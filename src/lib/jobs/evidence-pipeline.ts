// ---------------------------------------------------------------------------
// Atlas Evidence Pipeline — Durable Stage Definitions
//
// Defines the evidence reasoning pipeline as a sequence of durable job steps.
// Each stage wraps existing Atlas Evidence Engine logic via thin adapters.
// NO reasoning logic is duplicated — each handler delegates to the existing
// pure functions in src/lib/insurance/ and src/lib/actions/.
//
// Pipeline stages (based on actual existing implementation):
//
//   1. document_ingestion   — parse + chunk + embed + extract entities
//   2. claim_discovery       — cluster docs, extract fields, create/enrich claims
//   3. completeness_analysis — evaluate claim completeness against 11 categories
//   4. findings_analysis     — detect supplement/recovery opportunities
//   5. contradiction_scan    — cross-document contradiction detection
//   6. evidence_readiness    — workflow-relative evidence assessment
//   7. reconciliation        — financial reconciliation analysis
//
// Every stage:
//   - has a defined input/output schema
//   - is independently retryable
//   - produces structured results with provenance
//   - enforces tenant isolation
//   - is idempotent
// ---------------------------------------------------------------------------

import type { PipelineDefinition, PipelineStepDefinition } from "./types";

// ---------------------------------------------------------------------------
// Pipeline step types — must be unique strings
// ---------------------------------------------------------------------------

export const EVIDENCE_PIPELINE_STEPS = {
  DOCUMENT_INGESTION: "evidence_document_ingestion",
  CLAIM_DISCOVERY: "evidence_claim_discovery",
  COMPLETENESS_ANALYSIS: "evidence_completeness_analysis",
  FINDINGS_ANALYSIS: "evidence_findings_analysis",
  CONTRADICTION_SCAN: "evidence_contradiction_scan",
  EVIDENCE_READINESS: "evidence_readiness_assessment",
  RECONCILIATION: "evidence_reconciliation",
} as const;

export type EvidencePipelineStepType =
  (typeof EVIDENCE_PIPELINE_STEPS)[keyof typeof EVIDENCE_PIPELINE_STEPS];

// ---------------------------------------------------------------------------
// Pipeline job payload — the context passed to every step
// ---------------------------------------------------------------------------

export interface EvidencePipelinePayload {
  /** The company/tenant ID — enforced at every step. */
  tenant_id: string;
  /** User who triggered the pipeline (optional for automated triggers). */
  user_id?: string | null;
  /** The claim ID being analyzed (null for discovery runs). */
  claim_id?: string | null;
  /** Optional: specific document ID to process. */
  document_id?: string | null;
  /** Pipeline version — for future schema evolution. */
  pipeline_version: string;
  /** Correlation ID for tracing across steps. */
  correlation_id: string;
  /** Optional: archive ID if this was triggered by archive ingestion. */
  archive_id?: string | null;
  /** Maximum documents to scan during discovery. */
  max_documents?: number;
  /** Feature flag: allow the async pipeline path. */
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Step input/output types
// ---------------------------------------------------------------------------

/** Result of the document ingestion step. */
export interface DocumentIngestionResult {
  documents_processed: number;
  documents_failed: number;
  chunks_created: number;
  entities_created: number;
  document_ids: string[];
  warnings: string[];
}

/** Result of the claim discovery step. */
export interface ClaimDiscoveryStepResult {
  claims_created: number;
  claims_enriched: number;
  candidates_proposed: number;
  evidence_kept: number;
  documents_scanned: number;
  unclustered: number;
  claim_ids: string[];
  decisions: Array<Record<string, unknown>>;
}

/** Result of the completeness analysis step. */
export interface CompletenessStepResult {
  claim_id: string;
  score: number;
  total: number;
  complete: number;
  missing_categories: string[];
  conflicted_categories: string[];
  stale_categories: string[];
  summary: string;
}

/** Result of the findings analysis step. */
export interface FindingsStepResult {
  claim_id: string;
  findings_count: number;
  /** Raw findings from the claim package — shape matches DB JSONB. */
  findings: Array<Record<string, unknown>>;
}

/** Result of the contradiction scan step. */
export interface ContradictionScanStepResult {
  claim_id: string;
  contradictions_found: number;
  contradictions: Array<{
    field: string;
    sources: string[];
    values: string[];
    severity: string;
    recommendation: string;
  }>;
}

/** Result of the evidence readiness step. */
export interface EvidenceReadinessStepResult {
  claim_id: string;
  workflow: string;
  readiness: string;
  missing_evidence: string[];
  summary: string;
}

/** Result of the reconciliation step. */
export interface ReconciliationStepResult {
  claim_id: string;
  estimate?: number;
  invoiced?: number;
  paid: number;
  outstanding: number;
  has_discrepancy: boolean;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Pipeline definition — the ordered step sequence with dependencies
// ---------------------------------------------------------------------------

/** Default timeout for each step (30 seconds). */
const DEFAULT_STEP_TIMEOUT_MS = 30_000;

/**
 * Returns the evidence pipeline definition for a given claim context.
 * Steps are ordered by dependency: each step depends on all previous steps.
 */
export function getEvidencePipelineDefinition(): PipelineDefinition {
  const steps: PipelineStepDefinition[] = [
    {
      id: EVIDENCE_PIPELINE_STEPS.DOCUMENT_INGESTION,
      type: EVIDENCE_PIPELINE_STEPS.DOCUMENT_INGESTION,
      input_mapping: {},
      max_attempts: 3,
      timeout_ms: DEFAULT_STEP_TIMEOUT_MS,
      requires_review: false,
    },
    {
      id: EVIDENCE_PIPELINE_STEPS.CLAIM_DISCOVERY,
      type: EVIDENCE_PIPELINE_STEPS.CLAIM_DISCOVERY,
      input_mapping: {},
      depends_on: [EVIDENCE_PIPELINE_STEPS.DOCUMENT_INGESTION],
      max_attempts: 3,
      timeout_ms: DEFAULT_STEP_TIMEOUT_MS,
      requires_review: false,
    },
    {
      id: EVIDENCE_PIPELINE_STEPS.COMPLETENESS_ANALYSIS,
      type: EVIDENCE_PIPELINE_STEPS.COMPLETENESS_ANALYSIS,
      input_mapping: {},
      depends_on: [EVIDENCE_PIPELINE_STEPS.CLAIM_DISCOVERY],
      max_attempts: 2,
      timeout_ms: DEFAULT_STEP_TIMEOUT_MS,
      requires_review: false,
    },
    {
      id: EVIDENCE_PIPELINE_STEPS.FINDINGS_ANALYSIS,
      type: EVIDENCE_PIPELINE_STEPS.FINDINGS_ANALYSIS,
      input_mapping: {},
      depends_on: [EVIDENCE_PIPELINE_STEPS.CLAIM_DISCOVERY],
      max_attempts: 2,
      timeout_ms: DEFAULT_STEP_TIMEOUT_MS,
      requires_review: false,
    },
    {
      id: EVIDENCE_PIPELINE_STEPS.CONTRADICTION_SCAN,
      type: EVIDENCE_PIPELINE_STEPS.CONTRADICTION_SCAN,
      input_mapping: {},
      depends_on: [EVIDENCE_PIPELINE_STEPS.CLAIM_DISCOVERY],
      max_attempts: 2,
      timeout_ms: DEFAULT_STEP_TIMEOUT_MS,
      requires_review: false,
    },
    {
      id: EVIDENCE_PIPELINE_STEPS.EVIDENCE_READINESS,
      type: EVIDENCE_PIPELINE_STEPS.EVIDENCE_READINESS,
      input_mapping: {},
      depends_on: [
        EVIDENCE_PIPELINE_STEPS.COMPLETENESS_ANALYSIS,
        EVIDENCE_PIPELINE_STEPS.FINDINGS_ANALYSIS,
        EVIDENCE_PIPELINE_STEPS.CONTRADICTION_SCAN,
      ],
      max_attempts: 2,
      timeout_ms: DEFAULT_STEP_TIMEOUT_MS,
      requires_review: false,
    },
    {
      id: EVIDENCE_PIPELINE_STEPS.RECONCILIATION,
      type: EVIDENCE_PIPELINE_STEPS.RECONCILIATION,
      input_mapping: {},
      depends_on: [EVIDENCE_PIPELINE_STEPS.CLAIM_DISCOVERY],
      max_attempts: 2,
      timeout_ms: DEFAULT_STEP_TIMEOUT_MS,
      requires_review: false,
    },
  ];

  return {
    id: "evidence_pipeline_v1",
    name: "Evidence Reasoning Pipeline",
    version: "1.0.0",
    steps,
    total_timeout_ms: steps.length * DEFAULT_STEP_TIMEOUT_MS,
  };
}

// ---------------------------------------------------------------------------
// Step dependency resolution (pure)
// ---------------------------------------------------------------------------

/** Get the step IDs that must complete before the given step can run. */
export function getStepDependencies(stepType: EvidencePipelineStepType): string[] {
  const pipeline = getEvidencePipelineDefinition();
  const step = pipeline.steps.find((s) => s.type === stepType);
  return step?.depends_on ?? [];
}

/** Get all downstream steps that depend on the given step. */
export function getDownstreamSteps(stepType: EvidencePipelineStepType): string[] {
  const pipeline = getEvidencePipelineDefinition();
  const downstream: string[] = [];
  for (const step of pipeline.steps) {
    if (step.depends_on?.includes(stepType)) {
      downstream.push(step.type);
    }
  }
  return downstream;
}

// ---------------------------------------------------------------------------
// Pipeline context helpers
// ---------------------------------------------------------------------------

/** Generate a correlation ID for a pipeline run. */
export function generateCorrelationId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `ep-${ts}-${rand}`;
}

/** Build the job payload for a new evidence pipeline run. */
export function buildEvidencePipelinePayload(params: {
  tenant_id: string;
  user_id?: string;
  claim_id?: string;
  document_id?: string;
  archive_id?: string;
  max_documents?: number;
}): EvidencePipelinePayload {
  return {
    tenant_id: params.tenant_id,
    user_id: params.user_id ?? null,
    claim_id: params.claim_id ?? null,
    document_id: params.document_id ?? null,
    pipeline_version: "1.0.0",
    correlation_id: generateCorrelationId(),
    archive_id: params.archive_id ?? null,
    max_documents: params.max_documents ?? 60,
    enabled: true,
  };
}
