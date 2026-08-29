// ---------------------------------------------------------------------------
// Atlas Entity Header
//
// A reusable header component that communicates:
//   - entity type
//   - entity name
//   - status
//   - parent context
//   - important metadata
//   - primary action
//   - attention state
//
// Used on Claim, Document, Knowledge, and other entity detail pages.
// ---------------------------------------------------------------------------

import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AtlasEntityReference } from "@/lib/atlas-experience/entity-reference";
import { ENTITY_TYPE_LABELS, type EntityType } from "@/lib/atlas-experience/entity-reference";
import { type AttentionItem } from "@/lib/atlas-experience/attention";
import {
  ArrowLeft,
  ArrowRight,
  BadgeDollarSign,
  Brain,
  ChevronRight,
  FileSearch,
  MessageSquareText,
  Sparkles,
  Target,
  Zap,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Entity Type Styling
// ---------------------------------------------------------------------------

const ENTITY_STYLES: Record<string, string> = {
  claim: "border-rose-400/30 bg-rose-400/10 text-rose-600 dark:text-rose-300",
  supplement: "border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300",
  document: "border-sky-400/30 bg-sky-400/10 text-sky-600 dark:text-sky-300",
  recommendation: "border-violet-400/30 bg-violet-400/10 text-violet-600 dark:text-violet-300",
  workflow: "border-indigo-400/30 bg-indigo-400/10 text-indigo-600 dark:text-indigo-300",
  company: "border-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300",
  knowledge: "border-cyan-400/30 bg-cyan-400/10 text-cyan-600 dark:text-cyan-300",
  contact: "border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300",
  lead: "border-teal-400/30 bg-teal-400/10 text-teal-600 dark:text-teal-300",
};

// ---------------------------------------------------------------------------
// Entity Header Component
// ---------------------------------------------------------------------------

export function EntityHeader({
  entity,
  parent,
  attentionItems = [],
  actions,
  children,
}: {
  entity: AtlasEntityReference;
  parent?: AtlasEntityReference;
  attentionItems?: AttentionItem[];
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const navigate = useNavigate();
  const criticalCount = attentionItems.filter(
    (i) => i.status === "open" && (i.severity === "critical" || i.severity === "high"),
  ).length;
  const totalAttention = attentionItems.filter((i) => i.status === "open").length;
  const style = ENTITY_STYLES[entity.type] ?? "border-muted-foreground/30 bg-muted text-muted-foreground";

  return (
    <div className="space-y-4">
      {/* Breadcrumb trail */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <button
          type="button"
          onClick={() => navigate("/dashboard")}
          className="flex items-center gap-1 transition-colors hover:text-teal-600 dark:hover:text-teal-300"
        >
          Home
        </button>
        {parent && (
          <>
            <ChevronRight className="size-3 text-muted-foreground/40" />
            <button
              type="button"
              onClick={() => parent.href && navigate(parent.href)}
              className="transition-colors hover:text-teal-600 dark:hover:text-teal-300"
            >
              {parent.label}
            </button>
          </>
        )}
        <ChevronRight className="size-3 text-muted-foreground/40" />
        <span className="font-medium text-foreground/80">{entity.label}</span>
      </div>

      {/* Entity identity */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-start gap-3">
          {/* Entity type badge */}
          <div
            className={cn(
              "mt-1 flex size-10 shrink-0 items-center justify-center rounded-xl ring-1",
              style,
            )}
          >
            <EntityIcon type={entity.type} />
          </div>

          <div>
            {/* Entity type label */}
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-teal-600 dark:text-teal-400/90">
              {ENTITY_TYPE_LABELS[entity.type]}
            </p>
            {/* Entity name */}
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
              {entity.label}
            </h1>
            {/* Subtitle and metadata */}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {entity.subtitle && (
                <span className="text-sm text-muted-foreground">
                  {entity.subtitle}
                </span>
              )}
              {entity.status && (
                <Badge
                  variant="outline"
                  className={cn(
                    "font-mono text-[10px] uppercase tracking-wide",
                    entity.status === "open" || entity.status === "active"
                      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300"
                      : entity.status === "failed" || entity.status === "denied"
                        ? "border-rose-400/30 bg-rose-400/10 text-rose-600 dark:text-rose-300"
                        : "border-muted-foreground/30 bg-muted text-muted-foreground",
                  )}
                >
                  {entity.status.replace(/_/g, " ")}
                </Badge>
              )}
              {entity.financialImpact !== undefined && entity.financialImpact > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-600 dark:text-emerald-300">
                  <BadgeDollarSign className="size-3" />
                  ${entity.financialImpact.toLocaleString()}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-2">
          {totalAttention > 0 && (
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
                criticalCount > 0
                  ? "border border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300"
                  : "border border-border/60 bg-card/60 text-muted-foreground",
              )}
            >
              <Target className="size-3" />
              {totalAttention} attention item{totalAttention === 1 ? "" : "s"}
            </div>
          )}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => navigate("/dashboard/ask")}
          >
            <MessageSquareText className="size-3.5" />
            Ask Atlas
          </Button>
          {actions}
        </div>
      </div>

      {/* Additional content (e.g., relationship tabs) */}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entity Icon — type-specific icon
// ---------------------------------------------------------------------------

function EntityIcon({ type }: { type: EntityType }) {
  const iconClass = "size-5";
  switch (type) {
    case "claim":
      return <FileSearch className={iconClass} />;
    case "document":
      return <FileSearch className={iconClass} />;
    case "recommendation":
      return <Target className={iconClass} />;
    case "supplement":
      return <Sparkles className={iconClass} />;
    case "workflow":
      return <Zap className={iconClass} />;
    case "company":
      return <Brain className={iconClass} />;
    default:
      return <Sparkles className={iconClass} />;
  }
}
