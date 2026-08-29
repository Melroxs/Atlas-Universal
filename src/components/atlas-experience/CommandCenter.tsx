// ---------------------------------------------------------------------------
// Atlas Command Center Components
//
// Unified operational experience integrating Attention, Activity,
// and Decision systems into one coherent dashboard.
// ---------------------------------------------------------------------------

import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { formatDate } from "@/components/atlas-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/atlas-ui";
import { useIntelligence } from "@/lib/atlas-experience";
import { useActivity } from "@/lib/atlas-experience/useActivity";
import { useDecisions } from "@/lib/atlas-experience/useDecisions";
import {
  selectNextBestAction,
  buildAskAtlasContext,
  type NextBestAction,
  type AskAtlasContext,
} from "@/lib/atlas-experience/command-center";
import { useAtlasContext } from "@/lib/atlas-experience/context";
import {
  ActivityTimeline,
  ActivityTimelineSkeleton,
} from "./ActivityTimeline";
import { AtlasDecisionSummary } from "./DecisionCard";
import { AtlasActionPanel, useAtlasActions } from "./AtlasActionPanel";
import { useAtlasActionAuth } from "@/hooks/use-atlas-action-auth";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Brain,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  MessageSquareText,
  Radar,
  Shield,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useMemo } from "react";

// ---------------------------------------------------------------------------
// SystemState — workspace health strip
// ---------------------------------------------------------------------------

export function SystemState({ degraded = false }: { degraded?: boolean }) {
  const { health } = useAtlasContext();

  return (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <div
          className={cn(
            "size-2 rounded-full",
            degraded
              ? "bg-amber-400 animate-pulse"
              : "bg-emerald-400",
          )}
        />
        <span>{degraded ? "Atlas needs attention" : "Atlas is online"}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <Brain className="size-3 text-teal-600 dark:text-teal-300" />
          Knowledge {health.documents > 0 ? "●" : "○"}
        </span>
        <span className="flex items-center gap-1">
          <Sparkles className="size-3 text-teal-600 dark:text-teal-300" />
          AI ●
        </span>
        <span className="flex items-center gap-1">
          <Target className="size-3 text-teal-600 dark:text-teal-300" />
          Signals {health.openClaims > 0 ? "●" : "○"}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WhatMatters — attention intelligence summary
// ---------------------------------------------------------------------------

export function WhatMatters() {
  const navigate = useNavigate();
  const { items: attentionItems } = useIntelligence();

  const topItems = useMemo(() => {
    return attentionItems
      .filter((a) => a.status === "open" && (a.severity === "critical" || a.severity === "high" || a.severity === "medium"))
      .sort((a, b) => {
        const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
        return (order[a.severity] ?? 4) - (order[b.severity] ?? 4);
      })
      .slice(0, 3);
  }, [attentionItems]);

  const criticalCount = attentionItems.filter((a) => a.status === "open" && a.severity === "critical").length;
  const highCount = attentionItems.filter((a) => a.status === "open" && a.severity === "high").length;
  const totalImpact = attentionItems
    .filter((a) => a.status === "open")
    .reduce((sum, a) => sum + ((a.meta?.financialImpact as number) ?? 0), 0);
  const totalCritical = criticalCount + highCount;

  if (totalCritical === 0 && topItems.length === 0) {
    return (
      <Panel className="p-5">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="size-5 text-emerald-500" />
          <div>
            <p className="text-sm font-semibold text-foreground">You're clear.</p>
            <p className="text-xs text-muted-foreground">
              No critical issues require your attention right now.
            </p>
          </div>
        </div>
      </Panel>
    );
  }

  return (
    <Panel className="p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">What matters</h3>
        <div className="flex items-center gap-2">
          {totalCritical > 0 && (
            <Badge variant="outline" className="border-rose-400/30 bg-rose-400/10 font-mono text-[10px] text-rose-600 dark:text-rose-300">
              {totalCritical} critical
            </Badge>
          )}
          {totalImpact > 0 && (
            <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 font-mono text-[10px] text-emerald-600 dark:text-emerald-300">
              ${totalImpact.toLocaleString()} impact
            </Badge>
          )}
        </div>
      </div>

      {topItems.length > 0 && (
        <div className="mt-3 space-y-2">
          {topItems.map((item) => (
            <div
              key={item.id}
              className="flex w-full items-start gap-3 rounded-lg border border-border/60 bg-card/40 p-3 text-left transition-colors hover:bg-card/80"
            >
              <div
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md ring-1",
                  item.severity === "critical"
                    ? "bg-rose-400/10 ring-rose-400/25 text-rose-600 dark:text-rose-300"
                    : item.severity === "high"
                      ? "bg-amber-400/10 ring-amber-400/25 text-amber-600 dark:text-amber-300"
                      : "bg-sky-400/10 ring-sky-400/25 text-sky-600 dark:text-sky-300",
                )}
              >
                {item.severity === "critical" ? (
                  <AlertTriangle className="size-3" />
                ) : (
                  <Target className="size-3" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground">{item.title}</p>
                <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                  {item.explanation}
                </p>
              </div>
              <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/40" />
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// WhatChanged — recent activity summary
// ---------------------------------------------------------------------------

export function WhatChanged() {
  const navigate = useNavigate();
  const { activities, isLoading } = useActivity();

  const recentItems = useMemo(() => {
    const now = Date.now();
    const dayMs = 86_400_000;
    return activities
      .filter((a) => a.timestamp >= now - dayMs * 2)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5);
  }, [activities]);

  if (isLoading) {
    return (
      <Panel className="p-5">
        <h3 className="text-sm font-semibold text-foreground">What changed</h3>
        <ActivityTimelineSkeleton rows={3} />
      </Panel>
    );
  }

  if (recentItems.length === 0) {
    return (
      <Panel className="p-5">
        <h3 className="text-sm font-semibold text-foreground">What changed</h3>
        <div className="flex items-center gap-2 py-4 text-center">
          <Clock className="size-5 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">No recent changes</p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel className="p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">What changed</h3>
        <span className="text-[11px] text-muted-foreground/60">
          {recentItems.length} recent
        </span>
      </div>
      <div className="mt-3">
        <ActivityTimeline activities={recentItems} maxItems={5} showDateHeaders={false} />
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// WhatRecommends — decision/recommendation summary
// ---------------------------------------------------------------------------

export function WhatRecommends() {
  const { sortedDecisions, pendingApprovals, totalPotentialImpact } = useDecisions();

  const topDecisions = useMemo(() => {
    return sortedDecisions
      .filter((d) => d.status === "new")
      .slice(0, 3);
  }, [sortedDecisions]);

  if (topDecisions.length === 0) {
    return (
      <Panel className="p-5">
        <h3 className="text-sm font-semibold text-foreground">What Atlas recommends</h3>
        <div className="flex items-center gap-2 py-4 text-center">
          <CheckCircle2 className="size-5 text-emerald-400/50" />
          <p className="text-xs text-muted-foreground">No pending recommendations</p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel className="p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">What Atlas recommends</h3>
        <div className="flex items-center gap-2">
          {pendingApprovals.length > 0 && (
            <Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 font-mono text-[10px] text-amber-600 dark:text-amber-300">
              {pendingApprovals.length} need approval
            </Badge>
          )}
          {totalPotentialImpact > 0 && (
            <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 font-mono text-[10px] text-emerald-600 dark:text-emerald-300">
              ${totalPotentialImpact.toLocaleString()} potential
            </Badge>
          )}
        </div>
      </div>
      <div className="mt-3">
        <AtlasDecisionSummary decisions={topDecisions} maxItems={3} />
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// NextBestAction — the single most important next step
// ---------------------------------------------------------------------------

export function NextBestActionCard() {
  const navigate = useNavigate();
  const { items: attentionItems } = useIntelligence();
  const { activities } = useActivity();
  const { decisions } = useDecisions();

  const nextAction = useMemo(() => {
    return selectNextBestAction({ attentionItems, decisions, activities });
  }, [attentionItems, decisions, activities]);

  if (!nextAction) return null;

  const ACTION_ICONS: Record<string, LucideIcon> = {
    review: FileText,
    approve: CheckCircle2,
    investigate: AlertTriangle,
    follow_up: MessageSquareText,
  };
  const ActionIcon = ACTION_ICONS[nextAction.actionType] ?? Target;

  // Generate action proposals from the next best action
  const { generateAttentionActions, generateDecisionActions } = useAtlasActions();
  const auth = useAtlasActionAuth();
  const actionProposals = useMemo(() => {
    if (nextAction.entity) {
      const entity: import("@/lib/atlas-experience/entity-reference").AtlasEntityReference = {
        type: (nextAction.entity.type as import("@/lib/atlas-experience/entity-reference").AtlasEntityReference["type"]) ?? "claim",
        id: nextAction.entity.id,
        label: nextAction.entity.label ?? `${nextAction.entity.type} ${nextAction.entity.id}`,
        href: nextAction.entity.href,
      };
      if (nextAction.actionType === "approve") {
        return [{
          type: "approve_recommendation" as const,
          label: "Approve",
          entity,
          params: { recommendationId: nextAction.entity.id },
        }];
      }
      return [{
        type: "prepare_supplement" as const,
        label: "Prepare Supplement",
        entity,
        params: { claimId: nextAction.entity.id },
      }];
    }
    return [];
  }, [nextAction]);

  return (
    <Panel className="border-teal-400/25 bg-teal-400/5 p-5">
      <div className="flex items-center gap-2">
        <Zap className="size-4 text-teal-600 dark:text-teal-300" />
        <h3 className="text-sm font-semibold text-teal-700 dark:text-teal-200">
          Next best action
        </h3>
      </div>
      <div className="mt-3 flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-teal-400/10 ring-1 ring-teal-400/25">
          <ActionIcon className="size-4 text-teal-600 dark:text-teal-300" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{nextAction.title}</p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {nextAction.reason}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => nextAction.entity.href && navigate(nextAction.entity.href)}
            >
              {nextAction.actionType === "approve" ? "Review" : "Investigate"}
              <ArrowRight className="size-3" />
            </Button>
            <AtlasActionPanel
              actions={actionProposals}
              userRole={auth.userRole}
              userId={auth.userId}
              layout="compact"
            />
          </div>
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// AskAtlasEntry — entry point to Ask Atlas
// ---------------------------------------------------------------------------

export function AskAtlasEntry() {
  const navigate = useNavigate();
  const { health } = useAtlasContext();
  const { items: attentionItems } = useIntelligence();
  const { activities } = useActivity();
  const { decisions } = useDecisions();

  const suggestedPrompts = useMemo(() => {
    const prompts: string[] = ["What should I focus on?"];

    const criticalCount = attentionItems.filter(
      (a) => a.status === "open" && (a.severity === "critical" || a.severity === "high"),
    ).length;
    if (criticalCount > 0) {
      prompts.push(`What are the ${criticalCount} critical issues?`);
    }

    const pendingCount = decisions.filter(
      (d) => d.requiresApproval && d.status === "new",
    ).length;
    if (pendingCount > 0) {
      prompts.push("What needs my approval?");
    }

    const highImpact = decisions.filter(
      (d) => d.importance.impact !== undefined && d.importance.impact > 0,
    );
    if (highImpact.length > 0) {
      prompts.push("Where is the biggest opportunity?");
    }

    prompts.push("What changed today?");

    return prompts.slice(0, 4);
  }, [attentionItems, decisions]);

  return (
    <Panel className="p-5">
      <div className="flex items-center gap-2">
        <MessageSquareText className="size-4 text-teal-600 dark:text-teal-300" />
        <h3 className="text-sm font-semibold text-foreground">Ask Atlas</h3>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {suggestedPrompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => navigate("/dashboard/ask")}
            className="rounded-full border border-border/60 bg-card/40 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-teal-400/30 hover:text-teal-600 dark:hover:text-teal-300"
          >
            {prompt}
          </button>
        ))}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// CommandCenter — full composed command center
// ---------------------------------------------------------------------------

export function CommandCenter() {
  const { health } = useAtlasContext();

  const isDegraded = health.documents === 0 && health.entities === 0;

  return (
    <div className="flex flex-col gap-6">
      {/* System State */}
      <SystemState degraded={isDegraded} />

      {/* Next Best Action — most important single item */}
      <NextBestActionCard />

      {/* What Matters + What Changed — side by side on desktop */}
      <div className="grid gap-6 lg:grid-cols-2">
        <WhatMatters />
        <WhatChanged />
      </div>

      {/* What Atlas Recommends */}
      <WhatRecommends />

      {/* Ask Atlas Entry */}
      <AskAtlasEntry />
    </div>
  );
}
