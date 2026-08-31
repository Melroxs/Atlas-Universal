// ---------------------------------------------------------------------------
// Atlas Opportunity Engine
//
// Turns detected system changes into actionable opportunities.
// Distinguishes between INFORMATION, RISK, CHANGE, OPPORTUNITY, RECOMMENDATION.
// Implements deduplication and causal traceability.
// ---------------------------------------------------------------------------

import { type AttentionItem, type AttentionCategory } from "./attention";
import {
  type AtlasActionType,
  type AtlasExecutableAction,
  createAction,
  generateIdempotencyKey,
} from "./execution";
import type { AtlasEntityReference } from "./entity-reference";

// ---------------------------------------------------------------------------
// Change Classification
// ---------------------------------------------------------------------------

export type ChangeSeverity = "irrelevant" | "minor" | "material" | "critical";

export type OpportunityType =
  | "supplement_opportunity"
  | "evidence_gap_filling"
  | "claim_status_change"
  | "new_document_relevant"
  | "stale_action"
  | "verification_needed"
  | "review_recommended";

export interface DetectedChange {
  /** What changed */
  description: string;
  /** The entity that changed */
  entity: AtlasEntityReference;
  /** Change classification */
  severity: ChangeSeverity;
  /** Type of opportunity this represents */
  opportunityType: OpportunityType;
  /** Evidence supporting the classification */
  evidence: string[];
  /** Financial impact if determinable */
  financialImpact?: number;
  /** Confidence in this classification */
  confidence: "high" | "medium" | "low";
  /** Source event that triggered this detection */
  sourceEventId?: string;
  /** Fingerprint of the source state */
  sourceFingerprint?: string;
}

// ---------------------------------------------------------------------------
// Opportunity Generation
// ---------------------------------------------------------------------------

export interface GeneratedOpportunity {
  /** Unique identity for deduplication */
  idempotencyKey: string;
  /** The detected change */
  change: DetectedChange;
  /** Recommended action */
  recommendedAction: AtlasActionType;
  /** What Atlas would prepare */
  preparationDescription: string;
  /** Why Atlas recommends this */
  reason: string;
  /** What evidence supports this */
  supportingEvidence: string[];
  /** What is uncertain */
  uncertainties: string[];
  /** What would happen if approved */
  expectedOutcome: string;
  /** Causal lineage */
  causalTrace: CausalTraceEntry[];
}

export interface CausalTraceEntry {
  timestamp: string;
  event: string;
  source?: string;
  entityId?: string;
  entityType?: string;
}

// ---------------------------------------------------------------------------
// Opportunity Engine
// ---------------------------------------------------------------------------

/**
 * Classify a raw change into a severity and opportunity type.
 * Uses evidence semantics, not arbitrary scoring.
 */
export function classifyChange(change: {
  description: string;
  hasFindings: boolean;
  hasOpenSupplements: boolean;
  outstandingAmount: number;
  completenessScore: number;
  previousFindings: number;
  currentFindings: number;
  previousDocuments: number;
  currentDocuments: number;
}): DetectedChange["severity"] {
  // Critical: new evidence that changes the picture materially
  if (change.currentFindings > change.previousFindings && change.outstandingAmount > 0) {
    return "critical";
  }

  // Material: significant new information
  if (change.currentDocuments > change.previousDocuments && change.hasFindings) {
    return "material";
  }

  // Minor: incremental update
  if (change.currentDocuments > change.previousDocuments || change.currentFindings !== change.previousFindings) {
    return "minor";
  }

  // Irrelevant: no meaningful change
  return "irrelevant";
}

/**
 * Generate an opportunity from a classified change.
 * Returns null if the change is not actionable.
 */
export function generateOpportunity(
  change: DetectedChange,
  existingActions: Array<{ idempotencyKey: string; status: string }>,
): GeneratedOpportunity | null {
  // Don't create opportunity for irrelevant changes
  if (change.severity === "irrelevant") return null;

  // Deduplication: check if same opportunity already exists
  const key = `${change.entity.type}:${change.entity.id}:${change.opportunityType}`;
  const existingDuplicate = existingActions.find(
    (a) => a.idempotencyKey.includes(key) && ["proposed", "preparing", "prepared", "awaiting_confirmation"].includes(a.status),
  );
  if (existingDuplicate) return null;

  // Generate opportunity based on type
  const now = new Date().toISOString();
  const causalTrace: CausalTraceEntry[] = [
    { timestamp: now, event: "Change detected", source: change.description, entityId: change.entity.id, entityType: change.entity.type },
    { timestamp: now, event: "Change classified", source: `Severity: ${change.severity}, Confidence: ${change.confidence}` },
  ];

  switch (change.opportunityType) {
    case "supplement_opportunity":
      return {
        idempotencyKey: `opp:${key}:${generateIdempotencyKey("prepare_supplement", change.entity.id, {})}`,
        change,
        recommendedAction: "prepare_supplement",
        preparationDescription: `Atlas proposes preparing a supplement for ${change.entity.label} based on ${change.evidence.length} supporting evidence item${change.evidence.length === 1 ? "" : "s"}.`,
        reason: change.description,
        supportingEvidence: change.evidence,
        uncertainties: [
          "Carrier response is not yet known",
          "Final supplement amount depends on carrier evaluation",
        ],
        expectedOutcome: "A supplement proposal ready for your review before submission.",
        causalTrace,
      };

    case "review_recommended":
      return {
        idempotencyKey: `opp:${key}:${generateIdempotencyKey("navigate", change.entity.id, {})}`,
        change,
        recommendedAction: "navigate",
        preparationDescription: `Atlas recommends reviewing ${change.entity.label} due to ${change.description.toLowerCase()}.`,
        reason: change.description,
        supportingEvidence: change.evidence,
        uncertainties: [],
        expectedOutcome: "Review the updated claim information and determine if action is needed.",
        causalTrace,
      };

    case "verification_needed":
      return {
        idempotencyKey: `opp:${key}:verify:${Date.now()}`,
        change,
        recommendedAction: "navigate",
        preparationDescription: `Atlas recommends verifying the outcome of a recent action on ${change.entity.label}.`,
        reason: change.description,
        supportingEvidence: change.evidence,
        uncertainties: ["Verification depends on backend confirmation"],
        expectedOutcome: "Atlas confirms whether the previous action completed successfully.",
        causalTrace,
      };

    default:
      return null;
  }
}

/**
 * Build an attention item from an opportunity for the Attention system.
 */
export function opportunityToAttentionItem(opportunity: GeneratedOpportunity): AttentionItem {
  const severityMap: Record<ChangeSeverity, AttentionItem["severity"]> = {
    irrelevant: "info",
    minor: "info",
    material: "high",
    critical: "critical",
  };

  return {
    id: opportunity.idempotencyKey,
    severity: severityMap[opportunity.change.severity],
    category: opportunity.change.opportunityType as AttentionCategory,
    title: opportunity.preparationDescription,
    explanation: opportunity.reason,
    sourceEntityId: opportunity.change.entity.id,
    sourceEntityType: opportunity.change.entity.type,
    sourceEntityName: opportunity.change.entity.label,
    timestamp: Date.now(),
    nextAction: opportunity.change.severity === "critical" ? "Review and prepare" : "Review",
    hasEvidence: opportunity.supportingEvidence.length > 0,
    status: "open",
    meta: {
      financialImpact: opportunity.change.financialImpact,
      confidence: opportunity.change.confidence,
      opportunityType: opportunity.change.opportunityType,
      causalTrace: opportunity.causalTrace,
    },
  };
}
