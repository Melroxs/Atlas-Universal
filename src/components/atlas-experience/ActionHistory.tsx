// ---------------------------------------------------------------------------
// Atlas Action History
//
// Displays completed, failed, and in-progress actions in a contextual
// timeline. Uses the existing Atlas activity/audit infrastructure rather
// than creating a parallel system.
//
// Answers: WHO acted, WHAT happened, WHEN, ON WHICH ENTITY, WHY, RESULT
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/atlas-ui";
import {
  type AtlasExecutableAction,
  type AtlasActionStatus,
  type ActionRisk,
  getAuditTrail,
} from "@/lib/atlas-experience/execution";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Send,
  Shield,
  Sparkles,
  XCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Status display
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  AtlasActionStatus,
  { label: string; icon: LucideIcon; color: string; bg: string }
> = {
  proposed: {
    label: "Proposed",
    icon: Sparkles,
    color: "text-blue-600 dark:text-blue-300",
    bg: "bg-blue-50 dark:bg-blue-950/30",
  },
  preparing: {
    label: "Preparing",
    icon: Loader2,
    color: "text-amber-600 dark:text-amber-300",
    bg: "bg-amber-50 dark:bg-amber-950/30",
  },
  prepared: {
    label: "Prepared",
    icon: FileText,
    color: "text-teal-600 dark:text-teal-300",
    bg: "bg-teal-50 dark:bg-teal-950/30",
  },
  awaiting_confirmation: {
    label: "Awaiting confirmation",
    icon: Clock,
    color: "text-amber-600 dark:text-amber-300",
    bg: "bg-amber-50 dark:bg-amber-950/30",
  },
  confirmed: {
    label: "Confirmed",
    icon: CheckCircle2,
    color: "text-green-600 dark:text-green-300",
    bg: "bg-green-50 dark:bg-green-950/30",
  },
  executing: {
    label: "Executing",
    icon: Loader2,
    color: "text-blue-600 dark:text-blue-300",
    bg: "bg-blue-50 dark:bg-blue-950/30",
  },
  executed: {
    label: "Executed",
    icon: CheckCircle2,
    color: "text-green-600 dark:text-green-300",
    bg: "bg-green-50 dark:bg-green-950/30",
  },
  verified: {
    label: "Verified",
    icon: CheckCircle2,
    color: "text-emerald-600 dark:text-emerald-300",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
  },
  failed: {
    label: "Failed",
    icon: XCircle,
    color: "text-rose-600 dark:text-rose-300",
    bg: "bg-rose-50 dark:bg-rose-950/30",
  },
  blocked: {
    label: "Blocked",
    icon: Shield,
    color: "text-rose-600 dark:text-rose-300",
    bg: "bg-rose-50 dark:bg-rose-950/30",
  },
  rejected: {
    label: "Rejected",
    icon: XCircle,
    color: "text-muted-foreground",
    bg: "bg-muted/50",
  },
  expired: {
    label: "Expired",
    icon: Clock,
    color: "text-muted-foreground",
    bg: "bg-muted/50",
  },
  stale: {
    label: "Stale",
    icon: AlertTriangle,
    color: "text-amber-600 dark:text-amber-300",
    bg: "bg-amber-50 dark:bg-amber-950/30",
  },
  cancelled: {
    label: "Cancelled",
    icon: XCircle,
    color: "text-muted-foreground",
    bg: "bg-muted/50",
  },
  retry_pending: {
    label: "Retry Pending",
    icon: Loader2,
    color: "text-amber-600 dark:text-amber-300",
    bg: "bg-amber-50 dark:bg-amber-950/30",
  },
  verification_pending: {
    label: "Verifying",
    icon: Loader2,
    color: "text-blue-600 dark:text-blue-300",
    bg: "bg-blue-50 dark:bg-blue-950/30",
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
      {risk}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Single action history entry
// ---------------------------------------------------------------------------

function ActionHistoryEntry({
  action,
  showEntity = true,
}: {
  action: AtlasExecutableAction;
  showEntity?: boolean;
}) {
  const navigate = useNavigate();
  const config = STATUS_CONFIG[action.status] ?? STATUS_CONFIG.proposed;
  const Icon = config.icon;
  const ActionIcon = ACTION_ICONS[action.type] ?? Zap;
  const auditTrail = getAuditTrail(action);

  const lastEntry = auditTrail[auditTrail.length - 1];
  const timestamp = lastEntry?.timestamp
    ? new Date(lastEntry.timestamp).toLocaleString()
    : "—";

  const isTerminal = ["executed", "verified", "failed", "blocked", "rejected", "expired", "stale"].includes(
    action.status,
  );
  const isAnimating = ["preparing", "executing"].includes(action.status);

  return (
    <div
      className={cn(
        "group flex items-start gap-3 rounded-lg border p-3 transition-colors",
        config.bg,
        "border-border/50 hover:border-border",
      )}
    >
      {/* Status icon */}
      <div
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
          config.bg,
          isAnimating && "animate-pulse",
        )}
      >
        <Icon className={cn("size-3.5", config.color)} />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <ActionIcon className="size-3 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">
            {action.description}
          </span>
          <RiskBadge risk={action.risk} />
        </div>

        {showEntity && action.entity && (
          <button
            type="button"
            onClick={() => action.entity.href && navigate(action.entity.href)}
            className="mt-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {action.entity.label}
            {action.entity.type && (
              <span className="ml-1 text-[10px] uppercase tracking-wider opacity-60">
                {action.entity.type}
              </span>
            )}
          </button>
        )}

        <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className={cn("font-medium", config.color)}>{config.label}</span>
          <span>{timestamp}</span>
          {action.createdBy && (
            <span className="opacity-60">by {action.createdBy.slice(0, 8)}…</span>
          )}
        </div>

        {/* Audit trail last message */}
        {lastEntry?.reason && (
          <p className="mt-1 text-xs text-muted-foreground italic">
            {lastEntry.reason}
          </p>
        )}
      </div>

      {/* Navigate button for terminal states */}
      {isTerminal && action.entity.href && (
        <button
          type="button"
          onClick={() => navigate(action.entity.href!)}
          className="mt-1 shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
        >
          View →
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action History Panel
// ---------------------------------------------------------------------------

export interface ActionHistoryProps {
  /** Actions to display, newest first */
  actions: AtlasExecutableAction[];
  /** Maximum items to show */
  maxItems?: number;
  /** Show entity references */
  showEntity?: boolean;
  /** Panel title */
  title?: string;
  /** Additional CSS class */
  className?: string;
}

export function ActionHistory({
  actions,
  maxItems = 20,
  showEntity = true,
  title = "Action History",
  className,
}: ActionHistoryProps) {
  const sortedActions = useMemo(() => {
    return [...actions]
      .sort((a, b) => {
        // Sort by most recent audit entry first
        const aLast = a.auditTrail[a.auditTrail.length - 1]?.timestamp ?? a.createdAt;
        const bLast = b.auditTrail[b.auditTrail.length - 1]?.timestamp ?? b.createdAt;
        return new Date(bLast).getTime() - new Date(aLast).getTime();
      })
      .slice(0, maxItems);
  }, [actions, maxItems]);

  if (sortedActions.length === 0) {
    return (
      <Panel className={className}>
        <h3 className="mb-3 text-sm font-medium text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">No actions yet.</p>
      </Panel>
    );
  }

  return (
    <Panel className={className}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <Badge variant="secondary" className="text-[10px]">
          {sortedActions.length}
        </Badge>
      </div>
      <div className="space-y-2">
        {sortedActions.map((action) => (
          <ActionHistoryEntry
            key={action.id}
            action={action}
            showEntity={showEntity}
          />
        ))}
      </div>
    </Panel>
  );
}
