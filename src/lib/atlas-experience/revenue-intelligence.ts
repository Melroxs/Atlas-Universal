// ---------------------------------------------------------------------------
// Revenue Intelligence
//
// Collects attention signals from the Claims, Supplements, and financial
// analysis systems. Every insight is traceable to real Atlas data — no
// fabricated financial figures.
// ---------------------------------------------------------------------------

import { type AttentionItem } from "./attention";
import { createAttentionItem } from "./intelligence";

// ---------------------------------------------------------------------------
// Input shapes — match existing Atlas data shapes
// ---------------------------------------------------------------------------

export interface ClaimForIntelligence {
  _id: string;
  claimNumber?: string | null;
  customer?: string | null;
  property?: string | null;
  carrier?: string | null;
  status?: string;
  openFindings?: number;
  outstanding?: number;
  completeness?: number;
  completenessTotal?: number;
  hasDiscrepancy?: boolean;
  potential?: number;
  draftCount?: number;
  readyForSubmission?: number;
}

export interface RecommendationForIntelligence {
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
}

// ---------------------------------------------------------------------------
// Revenue Intelligence Collectors
// ---------------------------------------------------------------------------

/**
 * Generate attention items from claims that need supplement review.
 * These represent real revenue recovery opportunities.
 */
export function collectSupplementOpportunities(
  claims: ClaimForIntelligence[],
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const claim of claims) {
    if ((claim.openFindings ?? 0) <= 0) continue;

    const label = claim.customer ?? claim.property ?? claim.claimNumber ?? "Unnamed claim";
    const findingCount = claim.openFindings ?? 0;

    items.push(
      createAttentionItem({
        id: `revenue-supplement-${claim._id}`,
        severity: findingCount >= 3 ? "critical" : findingCount >= 2 ? "high" : "medium",
        category: "supplement_opportunity",
        title: `${findingCount} supplement opportunit${findingCount === 1 ? "y" : "ies"} on ${label}`,
        explanation: `Atlas identified ${findingCount} potential recovery ${findingCount === 1 ? "opportunity" : "opportunities"} that have not yet been addressed.`,
        sourceEntityId: claim._id,
        sourceEntityType: "claim",
        sourceEntityName: claim.claimNumber ?? undefined,
        nextAction: "Review findings",
        navigationTarget: `/dashboard/revenue-recovery/${claim._id}`,
        meta: {
          source: "revenue",
          financialImpact: undefined, // No fabricated amount
          findingCount,
          claimStatus: claim.status,
        },
      }),
    );
  }

  return items;
}

/**
 * Generate attention items for claims with outstanding amounts.
 */
export function collectOutstandingAmounts(
  claims: ClaimForIntelligence[],
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const claim of claims) {
    const outstanding = claim.outstanding ?? 0;
    if (outstanding <= 0) continue;

    const label = claim.customer ?? claim.property ?? claim.claimNumber ?? "Unnamed claim";

    items.push(
      createAttentionItem({
        id: `revenue-outstanding-${claim._id}`,
        severity: outstanding >= 5000 ? "critical" : outstanding >= 1000 ? "high" : "medium",
        category: "revenue_opportunity",
        title: `$${outstanding.toLocaleString()} potentially outstanding`,
        explanation: `Claim ${label} has a gap between approved and paid amounts.`,
        sourceEntityId: claim._id,
        sourceEntityType: "claim",
        sourceEntityName: claim.claimNumber ?? undefined,
        nextAction: "Review claim details",
        navigationTarget: `/dashboard/revenue-recovery/${claim._id}`,
        meta: {
          source: "revenue",
          financialImpact: outstanding,
          approvedVsPaid: true,
        },
      }),
    );
  }

  return items;
}

/**
 * Generate attention items for incomplete claim reconstructions.
 */
export function collectIncompleteClaims(
  claims: ClaimForIntelligence[],
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const claim of claims) {
    const completeness = claim.completeness ?? 0;
    const total = claim.completenessTotal ?? 0;
    if (total <= 0 || completeness >= total) continue;

    const label = claim.customer ?? claim.property ?? claim.claimNumber ?? "Unnamed claim";
    const pct = Math.round((completeness / total) * 100);

    items.push(
      createAttentionItem({
        id: `revenue-incomplete-${claim._id}`,
        severity: pct < 50 ? "high" : "medium",
        category: "evidence_gap",
        title: `Claim ${label} is ${pct}% complete`,
        explanation: `${completeness} of ${total} required evidence items have been provided.`,
        sourceEntityId: claim._id,
        sourceEntityType: "claim",
        sourceEntityName: claim.claimNumber ?? undefined,
        nextAction: "Upload missing evidence",
        navigationTarget: `/dashboard/revenue-recovery/${claim._id}`,
        meta: {
          source: "revenue",
          completeness,
          completenessTotal: total,
          percentage: pct,
        },
      }),
    );
  }

  return items;
}

/**
 * Generate attention items for claims with discrepancies.
 */
export function collectClaimDiscrepancies(
  claims: ClaimForIntelligence[],
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const claim of claims) {
    if (!claim.hasDiscrepancy) continue;

    const label = claim.customer ?? claim.property ?? claim.claimNumber ?? "Unnamed claim";

    items.push(
      createAttentionItem({
        id: `revenue-discrepancy-${claim._id}`,
        severity: "high",
        category: "contradiction",
        title: `Discrepancy detected on ${label}`,
        explanation: `Atlas found conflicting information in the documentation for this claim.`,
        sourceEntityId: claim._id,
        sourceEntityType: "claim",
        sourceEntityName: claim.claimNumber ?? undefined,
        nextAction: "Review discrepancy",
        navigationTarget: `/dashboard/revenue-recovery/${claim._id}`,
        meta: {
          source: "revenue",
          hasDiscrepancy: true,
        },
      }),
    );
  }

  return items;
}

/**
 * Generate attention items for open recommendations.
 */
export function collectOpenRecommendations(
  recs: RecommendationForIntelligence[],
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const rec of recs) {
    if (rec.status !== "open") continue;

    const severityMap: Record<string, "critical" | "high" | "medium" | "low"> = {
      high: "critical",
      medium: "high",
      low: "medium",
    };

    items.push(
      createAttentionItem({
        id: `rec-${rec._id}`,
        severity: severityMap[rec.priority] ?? "medium",
        category: "recommendation",
        title: rec.title,
        explanation: rec.summary,
        timestamp: rec.decidedAt ?? rec._creationTime,
        hasEvidence: (rec.evidence?.length ?? 0) > 0,
        nextAction: "Review recommendation",
        navigationTarget: "/dashboard/recommendations",
        meta: {
          source: "recommendations",
          detectorKey: rec.detectorKey,
          confidence: rec.confidence,
        },
      }),
    );
  }

  return items;
}

/**
 * Collect all revenue intelligence signals from available data.
 * This is the main entry point for the revenue intelligence collector.
 */
export function collectRevenueIntelligence(
  claims: ClaimForIntelligence[],
  recommendations: RecommendationForIntelligence[],
): AttentionItem[] {
  return [
    ...collectSupplementOpportunities(claims),
    ...collectOutstandingAmounts(claims),
    ...collectIncompleteClaims(claims),
    ...collectClaimDiscrepancies(claims),
    ...collectOpenRecommendations(recommendations),
  ];
}
