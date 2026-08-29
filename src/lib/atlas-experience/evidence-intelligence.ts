// ---------------------------------------------------------------------------
// Evidence Intelligence
//
// Collects attention signals from the Evidence Reasoning Engine, document
// pipeline, and knowledge layer. Every insight comes from real Atlas data.
// ---------------------------------------------------------------------------

import { type AttentionItem } from "./attention";
import { createAttentionItem } from "./intelligence";

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

export interface DocumentStats {
  total?: number;
  ready?: number;
  processing?: number;
  failed?: number;
  chunks?: number;
}

export interface EntityStats {
  entities?: number;
  relationships?: number;
  assertions?: number;
  typeCounts?: Record<string, number>;
}

export interface EvidenceDoc {
  _id: string;
  title?: string | null;
  classification?: string | null;
  status?: string | null;
}

// ---------------------------------------------------------------------------
// Evidence Intelligence Collectors
// ---------------------------------------------------------------------------

/**
 * Generate attention items for document processing failures.
 * Translates technical failures into user-friendly language.
 */
export function collectDocumentFailures(stats: DocumentStats): AttentionItem[] {
  const items: AttentionItem[] = [];
  const failed = stats.failed ?? 0;

  if (failed <= 0) return items;

  items.push(
    createAttentionItem({
      id: "evidence-doc-failures",
      severity: failed >= 3 ? "high" : "medium",
      category: "document_issue",
      title: `${failed} document${failed === 1 ? "" : "s"} failed processing`,
      explanation:
        failed === 1
          ? "A document could not be processed. This may affect evidence completeness."
          : `${failed} documents could not be processed. This may affect evidence completeness for related claims.`,
      nextAction: "Review documents",
      navigationTarget: "/dashboard/knowledge",
      meta: {
        source: "documents",
        failedCount: failed,
      },
    }),
  );

  return items;
}

/**
 * Generate attention items for documents still processing.
 * Only surfaces if processing has been running for a while (stale).
 */
export function collectStaleProcessing(stats: DocumentStats): AttentionItem[] {
  const items: AttentionItem[] = [];
  const processing = stats.processing ?? 0;

  if (processing <= 0) return items;

  items.push(
    createAttentionItem({
      id: "evidence-processing-active",
      severity: "info",
      category: "ai_insight",
      title: `${processing} document${processing === 1 ? "" : "s"} being analyzed`,
      explanation: `Atlas is actively processing ${processing} document${processing === 1 ? "" : "s"} in the knowledge pipeline.`,
      navigationTarget: "/dashboard/knowledge",
      meta: {
        source: "documents",
        processingCount: processing,
      },
    }),
  );

  return items;
}

/**
 * Generate attention items for empty knowledge bases.
 * Encourages the user to upload documents.
 */
export function collectEmptyKnowledge(stats: DocumentStats, entityStats: EntityStats): AttentionItem[] {
  const items: AttentionItem[] = [];

  const docCount = stats.total ?? 0;
  const entityCount = entityStats.entities ?? 0;

  if (docCount > 0 || entityCount > 0) return items;

  items.push(
    createAttentionItem({
      id: "evidence-empty-knowledge",
      severity: "low",
      category: "readiness_warning",
      title: "Knowledge base is empty",
      explanation:
        "Atlas has no documents or entities to work with. Upload documents to start building your intelligence layer.",
      nextAction: "Upload documents",
      navigationTarget: "/dashboard/knowledge",
      meta: {
        source: "documents",
        isEmpty: true,
      },
    }),
  );

  return items;
}

/**
 * Generate attention items for low-assertion knowledge bases.
 * When entities exist but few assertions have been made, the knowledge
 * layer may be underutilized.
 */
export function collectUnderutilizedKnowledge(
  entityStats: EntityStats,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  const entities = entityStats.entities ?? 0;
  const assertions = entityStats.assertions ?? 0;

  // Only flag when there are entities but very few assertions
  if (entities <= 5 || assertions >= entities * 2) return items;

  items.push(
    createAttentionItem({
      id: "evidence-underutilized-knowledge",
      severity: "info",
      category: "ai_insight",
      title: "Knowledge base could be more active",
      explanation: `${entities} entities exist but only ${assertions} assertions have been generated. Atlas may benefit from more document analysis.`,
      nextAction: "Review knowledge base",
      navigationTarget: "/dashboard/knowledge",
      meta: {
        source: "knowledge",
        entityCount: entities,
        assertionCount: assertions,
      },
    }),
  );

  return items;
}

/**
 * Collect all evidence intelligence signals.
 */
export function collectEvidenceIntelligence(
  docStats: DocumentStats,
  entityStats: EntityStats,
): AttentionItem[] {
  const docCount = docStats.total ?? 0;
  const entityCount = entityStats.entities ?? 0;

  // Only collect evidence signals when there is data to analyze
  if (docCount === 0 && entityCount === 0) {
    return [
      ...collectEmptyKnowledge(docStats, entityStats),
    ];
  }

  return [
    ...collectDocumentFailures(docStats),
    ...collectStaleProcessing(docStats),
    ...collectUnderutilizedKnowledge(entityStats),
  ];
}
