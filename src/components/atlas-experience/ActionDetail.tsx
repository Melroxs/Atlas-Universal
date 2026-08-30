// ---------------------------------------------------------------------------
// Atlas Action Detail
//
// Full-page experience for a single persisted action showing:
//   - What Atlas proposed (entity, type, risk, status)
//   - Why it matters (originating decision, evidence, recommendation)
//   - Lifecycle visualization (proposed → verified)
//   - Audit trail (who, what, when, why)
//   - Source traceability (back to claim, document, supplement, etc.)
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/atlas-ui";
import { formatDate } from "@/components/atlas-ui";
import {
  type AtlasExecutableAction,
  type AtlasActionStatus,
  type ActionRisk,
  type ActionAuditEntry,
  getAuditTrail,
  DEFAULT_ACTION_LIFECYCLE,
} from "@/lib/atlas-experience/execution";
import type { PersistedAction } from "@/lib/atlas-experience/action-persistence";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  Hash,
  Loader2,
  Send,
  Shield,
  Sparkles,
  User,
  XCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  AtlasActionStatus,
  { label: string; icon: LucideIcon; color: string; bg: string; description: string }
> = {
  proposed: {
    label: "Proposed",
    icon: Sparkles,
    color: "text-blue-600 dark:text-blue-300",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    description: "Atlas suggested this action",
  },
  preparing: {
    label: "Preparing",
    icon: Loader2,
    color: "text-amber-600 dark:text-amber-300",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    description: "Creating draft/artifact",
  },
  prepared: {
    label: "Prepared",
    icon: FileText,
    color: "text-teal-600 dark:text-teal-300",
    bg: "bg-teal-50 dark:bg-teal-950/30",
    description: "Draft ready for review",
  },
  awaiting_confirmation: {
    label: "Awaiting Confirmation",
    icon: Clock,
    color: "text-amber-600 dark:text-amber-300",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    description: "Waiting for human confirmation",
  },
  confirmed: {
    label: "Confirmed",
    icon: CheckCircle2,
    color: "text-green-600 dark:text-green-300",
    bg: "bg-green-50 dark:bg-green-950/30",
    description: "Human confirmed, ready to execute",
  },
  executing: {
    label: "Executing",
    icon: Loader2,
    color: "text-blue-600 dark:text-blue-300",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    description: "Being executed against backend",
  },
  executed: {
    label: "Executed",
    icon: CheckCircle2,
    color: "text-green-600 dark:text-green-300",
    bg: "bg-green-50 dark:bg-green-950/30",
    description: "Successfully completed",
  },
  verified: {
    label: "Verified",
    icon: CheckCircle2,
    color: "text-emerald-600 dark:text-emerald-300",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    description: "Result verified against backend state",
  },
  failed: {
    label: "Failed",
    icon: XCircle,
    color: "text-rose-600 dark:text-rose-300",
    bg: "bg-rose-50 dark:bg-rose-950/30",
    description: "Execution failed",
  },
  blocked: {
    label: "Blocked",
    icon: Shield,
    color: "text-rose-600 dark:text-rose-300",
    bg: "bg-rose-50 dark:bg-rose-950/30",
    description: "Authorization denied",
  },
  rejected: {
    label: "Rejected",
    icon: XCircle,
    color: "text-muted-foreground",
    bg: "bg-muted/50",
    description: "Human rejected this action",
  },
  expired: {
    label: "Expired",
    icon: Clock,
    color: "text-muted-foreground",
    bg: "bg-muted/50",
    description: "Confirmation timed out",
  },
  stale: {
    label: "Stale",
    icon: AlertTriangle,
    color: "text-amber-600 dark:text-amber-300",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    description: "Source data changed before execution",
  },
  cancelled: {
    label: "Cancelled",
    icon: XCircle,
    color: "text-muted-foreground",
    bg: "bg-muted/50",
    description: "Action was cancelled",
  },
  retry_pending: {
    label: "Retry Pending",
    icon: Loader2,
    color: "text-amber-600 dark:text-amber-300",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    description: "Failed but safe to retry",
  },
  verification_pending: {
    label: "Verifying",
    icon: Loader2,
    color: "text-blue-600 dark:text-blue-300",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    description: "Execution result pending verification",
  },
};

const ACTION_ICONS: Record<string, LucideIcon> = {
  navigate: Zap,
  show_evidence: FileText,
  show_decision: FileText,
  prepare_supplement: Sparkles,
  prepare_email: Send,
  prepare_crm_activity: FileText,
  submit_supplement: Send,
  send_email: Send,
  approve_recommendation: CheckCircle2,
  reject_recommendation: XCircle,
  execute_workflow: Zap,
  update_record: FileText,
  create_record: FileText,
  ask_followup: Sparkles,
};

const LIFECYCLE_STATES = DEFAULT_ACTION_LIFECYCLE;

// ---------------------------------------------------------------------------
// Risk Badge
// ---------------------------------------------------------------------------

function RiskBadge({ risk }: { risk: ActionRisk }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono text-[10px] uppercase tracking-wide",
        risk === "high"
          ? "border-rose-400/30 bg-rose-400/10 text-rose-600 dark:text-rose-300"
          : risk === "medium"
            ? "border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300"
            : "border-green-400/30 bg-green-400/10 text-green-600 dark:text-green-300",
      )}
    >
      {risk === "high" && <Shield className="mr-0.5 inline size-2.5" />}
      {risk === "medium" && <AlertTriangle className="mr-0.5 inline size-2.5" />}
      {risk} risk
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Lifecycle Visualization
// ---------------------------------------------------------------------------

function LifecycleVisualization({ status }: { status: AtlasActionStatus }) {
  const currentIdx = LIFECYCLE_STATES.indexOf(status);
  const isTerminal = ["failed", "blocked", "rejected", "expired", "stale"].includes(status);

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-2">
      {LIFECYCLE_STATES.map((state, idx) => {
        const config = STATUS_CONFIG[state];
        const Icon = config.icon;
        const isActive = idx === currentIdx;
        const isPast = currentIdx >= 0 && idx < currentIdx;
        const isFuture = currentIdx >= 0 && idx > currentIdx;

        return (
          <div key={state} className="flex items-center">
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors",
                isActive && config.bg,
                isActive && config.color,
                isPast && "text-green-600 dark:text-green-300",
                isFuture && "text-muted-foreground/50",
                isTerminal && idx > currentIdx && "opacity-30",
              )}
            >
              {isPast ? (
                <CheckCircle2 className="size-3" />
              ) : (
                <Icon className={cn("size-3", isActive && "animate-pulse")} />
              )}
              <span className="hidden sm:inline">{config.label}</span>
            </div>
            {idx < LIFECYCLE_STATES.length - 1 && (
              <ChevronRight className="size-3 text-muted-foreground/30 mx-0.5" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit Trail Entry
// ---------------------------------------------------------------------------

function AuditTrailEntry({
  entry,
  isLast,
}: {
  entry: ActionAuditEntry;
  isLast: boolean;
}) {
  const fromConfig = entry.from ? STATUS_CONFIG[entry.from as AtlasActionStatus] : null;
  const toConfig = STATUS_CONFIG[entry.to as AtlasActionStatus];

  return (
    <div className="flex gap-3">
      {/* Timeline dot */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "size-2 rounded-full",
            isLast ? "bg-blue-500" : "bg-muted-foreground/30",
          )}
        />
        {!isLast && <div className="w-px flex-1 bg-border" />}
      </div>

      {/* Content */}
      <div className="pb-4">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium text-foreground">
            {fromConfig ? fromConfig.label : "Created"} → {toConfig.label}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{formatDate(new Date(entry.timestamp).getTime())}</span>
          {entry.actor && (
            <>
              <span>·</span>
              <span className="flex items-center gap-1">
                <User className="size-2.5" />
                {entry.actor.length > 12 ? `${entry.actor.slice(0, 8)}…` : entry.actor}
              </span>
            </>
          )}
        </div>
        {entry.reason && (
          <p className="mt-1 text-xs text-muted-foreground italic">
            {entry.reason}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActionDetail Component
// ---------------------------------------------------------------------------

export interface ActionDetailProps {
  /** The persisted action to display */
  persistedAction: PersistedAction;
  /** Show back navigation */
  showBack?: boolean;
  /** Additional CSS class */
  className?: string;
  /** Callback for retry (re-prepare) */
  onRetry?: (action: AtlasExecutableAction) => void;
  /** Callback for dismiss */
  onDismiss?: (actionId: string) => void;
}

export function ActionDetail({
  persistedAction,
  showBack = true,
  className,
  onRetry,
  onDismiss,
}: ActionDetailProps) {
  const navigate = useNavigate();
  const { action, conversationId, signalId } = persistedAction;
  const config = STATUS_CONFIG[action.status];
  const Icon = config.icon;
  const ActionIcon = ACTION_ICONS[action.type] ?? Zap;
  const auditTrail = getAuditTrail(action);

  const isTerminal = ["executed", "verified", "failed", "blocked", "rejected", "expired", "stale"].includes(
    action.status,
  );
  const canRetry = ["failed", "expired", "stale"].includes(action.status);
  const canDismiss = ["rejected", "expired", "stale", "failed"].includes(action.status);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex size-10 items-center justify-center rounded-xl",
            config.bg,
          )}
        >
          <Icon className={cn("size-5", config.color)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <ActionIcon className="size-4 text-muted-foreground" />
            <h2 className="text-base font-semibold text-foreground">
              {action.description}
            </h2>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px]">
              {action.type.replace(/_/g, " ")}
            </Badge>
            <RiskBadge risk={action.risk} />
            <Badge
              variant="outline"
              className={cn("text-[10px]", config.color)}
            >
              {config.label}
            </Badge>
          </div>
        </div>
      </div>

      {/* Entity */}
      {action.entity && (
        <Panel>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Entity
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {action.entity.label}
            </span>
            <Badge variant="outline" className="text-[10px]">
              {action.entity.type}
            </Badge>
            {action.entity.href && (
              <button
                type="button"
                onClick={() => navigate(action.entity.href!)}
                className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-300 flex items-center gap-1"
              >
                View <ExternalLink className="size-2.5" />
              </button>
            )}
          </div>
        </Panel>
      )}

      {/* Lifecycle */}
      <Panel>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Lifecycle
        </h3>
        <LifecycleVisualization status={action.status} />
      </Panel>

      {/* Source Traceability */}
      <Panel>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Source
        </h3>
        <div className="space-y-1.5 text-sm">
          {action.decisionId && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Decision:</span>
              <button
                type="button"
                onClick={() => navigate(`/dashboard/recommendations`)}
                className="text-blue-600 hover:text-blue-700 dark:text-blue-300 flex items-center gap-1"
              >
                <Hash className="size-3" />
                {action.decisionId.slice(0, 8)}…
                <ExternalLink className="size-2.5" />
              </button>
            </div>
          )}
          {action.recommendationId && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Recommendation:</span>
              <button
                type="button"
                onClick={() => navigate(`/dashboard/recommendations`)}
                className="text-blue-600 hover:text-blue-700 dark:text-blue-300 flex items-center gap-1"
              >
                <Hash className="size-3" />
                {action.recommendationId.slice(0, 8)}…
                <ExternalLink className="size-2.5" />
              </button>
            </div>
          )}
          {conversationId && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Conversation:</span>
              <span className="text-foreground font-mono text-xs">
                {conversationId.slice(0, 8)}…
              </span>
            </div>
          )}
          {signalId && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Signal:</span>
              <span className="text-foreground font-mono text-xs">
                {signalId.slice(0, 8)}…
              </span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Created:</span>
            <span className="text-foreground">{formatDate(new Date(action.createdAt).getTime())}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">By:</span>
            <span className="text-foreground">{action.createdBy}</span>
          </div>
          {action.expiresAt && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Expires:</span>
              <span
                className={cn(
                  "text-foreground",
                  new Date(action.expiresAt) < new Date() && "text-rose-600",
                )}
              >
                {formatDate(new Date(action.expiresAt).getTime())}
              </span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Idempotency key:</span>
            <span className="text-foreground font-mono text-xs">
              {action.idempotencyKey.slice(0, 16)}…
            </span>
          </div>
        </div>
      </Panel>

      {/* Execution Result */}
      {action.result && (
        <Panel
          className={cn(
            action.result.status === "executed"
              ? "border-green-200 dark:border-green-800"
              : "border-rose-200 dark:border-rose-800",
          )}
        >
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Result
          </h3>
          <div className="space-y-1.5 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Status:</span>
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px]",
                  action.result.status === "executed"
                    ? "border-green-400/30 text-green-600 dark:text-green-300"
                    : "border-rose-400/30 text-rose-600 dark:text-rose-300",
                )}
              >
                {action.result.status}
              </Badge>
            </div>
            <p className="text-foreground">{action.result.message}</p>
            {action.result.error && (
              <p className="text-xs text-rose-600 dark:text-rose-300">
                {action.result.error.message}
              </p>
            )}
          </div>
        </Panel>
      )}

      {/* Audit Trail */}
      {auditTrail.length > 0 && (
        <Panel>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Audit Trail
          </h3>
          <div className="space-y-0">
            {auditTrail.map((entry, idx) => (
              <AuditTrailEntry
                key={`${entry.timestamp}-${idx}`}
                entry={entry}
                isLast={idx === auditTrail.length - 1}
              />
            ))}
          </div>
        </Panel>
      )}

      {/* Parameters */}
      {Object.keys(action.parameters).length > 0 && (
        <Panel>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Parameters
          </h3>
          <pre className="text-xs text-foreground bg-muted/50 rounded-lg p-3 overflow-auto max-h-40">
            {JSON.stringify(action.parameters, null, 2)}
          </pre>
        </Panel>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        {action.entity.href && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate(action.entity.href!)}
          >
            View {action.entity.type}
            <ArrowRight className="ml-1 size-3" />
          </Button>
        )}
        {canRetry && onRetry && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRetry(action)}
          >
            Retry
          </Button>
        )}
        {canDismiss && onDismiss && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onDismiss(action.id)}
          >
            Dismiss
          </Button>
        )}
      </div>
    </div>
  );
}
