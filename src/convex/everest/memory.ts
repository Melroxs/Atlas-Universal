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
// Phase 9 adds the full organizational memory contract (§4–§10): types,
// origin, 6-state confidence, provenance validation, contradiction detection,
// lifecycle transitions and live-state-override framing.
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

// ---------------------------------------------------------------------------
// Phase 9 — the full organizational memory contract
//
// §4  Memory types · §5 provenance · §6 origin · §7 confidence (6 states) ·
// §8 lifecycle · §9 live state overrides stale memory · §10 write service
// validation (this pure layer) + controlled DB writes (the Convex layer).
// ---------------------------------------------------------------------------

export type MemoryType =
  | "fact"
  | "preference"
  | "policy"
  | "relationship"
  | "decision"
  | "pattern"
  | "organizational_context"
  | "workflow_context"
  | "operational_state"
  | "summary";

export type MemoryOrigin =
  | "explicit"
  | "observed"
  | "imported"
  | "inferred"
  | "system-derived";

export type MemoryConfidence =
  | "confirmed"
  | "high"
  | "medium"
  | "low"
  | "disputed"
  | "stale";

export type MemoryStatus =
  | "active"
  | "contradicted"
  | "superseded"
  | "archived"
  | "expired"
  | "disputed";

/** §10 — every memory write is validated before it may touch the DB. */
export interface MemoryWriteInput {
  tenantId: string;
  memoryType: MemoryType;
  statement: string;
  origin: MemoryOrigin;
  /** Provenance is REQUIRED for anything beyond a raw observation. */
  provenance?: string;
  confidenceScore?: number;
  subjectType?: string;
  subjectId?: string;
  structuredValue?: unknown;
  sourceReferences?: Array<{ kind: string; ref: string }>;
  expiresAt?: number;
  createdBy?: string;
  now?: number;
}

export interface MemoryWriteResult {
  ok: boolean;
  reason?: string;
  /** resolved confidence state for the record. */
  confidence?: MemoryConfidence;
  /** dedupe token derived from subject + statement. */
  dedupeKey?: string;
}

/** §7 — map a numeric score to the 6-state confidence model. */
export function memoryConfidenceFromScore(score: number | undefined): MemoryConfidence {
  if (score == null) return "medium";
  if (score >= 0.9) return "confirmed";
  if (score >= 0.75) return "high";
  if (score >= 0.6) return "medium";
  return "low";
}

/** Numeric anchor for sorting/prioritization. */
export function memoryConfidenceScore(c: MemoryConfidence): number {
  const map: Record<MemoryConfidence, number> = {
    confirmed: 0.95,
    high: 0.8,
    medium: 0.65,
    low: 0.4,
    disputed: 0.25,
    stale: 0.2,
  };
  return map[c];
}

/** §6 — UI label preserving the origin distinction. An inferred memory must
 *  NEVER appear as an explicit user fact. */
export function originLabel(origin: MemoryOrigin): string {
  switch (origin) {
    case "explicit":
      return "Stated by a person";
    case "observed":
      return "Observed from records";
    case "imported":
      return "Imported from a system";
    case "inferred":
      return "Inferred by Atlas";
    case "system-derived":
      return "Derived by Atlas systems";
  }
}

/** §10 — the controlled memory-write validation pipeline. Returns the exact
 *  reason when a write must be rejected. */
export function validateMemoryWrite(input: MemoryWriteInput): MemoryWriteResult {
  const now = input.now ?? Date.now();
  if (!input.tenantId) return { ok: false, reason: "Tenant is required." };
  if (!input.statement || input.statement.trim().length < 3) {
    return { ok: false, reason: "A meaningful statement is required." };
  }
  if (input.statement.length > 4000) {
    return { ok: false, reason: "Statement exceeds the 4000 character limit." };
  }
  if (input.origin === "inferred" && !input.provenance) {
    return {
      ok: false,
      reason: "Inferred memory requires provenance — Atlas will not silently store an inference as organizational fact.",
    };
  }
  if (input.origin !== "explicit" && input.origin !== "observed" && !input.provenance) {
    return {
      ok: false,
      reason: "Non-explicit memory requires an identifiable source reference.",
    };
  }
  if (input.expiresAt && input.expiresAt <= now) {
    return { ok: false, reason: "expiresAt must be in the future." };
  }
  const confidence = memoryConfidenceFromScore(input.confidenceScore);
  const dedupeKey = `${input.memoryType}:${input.subjectId ?? "*"}:${stableMemoryToken(input.statement)}`;
  return { ok: true, confidence, dedupeKey };
}

function stableMemoryToken(s: string): string {
  let hash = 0x811c9dc5;
  const norm = s.trim().toLowerCase().replace(/\s+/g, " ");
  for (let i = 0; i < norm.length; i++) {
    hash ^= norm.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** §8 — legal lifecycle transitions. Every transition is auditable. */
export const MEMORY_TRANSITIONS: Record<MemoryStatus, MemoryStatus[]> = {
  active: ["contradicted", "superseded", "archived", "expired", "disputed"],
  disputed: ["active", "superseded", "archived", "contradicted"],
  contradicted: ["active", "superseded", "archived", "disputed"],
  superseded: ["archived"],
  archived: ["active"],
  expired: ["archived"],
};

/** §8 — validate a lifecycle transition. Returns the resolved next status or
 *  the rejection reason. */
export function transitionMemory(
  current: MemoryStatus,
  requested: MemoryStatus,
): { ok: boolean; next: MemoryStatus; reason?: string } {
  if (current === requested) return { ok: true, next: current };
  if ((MEMORY_TRANSITIONS[current] ?? []).includes(requested)) {
    return { ok: true, next: requested };
  }
  return {
    ok: false,
    next: current,
    reason: `Cannot move memory from ${current} to ${requested} — ${requested} is not a legal transition.`,
  };
}

/** §8 — contradiction detection. When two memories about the same subject
 *  materially disagree, Atlas NEVER silently overwrites: it returns a
 *  contradiction record carrying BOTH sources. */
export function detectContradiction(input: {
  existing: { statement: string; provenance?: string };
  incoming: { statement: string; provenance?: string };
  sameSubject: boolean;
}): { contradicted: boolean; reason?: string } {
  if (!input.sameSubject) return { contradicted: false };
  const a = normalizeMemoryStatement(input.existing.statement);
  const b = normalizeMemoryStatement(input.incoming.statement);
  if (a === b) return { contradicted: false }; // same statement — reinforce, not conflict

  // Negation heuristics: presence of explicit contradiction markers.
  const negA = /\b(not|never|no longer|doesn'?t|isn'?t|won'?t|cannot|can'?t|failed|closed|cancelled)\b/i.test(a);
  const negB = /\b(not|never|no longer|doesn'?t|isn'?t|won'?t|cannot|can'?t|failed|closed|cancelled)\b/i.test(b);
  const statusA = extractStatusWord(a);
  const statusB = extractStatusWord(b);
  const statusConflict =
    statusA && statusB && statusA !== statusB && isOppositeStatus(statusA, statusB);
  if ((negA || negB) && a.length > 8 && b.length > 8) {
    return {
      contradicted: true,
      reason: `Conflicting statements about the same subject: "${input.existing.statement}" vs "${input.incoming.statement}". Both sources are preserved.`,
    };
  }
  if (statusConflict) {
    return {
      contradicted: true,
      reason: `Conflicting recorded states: "${input.existing.statement}" vs "${input.incoming.statement}".`,
    };
  }
  return { contradicted: false };
}

function normalizeMemoryStatement(s: string): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[.]+$/, "");
}

const OPPOSITE_STATUS_PAIRS: Array<[string, string]> = [
  ["active", "completed"],
  ["active", "closed"],
  ["active", "cancelled"],
  ["open", "closed"],
  ["open", "completed"],
  ["pending", "approved"],
  ["pending", "rejected"],
  ["in_progress", "completed"],
  ["in_progress", "cancelled"],
];

function extractStatusWord(s: string): string | null {
  for (const [a, b] of OPPOSITE_STATUS_PAIRS) {
    if (s.includes(a)) return a;
    if (s.includes(b)) return b;
  }
  return null;
}

function isOppositeStatus(a: string, b: string): boolean {
  return OPPOSITE_STATUS_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

/** §9 — live verified system state wins over stale memory. The response
 *  preserves the historical memory while reporting the current truth. */
export function stateOverrideMessage(input: {
  memoryStatement: string;
  currentState: string;
  sameSubject: boolean;
}): string | null {
  if (!input.sameSubject) return null;
  const mem = normalizeMemoryStatement(input.memoryStatement);
  const state = normalizeMemoryStatement(input.currentState);
  if (mem === state) return null;
  return `The workspace previously recorded: "${input.memoryStatement}". The latest verified system state shows: "${input.currentState}". The current state takes precedence — the earlier memory is preserved for the record.`;
}
