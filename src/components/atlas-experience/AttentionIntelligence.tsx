// ---------------------------------------------------------------------------
// Atlas Attention Intelligence — Dashboard Integration
//
// Renders the "What needs your attention" section using the intelligence
// aggregation layer. Each item communicates:
//   1. What happened
//   2. Why it matters
//   3. What Atlas recommends
//   4. Where the underlying entity lives
//   5. What the user can do next
// ---------------------------------------------------------------------------

import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import {
  type AttentionItem,
  type AttentionSeverity,
  SEVERITY_STYLES,
  CATEGORY_LABELS,
  CATEGORY_ICONS,
} from "@/lib/atlas-experience/attention";
import {
  AlertTriangle,
  ArrowRight,
  BadgeDollarSign,
  Brain,
  Cable,
  Check,
  Clock,
  FileSearch,
  Flame,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  X,
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
  Clock,
  Target,
  AlertTriangle,
  Cable,
  Users,
  Brain,
  TrendingUp,
  Zap,
  BadgeDollarSign,
};

const SEVERITY_DOT: Record<AttentionSeverity, string> = {
  critical: "bg-rose-500",
  high: "bg-amber-500",
  medium: "bg-sky-500",
  low: "bg-teal-500",
  info: "bg-muted-foreground/40",
};

// ---------------------------------------------------------------------------
// Financial Amount Display
// ---------------------------------------------------------------------------

function formatAmount(amount?: number): string | null {
  if (typeof amount !== "number" || amount <= 0) return null;
  return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function FinancialBadge({ amount }: { amount?: number }) {
  const formatted = formatAmount(amount);
  if (!formatted) return null;

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-600 dark:text-emerald-300">
      <BadgeDollarSign className="size-3" />
      {formatted}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Attention Intelligence Card — Enhanced version with richer context
// ---------------------------------------------------------------------------

export function AttentionIntelligenceCard({
  item,
  onDismiss,
}: {
  item: AttentionItem;
  onDismiss?: (id: string) => void;
}) {
  const navigate = useNavigate();
  const Icon = ICON_MAP[CATEGORY_ICONS[item.category]] ?? AlertTriangle;
  const financialImpact =
    typeof item.meta?.financialImpact === "number"
      ? (item.meta.financialImpact as number)
      : undefined;

  return (
    <div
      className={cn(
        "group relative flex w-full items-start gap-3 rounded-xl border bg-card/60 p-3.5 text-left transition-all",
        item.severity === "critical"
          ? "border-rose-400/30 hover:border-rose-400/50"
          : item.severity === "high"
            ? "border-amber-400/30 hover:border-amber-400/50"
            : "border-border/60 hover:border-teal-400/30",
      )}
    >
      {/* Severity icon */}
      <div
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg ring-1",
          SEVERITY_STYLES[item.severity],
        )}
      >
        <Icon className="size-4" />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        {/* Title row with severity dot and financial amount */}
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              SEVERITY_DOT[item.severity],
            )}
          />
          <p className="truncate text-sm font-medium text-foreground">
            {item.title}
          </p>
          {financialImpact !== undefined && (
            <FinancialBadge amount={financialImpact} />
          )}
        </div>

        {/* Explanation */}
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
          {item.explanation}
        </p>

        {/* Meta row: category, next action, source entity */}
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide",
              SEVERITY_STYLES[item.severity],
            )}
          >
            {item.severity}
          </span>
          <span className="rounded-full border border-border/70 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            {CATEGORY_LABELS[item.category]}
          </span>
          {item.sourceEntityName && (
            <span className="rounded-full border border-teal-400/20 bg-teal-400/5 px-2 py-0.5 text-[10px] text-teal-600 dark:text-teal-300">
              {item.sourceEntityName}
            </span>
          )}
          {item.hasEvidence && (
            <span className="flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/5 px-2 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-300">
              <FileSearch className="size-3" />
              Evidence
            </span>
          )}
        </div>

        {/* Recommended action */}
        {item.nextAction && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => item.navigationTarget && navigate(item.navigationTarget)}
              className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-teal-400/40 hover:bg-teal-400/10"
            >
              <Zap className="size-3 text-teal-600 dark:text-teal-300" />
              {item.nextAction}
              <ArrowRight className="size-3 text-muted-foreground/50" />
            </button>
          </div>
        )}
      </div>

      {/* Dismiss button */}
      {onDismiss && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(item.id);
          }}
          className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-md text-muted-foreground/40 opacity-0 transition-all group-hover:opacity-100 hover:bg-muted/50 hover:text-muted-foreground"
          title="Dismiss"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty State — "You're clear"
// ---------------------------------------------------------------------------

export function AttentionClearState() {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-emerald-400/25 bg-emerald-400/10">
        <Check className="size-6 text-emerald-600 dark:text-emerald-300" />
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground">You're clear.</p>
        <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
          Atlas isn't seeing anything that requires your attention right now.
          When something changes, it will surface here automatically.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Intelligence Summary — compact summary for header/toolbar
// ---------------------------------------------------------------------------

export function IntelligenceSummary({
  criticalCount,
  highCount,
  totalFinancialImpact,
  totalItems,
}: {
  criticalCount: number;
  highCount: number;
  totalFinancialImpact: number;
  totalItems: number;
}) {
  if (totalItems === 0) return null;

  const hasFinancial = totalFinancialImpact > 0;

  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      {criticalCount > 0 && (
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-rose-500" />
          {criticalCount} critical
        </span>
      )}
      {highCount > 0 && (
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-amber-500" />
          {highCount} high
        </span>
      )}
      {hasFinancial && (
        <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-300">
          <BadgeDollarSign className="size-3" />
          ${totalFinancialImpact.toLocaleString()}
        </span>
      )}
      <span className="text-muted-foreground/50">
        {totalItems} attention item{totalItems === 1 ? "" : "s"}
      </span>
    </div>
  );
}
