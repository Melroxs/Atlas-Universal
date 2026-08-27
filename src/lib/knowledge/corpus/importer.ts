// ---------------------------------------------------------------------------
// Atlas Knowledge Corpus — Importer
//
// Validates, normalizes, and produces the database-ready import payload
// from the corpus data files. Handles:
//   - Manifest validation
//   - Schema validation of every record
//   - Deduplication by ID
//   - Graph relationship integrity
//   - Provenance validation
//   - Idempotent payload generation (ON CONFLICT-safe)
//
// This module does NOT directly touch the database — it produces
// the validated payload that the seed RPC consumes.
// ---------------------------------------------------------------------------

import {
  CORPUS_MANIFEST,
  type CorpusKnowledgeRecord,
  type CorpusGraphEdge,
} from "./manifest";
import { CORPUS_PROVENANCE } from "./sources";
import { FEDERAL_REGULATIONS } from "./regulations";
import { WORKFLOW_STAGES } from "./workflows";
import { DOCUMENTATION_EVIDENCE } from "./evidence";
import { JURISDICTION_PROFILES } from "./jurisdictions";
import { STANDARDS_METADATA } from "./standards";
import { RISK_PATTERNS } from "./risks";
import { REVENUE_RECOVERY } from "./revenue";
import { GRAPH_RELATIONSHIPS } from "./graph";
import type { KnowledgeItem, KnowledgeProvenance } from "../types";

// ---------------------------------------------------------------------------
// Validation Result
// ---------------------------------------------------------------------------

export interface CorpusValidationResult {
  valid: boolean;
  /** Total records discovered. */
  totalRecords: number;
  /** Records that passed validation. */
  validRecords: number;
  /** Records rejected with reasons. */
  rejected: Array<{ id: string; reason: string }>;
  /** Duplicate IDs detected. */
  duplicates: string[];
  /** Missing provenance references. */
  missingProvenance: string[];
  /** Orphan graph edges (references to nonexistent IDs). */
  orphanEdges: number;
  /** Counts by category. */
  categoryCounts: Record<string, number>;
  /** Warnings (non-fatal). */
  warnings: string[];
  /** Errors (fatal). */
  errors: string[];
}

// ---------------------------------------------------------------------------
// Validate a single corpus record
// ---------------------------------------------------------------------------

function validateRecord(record: CorpusKnowledgeRecord): string | null {
  if (!record.id || typeof record.id !== "string") return "Missing or invalid id";
  if (!record.title || typeof record.title !== "string") return "Missing or invalid title";
  if (!record.statement || typeof record.statement !== "string") return "Missing or invalid statement";
  if (!record.knowledgeType) return "Missing knowledgeType";
  if (typeof record.confidence !== "number" || record.confidence < 0 || record.confidence > 1) {
    return "Invalid confidence (must be 0-1)";
  }
  if (record.status !== "active" && record.status !== "superseded" && record.status !== "draft" && record.status !== "archived") {
    return `Invalid status: ${record.status}`;
  }
  if (!record.sourceId || typeof record.sourceId !== "string") return "Missing sourceId";
  if (!record.tags || !Array.isArray(record.tags)) return "Missing or invalid tags";

  // Jurisdiction-specific validation
  if (record.knowledgeType === "jurisdiction") {
    if (!record.verificationStatus) return "Jurisdiction record missing verificationStatus";
    if (!record.jurisdiction) return "Jurisdiction record missing jurisdiction field";
  }

  return null; // valid
}

// ---------------------------------------------------------------------------
// Full corpus validation
// ---------------------------------------------------------------------------

export function validateCorpus(): CorpusValidationResult {
  const manifest = CORPUS_MANIFEST;
  const allRecords: CorpusKnowledgeRecord[] = [
    ...FEDERAL_REGULATIONS,
    ...WORKFLOW_STAGES,
    ...DOCUMENTATION_EVIDENCE,
    ...JURISDICTION_PROFILES,
    ...STANDARDS_METADATA,
    ...RISK_PATTERNS,
    ...REVENUE_RECOVERY,
  ];

  const result: CorpusValidationResult = {
    valid: true,
    totalRecords: allRecords.length,
    validRecords: 0,
    rejected: [],
    duplicates: [],
    missingProvenance: [],
    orphanEdges: 0,
    categoryCounts: {},
    warnings: [...manifest.warnings],
    errors: [],
  };

  // 1. Validate each record
  const seenIds = new Set<string>();
  for (const record of allRecords) {
    const error = validateRecord(record);
    if (error) {
      result.rejected.push({ id: record.id, reason: error });
    } else {
      result.validRecords++;
    }

    // Check for duplicates
    if (seenIds.has(record.id)) {
      result.duplicates.push(record.id);
    }
    seenIds.add(record.id);

    // Count by category
    result.categoryCounts[record.knowledgeType] =
      (result.categoryCounts[record.knowledgeType] ?? 0) + 1;
  }

  // 2. Validate provenance references
  const provenanceIds = new Set(CORPUS_PROVENANCE.map((p) => p.sourceId));
  for (const record of allRecords) {
    if (!provenanceIds.has(record.sourceId)) {
      result.missingProvenance.push(record.id);
    }
  }

  // 3. Validate graph relationships
  const allIds = new Set(allRecords.map((r) => r.id));
  let orphanEdges = 0;
  for (const edge of GRAPH_RELATIONSHIPS) {
    if (!allIds.has(edge.sourceId) || !allIds.has(edge.targetId)) {
      orphanEdges++;
    }
  }
  result.orphanEdges = orphanEdges;

  // 4. Check expected counts (warnings, not errors)
  const expected = manifest.counts;
  if (result.categoryCounts["federal_regulation"] !== expected.federalRegulations) {
    result.warnings.push(
      `Federal regulations: expected ${expected.federalRegulations}, got ${result.categoryCounts["federal_regulation"] ?? 0}`,
    );
  }
  if (result.categoryCounts["workflow_stage"] !== expected.workflowStages) {
    result.warnings.push(
      `Workflow stages: expected ${expected.workflowStages}, got ${result.categoryCounts["workflow_stage"] ?? 0}`,
    );
  }
  if (result.categoryCounts["documentation_evidence"] !== expected.documentationEvidence) {
    result.warnings.push(
      `Documentation/evidence: expected ${expected.documentationEvidence}, got ${result.categoryCounts["documentation_evidence"] ?? 0}`,
    );
  }
  if (result.categoryCounts["jurisdiction"] !== expected.jurisdictionProfiles) {
    result.warnings.push(
      `Jurisdictions: expected ${expected.jurisdictionProfiles}, got ${result.categoryCounts["jurisdiction"] ?? 0}`,
    );
  }
  if (result.categoryCounts["standard"] !== expected.standardsMetadata) {
    result.warnings.push(
      `Standards: expected ${expected.standardsMetadata}, got ${result.categoryCounts["standard"] ?? 0}`,
    );
  }
  if (result.categoryCounts["risk_pattern"] !== expected.risks) {
    result.warnings.push(
      `Risks: expected ${expected.risks}, got ${result.categoryCounts["risk_pattern"] ?? 0}`,
    );
  }
  if (result.categoryCounts["revenue_concept"] !== expected.revenueRecoveryConcepts) {
    result.warnings.push(
      `Revenue concepts: expected ${expected.revenueRecoveryConcepts}, got ${result.categoryCounts["revenue_concept"] ?? 0}`,
    );
  }

  // Determine overall validity
  if (result.rejected.length > 0) {
    result.valid = false;
    result.errors.push(`${result.rejected.length} records failed validation`);
  }
  if (result.duplicates.length > 0) {
    result.valid = false;
    result.errors.push(`${result.duplicates.length} duplicate IDs detected`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Normalize corpus records into Atlas KnowledgeItem format
// ---------------------------------------------------------------------------

/** Map corpus sourceClassification to Atlas SourceClassification. */
function mapClassification(
  c: CorpusKnowledgeRecord["sourceClassification"],
): "REGULATORY" | "INDUSTRY_STANDARD" | "PROFESSIONAL_GUIDANCE" | "ATLAS_CURATED" | "CARRIER_OR_INSURANCE" {
  return c; // Direct mapping — types are already aligned
}

/**
 * Convert all corpus records into Atlas KnowledgeItem format.
 * This produces the payload that gets inserted into atlasIndustryKnowledge.
 */
export function normalizeCorpusToKnowledgeItems(): KnowledgeItem[] {
  const allRecords: CorpusKnowledgeRecord[] = [
    ...FEDERAL_REGULATIONS,
    ...WORKFLOW_STAGES,
    ...DOCUMENTATION_EVIDENCE,
    ...JURISDICTION_PROFILES,
    ...STANDARDS_METADATA,
    ...RISK_PATTERNS,
    ...REVENUE_RECOVERY,
  ];

  return allRecords.map((r) => ({
    id: r.id,
    layer: "atlas_industry" as const,
    sourceClassification: mapClassification(r.sourceClassification),
    title: r.title,
    statement: r.statement,
    interpretation: r.interpretation,
    knowledgeType: r.knowledgeType,
    industry: r.industry ?? "insurance restoration",
    jurisdiction: r.jurisdiction,
    confidence: r.confidence,
    status: r.status,
    isInference: r.isInference,
    tags: r.tags,
    sourceId: r.sourceId,
  }));
}

/**
 * Convert corpus provenance to Atlas KnowledgeProvenance format.
 */
export function normalizeCorpusProvenance(): KnowledgeProvenance[] {
  return CORPUS_PROVENANCE.map((p) => ({
    sourceId: p.sourceId,
    sourceName: p.sourceName,
    organization: p.organization,
    authorityTier: p.authorityTier,
    sourceType: p.sourceType,
    canonicalUrl: p.canonicalUrl,
    status: p.status,
  }));
}

/**
 * Get validated graph relationships (only edges where both endpoints exist).
 */
export function getValidatedGraphEdges(): CorpusGraphEdge[] {
  const allRecords: CorpusKnowledgeRecord[] = [
    ...FEDERAL_REGULATIONS,
    ...WORKFLOW_STAGES,
    ...DOCUMENTATION_EVIDENCE,
    ...JURISDICTION_PROFILES,
    ...STANDARDS_METADATA,
    ...RISK_PATTERNS,
    ...REVENUE_RECOVERY,
  ];
  const allIds = new Set(allRecords.map((r) => r.id));

  return GRAPH_RELATIONSHIPS.filter(
    (e) => allIds.has(e.sourceId) && allIds.has(e.targetId),
  );
}

/**
 * Get the ingestion report with exact counts.
 */
export function getIngestionReport(validation: CorpusValidationResult) {
  const knowledge = normalizeCorpusToKnowledgeItems();
  const provenance = normalizeCorpusProvenance();
  const edges = getValidatedGraphEdges();

  return {
    corpus: CORPUS_MANIFEST.corpusName,
    version: CORPUS_MANIFEST.version,
    releaseId: CORPUS_MANIFEST.releaseId,
    qcStatus: CORPUS_MANIFEST.qcStatus,
    totalRecords: validation.totalRecords,
    validRecords: validation.validRecords,
    rejected: validation.rejected.length,
    duplicates: validation.duplicates.length,
    orphanEdges: validation.orphanEdges,
    knowledgeItemsReady: knowledge.length,
    provenanceRecordsReady: provenance.length,
    graphEdgesReady: edges.length,
    categoryCounts: validation.categoryCounts,
    warnings: validation.warnings,
    errors: validation.errors,
  };
}
