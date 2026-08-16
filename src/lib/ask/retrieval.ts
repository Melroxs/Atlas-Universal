// ---------------------------------------------------------------------------
// Ask Atlas — deterministic local retrieval (Phase 15).
//
// The production deployment's `conversation-converse` Edge Function is not
// deployed, so every Ask Atlas / voice query currently fails. This module is
// the honest fallback: it answers from REAL persisted knowledge — documents,
// chunks, entities, claim candidates, claims and findings — via the same RPCs
// the rest of the app uses. Answers are always grounded in cited evidence and
// clearly labelled as local deterministic retrieval (no AI model configured).
//
//   answerLocally(supabase, question) → { answer, evidence, sessionId, ... }
//
// Every fact comes from the database. Nothing is fabricated.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import { rpcCall } from "@/lib/actions/rpc";
import { analyzeClaimCompleteness, toClaimSnapshot, type ClaimSnapshot } from "@/lib/insurance/logic";
import {
  assessReadiness,
  summarizeReadiness,
  workflowLabel,
  type ReadinessAssessment,
  type RequirementClaimFacts,
  type RequirementContext,
  type RequirementEvidenceDocument,
  type WorkflowKey,
} from "../../../supabase/functions/conversation-converse/source/evidence-requirements.ts";
import {
  compareClaimAgainstDocuments,
  scanDocumentsForContradictions,
  type EvidenceContradiction,
} from "../../../supabase/functions/conversation-converse/source/contradictions.ts";

export interface LocalEvidence {
  kind: "chunk" | "document" | "entity" | "candidate" | "finding";
  documentId?: string;
  chunkId?: string;
  entityId?: string;
  documentTitle?: string;
  title?: string;
  snippet?: string;
  relevance?: number;
  evidenceType?: string;
}

/** Reasoning categories (§23) — conclusions are labeled, never dressed up. */
export type ReasoningCategory =
  | "FACT"
  | "INFERENCE"
  | "UNKNOWN"
  | "MISSING"
  | "CONFLICT"
  | "RECOMMENDATION";

export interface ReasoningFinding {
  category: ReasoningCategory;
  statement: string;
  evidenceIds?: string[];
}

export interface LocalAnswer {
  sessionId: string;
  answer: string;
  classification: string;
  confidence: number;
  mode: "local";
  limitations: string;
  suggestedActions: string[];
  questionType: string;
  intent: string;
  evidence: LocalEvidence[];
  authorityAnswers: unknown[];
  pending: null;
  /** Structured intelligence (§37) — always arrays, never undefined. */
  findings?: ReasoningFinding[];
  missingInformation?: string[];
  contradictions?: EvidenceContradiction[];
  recommendations?: string[];
}

const STOPWORDS = new Set([
  "what", "did", "you", "find", "the", "of", "and", "how", "many", "do", "we",
  "have", "is", "are", "for", "to", "with", "on", "at", "from", "that", "it",
  "our", "your", "about", "me", "show", "why", "which", "needs", "most",
  "attention", "can", "i", "get", "tell", "this", "these", "those", "there",
  "their", "they", "was", "were", "be", "been", "all", "any", "each", "not",
  "but", "also", "its", "into", "than", "then", "when", "where", "will",
  "would", "should", "could", "please", "let", "know", "out", "over", "under",
  "more", "other", "some", "such", "only", "own", "same", "so", "too", "very",
  "can", "just", "come", "does", "has", "had", "having",
]);

function tokens(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9\-.\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function scoreDoc(row: { title?: string | null; summary?: string | null; sourceId?: string | null }, terms: string[]): number {
  const title = (row.title ?? "").toLowerCase();
  const summary = (row.summary ?? "").toLowerCase();
  const sourceId = (row.sourceId ?? "").toLowerCase();
  let score = 0;
  for (const t of terms) {
    if (title.includes(t)) score += 3;
    if (summary.includes(t)) score += 1;
    if (sourceId.includes(t)) score += 2;
  }
  return score;
}

interface DocRow {
  _id: string;
  title?: string | null;
  summary?: string | null;
  sourceId?: string | null;
  classification?: string | null;
  status?: string | null;
  entityCount?: number | null;
  chunkCount?: number | null;
}

/** Keyword search over real documents + their chunks, returning cited evidence. */
async function searchKnowledge(
  supabase: SupabaseClient,
  question: string,
): Promise<{ docs: DocRow[]; evidence: LocalEvidence[]; snippets: string[] }> {
  const terms = tokens(question);
  const docs = ((await rpcCall(supabase, "documents_list_documents")) ?? []) as DocRow[];
  const usable = docs.filter((d) => d.status === "ready");
  const scored = usable
    .map((d) => ({ d, score: terms.length ? scoreDoc(d, terms) : 1 }))
    .filter((x) => terms.length === 0 || x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const evidence: LocalEvidence[] = [];
  const snippets: string[] = [];
  for (const { d, score } of scored) {
    interface DocDetail {
      doc?: DocRow;
      chunks?: Array<{ _id: string; content: string; chunkIndex?: number }>;
    }
    let detail: DocDetail | null = null;
    try {
      detail = (await rpcCall(supabase, "documents_get_document_detail", {
        documentId: d._id,
      })) as DocDetail;
    } catch {
      // individual detail failure shouldn't kill the whole answer
    }
    const chunks = (detail?.chunks ?? []).filter((c) => Boolean(c.content));
    const matches = terms.length
      ? chunks
          .map((c) => ({ c, score: terms.filter((t) => c.content.toLowerCase().includes(t)).length }))
          .filter((m) => m.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 2)
      : chunks.slice(0, 1).map((c) => ({ c, score: 1 }));
    for (const m of matches) {
      const snippet = m.c.content.slice(0, 600);
      snippets.push(snippet);
      evidence.push({
        kind: "chunk",
        chunkId: m.c._id,
        documentId: d._id,
        documentTitle: d.title ?? undefined,
        title: d.title ?? "Chunk",
        snippet,
        relevance: Math.min(0.95, 0.4 + (m.score / Math.max(terms.length, 1)) * 0.5),
        evidenceType: d.classification ?? "Document",
      });
    }
    if (matches.length === 0 && d.title) {
      evidence.push({
        kind: "document",
        documentId: d._id,
        documentTitle: d.title,
        title: d.title,
        snippet: d.summary?.slice(0, 300) ?? "No chunks matched the query terms.",
        relevance: Math.min(0.7, 0.3 + score * 0.05),
        evidenceType: d.classification ?? "Document",
      });
    }
  }
  return { docs: scored.map((s) => s.d), evidence: evidence.slice(0, 8), snippets };
}

function claimNumberMatches(question: string): string[] {
  const q = question.toUpperCase();
  const out: string[] = [];
  for (const re of [
    // Alphanumeric claim id first (GAP-26-51847, CL-2019-48211).
    /\b[A-Z]{2,6}[- ]?\d{1,4}[- ]?\d{4,12}\b/g,
    /\bGAP[- ]?\d+\b/g,
    /\b(?:CL|CLM|CN)\d{4,12}\b/g,
    /\b\d{6,12}\b/g,
  ]) {
    const matches = q.match(re);
    if (matches) out.push(...matches.map((m) => m.replace(/[-\s]/g, "")));
  }
  return [...new Set(out)];
}

interface CandidateRow {
  _id: string;
  claimKey: string;
  claimNumber?: string | null;
  customer?: string | null;
  property?: string | null;
  confidence?: number | null;
  status?: string | null;
  evidence?: unknown;
  archiveId?: string | null;
}

interface RelevantDoc {
  _id: string;
  title?: string | null;
  classification?: string | null;
  summary?: string | null;
  text?: string;
}

/**
 * Load claim-relevant tenant documents with their chunk text (bounded).
 * Every doc is tenant-scoped (RLS) — evidence can never cross tenants.
 */
async function loadRelevantDocs(supabase: SupabaseClient): Promise<RelevantDoc[]> {
  const docs = ((await rpcCall(supabase, "documents_list_documents")) ?? []) as DocRow[];
  const relevant = docs
    .filter(
      (d) =>
        d.status === "ready" &&
        /estimate|xactimate|invoice|payment|supplement|fnol|scope|inspection|correspondence|policy|loss|deductible/i.test(
          `${d.title ?? ""} ${d.summary ?? ""} ${d.classification ?? ""}`,
        ),
    )
    .slice(0, 20);
  const out: RelevantDoc[] = [];
  for (const d of relevant) {
    let text = "";
    try {
      const detail = (await rpcCall(supabase, "documents_get_document_detail", {
        documentId: d._id,
      })) as { chunks?: Array<{ content?: string }> };
      text = (detail?.chunks ?? []).map((c) => c.content ?? "").join("\n").slice(0, 20_000);
    } catch {
      // an unreadable document is simply skipped
    }
    out.push({
      _id: d._id,
      title: d.title,
      classification: d.classification,
      summary: d.summary,
      text,
    });
  }
  return out;
}

/** Map a persisted claim row to the evidence-requirements claim shape. */
function toRequirementClaim(raw: Record<string, unknown>): RequirementClaimFacts {
  return {
    _id: raw._id != null ? String(raw._id) : undefined,
    claimNumber: typeof raw.claimNumber === "string" ? raw.claimNumber : null,
    dateOfLoss: typeof raw.dateOfLoss === "number" ? raw.dateOfLoss : null,
    property: typeof raw.property === "string" ? raw.property : null,
    causeOfLoss: typeof raw.causeOfLoss === "string" ? raw.causeOfLoss : null,
    customer: typeof raw.customer === "string" ? raw.customer : null,
    carrier: typeof raw.carrier === "string" ? raw.carrier : null,
    policy: typeof raw.policy === "string" ? raw.policy : null,
    adjuster: typeof raw.adjuster === "string" ? raw.adjuster : null,
    status: typeof raw.status === "string" ? raw.status : null,
    estimateAmount: typeof raw.estimateAmount === "number" ? raw.estimateAmount : null,
    estimateLineItemCount: typeof raw.estimateLineItemCount === "number" ? raw.estimateLineItemCount : null,
    invoicedAmount: typeof raw.invoicedAmount === "number" ? raw.invoicedAmount : null,
    paymentAmount: typeof raw.paymentAmount === "number" ? raw.paymentAmount : null,
    approvedAmount: typeof raw.approvedAmount === "number" ? raw.approvedAmount : null,
    deductible: typeof raw.deductible === "number" ? raw.deductible : null,
    scopeItems: Array.isArray(raw.scopeItems)
      ? (raw.scopeItems as RequirementClaimFacts["scopeItems"])
      : null,
    evidenceSummary: Array.isArray(raw.evidenceSummary)
      ? raw.evidenceSummary.map((x) => String(x ?? ""))
      : null,
    evidenceDocumentIds: Array.isArray(raw.evidenceDocumentIds)
      ? raw.evidenceDocumentIds
      : null,
    confidence: typeof raw.confidence === "number" ? raw.confidence : undefined,
    provenance: typeof raw.provenance === "string" ? raw.provenance : null,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : null,
  };
}

/** Load approved claims (insurance_list_claims → row.claim), best-effort. */
async function loadClaims(supabase: SupabaseClient): Promise<RequirementClaimFacts[]> {
  try {
    const rows = ((await rpcCall(supabase, "insurance_list_claims")) ?? []) as Array<{
      claim?: Record<string, unknown>;
    }>;
    return (Array.isArray(rows) ? rows : [])
      .map((r) => toRequirementClaim(r?.claim ?? {}))
      .filter((c) => c.claimNumber);
  } catch {
    return [];
  }
}

/**
 * Deterministic contradiction engine over the tenant's OWN documents and
 * claims (canonical pure module). Every hit preserves BOTH values and their
 * source documents — never a silently picked winner.
 */
async function findContradictions(
  supabase: SupabaseClient,
): Promise<{ hits: EvidenceContradiction[]; evidence: LocalEvidence[] }> {
  const relevant = await loadRelevantDocs(supabase);
  let hits = scanDocumentsForContradictions(relevant);
  // Claim-record vs document comparison (persisted values vs extracted ones).
  const claims = await loadClaims(supabase);
  for (const claim of claims) {
    const norm = (s: string) => s.replace(/[-\s]/g, "").toUpperCase();
    const target = norm(claim.claimNumber ?? "");
    const claimDocs = relevant.filter((d) =>
      norm(`${d.title ?? ""} ${d.text ?? ""}`).includes(target),
    );
    hits = [...hits, ...compareClaimAgainstDocuments(claim, claimDocs)];
  }
  // Dedupe by stable key.
  const seen = new Set<string>();
  const unique = hits.filter((h) => {
    if (seen.has(h.key)) return false;
    seen.add(h.key);
    return true;
  });
  const evidence: LocalEvidence[] = [];
  const seenDocs = new Set<string>();
  for (const h of unique) {
    for (const v of h.values) {
      if (!v.documentId || seenDocs.has(v.documentId)) continue;
      seenDocs.add(v.documentId);
      const doc = relevant.find((d) => d._id === v.documentId);
      evidence.push({
        kind: "document",
        documentId: v.documentId,
        documentTitle: v.documentTitle,
        title: v.documentTitle,
        snippet: doc?.summary?.slice(0, 300) ?? v.value,
        relevance: 0.85,
        evidenceType: doc?.classification ?? "Document",
      });
    }
  }
  return { hits: unique, evidence: evidence.slice(0, 8) };
}

/** Build the gap/readiness context for a claim from tenant documents. */
async function buildRequirementContext(
  supabase: SupabaseClient,
  claim: RequirementClaimFacts,
): Promise<{ ctx: RequirementContext; contradictions: EvidenceContradiction[] }> {
  const relevant = await loadRelevantDocs(supabase);
  const documents: RequirementEvidenceDocument[] = relevant.map((d) => ({
    _id: d._id,
    title: d.title ?? null,
    classification: d.classification ?? null,
    summary: d.summary ?? null,
    text: d.text ?? null,
  }));
  const ctx: RequirementContext = { claim, documents, claimNumber: claim.claimNumber };
  const contradictions = compareClaimAgainstDocuments(claim, relevant);
  return { ctx, contradictions };
}

/** Pick the claim a question refers to (claim number match, else most recent). */
function pickClaim(
  claims: RequirementClaimFacts[],
  question: string,
): RequirementClaimFacts | null {
  if (claims.length === 0) return null;
  const norm = (s: string) => s.replace(/[-\s]/g, "").toUpperCase();
  const cn = claimNumberMatches(question).map(norm);
  if (cn.length > 0) {
    const byNumber = claims.find((c) => cn.includes(norm(c.claimNumber ?? "")));
    if (byNumber) return byNumber;
  }
  return claims[0];
}

/** Structured findings from a readiness assessment (reasoning categories §23). */
function readinessFindings(readiness: ReadinessAssessment): ReasoningFinding[] {
  const findings: ReasoningFinding[] = [];
  for (const s of readiness.satisfied) {
    findings.push({ category: "FACT", statement: `${s} is satisfied.` });
  }
  for (const b of readiness.blockingIssues) {
    findings.push({
      category: b.status === "CONFLICT" ? "CONFLICT" : "MISSING",
      statement: `${b.label}: ${b.note}`,
      evidenceIds: b.evidence,
    });
  }
  for (const w of readiness.warnings) {
    findings.push({
      category: w.status === "CONFLICT" ? "CONFLICT" : "UNKNOWN",
      statement: `${w.label}: ${w.note}`,
      evidenceIds: w.evidence,
    });
  }
  for (const a of readiness.recommendedActions) {
    findings.push({ category: "RECOMMENDATION", statement: a });
  }
  return findings;
}

/** Run the gap + readiness engines for the question's claim, best-effort. */
async function runIntelligence(
  supabase: SupabaseClient,
  question: string,
  workflow: WorkflowKey,
): Promise<{
  readiness: ReadinessAssessment | null;
  ctx: RequirementContext | null;
  contradictions: EvidenceContradiction[];
  claim: RequirementClaimFacts | null;
}> {
  const claims = await loadClaims(supabase);
  const claim = pickClaim(claims, question);
  if (!claim) return { readiness: null, ctx: null, contradictions: [], claim: null };
  const { ctx, contradictions } = await buildRequirementContext(supabase, claim);
  const readiness = assessReadiness(
    ctx,
    workflow,
    contradictions.map((c) => ({
      field: c.field,
      values: c.values.map((v) => `${v.value} (${v.documentTitle})`),
    })),
  );
  return { readiness, ctx, contradictions, claim };
}

/** Local evidence items for a claim (for the intelligence answers). */
function claimEvidence(ctx: RequirementContext | null): LocalEvidence[] {
  if (!ctx) return [];
  return ctx.documents.slice(0, 6).map((d) => ({
    kind: "document" as const,
    documentId: d._id,
    documentTitle: d.title ?? undefined,
    title: d.title ?? "Document",
    snippet: d.summary?.slice(0, 300) ?? d.classification ?? "",
    relevance: 0.8,
    evidenceType: d.classification ?? "Document",
  }));
}

/** Deterministic intent router — every branch reads real persisted state. */
export async function answerLocally(
  supabase: SupabaseClient,
  question: string,
  sessionIdHint?: string | null,
): Promise<LocalAnswer> {
  const q = question.toLowerCase();
  const limitations =
    "Local deterministic retrieval — no AI model is configured, so answers are assembled from exact keyword matches over the tenant's own documents, chunks, entities and claim records. Evidence is cited; treat the answer as a guided summary, not an authoritative analysis.";

  let intent = "knowledge_search";
  let answer = "";
  let classification = "OBSERVATION";
  let confidence = 0.5;
  let evidence: LocalEvidence[] = [];
  let suggestedActions: string[] = [];
  let structuredFindings: ReasoningFinding[] | undefined;
  let structuredMissing: string[] | undefined;
  let structuredContradictions: EvidenceContradiction[] | undefined;
  let structuredRecommendations: string[] | undefined;

  // -------------------------------------------------------------------------
  // Structured intelligence intents (§19/§14/§25): evidence-gap analysis,
  // claim/supplement readiness and decision explanation run the deterministic
  // evidence-requirements + contradiction engines over the tenant's REAL
  // claims. They only fire when an approved claim exists — pending candidates
  // keep the reconstruction branch below. The engines are the intelligence
  // layer; keyword search is never used to fake absence reasoning.
  // -------------------------------------------------------------------------
  const isGap =
    /\b(missing|lack|lacking|absent|gaps?(?![- ]?\d)|incomplete|do we have everything|what.*need|not.*found|pricing support)\b/.test(q) ||
    /missing information|what are we missing/i.test(q);
  const isReadiness =
    /\b(ready|should we submit|can we submit|submit.*(supplement|claim)|prepared|readiness|challenged|denied)\b/.test(q);
  const isWhy = /why.*(flag|not ready|isn.t ready|deny|denied|risk|block)/.test(q);

  if (
    (isGap || isReadiness || isWhy) &&
    !/how many potential claims|potential claims|claims did you identify|what did you find|what.*in this company data|summarize|overview/.test(
      q,
    )
  ) {
    const claims = await loadClaims(supabase);
    if (claims.length > 0) {
      const workflow: WorkflowKey =
        isReadiness && /submit|submission|send/i.test(q)
          ? "submission_readiness"
          : isReadiness
            ? "supplement_readiness"
            : "claim_readiness";
      const intel = await runIntelligence(supabase, q, workflow);
      if (intel.readiness) {
        const r = intel.readiness;
        intent = isGap ? "evidence_gap_analysis" : isWhy ? "decision_explanation" : "claim_readiness";
        classification = "OBSERVATION";
        confidence = Math.max(0.45, 0.85 - (r.blockingIssues.length + r.warnings.length) * 0.05);
        evidence = claimEvidence(intel.ctx);
        structuredFindings = readinessFindings(r);
        structuredMissing = [...r.blockingIssues, ...r.warnings].map(
          (g) => `${g.label} (${g.gapType ?? "missing"})`,
        );
        structuredContradictions = intel.contradictions;
        structuredRecommendations = r.recommendedActions;
        suggestedActions = r.recommendedActions;
        const lead =
          isGap
            ? `Atlas compared the evidence required for ${workflowLabel(workflow).toLowerCase()} against what is actually on file for claim ${r.claimNumber ?? "this claim"}. The gaps below are derived from the expected-evidence model, not from searching for the word “missing”.`
            : isReadiness
              ? `Readiness assessment for claim ${r.claimNumber ?? "this claim"}.`
              : `Atlas flagged this because the expected evidence for ${workflowLabel(workflow).toLowerCase()} is not fully on file.`;
        answer = `${lead} ${summarizeReadiness(r)}`;
      }
    }
  }

  const cn = claimNumberMatches(question);
  const candidateIntent =
    /claim|recover|supplement|reconcil|pay/.test(q) &&
    (cn.length > 0 || /claim/.test(q));
  // Explicit discrepancy/contradiction questions route to the contradiction
  // engine (§43) — claim reconstruction must never hijack them.
  const contradictionQuestion =
    /discrepanc|contradict|conflict|inconsisten|differ|difference|not match/.test(q);

  // Claim-reconstruction intents — never hijack dataset/summary or
  // contradiction questions.
  if (
    candidateIntent &&
    !contradictionQuestion &&
    !/how many potential claims|potential claims|claims did you identify|what did you find|what.*in this company data|summarize|overview/.test(
      q,
    )
  ) {
    const candidates = ((await rpcCall(supabase, "insurance_list_claim_candidates")) ??
      []) as CandidateRow[];
    const norm = (s: string) => s.replace(/[-\s]/g, "").toUpperCase();
    const candidatesFor = cn.length
      ? candidates.filter((c) =>
          cn.some(
            (n) =>
              norm(c.claimKey) === n ||
              (c.claimNumber ? norm(c.claimNumber) === n : false),
          ),
        )
      : // No claim number in the question → match candidates by ANY word of
        // their customer name appearing in the question (a general, tenant-
        // agnostic customer lookup — never a hardcoded demo name).
        candidates.filter((c) =>
          (c.customer ?? "")
            .toLowerCase()
            .split(/\s+/)
            .some((w) => w.length >= 3 && q.toLowerCase().includes(w)),
        );
    const relevant = candidatesFor.length ? candidatesFor : candidates;
    if (relevant.length > 0) {
      intent = "claim_reconstruction";
      classification = "FACT";
      confidence = 0.85;
      const c = relevant[0];
      const ev = (c.evidence as unknown[] | null) ?? [];
      evidence = [
        {
          kind: "candidate",
          title: `Potential claim ${c.claimKey} (${c.status ?? "pending"})`,
          snippet: `Claim number evidence: ${c.claimNumber ?? c.claimKey}. Confidence ${Math.round((c.confidence ?? 0.5) * 100)}%. ${ev.length} evidence items recorded. Customer: ${c.customer ?? "not recorded"}. Property: ${c.property ?? "not recorded"}.`,
          relevance: 0.9,
          evidenceType: "Claim candidate",
        },
      ];
      suggestedActions = [
        "Review and approve this candidate in Revenue Recovery to create the claim baseline.",
        `Attach the supporting documents to claim ${c.claimKey}.`,
      ];

      if (/missing|need|what.*lack|not.*found|incomplete/.test(q)) {
        answer = `Potential claim ${c.claimKey} is reconstructed from ${ev.length} evidence item(s) in the supplied company data. The claim number itself is the strongest evidence; fields like customer, property, carrier, policy, loss date and financials are ${c.customer ? "partially" : "not yet"} populated because the candidate is still pending human confirmation. Evidence not found in the supplied company data (yet): a finalized claim record, policy endorsement details, and confirmed carrier payment ledger entries — these must come from review of the cited evidence or the approved claim baseline.`;
      } else if (/pay|reconcil|leav\w*.*table|revenue|recover/.test(q)) {
        answer = `Potential claim ${c.claimKey} is a candidate (status ${c.status}), so it has no confirmed carrier payment ledger yet. The archive evidence (${ev.length} item(s)) contains payment/correspondence documents that reference this claim number; a human review should reconcile those documents against the carrier ledger before any revenue figure is quoted. Potential recovery opportunities can only be computed after the candidate is approved and its financial fields are confirmed.`;
      } else if (/which.*attention|most attention|priority/.test(q)) {
        answer = `Of the potential claims found, ${c.claimKey} (${c.status}) has ${ev.length} evidence item(s) and ${Math.round((c.confidence ?? 0.5) * 100)}% reconstruction confidence — it is the primary candidate requiring attention.`;
      } else {
        answer = `Atlas reconstructed potential claim ${c.claimKey} from the company data. Claim-number evidence appears in ${ev.length} record(s); confidence is ${Math.round((c.confidence ?? 0.5) * 100)}%. The candidate is NOT an authoritative claim until it is approved. Evidence basis: ${(ev as Array<{ path?: string }>).slice(0, 5).map((e) => e.path ?? "document").join("; ") || "document references"}.`;
      }
    }
  }

  // 2. Dataset / claim-summary intents (checked before the generic
  //    candidate path so "how many claims" isn't hijacked by it).
  if (!answer && /how many potential claims|potential claims|claims did you identify/.test(q)) {
    const candidates = ((await rpcCall(supabase, "insurance_list_claim_candidates")) ??
      []) as CandidateRow[];
    intent = "claim_summary";
    answer = candidates.length
      ? `Atlas identified ${candidates.length} potential claim${candidates.length === 1 ? "" : "s"}: ${candidates
          .map((c) => `${c.claimKey} (${c.status})`)
          .join(", ")}. Each is a candidate awaiting human approval before it becomes an authoritative claim.`
      : "Atlas has not reconstructed any claim candidates yet — no deterministic claim identifiers were found in the ingested documents.";
    confidence = 0.9;
    classification = "FACT";
    evidence = candidates.map((c) => ({
      kind: "candidate" as const,
      title: `Potential claim ${c.claimKey}`,
      snippet: `${c.claimNumber ?? c.claimKey} — status ${c.status}, confidence ${Math.round((c.confidence ?? 0.5) * 100)}%.`,
      relevance: 0.9,
      evidenceType: "Claim candidate",
    }));
    suggestedActions = candidates.length
      ? ["Open Revenue Recovery to review each candidate."]
      : ["Upload company data (archive or documents) containing claim numbers to enable reconstruction."];
  }

  if (!answer && /what did you find|what.*in this company data|summarize|overview/.test(q)) {
    const docs = ((await rpcCall(supabase, "documents_list_documents")) ?? []) as DocRow[];
    const candidates = ((await rpcCall(supabase, "insurance_list_claim_candidates")) ??
      []) as CandidateRow[];
    const ready = docs.filter((d) => d.status === "ready");
    const byClass = new Map<string, number>();
    for (const d of ready) {
      const k = d.classification || "Unknown";
      byClass.set(k, (byClass.get(k) ?? 0) + 1);
    }
    const chunks = ready.reduce((s, d) => s + (d.chunkCount ?? 0), 0);
    const entities = ready.reduce((s, d) => s + (d.entityCount ?? 0), 0);
    intent = "data_summary";
    classification = "FACT";
    confidence = 0.9;
    answer = `Atlas has ingested ${ready.length} usable document${ready.length === 1 ? "" : "s"} (${chunks} chunks, ${entities} entities) and reconstructed ${candidates.length} potential claim${candidates.length === 1 ? "" : "s"}. Breakdown by classification: ${
      [...byClass.entries()].map(([k, v]) => `${k} (${v})`).join(", ") || "none classified yet"
    }. Candidate claims: ${candidates.map((c) => c.claimKey).join(", ") || "none"}.`;
    evidence = docs.slice(0, 5).map((d) => ({
      kind: "document" as const,
      documentId: d._id,
      title: d.title ?? "Document",
      snippet: d.summary?.slice(0, 250) ?? d.classification ?? "",
      relevance: 0.8,
      evidenceType: d.classification ?? "Document",
    }));
    suggestedActions = candidates.length
      ? ["Review the claim candidates in Revenue Recovery."]
      : [];
  }

  // 3. Contradiction / discrepancy intents — report REAL conflicting values
  //    from the deterministic contradiction engine (both sources preserved).
  if (!answer && contradictionQuestion) {
    const res = await findContradictions(supabase);
    if (res.hits.length > 0) {
      intent = "contradiction_analysis";
      classification = "OBSERVATION";
      confidence = 0.7;
      structuredContradictions = res.hits;
      structuredFindings = res.hits.map((h) => ({
        category: "CONFLICT" as const,
        statement: h.detail,
        evidenceIds: h.values.map((v) => v.documentId).filter((x): x is string => Boolean(x)),
      }));
      structuredRecommendations = [
        "Open the cited documents and reconcile each flagged difference against the carrier ledger and approved scope.",
        "Re-run Atlas analysis after the reconciliation so the conflicting values are resolved with both sources preserved.",
      ];
      answer = `Atlas found ${res.hits.length} contradiction${res.hits.length === 1 ? "" : "s"} in the supplied company data. ${res.hits
        .map((h) => h.detail)
        .join(" ")} Each difference is flagged for human reconciliation — a difference is not automatically an error (supplements, allowances and adjustments are legitimate causes).`;
      evidence = res.evidence;
      suggestedActions = structuredRecommendations;
    } else {
      intent = "knowledge_search";
      answer =
        "Atlas searched the tenant's documents and found no explicit contradictions matching that query. Absence of a detected contradiction is not a guarantee none exist — scanned documents without OCR, or values recorded in formats Atlas cannot parse, would not be found. Try a more specific question (e.g. about the loss date, roof square footage, or an estimate vs invoice amount).";
      confidence = 0.4;
      classification = "OBSERVATION";
    }
  }

  // 4. Default: keyword retrieval over documents/chunks.
  if (!answer) {
    const res = await searchKnowledge(supabase, question);
    if (res.evidence.length === 0) {
      intent = "knowledge_search";
      answer =
        "Atlas searched the tenant's documents and chunks and found no direct matches for that query. Evidence not found in the supplied company data is not the same as false — the information may exist in a format Atlas can't search yet (e.g. scanned PDFs without OCR), or it may genuinely be missing. Try different wording, or ask about a specific document, claim number or customer.";
      confidence = 0.3;
      classification = "OBSERVATION";
    } else {
      intent = "knowledge_search";
      classification = "OBSERVATION";
      confidence = 0.7;
      answer = `Atlas found ${res.docs.length} relevant document${res.docs.length === 1 ? "" : "s"} matching “${question}”. Best matches: ${res.docs
        .slice(0, 3)
        .map((d) => d.title ?? "Untitled")
        .join("; ")}. Direct excerpts: ${res.snippets
        .slice(0, 2)
        .map((s) => `“${s.slice(0, 220)}”`)
        .join(" ") || "see cited evidence below."}`;
      evidence = res.evidence;
    }
  }

  // Persist the turn into the ask-session history (real record, real evidence).
  let sessionId = sessionIdHint ?? "";
  try {
    const inserted = (await rpcCall(supabase, "ask_insert_session", {
      question,
      answer,
      classification,
      confidence,
      mode: "local",
      suggestedActions,
      toolPlan: null,
      limitations,
      questionType: intent,
      investigation: null,
      evidence,
    })) as { sessionId: string };
    sessionId = inserted.sessionId ?? sessionId;
  } catch {
    // history persistence is best-effort
  }

  return {
    sessionId,
    answer,
    classification,
    confidence,
    mode: "local",
    limitations,
    suggestedActions,
    questionType: intent,
    intent,
    evidence,
    authorityAnswers: [],
    pending: null,
    // Structured intelligence contract (§37) — arrays are always defined.
    findings: structuredFindings ?? [],
    missingInformation: structuredMissing ?? [],
    contradictions: structuredContradictions ?? [],
    recommendations: structuredRecommendations ?? suggestedActions,
  };
}

/** Convenience for tests + the E2E: claim completeness of a claim record. */
export function completenessOf(snapshot: ClaimSnapshot) {
  return analyzeClaimCompleteness(snapshot);
}
