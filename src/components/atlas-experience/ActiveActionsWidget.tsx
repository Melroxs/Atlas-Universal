// ---------------------------------------------------------------------------
// Active Actions Widget
//
// Compact Command Center component showing active action state.
// Displays: awaiting confirmation, executing, failed, recently completed.
// ---------------------------------------------------------------------------

import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/atlas-ui";
import { usePersistedActions } from "@/hooks/use-persisted-actions";
import { formatDate } from "@/components/atlas-ui";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  XCircle,
} from "lucide-react";

export function ActiveActionsWidget() {
  const navigate = useNavigate();
  const { activeActions, summary } = usePersistedActions();

  // Show most important actions first: awaiting confirmation, then executing, then failed
  const priorityActions = [
    ...activeActions.filter((a) => a.action.status === "awaiting_confirmation"),
    ...activeActions.filter((a) => a.action.status === "executing"),
    ...activeActions.filter((a) => a.action.status === "failed"),
  ].slice(0, 5);

  // Don't render if no active actions
  if (summary.total === 0 && priorityActions.length === 0) {
    return null;
  }

  return (
    <Panel className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-2.5">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Active Actions
        </h3>
        <button
          type="button"
          onClick={() => navigate("/dashboard/actions")}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
          View all
          <ExternalLink className="size-2.5" />
        </button>
      </div>

      {/* Summary row */}
      <div className="flex items-center gap-3 border-b border-border/30 px-4 py-2">
        {summary.pending > 0 && (
          <div className="flex items-center gap-1 text-[11px]">
            <Clock className="size-3 text-amber-500" />
            <span className="font-medium text-amber-600">{summary.pending}</span>
            <span className="text-muted-foreground">awaiting</span>
          </div>
        )}
        {summary.executing > 0 && (
          <div className="flex items-center gap-1 text-[11px]">
            <Loader2 className="size-3 text-blue-500 animate-pulse" />
            <span className="font-medium text-blue-600">{summary.executing}</span>
            <span className="text-muted-foreground">executing</span>
          </div>
        )}
        {summary.failed > 0 && (
          <div className="flex items-center gap-1 text-[11px]">
            <XCircle className="size-3 text-rose-500" />
            <span className="font-medium text-rose-600">{summary.failed}</span>
            <span className="text-muted-foreground">failed</span>
          </div>
        )}
        {summary.completed > 0 && (
          <div className="flex items-center gap-1 text-[11px]">
            <CheckCircle2 className="size-3 text-green-500" />
            <span className="font-medium text-green-600">{summary.completed}</span>
            <span className="text-muted-foreground">done</span>
          </div>
        )}
      </div>

      {/* Action items */}
      {priorityActions.length > 0 && (
        <div className="divide-y divide-border/30">
          {priorityActions.map((record) => {
            const { action } = record;
            const statusIcon =
              action.status === "awaiting_confirmation" ? (
                <Clock className="size-3 text-amber-500" />
              ) : action.status === "executing" ? (
                <Loader2 className="size-3 text-blue-500 animate-pulse" />
              ) : action.status === "failed" ? (
                <XCircle className="size-3 text-rose-500" />
              ) : (
                <AlertTriangle className="size-3 text-muted-foreground" />
              );

            return (
              <button
                key={action.id}
                type="button"
                onClick={() => navigate("/dashboard/actions")}
                className="flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-muted/30"
              >
                {statusIcon}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground truncate">
                    {action.description}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {action.entity.label} · {formatDate(new Date(action.createdAt).getTime())}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[9px] shrink-0",
                    action.status === "awaiting_confirmation" && "border-amber-400/30 text-amber-600",
                    action.status === "executing" && "border-blue-400/30 text-blue-600",
                    action.status === "failed" && "border-rose-400/30 text-rose-600",
                  )}
                >
                  {action.status.replace(/_/g, " ")}
                </Badge>
              </button>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
