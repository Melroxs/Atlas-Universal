// ---------------------------------------------------------------------------
// Atlas Action Panel
//
// Reusable component that provides executable action buttons wired to the
// Atlas execution layer. Used across Command Center, Decision Cards,
// Proactive Atlas, and entity detail pages.
//
// Every action:
//   1. Goes through the execution layer (not direct RPC calls)
//   2. Respects RBAC authorization
//   3. Requires confirmation for medium/high risk actions
//   4. Reports results back to the UI
// ---------------------------------------------------------------------------

import { useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import { usePersistedActions } from "@/hooks/use-persisted-actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  type AtlasExecutableAction,
  type AtlasActionResult,
  type AtlasUserRole,
  type AtlasActionType,
  type ActionRisk,
  createAction,
  checkAuthorization,
  getActionRisk,
  prepareForConfirmation,
  transitionAction,
  DEFAULT_CONFIRMATION_TIMEOUT_MS,
} from "@/lib/atlas-experience/execution";
import { executeAction, type ActionHandlerContext } from "@/lib/atlas-experience/action-handlers";
import { checkStaleness } from "@/lib/atlas-experience/staleness";
import { getSupabaseClient } from "@/lib/supabase";
import type { AtlasEntityReference } from "@/lib/atlas-experience/entity-reference";
import {
  ActionConfirmationDialog,
  type ConfirmationDialogState,
} from "./ActionConfirmationDialog";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileText,
  Loader2,
  Send,
  Shield,
  Sparkles,
  XCircle,
  Zap,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActionProposal {
  /** Action type to propose */
  type: AtlasActionType;
  /** Human-readable label */
  label: string;
  /** Entity this action operates on */
  entity: AtlasEntityReference;
  /** Additional parameters */
  params?: Record<string, unknown>;
  /** Decision ID for traceability */
  decisionId?: string;
  /** Recommendation ID for traceability */
  recommendationId?: string;
}

interface AtlasActionPanelProps {
  /** Available action proposals */
  actions: ActionProposal[];
  /** Current user role for authorization */
  userRole: AtlasUserRole;
  /** User ID for audit trail */
  userId: string;
  /** Layout variant */
  layout?: "horizontal" | "vertical" | "compact";
  /** Additional CSS class */
  className?: string;
}

// ---------------------------------------------------------------------------
// Risk badge styling
// ---------------------------------------------------------------------------

function RiskBadge({ risk }: { risk: ActionRisk }) {
  if (risk === "low") return null;
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono text-[9px] uppercase tracking-wide",
        risk === "high"
          ? "border-rose-400/30 bg-rose-400/10 text-rose-600 dark:text-rose-300"
          : "border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300",
      )}
    >
      {risk === "high" ? (
        <Shield className="mr-0.5 inline size-2.5" />
      ) : (
        <AlertTriangle className="mr-0.5 inline size-2.5" />
      )}
      {risk}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Action Icon mapping
// ---------------------------------------------------------------------------

const ACTION_ICONS: Record<AtlasActionType, typeof FileText> = {
  navigate: ArrowRight,
  show_evidence: FileText,
  show_decision: FileText,
  prepare_supplement: Sparkles,
  prepare_email: Send,
  submit_supplement: Send,
  send_email: Send,
  approve_recommendation: CheckCircle2,
  reject_recommendation: XCircle,
  execute_workflow: Zap,
  update_record: FileText,
  create_record: FileText,
  ask_followup: Sparkles,
};

// ---------------------------------------------------------------------------
// Action Confirmation Flow State
// ---------------------------------------------------------------------------

type ActionFlowState =
  | { phase: "idle" }
  | { phase: "confirming"; action: AtlasExecutableAction; proposal: ActionProposal }
  | { phase: "executing"; action: AtlasExecutableAction; proposal: ActionProposal }
  | { phase: "completed"; result: AtlasActionResult; proposal: ActionProposal }
  | { phase: "failed"; error: string; proposal: ActionProposal };

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function AtlasActionPanel({
  actions,
  userRole,
  userId,
  layout = "horizontal",
  className,
}: AtlasActionPanelProps) {
  const navigate = useNavigate();
  const [flowState, setFlowState] = useState<ActionFlowState>({ phase: "idle" });
  const { createAction: persistNewAction, transitionStatus: persistTransitionStatus } = usePersistedActions();

  const handleProposeAction = useCallback(
    (proposal: ActionProposal) => {
      // Check authorization
      const auth = checkAuthorization(proposal.type, userRole);
      if (!auth.allowed) {
        setFlowState({
          phase: "failed",
          error: `Not authorized: ${auth.reason}`,
          proposal,
        });
        return;
      }

      // Create the action
      const risk = getActionRisk(proposal.type);
      const action = createAction(
        proposal.type,
        proposal.label,
        proposal.label,
        proposal.entity,
        {
          ...proposal.params,
          decisionId: proposal.decisionId,
          recommendationId: proposal.recommendationId,
        },
        userId,
      );

      // Persist the proposed action
      persistNewAction(action);

      // Low-risk actions skip confirmation
      if (risk === "low") {
        handleExecute(action, proposal);
        return;
      }

      // Prepare for confirmation
      const prepared = prepareForConfirmation(action, DEFAULT_CONFIRMATION_TIMEOUT_MS);
      persistTransitionStatus(prepared.id, "awaiting_confirmation", userId, "Awaiting user confirmation");
      setFlowState({ phase: "confirming", action: prepared, proposal });
    },
    [userRole, userId],
  );

  const handleConfirm = useCallback(
    (confirmedAction: AtlasExecutableAction) => {
      const proposal = flowState.phase === "confirming" ? flowState.proposal : null;
      if (!proposal) return;
      handleExecute(confirmedAction, proposal);
    },
    [flowState],
  );

  const handleExecute = useCallback(
    async (action: AtlasExecutableAction, proposal: ActionProposal) => {
      setFlowState({ phase: "executing", action, proposal });

      try {
        // Staleness check before execution (skip for navigate/ask actions)
        if (action.type !== "navigate" && action.type !== "ask_followup" && action.type !== "show_evidence" && action.type !== "show_decision") {
          const supabase = getSupabaseClient();
          if (supabase) {
            const staleness = await checkStaleness(supabase, action);
            if (staleness.stale) {
              persistTransitionStatus(action.id, "stale", userId, staleness.explanation ?? "Source data changed");
              setFlowState({
                phase: "failed",
                error: `This action is stale: ${staleness.explanation ?? "The source data changed since this action was prepared."}`,
                proposal,
              });
              return;
            }
          }
        }

        persistTransitionStatus(action.id, "executing", userId, "Executing action");

        // Confirm the action before executing
        const confirmedAction = transitionAction(action, "confirmed", userId, "User confirmed");

        // Execute through the real backend
        const context: ActionHandlerContext = {
          userRole,
          userId,
        };
        const result = await executeAction(confirmedAction, context);

        if (result.status === "executed") {
          persistTransitionStatus(confirmedAction.id, "executed", userId, "Action executed successfully");
          setFlowState({ phase: "completed", result, proposal });
        } else {
          persistTransitionStatus(confirmedAction.id, "failed", userId, result.error?.message ?? result.message);
          setFlowState({
            phase: "failed",
            error: result.error?.message ?? result.message,
            proposal,
          });
        }
      } catch (e) {
        persistTransitionStatus(action.id, "failed", userId, e instanceof Error ? e.message : "Unknown error");
        setFlowState({
          phase: "failed",
          error: e instanceof Error ? e.message : "Unknown error",
          proposal,
        });
      }
    },
    [userId, userRole],
  );

  const handleCancel = useCallback(() => {
    setFlowState({ phase: "idle" });
  }, []);

  const handleDismiss = useCallback(() => {
    setFlowState({ phase: "idle" });
  }, []);

  // Filter to authorized actions only
  const authorizedActions = useMemo(
    () =>
      actions.filter((a) => {
        const auth = checkAuthorization(a.type, userRole);
        return auth.allowed;
      }),
    [actions, userRole],
  );

  if (authorizedActions.length === 0) return null;

  return (
    <>
      <div
        className={cn(
          layout === "vertical" && "flex flex-col gap-2",
          layout === "horizontal" && "flex flex-wrap gap-2",
          layout === "compact" && "flex gap-1.5",
          className,
        )}
      >
        {authorizedActions.map((proposal) => {
          const risk = getActionRisk(proposal.type);
          const Icon = ACTION_ICONS[proposal.type] ?? ArrowRight;
          const auth = checkAuthorization(proposal.type, userRole);

          return (
            <div key={`${proposal.type}-${proposal.entity.id}`} className="flex items-center gap-1.5">
              <Button
                size={layout === "compact" ? "sm" : "sm"}
                variant={risk === "high" ? "destructive" : risk === "medium" ? "default" : "outline"}
                className={cn(
                  "gap-1.5",
                  layout === "compact" && "h-7 text-[11px]",
                )}
                disabled={flowState.phase === "executing"}
                onClick={() => handleProposeAction(proposal)}
              >
                <Icon className="size-3" />
                {proposal.label}
              </Button>
              <RiskBadge risk={risk} />
              {auth.requiresApproval && (
                <Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 text-[9px] text-amber-600 dark:text-amber-300">
                  Approval needed
                </Badge>
              )}
            </div>
          );
        })}
      </div>

      {/* Confirmation Dialog */}
      <ActionConfirmationDialog
        open={flowState.phase === "confirming" || flowState.phase === "executing"}
        action={"action" in flowState ? flowState.action : null}
        state={
          flowState.phase === "confirming"
            ? "prepared"
            : flowState.phase === "executing"
              ? "executing"
              : "idle"
        }
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        onDismiss={handleDismiss}
      />

      {/* Completion/Failure toast-style feedback */}
      {flowState.phase === "completed" && (
        <CompletionFeedback
          result={flowState.result}
          proposal={flowState.proposal}
          onDismiss={handleDismiss}
        />
      )}
      {flowState.phase === "failed" && (
        <FailureFeedback
          error={flowState.error}
          proposal={flowState.proposal}
          onRetry={() => {
            const p = flowState.proposal;
            setFlowState({ phase: "idle" });
            // Small delay to allow state to clear
            setTimeout(() => handleProposeAction(p), 100);
          }}
          onDismiss={handleDismiss}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Completion Feedback
// ---------------------------------------------------------------------------

function CompletionFeedback({
  result,
  proposal,
  onDismiss,
}: {
  result: AtlasActionResult;
  proposal: ActionProposal;
  onDismiss: () => void;
}) {
  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm animate-in slide-in-from-bottom-4">
      <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4 shadow-lg backdrop-blur-sm">
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-400/20">
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-300" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
              Action completed
            </p>
            <p className="mt-0.5 text-xs text-emerald-700/80 dark:text-emerald-300/80">
              {result.message}
            </p>
            <div className="mt-2 flex gap-2">
              {proposal.entity.href && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 text-[11px]"
                  onClick={() => {
                    window.location.href = proposal.entity.href!;
                    onDismiss();
                  }}
                >
                  View {proposal.entity.type}
                  <ArrowRight className="size-3" />
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[11px]"
                onClick={onDismiss}
              >
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Failure Feedback
// ---------------------------------------------------------------------------

function FailureFeedback({
  error,
  proposal,
  onRetry,
  onDismiss,
}: {
  error: string;
  proposal: ActionProposal;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm animate-in slide-in-from-bottom-4">
      <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 shadow-lg backdrop-blur-sm">
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-rose-400/20">
            <XCircle className="size-4 text-rose-600 dark:text-rose-300" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-rose-800 dark:text-rose-200">
              Action failed
            </p>
            <p className="mt-0.5 text-xs text-rose-700/80 dark:text-rose-300/80">
              {error}
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-[11px]"
                onClick={onRetry}
              >
                <Loader2 className="size-3" />
                Retry
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[11px]"
                onClick={onDismiss}
              >
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hook: useAtlasActions
// ---------------------------------------------------------------------------

/**
 * Convenience hook that provides action proposal generation from Atlas data.
 * Use this to convert intelligence items, decisions, and attention items
 * into actionable proposals.
 */
export function useAtlasActions() {
  const generateDecisionActions = useCallback(
    (decision: {
      id: string;
      entity: AtlasEntityReference;
      recommendation: { title: string };
      status: string;
      requiresApproval?: boolean;
    }): ActionProposal[] => {
      const actions: ActionProposal[] = [];

      if (decision.status === "new") {
        actions.push({
          type: "approve_recommendation",
          label: "Approve",
          entity: decision.entity,
          params: { recommendationId: decision.id },
          decisionId: decision.id,
          recommendationId: decision.id,
        });
        actions.push({
          type: "reject_recommendation",
          label: "Reject",
          entity: decision.entity,
          params: { recommendationId: decision.id },
          decisionId: decision.id,
          recommendationId: decision.id,
        });
      }

      return actions;
    },
    [],
  );

  const generateAttentionActions = useCallback(
    (item: {
      id: string;
      entityType: string;
      entityId: string;
      category: string;
      title: string;
      navigationTarget?: string;
    }): ActionProposal[] => {
      const actions: ActionProposal[] = [];
      const entity: AtlasEntityReference = {
        type: item.entityType as AtlasEntityReference["type"],
        id: item.entityId,
        label: `${item.entityType} ${item.entityId}`,
        href: item.navigationTarget,
      };

      if (item.category === "revenue" || item.category === "supplement") {
        actions.push({
          type: "prepare_supplement",
          label: "Prepare Supplement",
          entity,
          params: { claimId: item.entityId },
        });
      } else if (item.category === "crm" || item.category === "outreach") {
        actions.push({
          type: "prepare_email",
          label: "Prepare Email",
          entity,
          params: { leadId: item.entityId },
        });
      } else if (item.category === "evidence") {
        actions.push({
          type: "show_evidence",
          label: "Review Evidence",
          entity,
        });
      }

      return actions;
    },
    [],
  );

  const generateSignalActions = useCallback(
    (signal: {
      type: string;
      entity?: AtlasEntityReference;
      sourceId?: string;
      sourceType?: string;
      title?: string;
    }): ActionProposal[] => {
      const actions: ActionProposal[] = [];
      if (!signal.entity) return actions;

      if (signal.type === "supplement_opportunity") {
        actions.push({
          type: "prepare_supplement",
          label: "Prepare Supplement",
          entity: signal.entity,
          params: { claimId: signal.entity.id },
        });
      } else if (signal.type === "evidence_gap") {
        actions.push({
          type: "show_evidence",
          label: "Review Evidence",
          entity: signal.entity,
        });
      } else if (signal.type === "pending_approval") {
        actions.push({
          type: "approve_recommendation",
          label: "Review & Approve",
          entity: signal.entity,
          params: { recommendationId: signal.sourceId },
        });
      }

      return actions;
    },
    [],
  );

  return {
    generateDecisionActions,
    generateAttentionActions,
    generateSignalActions,
  };
}
