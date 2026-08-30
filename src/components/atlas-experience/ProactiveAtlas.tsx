// ---------------------------------------------------------------------------
// Proactive Atlas — "Atlas noticed" surface
//
// Surfaces meaningful changes Atlas has detected without being noisy.
// Uses the Atlas Signal model for significance filtering and change detection.
// ---------------------------------------------------------------------------

import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/atlas-ui";
import { useIntelligence } from "@/lib/atlas-experience";
import { useActivity } from "@/lib/atlas-experience/useActivity";
import { useDecisions } from "@/lib/atlas-experience/useDecisions";
import { useAtlasContext } from "@/lib/atlas-experience/context";
import {
  attentionToSignal,
  decisionToSignal,
  filterSurfaceSignals,
  detectNewSignals,
  deduplicateSignals,
  buildSinceLastVisit,
  type AtlasSignal,
  type SignalSignificance,
  SIGNIFICANCE_ORDER,
} from "@/lib/atlas-experience/signal";
import { AtlasActionPanel, useAtlasActions } from "./AtlasActionPanel";
import { useAtlasActionAuth } from "@/hooks/use-atlas-action-auth";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  Info,
  Sparkles,
  Target,
  Zap,
} from "lucide-react";
import { useMemo, useState, useCallback, useEffect } from "react";

// ---------------------------------------------------------------------------
// Persistence key for seen signals (localStorage)
// ---------------------------------------------------------------------------

const SEEN_SIGNALS_KEY = "atlas-seen-signals";
const LAST_VISIT_KEY = "atlas-last-visit";

function loadSeenSignals(): Map<string, { firstSeenAt: string; seenCount: number }> {
  try {
    const raw = localStorage.getItem(SEEN_SIGNALS_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, { firstSeenAt: string; seenCount: number }>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

function saveSeenSignals(map: Map<string, { firstSeenAt: string; seenCount: number }>): void {
  try {
    const obj: Record<string, { firstSeenAt: string; seenCount: number }> = {};
    for (const [k, v] of map) {
      obj[k] = v;
    }
    localStorage.setItem(SEEN_SIGNALS_KEY, JSON.stringify(obj));
  } catch {
    // localStorage unavailable — silent fail
  }
}

function loadLastVisit(): string | null {
  try {
    return localStorage.getItem(LAST_VISIT_KEY);
  } catch {
    return null;
  }
}

function saveLastVisit(): void {
  try {
    localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString());
  } catch {
    // silent fail
  }
}

// ---------------------------------------------------------------------------
// Significance styling
// ---------------------------------------------------------------------------

const SIGNIFICANCE_STYLE: Record<SignalSignificance, { icon: typeof AlertTriangle; color: string; bg: string; ring: string }> = {
  critical: {
    icon: AlertTriangle,
    color: "text-rose-600 dark:text-rose-300",
    bg: "bg-rose-400/10",
    ring: "ring-rose-400/25",
  },
  important: {
    icon: Target,
    color: "text-amber-600 dark:text-amber-300",
    bg: "bg-amber-400/10",
    ring: "ring-amber-400/25",
  },
  notable: {
    icon: Info,
    color: "text-sky-600 dark:text-sky-300",
    bg: "bg-sky-400/10",
    ring: "ring-sky-400/25",
  },
  routine: {
    icon: Sparkles,
    color: "text-muted-foreground",
    bg: "bg-muted/40",
    ring: "ring-border/50",
  },
};

// ---------------------------------------------------------------------------
// SignalCard — single signal display
// ---------------------------------------------------------------------------

function SignalCard({ signal }: { signal: AtlasSignal }) {
  const navigate = useNavigate();
  const { generateSignalActions } = useAtlasActions();
  const auth = useAtlasActionAuth();
  const style = SIGNIFICANCE_STYLE[signal.significance];
  const Icon = style.icon;
  const actions = useMemo(() => generateSignalActions(signal), [signal, generateSignalActions]);

  return (
    <div
      className="flex w-full items-start gap-3 rounded-lg border border-border/60 bg-card/40 p-3 text-left transition-colors hover:bg-card/80"
    >
      <div
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md ring-1",
          style.bg,
          style.ring,
          style.color,
        )}
      >
        <Icon className="size-3" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground">{signal.title}</p>
        <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
          {signal.summary}
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          {signal.source === "atlas" && (
            <Badge variant="outline" className="border-teal-400/30 bg-teal-400/10 font-mono text-[9px] text-teal-600 dark:text-teal-300">
              Atlas
            </Badge>
          )}
          {signal.entity.type !== "claim" && (
            <span className="text-[10px] text-muted-foreground/60 capitalize">
              {signal.entity.type}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {signal.recommendedAction?.href && (
          <button
            type="button"
            onClick={() => navigate(signal.recommendedAction!.href!)}
            className="text-[11px] text-teal-600 hover:text-teal-700 dark:text-teal-300"
          >
            View <ChevronRight className="inline size-3" />
          </button>
        )}
        {actions.length > 0 && (
          <AtlasActionPanel
            actions={actions}
            userRole={auth.userRole}
            userId={auth.userId}
            layout="compact"
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProactiveAtlas — main component
// ---------------------------------------------------------------------------

export function ProactiveAtlas() {
  const navigate = useNavigate();
  const { entity } = useAtlasContext();
  const { items: attentionItems } = useIntelligence();
  const { activities } = useActivity();
  const { decisions } = useDecisions();

  const [isExpanded, setIsExpanded] = useState(false);

  // Build signals from existing Atlas data
  const allSignals = useMemo(() => {
    const signals: AtlasSignal[] = [];

    // Convert attention items to signals
    for (const item of attentionItems) {
      if (item.status === "open") {
        signals.push(attentionToSignal(item));
      }
    }

    // Convert high-value decisions to signals
    for (const decision of decisions) {
      if (decision.status === "new" && decision.importance.severity !== "low") {
        signals.push(decisionToSignal(decision));
      }
    }

    return signals;
  }, [attentionItems, decisions]);

  // Deduplicate
  const dedupedSignals = useMemo(() => {
    return deduplicateSignals(allSignals, 300_000); // 5 min window
  }, [allSignals]);

  // Filter to surfaceable signals
  const surfaceSignals = useMemo(() => {
    return filterSurfaceSignals(dedupedSignals);
  }, [dedupedSignals]);

  // Detect new signals since last visit
  const [lastVisitAt, setLastVisitAt] = useState<string | null>(() => loadLastVisit());

  const newSignals = useMemo(() => {
    return detectNewSignals(surfaceSignals, lastVisitAt);
  }, [surfaceSignals, lastVisitAt]);

  // Since-you-were-last-here context
  const sinceLastVisit = useMemo(() => {
    return buildSinceLastVisit(newSignals);
  }, [newSignals]);

  // Mark signals as seen when viewing
  const markAllSeen = useCallback(() => {
    const seen = loadSeenSignals();
    const now = new Date().toISOString();
    for (const signal of surfaceSignals) {
      const existing = seen.get(signal.id);
      seen.set(signal.id, {
        firstSeenAt: existing?.firstSeenAt ?? now,
        seenCount: (existing?.seenCount ?? 0) + 1,
      });
    }
    saveSeenSignals(seen);
    saveLastVisit();
    setLastVisitAt(now);
  }, [surfaceSignals]);

  // Save last visit on mount
  useEffect(() => {
    // We don't auto-save on mount to avoid clearing "new" state immediately
    // The user explicitly clicks "Mark all seen" or navigates away
  }, []);

  // Determine if there are any new signals to show
  const hasNewSignals = sinceLastVisit.totalNew > 0;

  // Don't render at all if no surfaceable signals
  if (surfaceSignals.length === 0) {
    return null;
  }

  return (
    <Panel className={cn("transition-colors", hasNewSignals && "border-teal-400/20 bg-teal-400/5")}>
      <div className="flex items-center justify-between px-5 py-3.5">
        <div className="flex items-center gap-2">
          <Zap className="size-4 text-teal-600 dark:text-teal-300" />
          <h2 className="text-sm font-semibold text-foreground">Atlas noticed</h2>
          {hasNewSignals && (
            <Badge
              variant="outline"
              className="border-teal-400/30 bg-teal-400/10 font-mono text-[10px] text-teal-600 dark:text-teal-300"
            >
              {sinceLastVisit.totalNew} new
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasNewSignals && (
            <button
              type="button"
              onClick={markAllSeen}
              className="flex items-center gap-1 text-[10px] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
            >
              <EyeOff className="size-3" />
              Mark all seen
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-teal-700 dark:hover:text-teal-200"
          >
            {isExpanded ? "Show less" : `View all ${surfaceSignals.length}`}
            <ChevronRight className={cn("size-3 transition-transform", isExpanded && "rotate-90")} />
          </button>
        </div>
      </div>

      <div className="px-5 pb-4">
        {/* Since you were last here — compact summary */}
        {hasNewSignals && !isExpanded && (
          <div className="mb-3 rounded-lg border border-teal-400/20 bg-teal-400/5 px-3 py-2">
            <div className="flex items-center gap-2">
              <Eye className="size-3.5 text-teal-600 dark:text-teal-300" />
              <span className="text-[11px] font-medium text-teal-700 dark:text-teal-200">
                Since you were last here
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {sinceLastVisit.criticalCount > 0 && (
                <span className="rounded-full bg-rose-400/10 px-2 py-0.5 font-mono text-[9px] text-rose-600 dark:text-rose-300">
                  {sinceLastVisit.criticalCount} critical
                </span>
              )}
              {sinceLastVisit.importantCount > 0 && (
                <span className="rounded-full bg-amber-400/10 px-2 py-0.5 font-mono text-[9px] text-amber-600 dark:text-amber-300">
                  {sinceLastVisit.importantCount} important
                </span>
              )}
              {sinceLastVisit.totalNew > sinceLastVisit.criticalCount + sinceLastVisit.importantCount && (
                <span className="rounded-full bg-sky-400/10 px-2 py-0.5 font-mono text-[9px] text-sky-600 dark:text-sky-300">
                  {sinceLastVisit.totalNew - sinceLastVisit.criticalCount - sinceLastVisit.importantCount} other
                </span>
              )}
            </div>
          </div>
        )}

        {/* Signal list */}
        <div className="space-y-2">
          {(isExpanded ? surfaceSignals : surfaceSignals.slice(0, 3)).map((signal) => (
            <SignalCard key={signal.id} signal={signal} />
          ))}
        </div>

        {!isExpanded && surfaceSignals.length > 3 && (
          <p className="mt-2 text-center text-[10px] text-muted-foreground/60">
            {surfaceSignals.length - 3} more signal{surfaceSignals.length - 3 === 1 ? "" : "s"}
          </p>
        )}
      </div>
    </Panel>
  );
}
