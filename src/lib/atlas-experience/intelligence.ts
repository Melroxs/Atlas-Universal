// ---------------------------------------------------------------------------
// Atlas Intelligence Aggregation Engine
//
// A pure TypeScript layer that collects attention signals from all Atlas
// systems, applies deterministic prioritization, and produces a unified
// list of attention items.
//
// This module has NO React dependencies — it is a pure data pipeline that
// can be consumed by Dashboard, Ask Atlas, agents, mobile, etc.
// ---------------------------------------------------------------------------

import {
  type AttentionItem,
  type AttentionSeverity,
  type AttentionCategory,
  SEVERITY_ORDER,
  countBySeverity,
} from "./attention";

// ---------------------------------------------------------------------------
// Enriched Attention Item — extends base with intelligence metadata
// ---------------------------------------------------------------------------

export interface EnrichedAttentionItem extends AttentionItem {
  /** Deterministic priority score (lower = more important) */
  priorityScore: number;
  /** Financial impact in dollars, if known */
  financialImpact?: number;
  /** Source system that generated this signal */
  source: string;
  /** Confidence in this signal (0-1), if calculable */
  confidence?: number;
  /** Age of item in hours */
  ageHours: number;
}

// ---------------------------------------------------------------------------
// Intelligence Snapshot — the full output of the aggregation layer
// ---------------------------------------------------------------------------

export interface IntelligenceSnapshot {
  /** All attention items, prioritized */
  items: EnrichedAttentionItem[];
  /** Summary counts by severity */
  counts: Record<AttentionSeverity, number>;
  /** Total financial impact across all items */
  totalFinancialImpact: number;
  /** Number of items requiring immediate action */
  actionRequiredCount: number;
  /** Timestamp of this snapshot */
  generatedAt: number;
}

// ---------------------------------------------------------------------------
// Prioritization Engine — deterministic scoring
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic priority score for an attention item.
 * Lower score = higher priority.
 *
 * Scoring factors:
 *   1. Severity weight (dominant factor)
 *   2. Financial impact (when known)
 *   3. Age penalty (older items slightly less urgent)
 *   4. Source importance (claims/revenue > system)
 */

const SEVERITY_WEIGHT: Record<AttentionSeverity, number> = {
  critical: 0,
  high: 100,
  medium: 200,
  low: 300,
  info: 400,
};

const SOURCE_WEIGHT: Record<string, number> = {
  claims: 0,
  revenue: 0,
  evidence: 10,
  recommendations: 15,
  documents: 20,
  workflows: 25,
  system: 40,
  integration: 35,
};

export function computePriorityScore(item: AttentionItem): number {
  const severityBase = SEVERITY_WEIGHT[item.severity] ?? 200;

  // Financial impact bonus: items with known financial impact rank higher
  const financialBonus = (() => {
    const meta = item.meta;
    if (meta && typeof meta === "object") {
      const amount = meta.financialImpact;
      if (typeof amount === "number" && amount > 0) {
        // More impactful items get lower scores (higher priority)
        // $10K+ = -50 points, $1K+ = -30, $100+ = -10
        if (amount >= 10000) return -50;
        if (amount >= 1000) return -30;
        if (amount >= 100) return -10;
      }
    }
    return 0;
  })();

  // Source importance: revenue/claims sources get priority
  const sourceWeight = (() => {
    const source = (item.meta?.source as string) ?? "";
    return SOURCE_WEIGHT[source] ?? 20;
  })();

  // Age penalty: items older than 7 days lose priority (max +50)
  const ageMs = Date.now() - item.timestamp;
  const ageHours = ageMs / (1000 * 60 * 60);
  const agePenalty = Math.min(Math.floor(ageHours / 24), 2) * 25;

  // Status adjustment: acknowledged items are less urgent
  const statusAdjustment = item.status === "acknowledged" ? 75 : 0;

  return severityBase + financialBonus + sourceWeight + agePenalty + statusAdjustment;
}

// ---------------------------------------------------------------------------
// Prioritization — sort and filter
// ---------------------------------------------------------------------------

/**
 * Apply deterministic prioritization to a list of attention items.
 * Returns items sorted by priority score (lowest = most important first).
 */
export function prioritizeItems(items: AttentionItem[]): EnrichedAttentionItem[] {
  const now = Date.now();

  const enriched: EnrichedAttentionItem[] = items.map((item) => {
    const ageMs = now - item.timestamp;
    const financialImpact =
      typeof item.meta?.financialImpact === "number"
        ? (item.meta.financialImpact as number)
        : undefined;

    return {
      ...item,
      priorityScore: computePriorityScore(item),
      financialImpact,
      source: (item.meta?.source as string) ?? "unknown",
      confidence:
        typeof item.meta?.confidence === "number"
          ? (item.meta.confidence as number)
          : undefined,
      ageHours: ageMs / (1000 * 60 * 60),
    };
  });

  return enriched.sort((a, b) => a.priorityScore - b.priorityScore);
}

// ---------------------------------------------------------------------------
// Intelligence Snapshot Builder
// ---------------------------------------------------------------------------

/**
 * Build a complete intelligence snapshot from a list of attention items.
 * This is the main entry point for the aggregation layer.
 */
export function buildIntelligenceSnapshot(
  items: AttentionItem[],
): IntelligenceSnapshot {
  const prioritized = prioritizeItems(items);
  const counts = countBySeverity(items);

  const totalFinancialImpact = prioritized.reduce((sum, item) => {
    return sum + (item.financialImpact ?? 0);
  }, 0);

  const actionRequiredCount = prioritized.filter(
    (item) =>
      item.status === "open" &&
      (item.severity === "critical" || item.severity === "high"),
  ).length;

  return {
    items: prioritized,
    counts,
    totalFinancialImpact,
    actionRequiredCount,
    generatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Signal Collection Helpers — used by intelligence collectors
// ---------------------------------------------------------------------------

/**
 * Create a standardized attention item with defaults.
 */
export function createAttentionItem(
  params: Pick<
    AttentionItem,
    "id" | "severity" | "category" | "title" | "explanation"
  > &
    Partial<Omit<AttentionItem, "id" | "severity" | "category" | "title" | "explanation">>,
): AttentionItem {
  return {
    status: "open",
    timestamp: Date.now(),
    ...params,
  };
}

/**
 * Deduplicate attention items by id, keeping the most recent version.
 */
export function deduplicateItems(items: AttentionItem[]): AttentionItem[] {
  const seen = new Map<string, AttentionItem>();
  for (const item of items) {
    const existing = seen.get(item.id);
    if (!existing || item.timestamp > existing.timestamp) {
      seen.set(item.id, item);
    }
  }
  return Array.from(seen.values());
}

/**
 * Filter out dismissed/resolved items unless explicitly requested.
 */
export function filterActiveItems(items: AttentionItem[]): AttentionItem[] {
  return items.filter((item) => item.status === "open" || item.status === "acknowledged");
}
