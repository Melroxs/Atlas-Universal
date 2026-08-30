// ---------------------------------------------------------------------------
// Atlas Action History Page
//
// Dedicated page for viewing all persisted actions with filtering.
// Route: /dashboard/actions (reuses existing Actions route)
// ---------------------------------------------------------------------------

import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PageHeader } from "@/components/atlas-ui";
import { formatDate } from "@/components/atlas-ui";
import { usePersistedActions } from "@/hooks/use-persisted-actions";
import { useAtlasActionAuth } from "@/hooks/use-atlas-action-auth";
import { ActionDetail } from "@/components/atlas-experience/ActionDetail";
import type { PersistedAction } from "@/lib/atlas-experience/action-persistence";
import type { AtlasActionStatus, ActionRisk } from "@/lib/atlas-experience/execution";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  FileText,
  Filter,
  Search,
  Shield,
  Sparkles,
  XCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Status display config
// ---------------------------------------------------------------------------

const STATUS_OPTIONS: Array<{ value: AtlasActionStatus | "all"; label: string; icon: LucideIcon; color: string }> = [
  { value: "all", label: "All", icon: Eye, color: "text-foreground" },
  { value: "awaiting_confirmation", label: "Pending", icon: Clock, color: "text-amber-600" },
  { value: "preparing", label: "Preparing", icon: Sparkles, color: "text-blue-600" },
  { value: "executing", label: "Executing", icon: Zap, color: "text-blue-600" },
  { value: "executed", label: "Executed", icon: CheckCircle2, color: "text-green-600" },
  { value: "verified", label: "Verified", icon: CheckCircle2, color: "text-emerald-600" },
  { value: "failed", label: "Failed", icon: XCircle, color: "text-rose-600" },
  { value: "expired", label: "Expired", icon: Clock, color: "text-muted-foreground" },
  { value: "blocked", label: "Blocked", icon: Shield, color: "text-rose-600" },
  { value: "rejected", label: "Rejected", icon: XCircle, color: "text-muted-foreground" },
  { value: "stale", label: "Stale", icon: Sparkles, color: "text-amber-600" },
];

const STATUS_COLORS: Record<string, string> = {
  proposed: "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300",
  preparing: "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300",
  prepared: "bg-teal-50 text-teal-700 dark:bg-teal-950/30 dark:text-teal-300",
  awaiting_confirmation: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
  confirmed: "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300",
  executing: "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300",
  executed: "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300",
  verified: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300",
  failed: "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300",
  blocked: "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300",
  rejected: "bg-muted text-muted-foreground",
  expired: "bg-muted text-muted-foreground",
  stale: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
};

const RISK_COLORS: Record<ActionRisk, string> = {
  low: "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300",
  medium: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
  high: "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300",
};

// ---------------------------------------------------------------------------
// Action Row
// ---------------------------------------------------------------------------

function ActionRow({
  record,
  onClick,
}: {
  record: PersistedAction;
  onClick: () => void;
}) {
  const { action } = record;
  const lastAudit = action.auditTrail[action.auditTrail.length - 1];

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border border-border/50 p-3 text-left transition-colors",
        "hover:border-border hover:bg-muted/30",
      )}
    >
      {/* Status indicator */}
      <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", STATUS_COLORS[action.status] ?? "bg-muted")}>
        {["executed", "verified"].includes(action.status) ? (
          <CheckCircle2 className="size-4" />
        ) : action.status === "failed" || action.status === "blocked" ? (
          <XCircle className="size-4" />
        ) : action.status === "awaiting_confirmation" ? (
          <Clock className="size-4" />
        ) : (
          <Sparkles className="size-4" />
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">
            {action.description}
          </span>
          <Badge variant="outline" className={cn("text-[9px] shrink-0", STATUS_COLORS[action.status])}>
            {action.status.replace(/_/g, " ")}
          </Badge>
          <Badge variant="outline" className={cn("text-[9px] shrink-0", RISK_COLORS[action.risk])}>
            {action.risk}
          </Badge>
        </div>
        <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
          <span>{action.entity.label}</span>
          <span>·</span>
          <span>{action.type.replace(/_/g, " ")}</span>
          <span>·</span>
          <span>{formatDate(new Date(action.createdAt).getTime())}</span>
          {lastAudit?.actor && (
            <>
              <span>·</span>
              <span>by {lastAudit.actor.length > 12 ? `${lastAudit.actor.slice(0, 8)}…` : lastAudit.actor}</span>
            </>
          )}
        </div>
      </div>

      {/* Source badge */}
      {record.source === "server" && (
        <Badge variant="secondary" className="text-[9px] shrink-0">
          synced
        </Badge>
      )}

      <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// ActionHistoryPage
// ---------------------------------------------------------------------------

export default function ActionHistoryPage() {
  const navigate = useNavigate();
  const { userId, userRole } = useAtlasActionAuth();
  const { actions, summary, activeActions } = usePersistedActions();

  const [statusFilter, setStatusFilter] = useState<AtlasActionStatus | "all">("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [riskFilter, setRiskFilter] = useState<ActionRisk | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAction, setSelectedAction] = useState<PersistedAction | null>(null);

  // Get unique action types
  const actionTypes = useMemo(() => {
    const types = new Set(actions.map((a) => a.action.type));
    return Array.from(types).sort();
  }, [actions]);

  // Get unique entity types
  const entityTypes = useMemo(() => {
    const types = new Set(actions.map((a) => a.action.entity.type));
    return Array.from(types).sort();
  }, [actions]);

  // Filter actions
  const filteredActions = useMemo(() => {
    let result = actions;

    if (statusFilter !== "all") {
      result = result.filter((a) => a.action.status === statusFilter);
    }
    if (typeFilter !== "all") {
      result = result.filter((a) => a.action.type === typeFilter);
    }
    if (entityFilter !== "all") {
      result = result.filter((a) => a.action.entity.type === entityFilter);
    }
    if (riskFilter !== "all") {
      result = result.filter((a) => a.action.risk === riskFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (a) =>
          a.action.description.toLowerCase().includes(q) ||
          a.action.entity.label.toLowerCase().includes(q) ||
          a.action.type.replace(/_/g, " ").includes(q),
      );
    }

    return result.sort(
      (a, b) => new Date(b.action.createdAt).getTime() - new Date(a.action.createdAt).getTime(),
    );
  }, [actions, statusFilter, typeFilter, searchQuery]);

  // If an action is selected, show detail view
  if (selectedAction) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSelectedAction(null)}
          className="gap-1.5"
        >
          <ArrowLeft className="size-3" />
          Back to History
        </Button>
        <ActionDetail
          persistedAction={selectedAction}
          showBack={false}
          onDismiss={(id) => {
            setSelectedAction(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Action History"
        description="All Atlas actions with full audit trail"
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Panel className="p-3">
          <div className="text-xs text-muted-foreground">Total</div>
          <div className="text-lg font-semibold">{summary.total}</div>
        </Panel>
        <Panel className="p-3">
          <div className="text-xs text-muted-foreground">Pending</div>
          <div className="text-lg font-semibold text-amber-600">{summary.pending}</div>
        </Panel>
        <Panel className="p-3">
          <div className="text-xs text-muted-foreground">Completed</div>
          <div className="text-lg font-semibold text-green-600">{summary.completed}</div>
        </Panel>
        <Panel className="p-3">
          <div className="text-xs text-muted-foreground">Failed</div>
          <div className="text-lg font-semibold text-rose-600">{summary.failed}</div>
        </Panel>
      </div>

      {/* Filters */}
      <Panel className="p-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search actions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-md border border-border bg-background pl-8 pr-3 py-1.5 text-sm"
            />
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-1">
            <Filter className="size-3 text-muted-foreground" />
            <div className="flex gap-0.5">
              {STATUS_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setStatusFilter(opt.value)}
                    className={cn(
                      "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                      statusFilter === opt.value
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <Icon className="size-2.5" />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Type filter */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          >
            <option value="all">All Types</option>
            {actionTypes.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>

          {/* Entity filter */}
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          >
            <option value="all">All Entities</option>
            {entityTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          {/* Risk filter */}
          <select
            value={riskFilter}
            onChange={(e) => setRiskFilter(e.target.value as ActionRisk | "all")}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          >
            <option value="all">All Risks</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
      </Panel>

      {/* Action list */}
      <div className="space-y-2">
        {filteredActions.length === 0 ? (
          <Panel className="p-6 text-center">
            <p className="text-sm text-muted-foreground">
              {actions.length === 0
                ? "No actions yet. Actions will appear here when you interact with Atlas."
                : "No actions match the current filters."}
            </p>
          </Panel>
        ) : (
          filteredActions.map((record) => (
            <ActionRow
              key={record.action.id}
              record={record}
              onClick={() => setSelectedAction(record)}
            />
          ))
        )}
      </div>

      {/* Count */}
      {filteredActions.length > 0 && (
        <p className="text-center text-xs text-muted-foreground">
          Showing {filteredActions.length} of {actions.length} actions
        </p>
      )}
    </div>
  );
}
