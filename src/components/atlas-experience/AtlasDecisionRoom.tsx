// ---------------------------------------------------------------------------
// Atlas Decision Room
//
// The unified Decision → Preparation → Review → Decision → Execution experience.
//
// This is NOT a wizard. It is an Atlas decision room where:
//   - Atlas proposes
//   - Atlas prepares
//   - User reviews
//   - User decides
//   - Atlas executes (only with explicit approval)
//   - Atlas confirms
//
// Every stage is visually and behaviorally distinct.
// The distinction between preparation and execution is a safety boundary.
// ---------------------------------------------------------------------------

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/atlas-ui";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Edit3,
  ExternalLink,
  FileText,
  Info,
  Lightbulb,
  Loader2,
  MessageSquareText,
  Radar,
  RefreshCw,
  Shield,
  ShieldAlert,
  Sparkles,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The lifecycle stage of the action decision room */
export type DecisionRoomStage =
  | "recommend"      // Atlas recommends this action
  | "preparing"      // Atlas is preparing
  | "prepared"       // Preparation complete, ready for review
  | "reviewing"      // User is reviewing
  | "confirming"     // User has confirmed, before execution
  | "executing"      // Server is executing
  | "completed"      // Execution confirmed successful
  | "failed"         // Execution failed
  | "stale"          // Source data changed since preparation
  | "cancelled"      // User cancelled
  | "already_done";  // This action was already completed

/** What Atlas prepared */
export interface PreparedArtifact {
  label: string;
  count?: number;
  icon?: LucideIcon;
}

/** A step in Atlas's preparation process */
export interface PreparationStep {
  label: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
}

/** The full decision room configuration */
export interface DecisionRoomConfig {
  /** Entity context */
  entityLabel: string;
  entityType: string;
  entityId?: string;

  /** Atlas recommendation */
  recommendationLabel: string;
  recommendationReason: string;
  financialImpact?: number;
  confidence?: "high" | "medium" | "low";

  /** What Atlas prepared */
  preparedArtifacts: PreparedArtifact[];

  /** Preparation steps (for the preparation animation) */
  preparationSteps?: PreparationStep[];

  /** What will happen when user approves */
  executionSummary?: string[];

  /** Missing information */
  missingInformation?: string[];

  /** Staleness info */
  isStale?: boolean;
  staleReason?: string;
  /** What changed — only real changes, never fabricated */
  staleChanges?: Array<{ label: string; description?: string }>;

  /** Already completed info */
  alreadyCompleted?: boolean;
  completedAt?: string;

  /** Source fingerprint for freshness check */
  sourceFingerprint?: string;

  /** Current action status from server */
  serverStatus?: string;

  /** Whether execution is possible (connected destination, etc.) */
  executionReady?: boolean;
  executionBlockedReason?: string;

  /** Risk level */
  risk?: "low" | "medium" | "high";

  /** Action label for submission */
  actionLabel?: string;
}

// ---------------------------------------------------------------------------
// StageIndicator — visual progress through the decision room
// ---------------------------------------------------------------------------

const STAGE_LABELS: Record<string, string> = {
  recommend: "Atlas recommends",
  preparing: "Atlas is preparing",
  prepared: "Prepared for review",
  reviewing: "Review",
  confirming: "Your decision",
  executing: "Atlas is executing",
  completed: "Completed",
  failed: "Action failed",
  stale: "Needs review",
  cancelled: "Cancelled",
  already_done: "Already completed",
};

function StageIndicator({ stage }: { stage: DecisionRoomStage }) {
  const stages: DecisionRoomStage[] = ["recommend", "prepared", "confirming", "executing", "completed"];
  const currentIndex = stages.indexOf(stage);
  const isActive = !["failed", "cancelled", "stale", "already_done"].includes(stage);

  return (
    <div className="flex items-center gap-1">
      {stages.map((s, i) => (
        <div key={s} className="flex items-center gap-1">
          <div
            className={cn(
              "size-2 rounded-full transition-colors",
              i <= currentIndex && isActive
                ? "bg-teal-400"
                : i <= currentIndex && !isActive
                  ? "bg-amber-400"
                  : "bg-muted-foreground/20",
            )}
          />
          {i < stages.length - 1 && (
            <div
              className={cn(
                "h-px w-4",
                i < currentIndex && isActive
                  ? "bg-teal-400/50"
                  : "bg-muted-foreground/15",
              )}
            />
          )}
        </div>
      ))}
      <span className="ml-2 text-[10px] font-medium text-muted-foreground">
        {STAGE_LABELS[stage] ?? stage}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PreparationAnimation — shows real preparation steps
// ---------------------------------------------------------------------------

function PreparationAnimation({ steps }: { steps: PreparationStep[] }) {
  return (
    <Panel className="p-5">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-teal-600 dark:text-teal-300" />
        <h3 className="text-sm font-semibold text-teal-700 dark:text-teal-200">
          Atlas is preparing this…
        </h3>
      </div>
      <p className="mb-3 text-[11px] text-muted-foreground/70">
        Atlas is analyzing claim data, checking evidence, and assembling a proposed submission for your review.
      </p>
      <div className="mt-4 space-y-3">
        {steps.map((step, i) => (
          <div key={`${step.label}-${i}`} className="flex items-start gap-3">
            <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
              {step.status === "done" && (
                <Check className="size-3.5 text-emerald-500" />
              )}
              {step.status === "running" && (
                <Loader2 className="size-3.5 animate-spin text-teal-500" />
              )}
              {step.status === "pending" && (
                <div className="size-2 rounded-full bg-muted-foreground/20" />
              )}
              {step.status === "error" && (
                <X className="size-3.5 text-rose-500" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "text-xs",
                  step.status === "done"
                    ? "text-foreground"
                    : step.status === "running"
                      ? "font-medium text-foreground"
                      : step.status === "error"
                        ? "text-rose-600 dark:text-rose-300"
                        : "text-muted-foreground",
                )}
              >
                {step.label}
              </p>
              {step.detail && (
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {step.detail}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// PreparedSummary — shows what Atlas prepared
// ---------------------------------------------------------------------------

function PreparedSummary({ config }: { config: DecisionRoomConfig }) {
  return (
    <Panel className="p-5">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="size-4 text-emerald-500" />
        <h3 className="text-sm font-semibold text-foreground">
          What Atlas prepared
        </h3>
      </div>
      <div className="mt-3 space-y-2">
        {config.preparedArtifacts.map((artifact, i) => {
          const Icon = artifact.icon ?? FileText;
          return (
            <div key={`${artifact.label}-${i}`} className="flex items-center gap-2.5">
              <Icon className="size-3.5 text-teal-600 dark:text-teal-300" />
              <span className="text-sm text-foreground">
                {artifact.count ? (
                  <>
                    <span className="font-mono font-medium">{artifact.count}</span>{" "}
                    {artifact.label}
                  </>
                ) : (
                  artifact.label
                )}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 space-y-2">
        <p className="rounded-lg border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-200">
          Nothing has been submitted. Atlas has assembled this proposal from the available claim evidence. Review it before approving.
        </p>
        <p className="text-[10px] text-muted-foreground/60">
          This is an in-session assembly — no supplement record, documents, or submissions exist until you approve and Atlas confirms the server-side execution.
        </p>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// MissingInfo — shows gaps
// ---------------------------------------------------------------------------

function MissingInfo({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <Panel className="p-5">
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 text-amber-500" />
        <h3 className="text-sm font-semibold text-foreground">Missing information</h3>
      </div>
      <div className="mt-3 space-y-1.5">
        {items.map((item, i) => (
          <div key={`${item}-${i}`} className="flex items-start gap-2">
            <Info className="mt-0.5 size-3 shrink-0 text-amber-500" />
            <span className="text-xs text-muted-foreground">{item}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// BeforeYouApprove — decision explanation
// ---------------------------------------------------------------------------

function BeforeYouApprove({ config }: { config: DecisionRoomConfig }) {
  if (!config.executionSummary || config.executionSummary.length === 0) return null;
  return (
    <Panel className="border-teal-400/25 bg-teal-400/5 p-5">
      <div className="flex items-center gap-2">
        <Shield className="size-4 text-teal-600 dark:text-teal-300" />
        <h3 className="text-sm font-semibold text-teal-700 dark:text-teal-200">
          Before you approve
        </h3>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        If you approve, Atlas will attempt to:
      </p>
      <ul className="mt-2 space-y-1.5">
        {config.executionSummary.map((item, i) => (
          <li key={`${i}`} className="flex items-start gap-2 text-xs text-foreground">
            <span className="mt-1 size-1 shrink-0 rounded-full bg-teal-400" />
            {item}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Nothing has happened yet. Only your explicit approval will trigger server execution.
      </p>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// ExecutionStatus — shows execution state
// ---------------------------------------------------------------------------

function ExecutionStatus({
  stage,
  resultMessage,
  failedReason,
  completedAt,
}: {
  stage: DecisionRoomStage;
  resultMessage?: string;
  failedReason?: string;
  completedAt?: string;
}) {
  if (stage === "executing") {
    return (
      <Panel className="p-5">
        <div className="flex items-center gap-3">
          <Loader2 className="size-5 animate-spin text-teal-600 dark:text-teal-300" />
          <div>
            <p className="text-sm font-medium text-foreground">Atlas is executing…</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Completing the approved action. Please wait.
            </p>
          </div>
        </div>
      </Panel>
    );
  }

  if (stage === "completed") {
    return (
      <Panel className="border-emerald-400/25 bg-emerald-400/5 p-5">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="size-5 text-emerald-500" />
          <div>
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-200">
              Completed
            </p>
            {resultMessage && (
              <p className="mt-1 text-xs text-muted-foreground">{resultMessage}</p>
            )}
            {completedAt && (
              <p className="mt-0.5 text-[11px] text-muted-foreground/60">
                {completedAt}
              </p>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">
              Atlas recorded the result.
            </p>
          </div>
        </div>
      </Panel>
    );
  }

  if (stage === "failed") {
    return (
      <Panel className="border-rose-400/25 bg-rose-400/5 p-5">
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-5 text-rose-500" />
          <div>
            <p className="text-sm font-semibold text-rose-700 dark:text-rose-200">
              Action failed
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {failedReason ?? "I couldn't complete this action. Nothing was submitted."}
            </p>
          </div>
        </div>
      </Panel>
    );
  }

  if (stage === "stale") {
    return (
      <Panel className="border-amber-400/25 bg-amber-400/5 p-5">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-5 text-amber-500" />
          <div>
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-200">
              This action needs review
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              The underlying data changed since Atlas prepared this action.
              Atlas recommends reviewing the updated information before proceeding.
            </p>
          </div>
        </div>
      </Panel>
    );
  }

  if (stage === "already_done") {
    return (
      <Panel className="p-5">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="size-5 text-muted-foreground/50" />
          <div>
            <p className="text-sm font-medium text-foreground">Already completed</p>
            <p className="mt-1 text-xs text-muted-foreground">
              This action was already executed. No duplicate will be performed.
            </p>
          </div>
        </div>
      </Panel>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main: AtlasDecisionRoom
// ---------------------------------------------------------------------------

interface AtlasDecisionRoomProps {
  /** Current stage */
  stage: DecisionRoomStage;
  /** Configuration */
  config: DecisionRoomConfig;

  // Callbacks
  onPrepare?: () => void;
  onApprove?: () => void;
  onEdit?: () => void;
  onAskAtlas?: () => void;
  onCancel?: () => void;
  onRetry?: () => void;

  // Content slots
  children?: ReactNode;
}

export function AtlasDecisionRoom({
  stage,
  config,
  onPrepare,
  onApprove,
  onEdit,
  onAskAtlas,
  onCancel,
  onRetry,
  children,
}: AtlasDecisionRoomProps) {
  const riskColors = {
    low: "border-border/70 text-muted-foreground",
    medium: "border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300",
    high: "border-rose-400/30 bg-rose-400/10 text-rose-600 dark:text-rose-300",
  };

  const confidenceColors = {
    high: "border-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300",
    medium: "border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300",
    low: "border-border/70 text-muted-foreground",
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Stage Indicator */}
      <StageIndicator stage={stage} />

      {/* Entity Context Header */}
      <Panel className="p-5">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60">
          <span className="uppercase tracking-wider">{config.entityType}</span>
          <span>{config.entityLabel}</span>
          {config.risk && (
            <Badge variant="outline" className={cn("ml-auto font-mono text-[9px] uppercase", riskColors[config.risk])}>
              {config.risk} risk
            </Badge>
          )}
        </div>
        {typeof config.financialImpact === "number" && config.financialImpact > 0 && (
          <p className="mt-1.5 font-mono text-lg font-semibold text-emerald-600 dark:text-emerald-300">
            ${config.financialImpact.toLocaleString(undefined, { maximumFractionDigits: 0 })} potential recovery
          </p>
        )}
        {config.confidence && (
          <Badge
            variant="outline"
            className={cn("mt-2 font-mono text-[10px] uppercase tracking-wide", confidenceColors[config.confidence])}
          >
            {config.confidence} confidence
          </Badge>
        )}
      </Panel>

      {/* STAGE: Recommend */}
      {(stage === "recommend" || stage === "preparing" || stage === "prepared" || stage === "reviewing" || stage === "confirming" || stage === "executing" || stage === "completed" || stage === "failed" || stage === "stale" || stage === "cancelled") && (
        <Panel className="border-teal-400/25 bg-teal-400/5 p-5">
          <div className="flex items-center gap-2">
            <Radar className="size-4 text-teal-600 dark:text-teal-300" />
            <h3 className="text-sm font-semibold text-teal-700 dark:text-teal-200">
              Atlas recommends
            </h3>
          </div>
          <p className="mt-2 text-sm font-medium text-foreground">
            {config.recommendationLabel}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {config.recommendationReason}
          </p>
        </Panel>
      )}

      {/* STAGE: Preparing */}
      {stage === "preparing" && config.preparationSteps && (
        <PreparationAnimation steps={config.preparationSteps} />
      )}

      {/* STAGE: Prepared / Reviewing */}
      {(stage === "prepared" || stage === "reviewing" || stage === "confirming") && (
        <>
          <PreparedSummary config={config} />
          {config.missingInformation && config.missingInformation.length > 0 && (
            <MissingInfo items={config.missingInformation} />
          )}
          <BeforeYouApprove config={config} />
        </>
      )}

      {/* STAGE: Execution status */}
      {(stage === "executing" || stage === "completed" || stage === "failed" || stage === "stale" || stage === "already_done") && (
        <ExecutionStatus
          stage={stage}
          resultMessage={config.recommendationLabel}
          completedAt={config.completedAt}
        />
      )}

      {/* Content slot */}
      {children}

      {/* ACTION BUTTONS — contextual to stage */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Recommend stage: Prepare */}
        {stage === "recommend" && (
          <Button
            size="sm"
            className="gap-1.5 bg-teal-400 text-teal-950 hover:bg-teal-300"
            onClick={onPrepare}
            disabled={!onPrepare}
          >
            <Sparkles className="size-3.5" />
            Prepare
          </Button>
        )}

        {/* Prepared stage: Approve, Edit, Ask Atlas */}
        {stage === "prepared" && (
          <>
            <Button
              size="sm"
              className="gap-1.5 bg-teal-400 text-teal-950 hover:bg-teal-300"
              onClick={onApprove}
              disabled={!onApprove}
            >
              <CheckCircle2 className="size-3.5" />
              Approve & Submit
            </Button>
            {onEdit && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={onEdit}>
                <Edit3 className="size-3.5" />
                Edit
              </Button>
            )}
            {onAskAtlas && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={onAskAtlas}>
                <MessageSquareText className="size-3.5" />
                Ask Atlas
              </Button>
            )}
            {onCancel && (
              <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" onClick={onCancel}>
                <X className="size-3.5" />
                Cancel
              </Button>
            )}
          </>
        )}

        {/* Confirming stage: final Approve */}
        {stage === "confirming" && (
          <>
            <Button
              size="sm"
              className="gap-1.5 bg-teal-400 text-teal-950 hover:bg-teal-300"
              onClick={onApprove}
              disabled={!onApprove}
            >
              <CheckCircle2 className="size-3.5" />
              Confirm & Submit
            </Button>
            {onCancel && (
              <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" onClick={onCancel}>
                <X className="size-3.5" />
                Cancel
              </Button>
            )}
          </>
        )}

        {/* Failed stage: Retry */}
        {stage === "failed" && onRetry && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onRetry}>
            <RefreshCw className="size-3.5" />
            Retry
          </Button>
        )}

        {/* Stale stage: Review changes */}
        {stage === "stale" && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onPrepare}>
            <RefreshCw className="size-3.5" />
            Review Changes
          </Button>
        )}

        {/* Completed stage: View result */}
        {stage === "completed" && config.entityId && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onAskAtlas}>
            <MessageSquareText className="size-3.5" />
            Ask Atlas what happened
          </Button>
        )}
      </div>
    </div>
  );
}
