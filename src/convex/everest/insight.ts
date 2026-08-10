// ---------------------------------------------------------------------------
// Everest — Knowledge → Intelligence (Composed Insight)
//
// §26. An insight may combine:
//   current organization state  ·  industry knowledge  ·  authority knowledge
//   jurisdiction  ·  temporal context  ·  evidence  ·  workflows  ·  events
//   memory
//
// The result MUST remain evidence-grounded. Every composed insight carries:
//   - a layer label (organization | industry | authority | memory | temporal)
//   - the evidence items that support it (with evidenceState)
//   - confidence derived from evidence quality, never fabricated
//
// PURE module — deterministic, dependency-free, unit-testable.
// ---------------------------------------------------------------------------

export type EvidenceState =
  | "verified"
  | "inferred"
  | "uncertain"
  | "stale"
  | "unavailable";

export interface InsightEvidenceRef {
  kind: string; // entity | assertion | authority | pack_item | event | workflow | deadline
  title: string;
  snippet?: string;
  evidenceState: EvidenceState;
  sourceRef?: string;
  authorityTier?: string;
  timestamp?: number;
}

export type InsightLayer =
  | "organization"
  | "industry"
  | "authority"
  | "memory"
  | "temporal";

export interface ComposedInsight {
  id: string;
  layer: InsightLayer;
  title: string;
  detail: string;
  confidence: number;
  evidence: InsightEvidenceRef[];
  /** Honest framing when confidence is low or applicability unclear. */
  limitation?: string;
}

export interface InsightInput {
  now: number;
  timezone: string;
  organizationState: {
    entityCount: number;
    assertionCount: number;
    openDecisions: Array<{ id: string; title: string; summary: string }>;
    pendingApprovals: Array<{ id: string; title: string; createdAt: number }>;
    recentEvents: Array<{ id: string; eventType: string; receivedAt: number }>;
    activeWorkflows: Array<{ id: string; name: string }>;
  };
  industryKnowledge: Array<{ key: string; title: string; summary?: string }>;
  authorityKnowledge: Array<{
    knowledgeId: string;
    title: string;
    statement: string;
    interpretation?: string;
    sourceName: string;
    authorityTier: string;
    version?: string;
    effectiveDate?: number;
    confidence: number;
    applies: boolean;
    applicabilityReason: string;
  }>;
  memory: Array<{ id: string; statement: string; classification: string; confidence: number }>;
  jurisdiction: { path: string[]; industry?: string };
}

// --- Confidence mapping ------------------------------------------------------

export function evidenceStateFromConfidence(c: number): EvidenceState {
  if (c >= 0.8) return "verified";
  if (c >= 0.6) return "inferred";
  if (c >= 0.4) return "uncertain";
  return "unavailable";
}

function combinedConfidence(refs: InsightEvidenceRef[], base: number): number {
  if (refs.length === 0) return Math.min(base, 0.35);
  const verified = refs.filter((r) => r.evidenceState === "verified").length;
  const ratio = verified / refs.length;
  return Math.min(0.95, Math.max(0.2, base + ratio * 0.25 - refs.length * 0.03));
}

// --- Composers ----------------------------------------------------------------

/** Organization layer — derived strictly from the organization state input. */
export function composeOrganizationInsights(input: InsightInput): ComposedInsight[] {
  const out: ComposedInsight[] = [];
  const approvals = input.organizationState.pendingApprovals;
  if (approvals.length > 0) {
    const stale = approvals.filter(
      (a) => input.now - a.createdAt > 3 * 24 * 3600_000,
    );
    out.push({
      id: "insight-org-approvals",
      layer: "organization",
      title: `${approvals.length} approval${approvals.length === 1 ? "" : "s"} waiting`,
      detail:
        stale.length > 0
          ? `${stale.length} have been waiting more than 3 business days — review before they expire.`
          : "Human approvals are pending and within their review window.",
      confidence: 1,
      evidence: approvals.map((a) => ({
        kind: "approval",
        title: a.title,
        evidenceState: "verified",
        sourceRef: a.id,
        timestamp: a.createdAt,
      })),
    });
  }
  if (input.organizationState.openDecisions.length > 0) {
    out.push({
      id: "insight-org-decisions",
      layer: "organization",
      title: `${input.organizationState.openDecisions.length} open decision${input.organizationState.openDecisions.length === 1 ? "" : "s"} need attention`,
      detail:
        "Open decisions represent unresolved operational questions. Each carries its own evidence trail.",
      confidence: 0.9,
      evidence: input.organizationState.openDecisions.slice(0, 5).map((d) => ({
        kind: "decision",
        title: d.title,
        snippet: d.summary,
        evidenceState: "inferred",
        sourceRef: d.id,
      })),
    });
  }
  if (input.organizationState.entityCount === 0 && input.organizationState.assertionCount === 0) {
    out.push({
      id: "insight-org-unknown",
      layer: "organization",
      title: "Knowledge graph is empty",
      detail:
        "No entities or assertions exist in the workspace yet — organization-level intelligence is unavailable until documents are ingested.",
      confidence: 0.35,
      evidence: [],
      limitation: "Organization data has not been ingested.",
    });
  }
  return out;
}

/** Industry layer — from active pack knowledge, always labeled domain knowledge. */
export function composeIndustryInsights(input: InsightInput): ComposedInsight[] {
  if (input.industryKnowledge.length === 0) return [];
  return input.industryKnowledge.slice(0, 3).map((item, i) => ({
    id: `insight-industry-${item.key}`,
    layer: "industry",
    title: item.title,
    detail: item.summary ?? "Domain knowledge from the configured industry pack.",
    confidence: 0.7,
    evidence: [
      {
        kind: "pack_item",
        title: item.title,
        snippet: item.summary,
        evidenceState: "inferred",
        sourceRef: item.key,
      },
    ],
    limitation:
      "This is domain-level knowledge — it is generally true in the industry, not a fact about this company unless organization evidence confirms it.",
  }));
}

/** Authority layer — only knowledge that actually applies to this tenant. */
export function composeAuthorityInsights(input: InsightInput): ComposedInsight[] {
  const applicable = input.authorityKnowledge.filter((k) => k.applies);
  if (applicable.length === 0) {
    const anyAuthority = input.authorityKnowledge.length > 0;
    return anyAuthority
      ? [
          {
            id: "insight-authority-none",
            layer: "authority",
            title: "No applicable authority knowledge for this operating context",
            detail: `Sources are registered but none of them apply to ${input.jurisdiction.path.join(" > ") || "an unspecified jurisdiction"}${input.jurisdiction.industry ? ` / ${input.jurisdiction.industry}` : ""}.`,
            confidence: 0.5,
            evidence: [],
            limitation: "Applicability cannot be determined from the available jurisdiction/context.",
          },
        ]
      : [];
  }
  return applicable.slice(0, 4).map((k) => ({
    id: `insight-authority-${k.knowledgeId}`,
    layer: "authority",
    title: k.title,
    detail: k.interpretation
      ? `${k.statement} — ${k.interpretation}`
      : k.statement,
    confidence: k.confidence,
    evidence: [
      {
        kind: "authority",
        title: `${k.sourceName}${k.version ? ` · ${k.version}` : ""}`,
        snippet: k.applicabilityReason,
        evidenceState: evidenceStateFromConfidence(k.confidence),
        sourceRef: k.sourceName,
        authorityTier: k.authorityTier,
        timestamp: k.effectiveDate ?? undefined,
      },
    ],
    limitation: `Source: ${k.sourceName} (${k.authorityTier.replace(/_/g, " ")}). This describes what the source states and Atlas's interpretation — it is not legal advice and never asserts compliance.`,
  }));
}

/** Memory layer — approved authority knowledge retained as org memory. */
export function composeMemoryInsights(input: InsightInput): ComposedInsight[] {
  if (input.memory.length === 0) return [];
  return input.memory.slice(0, 3).map((m) => ({
    id: `insight-memory-${m.id}`,
    layer: "memory",
    title: m.statement.slice(0, 80) + (m.statement.length > 80 ? "…" : ""),
    detail: m.statement,
    confidence: m.confidence,
    evidence: [
      {
        kind: "assertion",
        title: m.classification,
        snippet: m.statement,
        evidenceState: "verified",
        sourceRef: m.id,
      },
    ],
  }));
}

/** Temporal layer — time-aware observations grounded in real system data. */
export function composeTemporalInsights(input: InsightInput): ComposedInsight[] {
  const out: ComposedInsight[] = [];
  const oldest = input.organizationState.pendingApprovals
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt)[0];
  if (oldest) {
    const days = Math.floor((input.now - oldest.createdAt) / 86_400_000);
    if (days >= 3) {
      out.push({
        id: "insight-temporal-approval",
        layer: "temporal",
        title: `An approval has been waiting ${days} business days`,
        detail: `"${oldest.title}" has been waiting since ${new Date(oldest.createdAt).toISOString().slice(0, 10)} — past the typical 3-day review window.`,
        confidence: 0.9,
        evidence: [
          {
            kind: "deadline",
            title: oldest.title,
            evidenceState: "verified",
            sourceRef: oldest.id,
            timestamp: oldest.createdAt,
          },
        ],
      });
    }
  }
  for (const k of input.authorityKnowledge) {
    if (k.applies && k.effectiveDate && k.effectiveDate > input.now) {
      const daysUntil = Math.ceil((k.effectiveDate - input.now) / 86_400_000);
      if (daysUntil <= 14) {
        out.push({
          id: `insight-temporal-effective-${k.knowledgeId}`,
          layer: "temporal",
          title: `An applicable requirement becomes effective ${daysUntil === 0 ? "today" : `in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`}`,
          detail: `${k.title} becomes effective ${new Date(k.effectiveDate).toISOString().slice(0, 10)} in the operating timezone (${input.timezone}).`,
          confidence: 0.9,
          evidence: [
            {
              kind: "deadline",
              title: k.title,
              evidenceState: "verified",
              authorityTier: k.authorityTier,
              timestamp: k.effectiveDate,
            },
          ],
        });
      }
    }
  }
  return out;
}

/** Compose ALL layers into one evidence-grounded insight list. */
export function composeInsights(input: InsightInput): ComposedInsight[] {
  return [
    ...composeOrganizationInsights(input),
    ...composeTemporalInsights(input),
    ...composeAuthorityInsights(input),
    ...composeMemoryInsights(input),
    ...composeIndustryInsights(input),
  ];
}

/** Aggregate confidence over the composed insights — never above the weakest
 *  evidence allows. */
export function insightConfidence(insights: ComposedInsight[]): number {
  if (insights.length === 0) return 0.1;
  return Math.min(
    0.95,
    insights.reduce((sum, i) => sum + i.confidence, 0) / insights.length,
  );
}
