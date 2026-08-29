// ---------------------------------------------------------------------------
// useDecisions Hook
//
// React hook that connects the Decision model to the component tree.
// Wraps existing recommendations into the unified AtlasDecision model.
// ---------------------------------------------------------------------------

import { useMemo, useCallback } from "react";
import { useQuery } from "@/hooks/use-supabase";
import { api } from "@/lib/api";
import {
  type AtlasDecision,
  type AtlasDecisionStatus,
  recommendationToDecision,
  sortDecisionsByImportance,
  filterDecisionsByStatus,
  getDecisionsRequiringApproval,
  getHighImpactDecisions,
  getTotalPotentialImpact,
} from "./decision";
import { useIntelligence } from "./useIntelligence";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseDecisionsResult {
  /** All decisions derived from recommendations + intelligence */
  decisions: AtlasDecision[];
  /** Decisions sorted by importance */
  sortedDecisions: AtlasDecision[];
  /** Decisions requiring human approval */
  pendingApprovals: AtlasDecision[];
  /** High-impact decisions */
  highImpactDecisions: AtlasDecision[];
  /** Total potential financial impact across all open decisions */
  totalPotentialImpact: number;
  /** Whether data is loading */
  isLoading: boolean;
  /** Filter decisions by status */
  byStatus: (...statuses: AtlasDecisionStatus[]) => AtlasDecision[];
  /** Get the most critical N decisions */
  critical: (n: number) => AtlasDecision[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDecisions(): UseDecisionsResult {
  const recs = useQuery(api.recommendations.listRecommendations);
  const { items: attentionItems } = useIntelligence();

  const decisions = useMemo<AtlasDecision[]>(() => {
    const all: AtlasDecision[] = [];

    // Map existing recommendations to AtlasDecision
    if (Array.isArray(recs)) {
      for (const rec of recs) {
        const row = rec as Record<string, unknown>;
        try {
          const decision = recommendationToDecision({
            _id: String(row._id ?? ""),
            _creationTime: typeof row._creationTime === "number" ? row._creationTime : Date.now(),
            title: String(row.title ?? ""),
            summary: String(row.summary ?? ""),
            reason: String(row.reason ?? ""),
            priority: String(row.priority ?? "medium"),
            status: String(row.status ?? "open"),
            confidence: typeof row.confidence === "number" ? row.confidence : 0,
            expectedImpact: typeof row.expectedImpact === "string" ? row.expectedImpact : undefined,
            risk: typeof row.risk === "string" ? row.risk : undefined,
            detectorKey: String(row.detectorKey ?? "unknown"),
            evidence: Array.isArray(row.evidence)
              ? (row.evidence as Array<Record<string, unknown>>).map((e) => ({
                  kind: String(e.kind ?? "document"),
                  title: typeof e.title === "string" ? e.title : undefined,
                  snippet: typeof e.snippet === "string" ? e.snippet : undefined,
                  relevance: typeof e.relevance === "number" ? e.relevance : 0,
                  entityId: typeof e.entityId === "string" ? e.entityId : undefined,
                  entityType: typeof e.entityType === "string" ? e.entityType : undefined,
                }))
              : [],
            decidedAt: typeof row.decidedAt === "number" ? row.decidedAt : undefined,
          });
          all.push(decision);
        } catch {
          // Skip malformed recommendations
        }
      }
    }

    // Also surface high-severity attention items as informational decisions
    for (const item of attentionItems) {
      if (item.severity === "critical" || item.severity === "high") {
        // Only add if not already covered by a recommendation
        const alreadyCovered = all.some(
          (d) => d.attentionItemId === item.id || d.entity.id === item.sourceEntityId,
        );
        if (!alreadyCovered && item.sourceEntityId) {
          all.push({
            id: `attention-${item.id}`,
            entity: {
              type: (item.sourceEntityType as AtlasDecision["entity"]["type"]) ?? "unknown",
              id: item.sourceEntityId,
              label: item.title,
            },
            observation: {
              title: item.title,
              summary: item.explanation,
            },
            importance: {
              severity: item.severity as AtlasDecision["importance"]["severity"],
            },
            evidence: [],
            recommendation: {
              title: item.title,
              summary: item.explanation,
              reasoning: item.explanation,
            },
            status: "new",
            requiresApproval: false,
            attentionItemId: item.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      }
    }

    return all;
  }, [recs, attentionItems]);

  const sortedDecisions = useMemo(() => sortDecisionsByImportance(decisions), [decisions]);
  const pendingApprovals = useMemo(() => getDecisionsRequiringApproval(decisions), [decisions]);
  const highImpactDecisions = useMemo(() => getHighImpactDecisions(decisions), [decisions]);
  const totalPotentialImpact = useMemo(() => getTotalPotentialImpact(decisions), [decisions]);

  const byStatus = useCallback(
    (...statuses: AtlasDecisionStatus[]) => filterDecisionsByStatus(decisions, ...statuses),
    [decisions],
  );

  const critical = useCallback(
    (n: number) => sortDecisionsByImportance(decisions).slice(0, n),
    [decisions],
  );

  return {
    decisions,
    sortedDecisions,
    pendingApprovals,
    highImpactDecisions,
    totalPotentialImpact,
    isLoading: recs === undefined,
    byStatus,
    critical,
  };
}
