// ---------------------------------------------------------------------------
// Atlas Decision Card
//
// A comprehensive decision card that communicates:
//   - What Atlas found (observation)
//   - Why it matters (importance)
//   - What supports it (evidence)
//   - What Atlas recommends (recommendation)
//   - What the user can do (action)
// ---------------------------------------------------------------------------

import { useState, useMemo } from "react";
import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { formatDate } from "@/components/atlas-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type AtlasDecision,
  type AtlasEvidenceReference,
  DECISION_STATUS_LABELS,
  DECISION_STATUS_STYLES,
  SEVERITY_STYLES,
  getConfidenceLabel,
  getConfidenceStyle,
} from "@/lib/atlas-experience/decision";
import { AtlasActionPanel, useAtlasActions } from "./AtlasActionPanel";
import { useAtlasActionAuth } from "@/hooks/use-atlas-action-auth";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  Info,
  Network,
  Shield,
  Sparkles,
  Target,
  Zap,
  type LucideIcon,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Severity Icon
// ---------------------------------------------------------------------------

const SEVERITY_ICONS: Record<string, LucideIcon> = {
  critical: AlertTriangle,
  high: AlertTriangle,
  medium: Target,
  low: Info,
  info: Info,
};

// ---------------------------------------------------------------------------
// AtlasDecisionCard
// ---------------------------------------------------------------------------

export function AtlasDecisionCard({
  decision,
  showEvidence = true,
  showAction = true,
  compact = false,
}: {
  decision: AtlasDecision;
  showEvidence?: boolean;
  showAction?: boolean;
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const [evidenceExpanded, setEvidenceExpanded] = useState(false);
  const SeverityIcon = SEVERITY_ICONS[decision.importance.severity] ?? Info;

  return (
    <div
      className={cn(
        "rounded-xl border bg-card/60 p-5 transition-colors",
        decision.status === "new"
          ? "border-teal-400/25"
          : "border-border/60 opacity-80",
      )}
    >
      {/* Header: Status + Severity + Source */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={cn(
            "font-mono text-[10px] uppercase tracking-wide",
            SEVERITY_STYLES[decision.importance.severity],
          )}
        >
          <SeverityIcon className="mr-1 inline size-3" />
          {decision.importance.severity}
        </Badge>
        <Badge
          variant="outline"
          className={cn(
            "font-mono text-[10px] uppercase tracking-wide",
            DECISION_STATUS_STYLES[decision.status],
          )}
        >
          {DECISION_STATUS_LABELS[decision.status]}
        </Badge>
        {decision.source && (
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/60">
            {decision.source.replace(/_/g, " ")}
          </span>
        )}
        <span className="ml-auto font-mono text-[11px] text-muted-foreground/60">
          {formatDate(Number(decision.createdAt))}
        </span>
      </div>

      {/* Observation */}
      <h3 className="mt-2.5 text-sm font-semibold">{decision.observation.title}</h3>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        {decision.observation.summary}
      </p>

      {/* Impact */}
      {decision.importance.impact !== undefined && (
        <div className="mt-3 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-300">
            <Zap className="size-3" />
            ${decision.importance.impact.toLocaleString()}
          </span>
          {decision.importance.impactDescription && (
            <span className="text-xs text-muted-foreground/70">
              {decision.importance.impactDescription}
            </span>
          )}
        </div>
      )}

      {/* Recommendation */}
      <div className="mt-3 rounded-lg border border-teal-400/20 bg-teal-400/5 p-3">
        <div className="flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-teal-600 dark:text-teal-300" />
          <p className="text-xs font-semibold text-teal-700 dark:text-teal-200">
            Atlas recommends
          </p>
        </div>
        <p className="mt-1 text-sm font-medium text-foreground">
          {decision.recommendation.title}
        </p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
          {decision.recommendation.reasoning}
        </p>

        {/* Confidence */}
        <div className="mt-2 flex items-center gap-3 text-xs">
          <span className={cn("font-medium", getConfidenceStyle(decision.recommendation.confidence))}>
            {getConfidenceLabel(decision.recommendation.confidence)}
          </span>
          {decision.recommendation.confidence !== undefined && (
            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full",
                  decision.recommendation.confidence >= 0.8
                    ? "bg-emerald-400"
                    : decision.recommendation.confidence >= 0.5
                      ? "bg-amber-400"
                      : "bg-rose-400",
                )}
                style={{ width: `${Math.round(decision.recommendation.confidence * 100)}%` }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Evidence */}
      {showEvidence && decision.evidence.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setEvidenceExpanded(!evidenceExpanded)}
            className="flex w-full items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40"
          >
            <FileText className="size-3.5 text-teal-600 dark:text-teal-300" />
            Evidence · {decision.evidence.length} source{decision.evidence.length === 1 ? "" : "s"}
            {evidenceExpanded ? (
              <ChevronUp className="ml-auto size-3.5" />
            ) : (
              <ChevronDown className="ml-auto size-3.5" />
            )}
          </button>
          {evidenceExpanded && (
            <div className="mt-1.5 space-y-1.5">
              {decision.evidence.map((e, i) => (
                <EvidenceItem key={i} evidence={e} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Action */}
      {showAction && decision.action && (
        <DecisionActionSection decision={decision} compact={compact} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EvidenceItem — single evidence entry
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// DecisionActionSection — action buttons for decisions
// ---------------------------------------------------------------------------

function DecisionActionSection({
  decision,
  compact,
}: {
  decision: AtlasDecision;
  compact: boolean;
}) {
  const navigate = useNavigate();
  const { generateDecisionActions } = useAtlasActions();
  const auth = useAtlasActionAuth();
  const actions = useMemo(
    () => generateDecisionActions(decision),
    [decision, generateDecisionActions],
  );

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
      {decision.requiresApproval && (
        <span className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-300">
          <Shield className="size-3" />
          Requires review
        </span>
      )}
      {decision.entity.href && (
        <Button
          size="sm"
          variant="outline"
          className="ml-auto gap-1.5"
          onClick={() => navigate(decision.entity.href!)}
        >
          Review
          <ArrowRight className="size-3" />
        </Button>
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
  );
}

// ---------------------------------------------------------------------------
// EvidenceItem — single evidence entry
// ---------------------------------------------------------------------------

function EvidenceItem({ evidence }: { evidence: AtlasEvidenceReference }) {
  return (
    <div className="rounded-md border border-border/50 bg-background/40 p-2">
      <p className="flex items-center gap-2 text-[11px] font-medium">
        {evidence.kind === "entity" ? (
          <Network className="size-3 text-teal-600 dark:text-teal-300" />
        ) : (
          <FileText className="size-3 text-cyan-600 dark:text-cyan-300" />
        )}
        {evidence.title}
        <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">
          rel {Math.round(evidence.relevance * 100)}%
        </span>
      </p>
      {evidence.snippet && (
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
          {evidence.snippet}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AtlasDecisionSummary — compact summary for Dashboard
// ---------------------------------------------------------------------------

export function AtlasDecisionSummary({
  decisions,
  maxItems = 3,
}: {
  decisions: Array<{
    id: string;
    observation: { title: string };
    importance: { severity: string; impact?: number };
    recommendation: { title: string; confidence?: number };
    status: string;
    entity: { href?: string };
  }>;
  maxItems?: number;
}) {
  const navigate = useNavigate();
  const top = decisions.slice(0, maxItems);

  if (top.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <CheckCircle2 className="size-6 text-emerald-400/50" />
        <p className="text-sm font-medium text-muted-foreground">No pending decisions</p>
        <p className="text-xs text-muted-foreground/70">
          Atlas is monitoring your workspace for opportunities.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {top.map((d) => {
        const SeverityIcon = SEVERITY_ICONS[d.importance.severity] ?? Info;
        return (
          <button
            key={d.id}
            type="button"
            onClick={() => d.entity.href && navigate(d.entity.href)}
            className="flex w-full items-start gap-3 rounded-lg border border-border/60 bg-card/40 p-3 text-left transition-colors hover:bg-card/80"
          >
            <div
              className={cn(
                "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md ring-1",
                SEVERITY_STYLES[d.importance.severity],
              )}
            >
              <SeverityIcon className="size-3" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground">{d.observation.title}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{d.recommendation.title}</p>
            </div>
            {d.importance.impact !== undefined && (
              <span className="shrink-0 font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-300">
                ${d.importance.impact.toLocaleString()}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
