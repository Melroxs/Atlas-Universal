// ---------------------------------------------------------------------------
// Atlas Entity Intelligence Panel
//
// Shows entity-specific intelligence: what Atlas sees, what it recommends,
// and supporting evidence. Reuses the Prompt 02 attention intelligence
// engine — no second intelligence system.
// ---------------------------------------------------------------------------

import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type AttentionItem, SEVERITY_STYLES, CATEGORY_LABELS, CATEGORY_ICONS } from "@/lib/atlas-experience/attention";
import {
  AlertTriangle,
  ArrowRight,
  BadgeDollarSign,
  Brain,
  Check,
  FileSearch,
  Flame,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
  type LucideIcon,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Icon mapping
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, LucideIcon> = {
  FileSearch,
  ShieldAlert,
  Flame,
  Sparkles,
  Target,
  AlertTriangle,
  Brain,
  TrendingUp,
  Zap,
  BadgeDollarSign,
};

// ---------------------------------------------------------------------------
// Entity Intelligence Panel
// ---------------------------------------------------------------------------

export function EntityIntelligencePanel({
  entity,
  attentionItems,
  recommendations = [],
  entityLabel,
  items,
}: {
  entity?: { type: string; id: string; label: string };
  attentionItems?: AttentionItem[];
  recommendations?: Array<{ id: string; title: string; summary: string; priority: string; status: string; confidence: number }>;
  entityLabel?: string;
  items?: AttentionItem[];
}) {
  const navigate = useNavigate();
  
  // Support both `attentionItems` and `items` props
  const allItems = attentionItems ?? items ?? [];
  const openItems = allItems.filter((i) => i.status === "open");
  const openRecs = recommendations.filter((r) => r.status === "open");

  const hasContent = openItems.length > 0 || openRecs.length > 0;

  if (!hasContent) {
    return (
      <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/5 p-4">
        <div className="flex items-center gap-2">
          <Check className="size-4 text-emerald-600 dark:text-emerald-300" />
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-200">
            {entityLabel ? `${entityLabel} looks good` : "Looks good"}
          </p>
        </div>
        <p className="mt-1 text-xs text-emerald-600/70 dark:text-emerald-300/70">
          Atlas isn't seeing anything that requires attention for this entity right now.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* What Atlas sees */}
      {openItems.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Brain className="size-3 text-teal-600 dark:text-teal-300" />
            Atlas sees
          </h3>
          <div className="space-y-1.5">
            {openItems.slice(0, 5).map((item) => {
              const Icon = ICON_MAP[CATEGORY_ICONS[item.category]] ?? AlertTriangle;
              return (
                <div
                  key={item.id}
                  className={cn(
                    "flex items-start gap-2.5 rounded-lg border p-2.5 transition-colors",
                    item.severity === "critical"
                      ? "border-rose-400/30 bg-rose-400/5"
                      : item.severity === "high"
                        ? "border-amber-400/30 bg-amber-400/5"
                        : "border-border/60 bg-card/40",
                  )}
                >
                  <div
                    className={cn(
                      "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md ring-1",
                      SEVERITY_STYLES[item.severity],
                    )}
                  >
                    <Icon className="size-3" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground">{item.title}</p>
                    <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                      {item.explanation}
                    </p>
                  </div>
                  {item.navigationTarget && (
                    <button
                      type="button"
                      onClick={() => navigate(item.navigationTarget!)}
                      className="mt-0.5 shrink-0 text-muted-foreground/40 transition-colors hover:text-teal-600 dark:hover:text-teal-300"
                    >
                      <ArrowRight className="size-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Atlas recommends */}
      {openRecs.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Sparkles className="size-3 text-amber-600 dark:text-amber-300" />
            Atlas recommends
          </h3>
          <div className="space-y-1.5">
            {openRecs.slice(0, 3).map((rec) => (
              <div
                key={rec.id}
                className="flex items-start gap-2.5 rounded-lg border border-violet-400/25 bg-violet-400/5 p-2.5"
              >
                <Target className="mt-0.5 size-3.5 shrink-0 text-violet-600 dark:text-violet-300" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground">{rec.title}</p>
                  <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                    {rec.summary}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn(
                        "font-mono text-[9px] uppercase tracking-wide",
                        rec.priority === "high"
                          ? "border-rose-400/30 bg-rose-400/10 text-rose-600 dark:text-rose-300"
                          : rec.priority === "medium"
                            ? "border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300"
                            : "border-sky-400/30 bg-sky-400/10 text-sky-600 dark:text-sky-300",
                      )}
                    >
                      {rec.priority}
                    </Badge>
                    {rec.confidence > 0 && (
                      <span className="font-mono text-[10px] text-muted-foreground/60">
                        {Math.round(rec.confidence * 100)}% confidence
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
