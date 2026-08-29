// ---------------------------------------------------------------------------
// Atlas Attention Model
//
// A reusable system for surfacing "what needs attention" across the platform.
// Attention items represent anything Atlas identifies as important: missing
// evidence, contradictions, overdue tasks, revenue opportunities, etc.
//
// This module provides types, severity/category classification, and display
// utilities. The actual attention items are produced by existing Atlas systems
// (recommendations, evidence engine, claim analysis) and normalized here.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AttentionSeverity = "critical" | "high" | "medium" | "low" | "info";

export type AttentionCategory =
  | "evidence_gap"
  | "contradiction"
  | "claim_issue"
  | "supplement_opportunity"
  | "overdue_task"
  | "recommendation"
  | "workflow_failed"
  | "integration_problem"
  | "customer_activity"
  | "ai_insight"
  | "revenue_opportunity"
  | "readiness_warning"
  | "action_required"
  | "document_issue";

export interface AttentionItem {
  id: string;
  severity: AttentionSeverity;
  category: AttentionCategory;
  title: string;
  explanation: string;
  /** Reference to the related entity (claim, document, etc.) */
  sourceEntityId?: string;
  sourceEntityType?: string;
  sourceEntityName?: string;
  timestamp: number;
  /** The recommended next action */
  nextAction?: string;
  /** Whether there is supporting evidence */
  hasEvidence?: boolean;
  /** Current status */
  status: "open" | "acknowledged" | "resolved";
  /** Where navigating should take the user */
  navigationTarget?: string;
  /** Optional additional metadata */
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Severity / category styling (theme-aware)
// ---------------------------------------------------------------------------

export const SEVERITY_STYLES: Record<AttentionSeverity, string> = {
  critical: "border-rose-400/40 bg-rose-400/10 text-rose-600 dark:text-rose-300",
  high: "border-amber-400/40 bg-amber-400/10 text-amber-600 dark:text-amber-300",
  medium: "border-sky-400/40 bg-sky-400/10 text-sky-600 dark:text-sky-300",
  low: "border-teal-400/40 bg-teal-400/10 text-teal-600 dark:text-teal-300",
  info: "border-muted-foreground/30 bg-muted text-muted-foreground",
};

export const CATEGORY_LABELS: Record<AttentionCategory, string> = {
  evidence_gap: "Evidence gap",
  contradiction: "Contradiction",
  claim_issue: "Claim issue",
  supplement_opportunity: "Supplement opportunity",
  overdue_task: "Overdue task",
  recommendation: "Recommendation",
  workflow_failed: "Workflow failed",
  integration_problem: "Integration issue",
  customer_activity: "Customer activity",
  ai_insight: "Atlas insight",
  revenue_opportunity: "Revenue opportunity",
  readiness_warning: "Readiness warning",
  action_required: "Action required",
  document_issue: "Document issue",
};

export const CATEGORY_ICONS: Record<AttentionCategory, string> = {
  evidence_gap: "FileSearch",
  contradiction: "ShieldAlert",
  claim_issue: "Flame",
  supplement_opportunity: "Sparkles",
  overdue_task: "Clock",
  recommendation: "Target",
  workflow_failed: "AlertTriangle",
  integration_problem: "Cable",
  customer_activity: "Users",
  ai_insight: "Brain",
  revenue_opportunity: "TrendingUp",
  readiness_warning: "Radar",
  action_required: "Zap",
  document_issue: "FileSearch",
};

// ---------------------------------------------------------------------------
// Attention item factories — normalize existing data into attention items
// ---------------------------------------------------------------------------

/**
 * Convert a recommendation (from the existing recommendation system) into
 * an attention item.
 */
export function recommendationToAttentionItem(rec: {
  _id: string;
  title: string;
  summary: string;
  priority: string;
  status: string;
  confidence: number;
  detectorKey: string;
  decidedAt?: number | null;
  _creationTime: number;
  evidence?: Array<Record<string, unknown>>;
}): AttentionItem {
  const severityMap: Record<string, AttentionSeverity> = {
    high: "critical",
    medium: "high",
    low: "medium",
  };

  return {
    id: `rec-${rec._id}`,
    severity: severityMap[rec.priority] ?? "medium",
    category: "recommendation",
    title: rec.title,
    explanation: rec.summary,
    timestamp: rec.decidedAt ?? rec._creationTime,
    hasEvidence: (rec.evidence?.length ?? 0) > 0,
    status: rec.status === "open" ? "open" : rec.status === "dismissed" ? "resolved" : "acknowledged",
    navigationTarget: "/dashboard/recommendations",
    meta: { detectorKey: rec.detectorKey, confidence: rec.confidence },
  };
}

/**
 * Convert a claim (from the revenue recovery system) needing attention
 * into an attention item.
 */
export function claimToAttentionItem(claim: {
  _id: string;
  claimNumber?: string | null;
  customer?: string | null;
  property?: string | null;
  status?: string;
  openFindings?: number;
  outstanding?: number;
  completeness?: number;
  completenessTotal?: number;
  hasDiscrepancy?: boolean;
}): AttentionItem {
  const hasFindings = (claim.openFindings ?? 0) > 0;
  const hasOutstanding = (claim.outstanding ?? 0) > 0;
  const incomplete = (claim.completeness ?? 0) < (claim.completenessTotal ?? 0);

  let severity: AttentionSeverity = "medium";
  if (hasOutstanding && hasFindings) severity = "critical";
  else if (hasOutstanding || hasFindings) severity = "high";
  else if (incomplete) severity = "medium";

  const label = claim.customer ?? claim.property ?? claim.claimNumber ?? "Unnamed claim";

  let category: AttentionCategory = "claim_issue";
  if (hasFindings) category = "supplement_opportunity";
  if (claim.hasDiscrepancy) category = "contradiction";
  if (incomplete && !hasFindings) category = "evidence_gap";

  return {
    id: `claim-${claim._id}`,
    severity,
    category,
    title: label,
    explanation: [
      hasFindings ? `${claim.openFindings} open finding${(claim.openFindings ?? 0) === 1 ? "" : "s"}` : null,
      hasOutstanding ? `$${(claim.outstanding ?? 0).toLocaleString()} potentially outstanding` : null,
      incomplete ? `${claim.completeness}/${claim.completenessTotal} complete` : null,
      claim.status ? `Status: ${claim.status.replace(/_/g, " ")}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    sourceEntityId: claim._id,
    sourceEntityType: "claim",
    sourceEntityName: claim.claimNumber ?? undefined,
    timestamp: Date.now(),
    nextAction: hasFindings ? "Review findings" : incomplete ? "Upload missing evidence" : "Review claim",
    status: "open",
    navigationTarget: `/dashboard/revenue-recovery/${claim._id}`,
  };
}

/**
 * Convert document pipeline status into attention items.
 */
export function pipelineToAttentionItems(stats: {
  total?: number;
  ready?: number;
  processing?: number;
  failed?: number;
}): AttentionItem[] {
  const items: AttentionItem[] = [];

  if ((stats.failed ?? 0) > 0) {
    items.push({
      id: "pipeline-failed",
      severity: "high",
      category: "workflow_failed",
      title: "Document processing failures",
      explanation: `${stats.failed} document${(stats.failed ?? 0) === 1 ? "" : "s"} failed processing`,
      timestamp: Date.now(),
      nextAction: "Review failed documents",
      status: "open",
      navigationTarget: "/dashboard/knowledge",
    });
  }

  if ((stats.processing ?? 0) > 0) {
    items.push({
      id: "pipeline-processing",
      severity: "info",
      category: "ai_insight",
      title: "Documents processing",
      explanation: `${stats.processing} document${(stats.processing ?? 0) === 1 ? "" : "s"} currently being analyzed`,
      timestamp: Date.now(),
      status: "open",
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Sorting and filtering
// ---------------------------------------------------------------------------

export const SEVERITY_ORDER: Record<AttentionSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/** Sort attention items by severity (critical first), then by timestamp (newest first). */
export function sortAttentionItems(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => {
    const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return b.timestamp - a.timestamp;
  });
}

/** Filter attention items by severity. */
export function filterBySeverity(
  items: AttentionItem[],
  minSeverity: AttentionSeverity,
): AttentionItem[] {
  const min = SEVERITY_ORDER[minSeverity];
  return items.filter((item) => SEVERITY_ORDER[item.severity] <= min);
}

/** Get count of open attention items by severity. */
export function countBySeverity(items: AttentionItem[]): Record<AttentionSeverity, number> {
  const counts: Record<AttentionSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const item of items) {
    if (item.status === "open") {
      counts[item.severity]++;
    }
  }
  return counts;
}
