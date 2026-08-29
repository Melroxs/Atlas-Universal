// ---------------------------------------------------------------------------
// Atlas Decision Model
//
// A unified representation of Atlas decisions that wraps the existing
// Recommendation system and Decision Engine. This is the experience layer
// over the existing recommendation state machine.
//
// Pipeline: OBSERVATION → EVIDENCE → DECISION → RECOMMENDATION → ACTION
// ---------------------------------------------------------------------------

import { type AtlasEntityReference } from "./entity-reference";

// ---------------------------------------------------------------------------
// Decision Types
// ---------------------------------------------------------------------------

/** What Atlas found — a factual observation */
export interface AtlasObservation {
  /** What Atlas found */
  title: string;
  /** Why it matters — business context */
  summary: string;
}

/** Evidence supporting a decision */
export interface AtlasEvidenceReference {
  /** Evidence title or description */
  title: string;
  /** Type of evidence (document, entity, estimate, etc.) */
  kind: "document" | "entity" | "estimate" | "correspondence" | "inference";
  /** Relevance score 0..1 (from existing evidence system) */
  relevance: number;
  /** Optional snippet / excerpt */
  snippet?: string;
  /** Related entity ID if applicable */
  entityId?: string;
  /** Related entity type */
  entityType?: string;
}

/** Importance assessment */
export interface AtlasDecisionImportance {
  /** Severity classification */
  severity: "critical" | "high" | "medium" | "low" | "info";
  /** Financial impact if known — never fabricated */
  impact?: number;
  /** Impact description */
  impactDescription?: string;
}

/** The recommendation from Atlas */
export interface AtlasDecisionRecommendation {
  /** What Atlas recommends */
  title: string;
  /** Detailed recommendation */
  summary: string;
  /** Confidence 0..1 or undefined if not calculated */
  confidence?: number;
  /** Why Atlas recommends this */
  reasoning: string;
}

/** The action Atlas proposes */
export interface AtlasDecisionAction {
  /** Action label */
  label: string;
  /** Action type identifier */
  actionType: "prepare" | "submit" | "approve" | "review" | "create" | "send" | "update";
  /** Whether this requires human approval */
  requiresApproval: boolean;
  /** Whether this is a destructive/irreversible action */
  destructive?: boolean;
  /** Action description */
  description?: string;
  /** Parameters for the action */
  params?: Record<string, unknown>;
}

/** Decision status — maps to existing recommendation state machine */
export type AtlasDecisionStatus =
  | "new"          // Newly identified, not yet reviewed
  | "review"       // Under review by user
  | "approved"     // User approved (maps to recommendation.approved)
  | "rejected"     // User rejected (maps to recommendation.rejected)
  | "executed"     // Action completed (maps to recommendation.executed)
  | "dismissed";   // User dismissed (maps to recommendation.dismissed)

/** A unified Atlas decision */
export interface AtlasDecision {
  /** Unique identifier */
  id: string;

  /** The entity this decision relates to */
  entity: AtlasEntityReference;

  /** What Atlas found */
  observation: AtlasObservation;

  /** Why it matters */
  importance: AtlasDecisionImportance;

  /** Supporting evidence */
  evidence: AtlasEvidenceReference[];

  /** What Atlas recommends */
  recommendation: AtlasDecisionRecommendation;

  /** What can happen next */
  action?: AtlasDecisionAction;

  /** Current decision status */
  status: AtlasDecisionStatus;

  /** Decision source (which detector/agent generated this) */
  source?: string;

  /** Whether human approval is required before action */
  requiresApproval: boolean;

  /** Related attention item ID (from Prompt 02) */
  attentionItemId?: string;

  /** Related activity IDs (from Prompt 04) */
  activityIds?: string[];

  /** When the decision was created */
  createdAt: string;

  /** When the decision was last updated */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Decision Status Constants
// ---------------------------------------------------------------------------

/** Human-readable labels for decision statuses */
export const DECISION_STATUS_LABELS: Record<AtlasDecisionStatus, string> = {
  new: "New",
  review: "Under Review",
  approved: "Approved",
  rejected: "Rejected",
  executed: "Executed",
  dismissed: "Dismissed",
};

/** Styling for decision statuses */
export const DECISION_STATUS_STYLES: Record<AtlasDecisionStatus, string> = {
  new: "border-teal-400/30 bg-teal-400/10 text-teal-600 dark:text-teal-300",
  review: "border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300",
  approved: "border-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300",
  rejected: "border-rose-400/30 bg-rose-400/10 text-rose-600 dark:text-rose-300",
  executed: "border-sky-400/30 bg-sky-400/10 text-sky-600 dark:text-sky-300",
  dismissed: "border-muted-foreground/30 bg-muted text-muted-foreground",
};

/** Severity styling */
export const SEVERITY_STYLES: Record<string, string> = {
  critical: "border-rose-400/30 bg-rose-400/10 text-rose-600 dark:text-rose-300",
  high: "border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300",
  medium: "border-sky-400/30 bg-sky-400/10 text-sky-600 dark:text-sky-300",
  low: "border-border/60 bg-muted text-muted-foreground",
  info: "border-border/60 bg-muted text-muted-foreground",
};

/** Severity priority for sorting (lower = more important) */
export const SEVERITY_PRIORITY: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

// ---------------------------------------------------------------------------
// Confidence Helpers
// ---------------------------------------------------------------------------

/** Get a human-readable confidence label */
export function getConfidenceLabel(confidence?: number): string {
  if (confidence === undefined || confidence === null) return "Evidence incomplete";
  if (confidence >= 0.8) return "High confidence";
  if (confidence >= 0.5) return "Moderate confidence";
  return "Low confidence";
}

/** Get confidence styling */
export function getConfidenceStyle(confidence?: number): string {
  if (confidence === undefined || confidence === null) return "text-muted-foreground";
  if (confidence >= 0.8) return "text-emerald-600 dark:text-emerald-300";
  if (confidence >= 0.5) return "text-amber-600 dark:text-amber-300";
  return "text-rose-600 dark:text-rose-300";
}

// ---------------------------------------------------------------------------
// Decision Factories — create AtlasDecision from existing data
// ---------------------------------------------------------------------------

let decisionCounter = 0;
function nextDecisionId(): string {
  return `decision-${Date.now()}-${++decisionCounter}`;
}

/**
 * Map a recommendation status to a decision status.
 */
export function recommendationStatusToDecisionStatus(
  status: string,
): AtlasDecisionStatus {
  switch (status) {
    case "open": return "new";
    case "approved": return "approved";
    case "rejected": return "rejected";
    case "executed": return "executed";
    case "dismissed": return "dismissed";
    default: return "new";
  }
}

/**
 * Create an AtlasDecision from an existing recommendation record.
 * This is the primary adapter — it wraps the existing recommendation
 * system into the unified decision model.
 */
export function recommendationToDecision(rec: {
  _id: string;
  _creationTime: number;
  title: string;
  summary: string;
  reason: string;
  priority: string;
  status: string;
  confidence: number;
  expectedImpact?: string;
  risk?: string;
  detectorKey: string;
  evidence: Array<{
    kind: string;
    title?: string;
    snippet?: string;
    relevance: number;
    entityId?: string;
    entityType?: string;
  }>;
  decidedAt?: number;
}): AtlasDecision {
  // Map priority to severity
  const severityMap: Record<string, AtlasDecisionImportance["severity"]> = {
    critical: "critical",
    high: "high",
    medium: "medium",
    low: "low",
  };
  const severity = severityMap[rec.priority] ?? "medium";

  // Parse financial impact from expectedImpact string
  let impact: number | undefined;
  if (rec.expectedImpact) {
    const match = rec.expectedImpact.match(/\$?([\d,]+(?:\.\d+)?)/);
    if (match) {
      impact = parseFloat(match[1].replace(/,/g, ""));
    }
  }

  // Determine action type based on detector key
  let actionType: AtlasDecisionAction["actionType"] = "review";
  if (rec.detectorKey.includes("supplement")) actionType = "submit";
  else if (rec.detectorKey.includes("gap")) actionType = "review";
  else if (rec.detectorKey.includes("contradiction")) actionType = "review";

  return {
    id: rec._id,
    entity: {
      type: "recommendation",
      id: rec._id,
      label: rec.title,
      href: "/dashboard/recommendations",
    },
    observation: {
      title: rec.title,
      summary: rec.summary,
    },
    importance: {
      severity,
      impact,
      impactDescription: rec.expectedImpact,
    },
    evidence: rec.evidence.map((e) => ({
      title: e.title ?? e.kind,
      kind: (e.kind as AtlasEvidenceReference["kind"]) ?? "document",
      relevance: e.relevance,
      snippet: e.snippet,
      entityId: e.entityId,
      entityType: e.entityType,
    })),
    recommendation: {
      title: rec.title,
      summary: rec.summary,
      confidence: rec.confidence,
      reasoning: rec.reason,
    },
    action: {
      label: actionType === "submit" ? "Review recommendation" : "Review finding",
      actionType,
      requiresApproval: true,
      description: rec.reason,
    },
    status: recommendationStatusToDecisionStatus(rec.status),
    source: rec.detectorKey,
    requiresApproval: rec.status === "open",
    createdAt: String(rec._creationTime),
    updatedAt: rec.decidedAt ? String(rec.decidedAt) : String(rec._creationTime),
  };
}

/**
 * Create a decision from an attention item (from Prompt 02).
 * This links attention → decision.
 */
export function attentionItemToDecision(item: {
  id: string;
  type: string;
  severity: string;
  title: string;
  summary: string;
  entityType?: string;
  entityId?: string;
  financialImpact?: number;
  recommendedAction?: { label: string; actionType: string };
  confidence?: number;
}): AtlasDecision {
  return {
    id: nextDecisionId(),
    entity: {
      type: (item.entityType as AtlasEntityReference["type"]) ?? "unknown",
      id: item.entityId ?? "",
      label: item.title,
    },
    observation: {
      title: item.title,
      summary: item.summary,
    },
    importance: {
      severity: item.severity as AtlasDecisionImportance["severity"],
      impact: item.financialImpact,
    },
    evidence: [],
    recommendation: {
      title: item.title,
      summary: item.summary,
      confidence: item.confidence,
      reasoning: item.summary,
    },
    action: item.recommendedAction
      ? {
          label: item.recommendedAction.label,
          actionType: item.recommendedAction.actionType as AtlasDecisionAction["actionType"],
          requiresApproval: true,
        }
      : undefined,
    status: "new",
    requiresApproval: true,
    attentionItemId: item.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Decision Filtering & Sorting
// ---------------------------------------------------------------------------

/** Sort decisions by importance (critical first) */
export function sortDecisionsByImportance(decisions: AtlasDecision[]): AtlasDecision[] {
  return [...decisions].sort((a, b) => {
    const aPriority = SEVERITY_PRIORITY[a.importance.severity] ?? 4;
    const bPriority = SEVERITY_PRIORITY[b.importance.severity] ?? 4;
    if (aPriority !== bPriority) return aPriority - bPriority;
    // Then by confidence (higher first)
    const aConf = a.recommendation.confidence ?? 0;
    const bConf = b.recommendation.confidence ?? 0;
    return bConf - aConf;
  });
}

/** Filter decisions by status */
export function filterDecisionsByStatus(
  decisions: AtlasDecision[],
  ...statuses: AtlasDecisionStatus[]
): AtlasDecision[] {
  return decisions.filter((d) => statuses.includes(d.status));
}

/** Filter decisions that require approval */
export function getDecisionsRequiringApproval(decisions: AtlasDecision[]): AtlasDecision[] {
  return decisions.filter((d) => d.requiresApproval && d.status === "new");
}

/** Get only high-impact decisions */
export function getHighImpactDecisions(decisions: AtlasDecision[]): AtlasDecision[] {
  return decisions.filter(
    (d) =>
      d.importance.severity === "critical" ||
      d.importance.severity === "high" ||
      (d.importance.impact !== undefined && d.importance.impact > 0),
  );
}

/** Get the total potential financial impact */
export function getTotalPotentialImpact(decisions: AtlasDecision[]): number {
  return decisions.reduce((sum, d) => sum + (d.importance.impact ?? 0), 0);
}
