// ---------------------------------------------------------------------------
// Attention — Atlas's intelligence briefing
//
// Not a notification center. This is Atlas saying:
// "I've reviewed what's happening. Here's what matters, in order."
//
// Each item answers:
//   1. What happened?
//   2. Why does it matter?
//   3. What does Atlas recommend?
//
// ┌──────────────────────────────────────────────────────────────┐
// │                                                              │
// │  I've prioritized 12 things that need your attention.       │
// │                                                              │
// │  ── URGENT ──────────────────────────────────────────────   │
// │                                                              │
// │  Claim #1842              $18,420 potential recovery        │
// │                                                              │
// │  Carrier scope discrepancy identified. The estimate         │
// │  excludes documented scope that should be covered.          │
// │                                                              │
// │  Atlas recommends: Investigate supplement.                  │
// │  Evidence confidence: High                                  │
// │                                                              │
// │  [ Investigate ]  [ Ask Atlas ]                             │
// │                                                              │
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
  Eye,
  Info,
  Radar,
  Sparkles,
  Target,
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
// Confidence bar — small inline confidence indicator
// ---------------------------------------------------------------------------

function ConfidenceIndicator({ severity }: { severity: string }) {
  const level = severity === "critical" || severity === "high" ? "high" : severity === "medium" ? "medium" : "low";
  const colors = {
    high: "bg-emerald-400",
    medium: "bg-amber-400",
    low: "bg-muted-foreground/40",
  };

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={cn(
              "size-1 rounded-full",
              i <= (level === "high" ? 2 : level === "medium" ? 1 : 0)
                ? colors[level]
                : "bg-muted-foreground/20"
            )}
          />
        ))}
      </div>
      <span className="text-[10px] text-muted-foreground/60 capitalize">{level}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AttentionItemCard — single intelligence item with Atlas narration
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
    <div className="rounded-xl border border-border/60 bg-card/50 p-5 transition-colors hover:bg-card/80">
      {/* Entity + financial impact */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-lg ring-1",
              config.bg,
              config.ring,
              config.color,
            )}
          >
            <Icon className="size-3.5" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{item.title}</p>
            {item.sourceEntityType && (
              <p className="text-[10px] capitalize text-muted-foreground/60">{item.sourceEntityType}</p>
            )}
          </div>
        </div>
        {financialImpact > 0 && (
          <span className="shrink-0 font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-300">
            ${financialImpact.toLocaleString()}
          </span>
        )}
      </div>

      {/* Atlas narration — what happened and why it matters */}
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        {item.explanation}
      </p>

      {/* What changed — when real data supports it */}
      {typeof item.meta?.whatChanged === "string" && item.meta.whatChanged.length > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground/70">
          <span className="font-medium text-muted-foreground">What changed:</span> {item.meta.whatChanged}
        </p>
      )}

      {/* Atlas recommendation */}
      {item.nextAction && (
        <p className="mt-1.5 text-[11px] text-teal-700 dark:text-teal-200">
          <span className="font-medium">Atlas recommends:</span> {item.nextAction}
        </p>
      )}

      {/* Atlas recommendation + confidence */}
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ConfidenceIndicator severity={severity} />
          {item.navigationTarget && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 h-7 text-[11px]"
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
// Attention Page — Atlas intelligence briefing
// ---------------------------------------------------------------------------

export default function Attention() {
  const { items: attentionItems, counts, totalFinancialImpact } = useIntelligence();
  const { activities, isLoading: activitiesLoading } = useActivity();
  const { sortedDecisions, pendingApprovals } = useDecisions();

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
      {/* Atlas narrates the briefing */}
      <div>
        <p className="text-sm leading-6 text-muted-foreground">
          {totalOpen > 0 ? (
            <>
              I've prioritized{" "}
              <span className="font-medium text-foreground">{totalOpen}</span>{" "}
              thing{totalOpen === 1 ? "" : "s"} that need your attention.
            </>
          ) : (
            "I'm monitoring your business. Nothing urgent right now."
          )}
        </p>

        {/* Summary */}
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

      {/* Intelligence items grouped by severity */}
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
          <div className="space-y-3">
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
              I'm monitoring your business continuously. When something needs your attention, it will appear here.
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
        <h2 className="text-sm font-semibold text-foreground">Recent activity</h2>
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
