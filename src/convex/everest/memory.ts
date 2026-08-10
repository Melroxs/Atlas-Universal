// ---------------------------------------------------------------------------
// Everest — Knowledge → Memory
//
// §25. Authority knowledge becomes organizational MEMORY only when it is
// organizationally relevant AND a human has approved it. The pipeline:
//
//   Authority knowledge
//      → Knowledge Graph (authoritativeKnowledge + provenance)
//      → Applicability (jurisdiction/industry context)
//      → Organization context (tenant)
//      → Memory (knowledgeAssertion) ONLY when relevant + approved
//
// Memory always retains provenance: source, tier, version, dates, and the
// review trail. It never asserts compliance — only applicability + review.
//
// PURE module — deterministic, dependency-free, unit-testable.
// ---------------------------------------------------------------------------

export type MemoryKind = "authority" | "industry" | "observation";

export interface AuthorityMemorySource {
  sourceId: string;
  sourceName: string;
  authorityTier: string;
  tierLabel: string;
  version?: string;
  publicationDate?: number | null;
  effectiveDate?: number | null;
  canonicalUrl?: string;
}

export interface AuthorityMemoryInput {
  tenantId: string;
  /** What the authoritative source actually states. */
  statement: string;
  /** Atlas's operational interpretation — always labeled as such. */
  interpretation?: string;
  confidence: number;
  source: AuthorityMemorySource;
  /** The impact assessment / change that triggered this memory. */
  changeType?: string;
  reviewNote?: string;
  decidedBy?: string;
  decidedAt?: number;
}

/** Provenance string attached to the memory record — never dropped. */
export function memoryProvenance(input: AuthorityMemoryInput): string {
  const parts: string[] = [];
  parts.push(`Source: ${input.source.sourceName}`);
  parts.push(`Tier: ${input.source.tierLabel}`);
  if (input.source.version) parts.push(`Version: ${input.source.version}`);
  if (input.source.publicationDate) {
    parts.push(
      `Published: ${new Date(input.source.publicationDate).toISOString().slice(0, 10)}`,
    );
  }
  if (input.source.effectiveDate) {
    parts.push(
      `Effective: ${new Date(input.source.effectiveDate).toISOString().slice(0, 10)}`,
    );
  }
  if (input.source.canonicalUrl) parts.push(`Reference: ${input.source.canonicalUrl}`);
  if (input.changeType) parts.push(`Change: ${input.changeType.replace(/_/g, " ")}`);
  if (input.reviewNote) parts.push(`Review: ${input.reviewNote}`);
  return parts.join(" · ");
}

/**
 * Build the tenant-scoped memory record (a knowledgeAssertion) from an
 * approved authority change. Only called AFTER human approval — never
 * promoted automatically for consequential changes.
 */
export function memoryRecordFromApproval(input: AuthorityMemoryInput): {
  classification: "RULE";
  statement: string;
  confidence: number;
  evidence: string;
  status: "confirmed";
  provenance: string;
} {
  const statement = input.interpretation
    ? `${input.statement} — Interpretation: ${input.interpretation}`
    : input.statement;
  const provenance = memoryProvenance(input);
  return {
    classification: "RULE",
    statement,
    confidence: Math.min(0.99, Math.max(0.4, input.confidence)),
    evidence: provenance,
    status: "confirmed",
    provenance,
  };
}

/** Honest framing guardrail: never claim compliance, only applicability. */
export function applicabilityLabel(applies: boolean, reason: string): string {
  if (!applies) {
    return `Applicability cannot be determined from the available jurisdiction/context. ${reason}`;
  }
  return reason;
}
