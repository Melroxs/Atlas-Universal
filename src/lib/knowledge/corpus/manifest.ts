// ---------------------------------------------------------------------------
// Atlas Knowledge Corpus — Manifest
//
// Atlas U.S. Insurance Restoration Industry Knowledge Corpus — Seed Release
// Defines the corpus structure, expected counts, and validation rules.
// ---------------------------------------------------------------------------

export const CORPUS_MANIFEST = {
  /** Human-readable release name. */
  releaseName:
    "Atlas U.S. Insurance Restoration Industry Knowledge Corpus — Seed Release",
  /** Semantic version of this corpus release. */
  version: "1.0.0",
  /** Unique release identifier. */
  releaseId: "atlas-insurance-restoration-seed-v1",
  /** Corpus canonical name. */
  corpusName: "atlas_insurance_restoration",
  /** Release date (ISO-8601). */
  releaseDate: "2026-08-27",
  /** Minimum Atlas version this corpus targets. */
  minAtlasVersion: "0.1.0",

  /** Expected record counts by category. */
  counts: {
    sources: 5,
    knowledgeRecords: 112,
    federalRegulations: 8,
    workflowStages: 31,
    documentationEvidence: 36,
    jurisdictionProfiles: 51, // 50 states + DC
    standardsMetadata: 5,
    risks: 21,
    revenueRecoveryConcepts: 16,
    provenanceRecords: 12, // expanded from 7 with corpus sources
    graphRelationships: 40,
  },

  /** Categories of knowledge in this corpus. */
  categories: [
    "federal_regulation",
    "workflow_stage",
    "documentation_evidence",
    "jurisdiction",
    "standard",
    "risk_pattern",
    "revenue_concept",
    "terminology",
    "requirement",
    "role",
    "concept",
  ] as const,

  /** Quality control status. */
  qcStatus: "PASS_WITH_WARNINGS" as const,
  /** Known warnings. */
  warnings: [
    "50-state + DC jurisdiction records are placeholders requiring official-source verification.",
    "Jurisdiction placeholder records must not be represented as authoritative legal conclusions.",
  ],

  /** Knowledge graph edge types supported. */
  edgeTypes: [
    "REGULATION_APPLIES_TO",
    "JURISDICTION_GOVERNS",
    "WORKFLOW_REQUIRES",
    "DOCUMENT_PROVIDES_EVIDENCE_FOR",
    "CLAIM_ELEMENT_SUPPORTS",
    "SUPPLEMENT_AFFECTS",
    "RISK_CAUSED_BY",
    "MISSING_EVIDENCE_TRIGGERS",
    "REGULATION_CITES",
    "WORKFLOW_TRANSITIONS_TO",
  ] as const,
} as const;

export type CorpusManifest = typeof CORPUS_MANIFEST;

/** Knowledge record shape for the corpus. */
export interface CorpusKnowledgeRecord {
  /** Unique record ID (corpus-scoped). */
  id: string;
  /** Knowledge type category. */
  knowledgeType:
    | "federal_regulation"
    | "workflow_stage"
    | "documentation_evidence"
    | "jurisdiction"
    | "standard"
    | "risk_pattern"
    | "revenue_concept"
    | "terminology"
    | "requirement"
    | "role"
    | "concept";
  /** Human-readable title. */
  title: string;
  /** The knowledge statement. */
  statement: string;
  /** Atlas's operational interpretation. */
  interpretation?: string;
  /** Source classification. */
  sourceClassification:
    | "REGULATORY"
    | "INDUSTRY_STANDARD"
    | "PROFESSIONAL_GUIDANCE"
    | "ATLAS_CURATED"
    | "CARRIER_OR_INSURANCE";
  /** Source ID referencing provenance. */
  sourceId: string;
  /** Industry focus. */
  industry?: string;
  /** Jurisdiction (e.g., "United States", "United States > Florida"). */
  jurisdiction?: string;
  /** Confidence score 0-1. */
  confidence: number;
  /** Whether this is an Atlas inference/heuristic. */
  isInference: boolean;
  /** Status. */
  status: "active" | "superseded" | "draft" | "archived";
  /** Tags for categorization. */
  tags: string[];
  /** Verification status (especially for jurisdictions). */
  verificationStatus?: "official" | "secondary" | "derived" | "placeholder";
  /** Corpus version this record belongs to. */
  corpusVersion?: string;
  /** Optional: federal applicability for jurisdiction records. */
  federalApplies?: boolean;
  /** Optional: stage in a lifecycle for workflow records. */
  stageOrder?: number;
  /** Optional: prerequisite stage IDs for workflow records. */
  prerequisites?: string[];
  /** Optional: affected claim types for risk/revenue records. */
  affectedClaimTypes?: string[];
}

/** Source provenance record for the corpus. */
export interface CorpusProvenanceRecord {
  sourceId: string;
  sourceName: string;
  organization: string;
  authorityTier: string;
  sourceType: string;
  canonicalUrl?: string;
  status: string;
}

/** Knowledge graph relationship. */
export interface CorpusGraphEdge {
  sourceId: string;
  targetId: string;
  relationship: string;
  /** Edge metadata (optional). */
  metadata?: Record<string, unknown>;
}
