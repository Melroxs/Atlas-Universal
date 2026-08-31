// ---------------------------------------------------------------------------
// Attention — Atlas's prioritized intelligence view
//
// Not a notification center. This is Atlas saying:
// "I've reviewed what's happening. Here's what matters, in order."
//
// ┌──────────────────────────────────────────────────────────────┐
// │ ATTENTION                                                    │
// │                                                              │
// │ Atlas has prioritized 12 things.                             │
// │                                                              │
// │ ── URGENT ──────────────────────────────────────────────────│
// │                                                              │
// │ Claim #1842    Potential recovery: $18,420                   │
// │ Carrier scope discrepancy identified.                        │
// │ Confidence: HIGH          [Investigate]  [Ask Atlas]        │
// │                                                              │
// │ ── OPPORTUNITIES ──────────────────────────────────────────│
// │                                                              │
// │ Claim #1773    Potential recovery: $11,600                   │
// │ Supplement opportunity detected.                             │
// └──────────────────────────────────────────────────────────────┘

import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { useIntelligence } from "@/lib/atlas-experience/useIntelligence";
import { useActivity } from "@/lib/atlas-experience/useActivity";
import { useDecisions } from "@/lib/atlas-experience/useDecisions";
import { useAtlasContext } from "@/lib/atlas-experience/context";
import { AtlasActionPanel, useAtlasActions } from "@/components/atlas-experience/AtlasActionPanel";
import { useAtlasActionAuth } from "@/hooks/use-atlas-action-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/atlas-ui";
import { ActivityTimeline } from "@/components/atlas-experience/ActivityTimeline";
import { AtlasDecisionSummary } from "@/components/atlas-experience/DecisionCard";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  Eye,
  FileText,
  Info,
  MessageSquareText,
  Radar,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Severity → visual mapping
// ---------------------------------------------------------------------------

const SEVERITY_CONFIG: Record<string, { icon: typeof AlertTriangle; color: string; bg: string; ring: string; label: string }> = {
  critical: {
    icon: AlertTriangle,
    color: "text-rose-600 dark:text-rose-300",
    bg: "bg-rose-400/10",
    ring: "ring-rose-400/25",
    label: "Urgent",
  },
  high: {
    icon: Target,
    color: "text-amber-600 dark:text-amber-300",
    bg: "bg-amber-400/10",
    ring: "ring-amber-400/25",
    label: "Important",
  },
  medium: {
    icon: Sparkles,
    color: "text-sky-600 dark:text-sky-300",
    bg: "bg-sky-400/10",
    ring: "ring-sky-400/25",
    label: "Notable",
  },
  low: {
    icon: Info,
    color: "text-muted-foreground",
    bg: "bg-muted/40",
    ring: "ring-border/50",
    label: "Routine",
  },
  info: {
    icon: Info,
    color: "text-muted-foreground",
    bg: "bg-muted/40",
    ring: "ring-border/50",
    label: "Informational",
  },
};

// ---------------------------------------------------------------------------
// AttentionItemCard — single attention item
// ---------------------------------------------------------------------------

function AttentionItemCard({ item }: { item: import("@/lib/atlas-experience/attention").AttentionItem }) {
  const navigate = useNavigate();
  const { generateAttentionActions } = useAtlasActions();
  const auth = useAtlasActionAuth();

  const severity = item.severity as string;
  const config = SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.info;
  const Icon = config.icon;

  const actions = useMemo(
    () =>
      generateAttentionActions({
        id: item.id,
        entityType: item.sourceEntityType ?? "claim",
        entityId: item.sourceEntityId ?? item.id,
        category: item.category,
        title: item.title,
        navigationTarget: item.navigationTarget,
      }),
    [item, generateAttentionActions],
  );

  const financialImpact = (item.meta?.financialImpact as number) ?? 0;

  return (
    <div className="flex w-full items-start gap-3 rounded-xl border border-border/60 bg-card/50 p-4 text-left transition-colors hover:bg-card/80">
      <div
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg ring-1",
          config.bg,
          config.ring,
          config.color,
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{item.title}</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              {item.explanation}
            </p>
          </div>
          {financialImpact > 0 && (
            <Badge
              variant="outline"
              className="shrink-0 border-emerald-400/30 bg-emerald-400/10 font-mono text-[10px] text-emerald-600 dark:text-emerald-300"
            >
              ${financialImpact.toLocaleString()}
            </Badge>
          )}
        </div>

        {/* Entity and time context */}
        <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground/60">
          {item.sourceEntityType && (
            <span className="capitalize">{item.sourceEntityType}</span>
          )}
          {item.category && (
            <>
              <span>·</span>
              <span className="capitalize">{item.category}</span>
            </>
          )}
        </div>

        {/* Actions */}
        <div className="mt-3 flex items-center gap-2">
          {item.navigationTarget && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => navigate(item.navigationTarget!)}
            >
              Investigate
              <ArrowRight className="size-3" />
            </Button>
          )}
          <AtlasActionPanel
            actions={actions}
            userRole={auth.userRole}
            userId={auth.userId}
            layout="compact"
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attention Page
// ---------------------------------------------------------------------------

export default function Attention() {
  const { items: attentionItems, counts, totalFinancialImpact, actionRequiredCount } = useIntelligence();
  const { activities, isLoading: activitiesLoading } = useActivity();
  const { sortedDecisions, pendingApprovals, totalPotentialImpact } = useDecisions();

  const [filter, setFilter] = useState<string | null>(null);

  // Group items by severity
  const grouped = useMemo(() => {
    const groups: Record<string, typeof attentionItems> = {};
    const severityOrder = ["critical", "high", "medium", "low", "info"];

    for (const item of attentionItems.filter((a) => a.status === "open")) {
      const sev = item.severity as string;
      if (!groups[sev]) groups[sev] = [];
      groups[sev].push(item);
    }

    return severityOrder
      .filter((sev) => groups[sev]?.length)
      .map((sev) => ({
        severity: sev,
        label: SEVERITY_CONFIG[sev]?.label ?? sev,
        items: groups[sev],
      }));
  }, [attentionItems]);

  const filteredGrouped = filter
    ? grouped.filter((g) => g.severity === filter)
    : grouped;

  const totalOpen = attentionItems.filter((a) => a.status === "open").length;

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <Eye className="size-5 text-teal-600 dark:text-teal-300" />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Attention</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {totalOpen > 0
            ? `Atlas has prioritized ${totalOpen} thing${totalOpen === 1 ? "" : "s"} that need your attention.`
            : "Atlas is monitoring your business. Nothing urgent right now."}
        </p>

        {/* Summary badges */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {counts.critical > 0 && (
            <Badge variant="outline" className="border-rose-400/30 bg-rose-400/10 font-mono text-[10px] text-rose-600 dark:text-rose-300">
              {counts.critical} urgent
            </Badge>
          )}
          {counts.high > 0 && (
            <Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 font-mono text-[10px] text-amber-600 dark:text-amber-300">
              {counts.high} important
            </Badge>
          )}
          {counts.medium > 0 && (
            <Badge variant="outline" className="border-sky-400/30 bg-sky-400/10 font-mono text-[10px] text-sky-600 dark:text-sky-300">
              {counts.medium} notable
            </Badge>
          )}
          {totalFinancialImpact > 0 && (
            <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 font-mono text-[10px] text-emerald-600 dark:text-emerald-300">
              ${totalFinancialImpact.toLocaleString()} potential impact
            </Badge>
          )}
        </div>

        {/* Filter tabs */}
        {grouped.length > 1 && (
          <div className="mt-4 flex gap-1">
            <button
              type="button"
              onClick={() => setFilter(null)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                !filter
                  ? "bg-teal-400/10 text-teal-700 dark:text-teal-200"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              All ({totalOpen})
            </button>
            {grouped.map((g) => {
              const cfg = SEVERITY_CONFIG[g.severity];
              return (
                <button
                  key={g.severity}
                  type="button"
                  onClick={() => setFilter(filter === g.severity ? null : g.severity)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                    filter === g.severity
                      ? `${cfg?.bg} ${cfg?.color}`
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  {g.label} ({g.items.length})
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Attention items grouped by severity */}
      {filteredGrouped.map((group) => (
        <div key={group.severity}>
          <div className="mb-3 flex items-center gap-2">
            <div
              className={cn(
                "flex size-5 items-center justify-center rounded-md",
                SEVERITY_CONFIG[group.severity]?.bg,
              )}
            >
              {(() => {
                const Icon = SEVERITY_CONFIG[group.severity]?.icon ?? Info;
                return <Icon className={cn("size-3", SEVERITY_CONFIG[group.severity]?.color)} />;
              })()}
            </div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {group.label}
            </h2>
            <span className="text-[10px] text-muted-foreground/60">
              {group.items.length}
            </span>
          </div>
          <div className="space-y-2">
            {group.items.map((item) => (
              <AttentionItemCard key={item.id} item={item} />
            ))}
          </div>
        </div>
      ))}

      {/* Empty state */}
      {totalOpen === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/70 py-16 text-center">
          <CheckCircle2 className="size-10 text-emerald-500/50" />
          <div>
            <p className="text-sm font-semibold text-foreground">You're clear.</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
              Atlas is monitoring your business continuously. When something needs your attention, it will appear here.
            </p>
          </div>
        </div>
      )}

      {/* Decisions needing approval */}
      {pendingApprovals.length > 0 && (
        <Panel className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Awaiting your decision</h2>
            <Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 font-mono text-[10px] text-amber-600 dark:text-amber-300">
              {pendingApprovals.length} need approval
            </Badge>
          </div>
          <div className="mt-3">
            <AtlasDecisionSummary decisions={pendingApprovals} maxItems={5} />
          </div>
        </Panel>
      )}

      {/* Recent activity */}
      <Panel className="p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Recent activity</h2>
        </div>
        <div className="mt-3">
          {activitiesLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <div className="size-4 animate-spin rounded-full border-2 border-teal-400 border-t-transparent" />
              Loading activity…
            </div>
          ) : (
            <ActivityTimeline activities={activities.slice(0, 10)} maxItems={10} showDateHeaders={false} />
          )}
        </div>
      </Panel>
    </div>
  );
}
