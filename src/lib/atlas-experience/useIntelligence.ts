// ---------------------------------------------------------------------------
// useIntelligence — React hook for the Atlas Intelligence Layer
//
// Subscribes to existing Atlas data queries, runs all intelligence
// collectors, applies prioritization, and returns a unified snapshot.
//
// This hook is the bridge between the pure intelligence engine and
// the React component tree.
// ---------------------------------------------------------------------------

import { useMemo, useRef, useState, useCallback } from "react";
import { useQuery } from "@/hooks/use-supabase";
import { api, type Obj } from "@/lib/api";

import { type AttentionItem, type AttentionSeverity } from "./attention";
import {
  type IntelligenceSnapshot,
  buildIntelligenceSnapshot,
  filterActiveItems,
  deduplicateItems,
} from "./intelligence";
import { collectRevenueIntelligence, type ClaimForIntelligence, type RecommendationForIntelligence } from "./revenue-intelligence";
import { collectEvidenceIntelligence } from "./evidence-intelligence";
import { collectWorkflowIntelligence } from "./workflow-intelligence";

// ---------------------------------------------------------------------------
// Aggregate Attention Hook
// ---------------------------------------------------------------------------

export interface UseIntelligenceResult {
  /** The full intelligence snapshot */
  snapshot: IntelligenceSnapshot;
  /** Just the prioritized items */
  items: AttentionItem[];
  /** Count by severity */
  counts: Record<AttentionSeverity, number>;
  /** Total financial impact across all items */
  totalFinancialImpact: number;
  /** Number requiring immediate action */
  actionRequiredCount: number;
  /** Whether data is still loading */
  isLoading: boolean;
  /** Any error from underlying queries */
  error: string | null;
  /** Items that changed since the last snapshot */
  changedItems: AttentionItem[];
  /** Whether there are meaningful changes since last visit */
  hasNewChanges: boolean;
  /** Clear the change notification */
  acknowledgeChanges: () => void;
}

/**
 * Subscribe to all Atlas data sources and produce a unified intelligence
 * snapshot. Uses existing Supabase queries — no new RPCs required.
 */
export function useIntelligence(): UseIntelligenceResult {
  // Subscribe to existing data sources
  const claims = useQuery(api.insurance.claims.listClaims, {});
  const recs = useQuery(api.recommendations.listRecommendations);
  const docStats = useQuery(api.documents.documentStats);
  const entityStats = useQuery(api.knowledge.entityStats);
  const workflows = useQuery(api.workflows.listWorkflowInstances);

  const isLoading = claims === undefined || recs === undefined;

  // Build the intelligence snapshot
  const snapshot = useMemo(() => {
    // Revenue Intelligence
    const revenueItems = collectRevenueIntelligence(
      (claims ?? []) as unknown as ClaimForIntelligence[],
      (recs ?? []) as unknown as RecommendationForIntelligence[],
    );

    // Evidence Intelligence
    const evidenceItems = collectEvidenceIntelligence(
      docStats ?? {},
      entityStats ?? {},
    );

    // Workflow Intelligence
    const workflowItems = collectWorkflowIntelligence(
      (workflows ?? []) as unknown as Array<{ _id: string; name?: string | null; status?: string; _creationTime: number }>,
      docStats ?? {},
    );

    // Combine, deduplicate, filter active, and prioritize
    const allItems = [...revenueItems, ...evidenceItems, ...workflowItems];
    const active = filterActiveItems(deduplicateItems(allItems));

    return buildIntelligenceSnapshot(active);
  }, [claims, recs, docStats, entityStats, workflows]);

  // Track changes between snapshots
  const prevItemIdsRef = useRef<Set<string>>(new Set());
  const [changedItems, setChangedItems] = useState<AttentionItem[]>([]);

  // Detect meaningful changes when snapshot updates
  useMemo(() => {
    const currentIds = new Set(snapshot.items.map((i) => i.id));
    const prevIds = prevItemIdsRef.current;

    if (prevIds.size > 0) {
      const newItems = snapshot.items.filter((i) => !prevIds.has(i.id));
      if (newItems.length > 0) {
        setChangedItems(newItems);
      }
    }

    prevItemIdsRef.current = currentIds;
  }, [snapshot.items]);

  const acknowledgeChanges = useCallback(() => {
    setChangedItems([]);
  }, []);

  return {
    snapshot,
    items: snapshot.items,
    counts: snapshot.counts,
    totalFinancialImpact: snapshot.totalFinancialImpact,
    actionRequiredCount: snapshot.actionRequiredCount,
    isLoading,
    error: null,
    changedItems,
    hasNewChanges: changedItems.length > 0,
    acknowledgeChanges,
  };
}

// ---------------------------------------------------------------------------
// Convenience accessors for specific intelligence categories
// ---------------------------------------------------------------------------

/**
 * Get only revenue-related attention items.
 */
export function useRevenueIntelligence(
  items: AttentionItem[],
): AttentionItem[] {
  return useMemo(
    () =>
      items.filter(
        (i) =>
          i.category === "revenue_opportunity" ||
          i.category === "supplement_opportunity",
      ),
    [items],
  );
}

/**
 * Get only evidence-related attention items.
 */
export function useEvidenceIntelligence(
  items: AttentionItem[],
): AttentionItem[] {
  return useMemo(
    () =>
      items.filter(
        (i) =>
          i.category === "evidence_gap" ||
          i.category === "contradiction" ||
          (i.category as string) === "document_issue",
      ),
    [items],
  );
}

/**
 * Get items requiring immediate attention (critical + high, open status).
 */
export function useCriticalItems(items: AttentionItem[]): AttentionItem[] {
  return useMemo(
    () =>
      items.filter(
        (i) =>
          i.status === "open" &&
          (i.severity === "critical" || i.severity === "high"),
      ),
    [items],
  );
}
