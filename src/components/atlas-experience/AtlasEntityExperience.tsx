// ---------------------------------------------------------------------------
// Atlas Entity Experience Framework
//
// Reusable components for presenting any Atlas entity through the lens of
// Atlas understanding: what happened, what matters, what supports it,
// what's missing, what Atlas recommends.
//
// The entity experience answers one question:
//   "What does Atlas understand about this thing, and what should I do?"
// ---------------------------------------------------------------------------

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/atlas-ui";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Info,
  Lightbulb,
  Radar,
  ShieldAlert,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";

// ---------------------------------------------------------------------------
// AtlasEntityShell — the container for any entity experience
// ---------------------------------------------------------------------------

interface EntityShellProps {
  /** Entity type label (e.g., "Claim") */
  entityType: string;
  /** Entity identifier (e.g., "#1842") */
  entityId: string;
  /** Atlas's verdict on the entity (e.g., "UNDERPAID") */
  verdict?: string;
  /** Primary financial impact */
  financialImpact?: number;
  /** Confidence level */
  confidence?: "high" | "medium" | "low";
  /** Atlas assessment text */
  assessment?: string;
  /** Action buttons */
  actions?: ReactNode;
  /** Entity status badge */
  statusBadge?: ReactNode;
  /** Contextual return — where did the user come from? */
  returnTo?: { label: string; onClick: () => void };
  children: ReactNode;
}

export function AtlasEntityShell({
  entityType,
  entityId,
  verdict,
  financialImpact,
  confidence,
  assessment,
  actions,
  statusBadge,
  returnTo,
  children,
}: EntityShellProps) {
  const confidenceColors = {
    high: "border-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300",
    medium: "border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300",
    low: "border-border/70 text-muted-foreground",
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Contextual return path */}
      {returnTo && (
        <button
          type="button"
          onClick={returnTo.onClick}
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          {returnTo.label}
        </button>
      )}

      {/* Entity header — Atlas's perspective */}
      <div className="relative">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60">
          <span className="uppercase tracking-wider">{entityType}</span>
          <span>{entityId}</span>
          {statusBadge}
        </div>

        {verdict && (
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {verdict}
          </h1>
        )}

        {(typeof financialImpact === "number" || confidence) && (
          <div className="mt-3 flex items-center gap-3">
            {typeof financialImpact === "number" && financialImpact > 0 && (
              <span className="font-mono text-lg font-semibold text-emerald-600 dark:text-emerald-300">
                ${financialImpact.toLocaleString(undefined, { maximumFractionDigits: 0 })} potential recovery
              </span>
            )}
            {confidence && (
              <Badge variant="outline" className={cn("font-mono text-[10px] uppercase tracking-wide", confidenceColors[confidence])}>
                {confidence} confidence
              </Badge>
            )}
          </div>
        )}

        {assessment && (
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            {assessment}
          </p>
        )}

        {actions && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>

      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AtlasAssessment — "ATLAS ASSESSMENT" section with "Why?" evidence trail
// ---------------------------------------------------------------------------

interface AtlasAssessmentProps {
  children: ReactNode;
  /** Evidence supporting this assessment — revealed by "Why?" */
  supportingEvidence?: Array<{
    label: string;
    detail?: string;
    /** Optional source label (e.g. document name) */
    sourceLabel?: string;
    /** Optional source navigation path */
    sourcePath?: string;
  }>;
  /** Optional callback when user clicks "View source" on an evidence item */
  onViewSource?: (sourcePath: string) => void;
}

export function AtlasAssessment({ children, supportingEvidence, onViewSource }: AtlasAssessmentProps) {
  const [showWhy, setShowWhy] = useState(false);

  return (
    <Panel className="p-5">
      <div className="flex items-center gap-2">
        <Radar className="size-4 text-teal-600 dark:text-teal-300" />
        <h2 className="text-sm font-semibold text-foreground">Atlas Assessment</h2>
      </div>
      <div className="mt-3 text-sm leading-6 text-muted-foreground">
        {children}
      </div>

      {/* "Why?" evidence trail — builds trust */}
      {supportingEvidence && supportingEvidence.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowWhy(!showWhy)}
            className="flex items-center gap-1.5 text-xs font-medium text-teal-600 transition-colors hover:text-teal-700 dark:text-teal-300 dark:hover:text-teal-200"
          >
            <Lightbulb className="size-3" />
            {showWhy ? "Hide reasoning" : "Why does Atlas think this?"}
          </button>

          {showWhy && (
            <div className="mt-3 space-y-2 rounded-lg border border-teal-400/20 bg-teal-400/5 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-teal-700 dark:text-teal-200">
                Evidence supporting this conclusion
              </p>
              {supportingEvidence.map((e, i) => (
                <div key={`${e.label}-${i}`} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-3 shrink-0 text-teal-500" />
                  <div className="min-w-0 flex-1">
                    <span className="text-xs text-foreground">{e.label}</span>
                    {e.detail && (
                      <span className="ml-1 text-[11px] text-muted-foreground">— {e.detail}</span>
                    )}
                    {e.sourceLabel && (
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="text-[10px] text-teal-600/70 dark:text-teal-300/70">
                          Source: {e.sourceLabel}
                        </span>
                        {e.sourcePath && (
                          <button
                            type="button"
                            onClick={() => onViewSource?.(e.sourcePath!)}
                            className="text-[10px] font-medium text-teal-600 underline-offset-2 hover:underline dark:text-teal-300"
                          >
                            View source
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// AtlasKnowledge — "WHAT ATLAS KNOWS" with ✓/⚠ items
// ---------------------------------------------------------------------------

interface KnowledgeItem {
  label: string;
  status: "known" | "partial" | "missing";
  detail?: string;
}

interface AtlasKnowledgeProps {
  items: KnowledgeItem[];
  title?: string;
}

export function AtlasKnowledge({ items, title = "What Atlas knows" }: AtlasKnowledgeProps) {
  const known = items.filter((i) => i.status === "known");
  const partial = items.filter((i) => i.status === "partial");
  const missing = items.filter((i) => i.status === "missing");

  return (
    <Panel className="p-5">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <div className="mt-3 space-y-2">
        {known.map((item) => (
          <div key={item.label} className="flex items-start gap-2.5">
            <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
            <div className="min-w-0">
              <span className="text-sm text-foreground">{item.label}</span>
              {item.detail && (
                <span className="ml-1.5 text-xs text-muted-foreground">— {item.detail}</span>
              )}
            </div>
          </div>
        ))}
        {partial.map((item) => (
          <div key={item.label} className="flex items-start gap-2.5">
            <Info className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
            <div className="min-w-0">
              <span className="text-sm text-foreground">{item.label}</span>
              {item.detail && (
                <span className="ml-1.5 text-xs text-muted-foreground">— {item.detail}</span>
              )}
            </div>
          </div>
        ))}
        {missing.map((item) => (
          <div key={item.label} className="flex items-start gap-2.5">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-rose-500" />
            <div className="min-w-0">
              <span className="text-sm text-foreground">{item.label}</span>
              {item.detail && (
                <span className="ml-1.5 text-xs text-muted-foreground">— {item.detail}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// AtlasGaps — "WHAT'S MISSING" section
// ---------------------------------------------------------------------------

interface GapItem {
  label: string;
  severity: "critical" | "warning" | "info";
  description?: string;
}

interface AtlasGapsProps {
  gaps: GapItem[];
}

export function AtlasGaps({ gaps }: AtlasGapsProps) {
  if (gaps.length === 0) return null;

  const severityConfig = {
    critical: { icon: ShieldAlert, color: "text-rose-600 dark:text-rose-300" },
    warning: { icon: Info, color: "text-amber-600 dark:text-amber-300" },
    info: { icon: Info, color: "text-muted-foreground" },
  };

  return (
    <Panel className="p-5">
      <h2 className="text-sm font-semibold text-foreground">What's missing</h2>
      <div className="mt-3 space-y-2">
        {gaps.map((gap) => {
          const config = severityConfig[gap.severity];
          const Icon = config.icon;
          return (
            <div key={gap.label} className="flex items-start gap-2.5">
              <Icon className={cn("mt-0.5 size-3.5 shrink-0", config.color)} />
              <div className="min-w-0">
                <span className="text-sm text-foreground">{gap.label}</span>
                {gap.description && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{gap.description}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// AtlasTimeline — reconstructed claim story
// ---------------------------------------------------------------------------

interface TimelineEvent {
  label: string;
  detail?: string;
  timestamp?: number;
  source?: "atlas" | "system" | "user";
}

interface AtlasTimelineProps {
  events: TimelineEvent[];
  title?: string;
}

export function AtlasTimeline({ events, title = "Claim Story" }: AtlasTimelineProps) {
  if (events.length === 0) return null;

  return (
    <Panel className="p-5">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <div className="mt-4">
        <ol className="relative space-y-4 border-l border-border/60 pl-5">
          {events.map((event, i) => (
            <li key={`${event.label}-${i}`} className="relative">
              <span
                className={cn(
                  "absolute -left-[25px] top-1 size-2.5 rounded-full ring-4 ring-background",
                  event.source === "atlas" ? "bg-violet-400" : event.source === "user" ? "bg-amber-400" : "bg-teal-400"
                )}
              />
              <p className="text-xs font-medium text-foreground">{event.label}</p>
              {event.detail && (
                <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{event.detail}</p>
              )}
              {event.source === "atlas" && (
                <span className="mt-1 inline-flex items-center gap-1 rounded border border-violet-400/30 bg-violet-400/10 px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-violet-600 dark:text-violet-300">
                  <Radar className="size-2.5" /> Atlas
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// AtlasActionRecommendation — "ATLAS RECOMMENDS" section
// ---------------------------------------------------------------------------

interface ActionRecommendation {
  label: string;
  description?: string;
  primary?: boolean;
  onClick?: () => void;
  icon?: LucideIcon;
}

interface AtlasActionRecommendationProps {
  title?: string;
  recommendations: ActionRecommendation[];
}

export function AtlasActionRecommendation({
  title = "Atlas recommends",
  recommendations,
}: AtlasActionRecommendationProps) {
  if (recommendations.length === 0) return null;

  return (
    <Panel className="border-teal-400/25 bg-teal-400/5 p-5">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-teal-600 dark:text-teal-300" />
        <h2 className="text-sm font-semibold text-teal-700 dark:text-teal-200">{title}</h2>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {recommendations.map((rec) => {
          const Icon = rec.icon ?? ArrowRight;
          return (
            <Button
              key={rec.label}
              size="sm"
              variant={rec.primary ? "default" : "outline"}
              className={cn(
                "gap-1.5",
                rec.primary && "bg-teal-400 text-teal-950 hover:bg-teal-300"
              )}
              onClick={rec.onClick}
            >
              <Icon className="size-3.5" />
              {rec.label}
            </Button>
          );
        })}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// AtlasEvidenceSummary — compact evidence overview with relevance context
// ---------------------------------------------------------------------------

interface EvidenceDoc {
  title: string;
  classification?: string;
  /** Why this document matters to the current entity */
  relevance?: string;
  /** Evidence state — how this evidence supports the assessment */
  evidenceState?: "supported" | "inferred" | "missing" | "unavailable" | "contradicted";
  /** Source location if known */
  sourceLocation?: string;
}

interface AtlasEvidenceSummaryProps {
  documents: EvidenceDoc[];
  emptyMessage?: string;
}

export function AtlasEvidenceSummary({ documents, emptyMessage }: AtlasEvidenceSummaryProps) {
  if (documents.length === 0) {
    return (
      <Panel className="p-5">
        <h2 className="text-sm font-semibold text-foreground">Evidence</h2>
        <div className="mt-3 flex flex-col items-center gap-2 py-6 text-center">
          <Radar className="size-6 text-muted-foreground/40" />
          <p className="max-w-xs text-xs leading-5 text-muted-foreground">
            {emptyMessage ?? "Atlas hasn't found supporting evidence yet. You can add documents or ask Atlas what information is needed."}
          </p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel className="p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Evidence</h2>
        <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
          {documents.length} document{documents.length === 1 ? "" : "s"}
        </Badge>
      </div>
      <div className="mt-3 space-y-1.5">
        {documents.map((doc, i) => (
          <div
            key={`${doc.title}-${i}`}
            className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
          >
            <div className="flex items-center gap-2">
              {doc.evidenceState === "missing" ? (
                <span className="size-3.5 shrink-0 rounded-full border border-amber-400/50 bg-amber-400/10" />
              ) : doc.evidenceState === "contradicted" ? (
                <span className="size-3.5 shrink-0 rounded-full border border-rose-400/50 bg-rose-400/10" />
              ) : doc.evidenceState === "inferred" ? (
                <span className="size-3.5 shrink-0 rounded-full border border-sky-400/50 bg-sky-400/10" />
              ) : doc.evidenceState === "unavailable" ? (
                <span className="size-3.5 shrink-0 rounded-full border border-muted-foreground/30 bg-muted/30" />
              ) : (
                <Check className="size-3.5 shrink-0 text-teal-500" />
              )}
              <span className="truncate text-xs font-medium text-foreground">{doc.title}</span>
              {doc.evidenceState && doc.evidenceState !== "supported" && (
                <Badge variant="outline" className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                  {doc.evidenceState}
                </Badge>
              )}
              {doc.classification && (
                <Badge variant="outline" className="ml-auto font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                  {doc.classification}
                </Badge>
              )}
            </div>
            {doc.relevance && (
              <p className="mt-1 ml-5.5 text-[11px] leading-4 text-muted-foreground">
                Relevant because: {doc.relevance}
              </p>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// AtlasConfidenceExplanation — explains WHY confidence is at its level
// ---------------------------------------------------------------------------

interface ConfidenceExplanationItem {
  label: string;
  count?: number;
}

interface AtlasConfidenceExplanationProps {
  confidence: "high" | "medium" | "low";
  supportingDocs?: number;
  supportingFindings?: number;
  discrepancies?: number;
  contradictions?: number;
  additionalFactors?: ConfidenceExplanationItem[];
}

export function AtlasConfidenceExplanation({
  confidence,
  supportingDocs = 0,
  supportingFindings = 0,
  discrepancies = 0,
  contradictions = 0,
  additionalFactors = [],
}: AtlasConfidenceExplanationProps) {
  const [expanded, setExpanded] = useState(false);

  const totalFactors = supportingDocs + supportingFindings + discrepancies + contradictions + additionalFactors.length;

  if (totalFactors === 0) return null;

  const confidenceColors = {
    high: "text-emerald-600 dark:text-emerald-300",
    medium: "text-amber-600 dark:text-amber-300",
    low: "text-muted-foreground",
  };

  return (
    <Panel className="p-4">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="flex items-center gap-1.5">
          <Info className="size-3" />
          Why {confidence} confidence?
        </span>
        <ChevronRight className={cn("size-3 transition-transform", expanded && "rotate-90")} />
      </button>

      {expanded && (
        <div className="mt-3 space-y-1.5">
          {supportingDocs > 0 && (
            <div className="flex items-center gap-2 text-[11px]">
              <Check className="size-3 shrink-0 text-teal-500" />
              <span className="text-foreground">{supportingDocs} supporting document{supportingDocs === 1 ? "" : "s"}</span>
            </div>
          )}
          {supportingFindings > 0 && (
            <div className="flex items-center gap-2 text-[11px]">
              <Check className="size-3 shrink-0 text-teal-500" />
              <span className="text-foreground">{supportingFindings} corroborating finding{supportingFindings === 1 ? "" : "s"}</span>
            </div>
          )}
          {discrepancies > 0 && (
            <div className="flex items-center gap-2 text-[11px]">
              <Check className="size-3 shrink-0 text-teal-500" />
              <span className="text-foreground">{discrepancies} estimate discrepanc{discrepancies === 1 ? "y" : "ies"}</span>
            </div>
          )}
          {contradictions > 0 && (
            <div className="flex items-center gap-2 text-[11px]">
              <ShieldAlert className="size-3 shrink-0 text-rose-500" />
              <span className="text-foreground">{contradictions} contradict{contradictions === 1 ? "ion" : "ions"}</span>
            </div>
          )}
          {additionalFactors.map((f, i) => (
            <div key={`${f.label}-${i}`} className="flex items-center gap-2 text-[11px]">
              <Check className="size-3 shrink-0 text-teal-500" />
              <span className="text-foreground">
                {f.count ? `${f.count} ` : ""}{f.label}
              </span>
            </div>
          ))}
          <p className={cn("mt-2 text-[10px] font-medium", confidenceColors[confidence])}>
            Overall confidence: {confidence.toUpperCase()}
          </p>
        </div>
      )}
    </Panel>
  );
}
