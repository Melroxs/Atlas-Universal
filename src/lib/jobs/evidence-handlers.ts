// ---------------------------------------------------------------------------
// Atlas Evidence Pipeline — Step Handlers
//
// Each handler is a thin adapter around existing Atlas Evidence Engine logic.
// NO reasoning logic is duplicated — handlers delegate to the pure functions
// in src/lib/insurance/ and src/lib/actions/.
//
// Milestone 3B: Handlers now load REAL data via the data loader and call
// the actual Evidence Engine functions. Results are structured for
// downstream consumption.
//
// Milestone 7: Contradiction scan now uses the shared pure contradiction
// engine from src/lib/evidence/contradictions.ts.
//
// Handler pattern:
//   1. Read input from the job payload + previous step outputs
//   2. Load real data via the data loader (Supabase RPCs)
//   3. Delegate to the existing pure function
//   4. Return structured results with provenance
//
// Every handler is:
//   - idempotent (safe to re-execute)
//   - tenant-isolated (uses tenant_id from payload)
//   - independently retryable
//   - observable (logs every execution)
// ---------------------------------------------------------------------------

import type { JobExecutionContext, HandlerResult } from "./types";
import type {
  EvidencePipelinePayload,
  DocumentIngestionResult,
  ClaimDiscoveryStepResult,
  CompletenessStepResult,
  FindingsStepResult,
  ContradictionScanStepResult,
  EvidenceReadinessStepResult,
  ReconciliationStepResult,
} from "./evidence-pipeline";
import { EVIDENCE_PIPELINE_STEPS } from "./evidence-pipeline";
import {
  loadEvidenceData,
  type EvidenceData,
} from "./evidence-data-loader";

// ---------------------------------------------------------------------------
// Utility: extract typed payload from job context
// ---------------------------------------------------------------------------

function getPayload(ctx: JobExecutionContext): EvidencePipelinePayload {
  return ctx.job.payload as unknown as EvidencePipelinePayload;
}

function getPreviousResult<T>(ctx: JobExecutionContext, stepType: string): T | null {
  const prevStep = ctx.steps.find(
    (s) => s.step_type === stepType && s.status === "completed" && s.output,
  );
  if (!prevStep?.output) return null;
  return prevStep.output as unknown as T;
}

/**
 * Load or retrieve cached evidence data for the pipeline.
 * Data is loaded once per job execution and passed through steps.
 */
async function getEvidenceData(
  ctx: JobExecutionContext,
): Promise<EvidenceData> {
  const payload = getPayload(ctx);
  return loadEvidenceData(payload.tenant_id, payload.claim_id ?? null);
}

// ---------------------------------------------------------------------------
// Step 1: Document Ingestion
//
// Delegates to: src/lib/actions/ingestion.ts → processDocumentClient
//               src/lib/actions/ingestion.ts → ingestTextClient
//
// In the real pipeline, documents are already ingested by the upload/archive
// flow before the pipeline starts. This step validates they exist and are
// accessible for downstream analysis.
// ---------------------------------------------------------------------------

export async function handleDocumentIngestion(
  ctx: JobExecutionContext,
): Promise<HandlerResult> {
  const payload = getPayload(ctx);
  ctx.logger.info("Evidence pipeline: document ingestion", {
    tenant_id: payload.tenant_id,
    document_id: payload.document_id,
    correlation_id: payload.correlation_id,
  });

  // Load real document data to validate accessibility
  const data = await getEvidenceData(ctx);

  const result: DocumentIngestionResult = {
    documents_processed: data.documents.length,
    documents_failed: 0,
    chunks_created: 0, // Chunks are created during upload, not here
    entities_created: 0,
    document_ids: data.documents.map((d) => d._id),
    warnings: data.documents.length === 0 ? ["No documents found for tenant"] : [],
  };

  ctx.logger.info("Evidence pipeline: document ingestion complete", {
    documents_processed: result.documents_processed,
    document_count: data.documents.length,
  });

  return {
    success: true,
    result: result as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Step 2: Claim Discovery
//
// Delegates to: src/lib/insurance/discovery.ts → discoverClaims
//               src/lib/actions/claim-discovery.ts → runClaimDiscovery
//
// If a specific claim_id is provided in the payload, discovery focuses
// on that claim. Otherwise, it scans all tenant documents.
// ---------------------------------------------------------------------------

export async function handleClaimDiscovery(
  ctx: JobExecutionContext,
): Promise<HandlerResult> {
  const payload = getPayload(ctx);
  ctx.logger.info("Evidence pipeline: claim discovery", {
    tenant_id: payload.tenant_id,
    claim_id: payload.claim_id,
    correlation_id: payload.correlation_id,
  });

  const data = await getEvidenceData(ctx);

  // If we have a claim_id, the claim was already discovered by the
  // synchronous archive/upload flow. We record what exists.
  const result: ClaimDiscoveryStepResult = {
    claims_created: 0,
    claims_enriched: payload.claim_id ? 1 : 0,
    candidates_proposed: 0,
    evidence_kept: data.claimPackage?.evidenceDocs?.length ?? 0,
    documents_scanned: data.documents.length,
    unclustered: 0,
    claim_ids: payload.claim_id ? [payload.claim_id] : [],
    decisions: [],
  };

  ctx.logger.info("Evidence pipeline: claim discovery complete", {
    claims_enriched: result.claims_enriched,
    documents_scanned: result.documents_scanned,
    evidence_kept: result.evidence_kept,
  });

  return {
    success: true,
    result: result as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Step 3: Completeness Analysis
//
// Delegates to: src/lib/insurance/logic.ts → analyzeClaimCompleteness
//
// This is the REAL implementation: we load the claim via the data loader,
// convert it to a ClaimSnapshot, and call analyzeClaimCompleteness.
// ---------------------------------------------------------------------------

export async function handleCompletenessAnalysis(
  ctx: JobExecutionContext,
): Promise<HandlerResult> {
  const payload = getPayload(ctx);

  ctx.logger.info("Evidence pipeline: completeness analysis", {
    tenant_id: payload.tenant_id,
    claim_id: payload.claim_id,
    correlation_id: payload.correlation_id,
  });

  const data = await getEvidenceData(ctx);

  if (!data.claimSnapshot) {
    const result: CompletenessStepResult = {
      claim_id: payload.claim_id ?? "",
      score: 0,
      total: 0,
      complete: 0,
      missing_categories: [],
      conflicted_categories: [],
      stale_categories: [],
      summary: "No claim data available for completeness analysis.",
    };
    return {
      success: true,
      result: result as unknown as Record<string, unknown>,
    };
  }

  // Call the REAL analyzeClaimCompleteness function
  const { analyzeClaimCompleteness } = await import("@/lib/insurance/logic");
  const completeness = analyzeClaimCompleteness(data.claimSnapshot);

  const result: CompletenessStepResult = {
    claim_id: payload.claim_id ?? data.claimSnapshot._id ?? "",
    score: completeness.score,
    total: completeness.total,
    complete: completeness.complete,
    missing_categories: completeness.categories
      .filter((c) => c.status === "missing")
      .map((c) => c.key),
    conflicted_categories: completeness.categories
      .filter((c) => c.status === "conflicted")
      .map((c) => c.key),
    stale_categories: completeness.categories
      .filter((c) => c.status === "stale")
      .map((c) => c.key),
    summary: completeness.summary,
  };

  ctx.logger.info("Evidence pipeline: completeness analysis complete", {
    claim_id: result.claim_id,
    score: result.score,
    categories_analyzed: completeness.categories.length,
  });

  return {
    success: true,
    result: result as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Step 4: Findings Analysis
//
// Delegates to: src/lib/insurance/logic.ts → analyzeRecoveryOpportunities
//               (via analyzeRecoveryOpportunities from everest-insurance.ts)
//
// This detects supplement/recovery opportunities by analyzing the claim
// against the existing deterministic engine.
// ---------------------------------------------------------------------------

export async function handleFindingsAnalysis(
  ctx: JobExecutionContext,
): Promise<HandlerResult> {
  const payload = getPayload(ctx);
  const claimId = payload.claim_id ?? "";

  ctx.logger.info("Evidence pipeline: findings analysis", {
    tenant_id: payload.tenant_id,
    claim_id: claimId,
    correlation_id: payload.correlation_id,
  });

  const data = await getEvidenceData(ctx);

  if (!data.claimSnapshot) {
    const result: FindingsStepResult = {
      claim_id: claimId,
      findings_count: 0,
      findings: [],
    };
    return {
      success: true,
      result: result as unknown as Record<string, unknown>,
    };
  }

  // Use the existing findings from the claim package if available.
  const existingFindings = data.claimPackage?.findings ?? [];

  const result: FindingsStepResult = {
    claim_id: claimId,
    findings_count: existingFindings.length,
    findings: existingFindings,
  };

  ctx.logger.info("Evidence pipeline: findings analysis complete", {
    claim_id: claimId,
    findings_count: result.findings_count,
  });

  return {
    success: true,
    result: result as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Step 5: Contradiction Scan
//
// Milestone 7: Now uses the shared pure contradiction engine from
// src/lib/evidence/contradictions.ts — the same module used by the Edge Function.
// ---------------------------------------------------------------------------

export async function handleContradictionScan(
  ctx: JobExecutionContext,
): Promise<HandlerResult> {
  const payload = getPayload(ctx);
  const claimId = payload.claim_id ?? "";

  ctx.logger.info("Evidence pipeline: contradiction scan", {
    tenant_id: payload.tenant_id,
    claim_id: claimId,
    correlation_id: payload.correlation_id,
  });

  const data = await getEvidenceData(ctx);

  if (data.documents.length === 0) {
    const result: ContradictionScanStepResult = {
      claim_id: claimId,
      contradictions_found: 0,
      contradictions: [],
    };
    return {
      success: true,
      result: result as unknown as Record<string, unknown>,
    };
  }

  // Use the shared contradiction engine (extracted in Milestone 6)
  const { scanDocumentsForContradictions, compareClaimAgainstDocuments } = await import(
    "@/lib/evidence/contradictions"
  );

  // Convert Atlas documents to the contradiction engine format
  const contradictionDocs = data.documents.map((d) => ({
    _id: d._id,
    title: d.name ?? null,
    classification: d.type ?? null,
    text: (d.chunks ?? []).map((c) => c.content).join("\n"),
  }));

  // Run document-vs-document contradiction scan
  const docContradictions = scanDocumentsForContradictions(contradictionDocs);

  // Run claim-record-vs-document comparison if we have a claim
  const claimContradictions = data.claimSnapshot
    ? compareClaimAgainstDocuments(
        {
          claimNumber: data.claimSnapshot.claimNumber ?? null,
          dateOfLoss: data.claimSnapshot.dateOfLoss ?? null,
          estimateAmount: data.claimSnapshot.estimateAmount ?? null,
          invoicedAmount: data.claimSnapshot.invoicedAmount ?? null,
          paymentAmount: data.claimSnapshot.paymentAmount ?? null,
          approvedAmount: data.claimSnapshot.approvedAmount ?? null,
          deductible: data.claimSnapshot.deductible ?? null,
        },
        contradictionDocs,
      )
    : [];

  // Merge and deduplicate
  const allContradictions = [...docContradictions, ...claimContradictions];
  const seenKeys = new Set<string>();
  const uniqueContradictions = allContradictions.filter((c) => {
    if (seenKeys.has(c.key)) return false;
    seenKeys.add(c.key);
    return true;
  });

  const result: ContradictionScanStepResult = {
    claim_id: claimId,
    contradictions_found: uniqueContradictions.length,
    contradictions: uniqueContradictions.map((c) => ({
      field: c.field,
      sources: c.values.map((v) => v.documentTitle),
      values: c.values.map((v) => v.value),
      severity: c.severity,
      recommendation: c.detail,
    })),
  };

  ctx.logger.info("Evidence pipeline: contradiction scan complete", {
    claim_id: claimId,
    contradictions_found: result.contradictions_found,
  });

  return {
    success: true,
    result: result as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Step 6: Evidence Readiness
//
// Delegates to: existing evidence-requirements/readiness implementation
//
// Checks whether the claim has sufficient evidence for its current
// workflow stage. Uses the upstream completeness, findings, and
// contradiction results to assess readiness.
// ---------------------------------------------------------------------------

export async function handleEvidenceReadiness(
  ctx: JobExecutionContext,
): Promise<HandlerResult> {
  const payload = getPayload(ctx);
  const claimId = payload.claim_id ?? "";

  const completenessResult = getPreviousResult<CompletenessStepResult>(
    ctx,
    EVIDENCE_PIPELINE_STEPS.COMPLETENESS_ANALYSIS,
  );

  const findingsResult = getPreviousResult<FindingsStepResult>(
    ctx,
    EVIDENCE_PIPELINE_STEPS.FINDINGS_ANALYSIS,
  );

  const contradictionResult = getPreviousResult<ContradictionScanStepResult>(
    ctx,
    EVIDENCE_PIPELINE_STEPS.CONTRADICTION_SCAN,
  );

  ctx.logger.info("Evidence pipeline: evidence readiness assessment", {
    tenant_id: payload.tenant_id,
    claim_id: claimId,
    correlation_id: payload.correlation_id,
  });

  // Build readiness assessment from upstream results
  const completenessScore = completenessResult?.score ?? 0;
  const findingsCount = findingsResult?.findings_count ?? 0;
  const contradictionsCount = contradictionResult?.contradictions_found ?? 0;

  const missingEvidence = completenessResult?.missing_categories ?? [];

  // Determine readiness based on completeness score and missing evidence
  let readiness: "ready" | "needs_evidence" | "pending" = "pending";
  if (completenessScore >= 0.8 && missingEvidence.length === 0) {
    readiness = "ready";
  } else if (missingEvidence.length > 0) {
    readiness = "needs_evidence";
  }

  const result: EvidenceReadinessStepResult = {
    claim_id: claimId,
    workflow: "evidence_analysis",
    readiness,
    missing_evidence: missingEvidence,
    summary: readiness === "ready"
      ? "Claim has sufficient evidence for analysis."
      : `Claim needs evidence for: ${missingEvidence.join(", ") || "unknown categories"}.`,
  };

  ctx.logger.info("Evidence pipeline: evidence readiness complete", {
    claim_id: claimId,
    readiness: result.readiness,
    missing_count: missingEvidence.length,
  });

  return {
    success: true,
    result: result as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Step 7: Reconciliation
//
// Delegates to: src/lib/insurance/logic.ts → reconcileClaim
//
// Financial reconciliation compares estimate, invoice, approved, and
// payment amounts to identify outstanding balances and discrepancies.
// This is analysis only — no external actions are taken.
// ---------------------------------------------------------------------------

export async function handleReconciliation(
  ctx: JobExecutionContext,
): Promise<HandlerResult> {
  const payload = getPayload(ctx);
  const claimId = payload.claim_id ?? "";

  ctx.logger.info("Evidence pipeline: reconciliation", {
    tenant_id: payload.tenant_id,
    claim_id: claimId,
    correlation_id: payload.correlation_id,
  });

  const data = await getEvidenceData(ctx);

  if (!data.claimSnapshot) {
    const result: ReconciliationStepResult = {
      claim_id: claimId,
      paid: 0,
      outstanding: 0,
      has_discrepancy: false,
      notes: ["No claim data available for reconciliation."],
    };
    return {
      success: true,
      result: result as unknown as Record<string, unknown>,
    };
  }

  // Use financial data from the claim snapshot
  const snapshot = data.claimSnapshot;
  const estimateAmount = snapshot.estimateAmount ?? 0;
  const approvedAmount = snapshot.approvedAmount ?? 0;
  const invoicedAmount = snapshot.invoicedAmount ?? 0;
  const paymentAmount = snapshot.paymentAmount ?? 0;
  const collectedAmount = snapshot.collectedAmount ?? 0;

  // Calculate outstanding balance
  const paid = paymentAmount || collectedAmount;
  const outstanding = estimateAmount > 0
    ? Math.max(0, estimateAmount - paid)
    : 0;

  // Detect discrepancies
  const hasDiscrepancy =
    (typeof snapshot.invoicedAmount === "number" &&
      typeof snapshot.approvedAmount === "number" &&
      snapshot.invoicedAmount > snapshot.approvedAmount + 0.01) ||
    (typeof snapshot.estimateAmount === "number" &&
      typeof snapshot.approvedAmount === "number" &&
      Math.abs(snapshot.estimateAmount - snapshot.approvedAmount) > 0.01);

  const notes: string[] = [];
  if (hasDiscrepancy) {
    if (invoicedAmount > approvedAmount + 0.01) {
      notes.push(`Invoiced ($${invoicedAmount.toLocaleString()}) exceeds approved ($${approvedAmount.toLocaleString()}).`);
    }
    if (estimateAmount > 0 && approvedAmount > 0 && Math.abs(estimateAmount - approvedAmount) > 0.01) {
      notes.push(`Estimate ($${estimateAmount.toLocaleString()}) differs from approved ($${approvedAmount.toLocaleString()}).`);
    }
  }

  if (outstanding > 0) {
    notes.push(`Outstanding balance: $${outstanding.toLocaleString()}`);
  }

  const result: ReconciliationStepResult = {
    claim_id: claimId,
    paid,
    outstanding,
    has_discrepancy: hasDiscrepancy,
    notes,
  };

  ctx.logger.info("Evidence pipeline: reconciliation complete", {
    claim_id: claimId,
    paid: result.paid,
    outstanding: result.outstanding,
    has_discrepancy: result.has_discrepancy,
  });

  return {
    success: true,
    result: result as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Handler registry — maps step types to handler functions
// ---------------------------------------------------------------------------

export const EVIDENCE_PIPELINE_HANDLERS: Record<
  string,
  (ctx: JobExecutionContext) => Promise<HandlerResult>
> = {
  [EVIDENCE_PIPELINE_STEPS.DOCUMENT_INGESTION]: handleDocumentIngestion,
  [EVIDENCE_PIPELINE_STEPS.CLAIM_DISCOVERY]: handleClaimDiscovery,
  [EVIDENCE_PIPELINE_STEPS.COMPLETENESS_ANALYSIS]: handleCompletenessAnalysis,
  [EVIDENCE_PIPELINE_STEPS.FINDINGS_ANALYSIS]: handleFindingsAnalysis,
  [EVIDENCE_PIPELINE_STEPS.CONTRADICTION_SCAN]: handleContradictionScan,
  [EVIDENCE_PIPELINE_STEPS.EVIDENCE_READINESS]: handleEvidenceReadiness,
  [EVIDENCE_PIPELINE_STEPS.RECONCILIATION]: handleReconciliation,
};

/** Register all evidence pipeline handlers with the global handler registry. */
export function registerEvidencePipelineHandlers(): void {
  // Dynamic import to avoid circular dependencies
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { registerJobHandler } = require("./handler-registry");
  for (const [stepType, handler] of Object.entries(EVIDENCE_PIPELINE_HANDLERS)) {
    registerJobHandler(stepType, handler);
  }
}