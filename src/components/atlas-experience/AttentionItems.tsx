import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import {
  type AttentionItem,
  type AttentionSeverity,
  SEVERITY_STYLES,
  CATEGORY_LABELS,
  CATEGORY_ICONS,
  sortAttentionItems,
} from "@/lib/atlas-experience/attention";
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  Cable,
  Clock,
  FileSearch,
  Flame,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";

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
};

const SEVERITY_DOT: Record<AttentionSeverity, string> = {
  critical: "bg-rose-500",
  high: "bg-amber-500",
  medium: "bg-sky-500",
  low: "bg-teal-500",
  info: "bg-muted-foreground/40",
};

export function AttentionItemCard({ item }: { item: AttentionItem }) {
  const navigate = useNavigate();
  const Icon = ICON_MAP[CATEGORY_ICONS[item.category]] ?? AlertTriangle;

  return (
    <button
      type="button"
      onClick={() => item.navigationTarget && navigate(item.navigationTarget)}
      className={cn(
        "group flex w-full items-start gap-3 rounded-xl border bg-card/60 p-3.5 text-left transition-all",
        item.severity === "critical"
          ? "border-rose-400/30 hover:border-rose-400/50"
          : item.severity === "high"
            ? "border-amber-400/30 hover:border-amber-400/50"
            : "border-border/60 hover:border-teal-400/30",
        item.navigationTarget && "hover:bg-muted/30",
      )}
    >
      <div
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg ring-1",
          SEVERITY_STYLES[item.severity],
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
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
        </div>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
          {item.explanation}
        </p>
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
          {item.nextAction && (
            <span className="text-[11px] text-muted-foreground/70">
              {item.nextAction}
            </span>
          )}
        </div>
      </div>
      {item.navigationTarget && (
        <ArrowRight className="mt-2 size-4 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-teal-600 dark:group-hover:text-teal-300" />
      )}
    </button>
  );
}

export function AttentionItemsList({
  items,
  maxItems = 8,
}: {
  items: AttentionItem[];
  maxItems?: number;
}) {
  const sorted = sortAttentionItems(items).slice(0, maxItems);

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <Sparkles className="size-6 text-emerald-600/50 dark:text-emerald-400/50" />
        <p className="text-sm text-muted-foreground">
          Nothing needs attention right now.
        </p>
        <p className="text-xs text-muted-foreground/70">
          Atlas will surface issues here when detected.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sorted.map((item) => (
        <AttentionItemCard key={item.id} item={item} />
      ))}
      {items.length > maxItems && (
        <p className="text-center text-xs text-muted-foreground/60">
          {items.length - maxItems} more items not shown
        </p>
      )}
    </div>
  );
}

export function AttentionSummaryBar({ items }: { items: AttentionItem[] }) {
  const open = items.filter((i) => i.status === "open");
  const criticalCount = open.filter((i) => i.severity === "critical").length;
  const highCount = open.filter((i) => i.severity === "high").length;
  const totalCount = open.length;

  if (totalCount === 0) return null;

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
      <span className="text-muted-foreground/50">
        {totalCount} total attention items
      </span>
    </div>
  );
}
