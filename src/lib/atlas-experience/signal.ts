// ---------------------------------------------------------------------------
// Atlas Signal Model
//
// A signal represents a meaningful change Atlas has detected in the business.
// Signals are distinct from activities (what happened) and attention items
// (what requires action). A signal is "something changed, and it matters."
// ---------------------------------------------------------------------------

import type { AtlasEntityReference } from "./entity-reference";
import type { AttentionItem } from "./attention";
import type { AtlasDecision } from "./decision";
import type { AtlasActivity } from "./activity";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SignalSource = "atlas" | "system" | "user" | "external";

export type SignalSignificance = "critical" | "important" | "notable" | "routine";

export type SignalType =
  | "claim_status_changed"
  | "claim_financial_changed"
  | "claim_new"
  | "document_uploaded"
  | "document_processing_completed"
  | "document_processing_failed"
  | "evidence_gap_discovered"
  | "contradiction_discovered"
  | "contradiction_resolved"
  | "evidence_sufficiency_changed"
  | "recommendation_created"
  | "recommendation_status_changed"
  | "workflow_failed"
  | "workflow_completed"
  | "workflow_blocked"
  | "crm_lead_created"
  | "crm_reply_received"
  | "crm_stage_changed"
  | "crm_task_overdue"
  | "revenue_opportunity_identified"
  | "supplement_opportunity_found"
  | "atlas_analysis_completed"
  | "system_integration_sync"
  | "unknown";

export interface AtlasSignal {
  id: string;
  type: SignalType;
  entity: AtlasEntityReference;
  source: SignalSource;
  title: string;
  summary: string;
  occurredAt: string; // ISO timestamp
  significance: SignalSignificance;
  attentionItemId?: string;
  decisionId?: string;
  activityId?: string;
  recommendedAction?: {
    label: string;
    href?: string;
  };
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Significance Classification
// ---------------------------------------------------------------------------

/** Maps signal types to their typical significance level. */
export const SIGNAL_SIGNIFICANCE: Record<SignalType, SignalSignificance> = {
  // Critical
  workflow_failed: "critical",
  contradiction_discovered: "critical",
  evidence_gap_discovered: "critical",
  document_processing_failed: "critical",
  crm_task_overdue: "critical",

  // Important
  claim_status_changed: "important",
  claim_financial_changed: "important",
  recommendation_created: "important",
  recommendation_status_changed: "important",
  revenue_opportunity_identified: "important",
  supplement_opportunity_found: "important",
  workflow_completed: "important",
  crm_reply_received: "important",
  crm_stage_changed: "important",

  // Notable
  document_uploaded: "notable",
  document_processing_completed: "notable",
  claim_new: "notable",
  contradiction_resolved: "notable",
  evidence_sufficiency_changed: "notable",
  atlas_analysis_completed: "notable",
  crm_lead_created: "notable",
  workflow_blocked: "notable",

  // Routine
  system_integration_sync: "routine",
  unknown: "routine",
};

/** Significance ordering for sorting (lower = more significant). */
export const SIGNIFICANCE_ORDER: Record<SignalSignificance, number> = {
  critical: 0,
  important: 1,
  notable: 2,
  routine: 3,
};

// ---------------------------------------------------------------------------
// Significance Filtering
// ---------------------------------------------------------------------------

/**
 * Determines if a signal should surface in the proactive display.
 * Critical and important always surface. Notable surfaces if above a threshold.
 * Routine never surfaces proactively.
 */
export function shouldSurfaceSignal(signal: AtlasSignal): boolean {
  if (signal.significance === "critical") return true;
  if (signal.significance === "important") return true;
  if (signal.significance === "notable") return true;
  return false; // routine never surfaces proactively
}

/**
 * Filter signals to those that should appear on the proactive surface.
 */
export function filterSurfaceSignals(signals: AtlasSignal[]): AtlasSignal[] {
  return signals
    .filter(shouldSurfaceSignal)
    .sort((a, b) => SIGNIFICANCE_ORDER[a.significance] - SIGNIFICANCE_ORDER[b.significance]);
}

// ---------------------------------------------------------------------------
// Change Detection
// ---------------------------------------------------------------------------

/** Stored representation of a previously-seen signal. */
export interface SeenSignalState {
  signalId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
}

/**
 * Identify which signals are new since a given timestamp.
 * Returns only signals that occurred after the cutoff.
 */
export function detectNewSignals(
  signals: AtlasSignal[],
  lastVisitAt: string | null,
): AtlasSignal[] {
  if (!lastVisitAt) return filterSurfaceSignals(signals);

  const cutoff = new Date(lastVisitAt).getTime();
  return filterSurfaceSignals(signals).filter(
    (s) => new Date(s.occurredAt).getTime() > cutoff,
  );
}

/**
 * Identify signals that the user has not yet acknowledged.
 * Compares signal IDs against previously seen state.
 */
export function detectUnseenSignals(
  signals: AtlasSignal[],
  seenState: Map<string, SeenSignalState>,
): AtlasSignal[] {
  return filterSurfaceSignals(signals).filter((s) => !seenState.has(s.id));
}

// ---------------------------------------------------------------------------
// Duplicate Prevention
// ---------------------------------------------------------------------------

/**
 * Deduplicate signals by type + entity ID + occurrence window.
 * If two signals of the same type target the same entity within the window,
 * keep only the most recent one.
 */
export function deduplicateSignals(
  signals: AtlasSignal[],
  windowMs: number = 60_000, // 1 minute default
): AtlasSignal[] {
  const sorted = [...signals].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );

  const seen = new Map<string, AtlasSignal>();
  const result: AtlasSignal[] = [];

  for (const signal of sorted) {
    const key = `${signal.type}:${signal.entity.id}`;
    const existing = seen.get(key);
    if (existing) {
      const existingTime = new Date(existing.occurredAt).getTime();
      const signalTime = new Date(signal.occurredAt).getTime();
      if (existingTime - signalTime < windowMs) {
        // Same type + entity within window — skip older duplicate
        continue;
      }
    }
    seen.set(key, signal);
    result.push(signal);
  }

  return result.sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
}

// ---------------------------------------------------------------------------
// Factory: Convert existing data → AtlasSignal
// ---------------------------------------------------------------------------

let signalCounter = 0;
function nextSignalId(): string {
  return `signal-${Date.now()}-${++signalCounter}`;
}

/**
 * Convert an AttentionItem into an AtlasSignal.
 * Links the signal back to the originating attention item.
 */
export function attentionToSignal(item: AttentionItem): AtlasSignal {
  const significance: SignalSignificance =
    item.severity === "critical"
      ? "critical"
      : item.severity === "high"
        ? "important"
        : item.severity === "medium"
          ? "notable"
          : "routine";

  return {
    id: nextSignalId(),
    type: mapAttentionCategoryToSignalType(item.category),
    entity: item.sourceEntityId
      ? {
          type: (item.sourceEntityType as AtlasEntityReference["type"]) ?? "claim",
          id: item.sourceEntityId,
          label: item.title,
        }
      : { type: "claim", id: "unknown", label: "Unknown" },
    source: "atlas",
    title: item.title,
    summary: item.explanation,
    occurredAt: new Date().toISOString(),
    significance,
    attentionItemId: item.id,
    recommendedAction: item.navigationTarget
      ? { label: "Review", href: item.navigationTarget }
      : undefined,
  };
}

/**
 * Convert an AtlasDecision into an AtlasSignal.
 * Links the signal back to the originating decision.
 */
export function decisionToSignal(decision: AtlasDecision): AtlasSignal {
  const significance: SignalSignificance =
    decision.importance.severity === "critical"
      ? "critical"
      : decision.importance.severity === "high"
        ? "important"
        : decision.importance.severity === "medium"
          ? "notable"
          : "routine";

  return {
    id: nextSignalId(),
    type: "recommendation_created",
    entity: decision.entity,
    source: "atlas",
    title: decision.recommendation.title,
    summary: decision.recommendation.summary,
    occurredAt: decision.createdAt,
    significance,
    decisionId: decision.id,
    recommendedAction: decision.action
      ? { label: decision.action.label, href: decision.entity.href }
      : { label: "Review", href: decision.entity.href },
  };
}

/**
 * Convert an AtlasActivity into an AtlasSignal.
 * Only converts activities that represent meaningful changes.
 */
export function activityToSignal(activity: AtlasActivity): AtlasSignal | null {
  // Only convert activities that are significant enough for proactive surfacing
  const significantTypes = new Set([
    "contradiction_found",
    "evidence_gap",
    "supplement_generated",
    "revenue_opportunity",
    "claim_status_changed",
    "document_processing_failed",
    "workflow_failed",
    "recommendation_created",
  ]);

  // Check if the activity's category maps to a significant type
  const categoryLower = activity.category.toLowerCase().replace(/_/g, "");
  const isSignificant = [...significantTypes].some((t) => categoryLower.includes(t.replace(/_/g, "")));

  if (!isSignificant) return null;

  const significance: SignalSignificance =
    activity.significance === "important"
      ? "important"
      : activity.significance === "notable"
        ? "notable"
        : "routine";

  return {
    id: nextSignalId(),
    type: mapActivityCategoryToSignalType(activity.category),
    entity: activity.entity,
    source: activity.actor.type === "atlas" ? "atlas" : activity.actor.type === "system" ? "system" : "user",
    title: activity.title,
    summary: activity.summary ?? activity.title,
    occurredAt: activity.timestamp > 0 ? new Date(activity.timestamp).toISOString() : new Date().toISOString(),
    significance,
    activityId: activity.id,
    recommendedAction: activity.entity.href
      ? { label: "View", href: activity.entity.href }
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Mapping Helpers
// ---------------------------------------------------------------------------

function mapAttentionCategoryToSignalType(category: string): SignalType {
  const lower = category.toLowerCase();
  if (lower.includes("contradiction")) return "contradiction_discovered";
  if (lower.includes("evidence") && lower.includes("gap")) return "evidence_gap_discovered";
  if (lower.includes("supplement")) return "supplement_opportunity_found";
  if (lower.includes("revenue") || lower.includes("financial") || lower.includes("outstanding")) {
    return "revenue_opportunity_identified";
  }
  if (lower.includes("incomplete")) return "evidence_gap_discovered";
  if (lower.includes("discrepancy")) return "contradiction_discovered";
  return "unknown";
}

function mapActivityCategoryToSignalType(category: string): SignalType {
  const lower = category.toLowerCase();
  if (lower.includes("contradiction")) return "contradiction_discovered";
  if (lower.includes("evidence") && lower.includes("gap")) return "evidence_gap_discovered";
  if (lower.includes("supplement")) return "supplement_opportunity_found";
  if (lower.includes("revenue") || lower.includes("financial")) return "revenue_opportunity_identified";
  if (lower.includes("workflow") && lower.includes("failed")) return "workflow_failed";
  if (lower.includes("recommendation")) return "recommendation_created";
  if (lower.includes("claim") && lower.includes("status")) return "claim_status_changed";
  if (lower.includes("document") && lower.includes("processing")) return "document_processing_completed";
  if (lower.includes("analysis")) return "atlas_analysis_completed";
  return "unknown";
}

// ---------------------------------------------------------------------------
// "Since You Were Last Here" Context
// ---------------------------------------------------------------------------

export interface SinceLastVisit {
  totalNew: number;
  criticalCount: number;
  importantCount: number;
  signals: AtlasSignal[];
  byEntity: Map<string, AtlasSignal[]>;
}

/**
 * Build the "Since you were last here" summary.
 * Groups new signals by entity and counts by significance.
 */
export function buildSinceLastVisit(
  newSignals: AtlasSignal[],
): SinceLastVisit {
  const byEntity = new Map<string, AtlasSignal[]>();

  for (const signal of newSignals) {
    const key = `${signal.entity.type}:${signal.entity.id}`;
    const existing = byEntity.get(key) ?? [];
    existing.push(signal);
    byEntity.set(key, existing);
  }

  return {
    totalNew: newSignals.length,
    criticalCount: newSignals.filter((s) => s.significance === "critical").length,
    importantCount: newSignals.filter((s) => s.significance === "important").length,
    signals: newSignals,
    byEntity,
  };
}

// ---------------------------------------------------------------------------
// Proactive Context for Ask Atlas
// ---------------------------------------------------------------------------

export interface ProactiveAtlasContext {
  newSignalsCount: number;
  criticalSignals: string[];
  entityIds: string[];
  summary: string;
}

/**
 * Build compact proactive context for Ask Atlas integration.
 */
export function buildProactiveContext(signals: AtlasSignal[]): ProactiveAtlasContext {
  const surfaceSignals = filterSurfaceSignals(signals);
  const critical = surfaceSignals.filter((s) => s.significance === "critical");
  const entityIds = [...new Set(surfaceSignals.map((s) => s.entity.id))];

  const parts: string[] = [];
  if (critical.length > 0) {
    parts.push(`${critical.length} critical change${critical.length === 1 ? "" : "s"}`);
  }
  const important = surfaceSignals.filter((s) => s.significance === "important");
  if (important.length > 0) {
    parts.push(`${important.length} important change${important.length === 1 ? "" : "s"}`);
  }

  return {
    newSignalsCount: surfaceSignals.length,
    criticalSignals: critical.map((s) => s.title),
    entityIds,
    summary: parts.length > 0 ? parts.join(", ") : "No significant changes",
  };
}
