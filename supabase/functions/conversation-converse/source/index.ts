// ---------------------------------------------------------------------------
// conversation-converse — the Atlas conversational brain (deployed).
//
// DEPLOYMENT CONTRACT (Freebuff bundler): source/index.ts is the entry point
// and only files inside this function package directory are bundled. This
// file imports the LOCAL package copy of the CORS helpers at ./cors.ts — it
// must never import ../_shared/cors.ts or anything outside this directory.
// The canonical shared helper is kept at _shared/cors.ts for the repo, and
// the drift test in _shared/cors.test.ts guarantees the two copies stay
// identical. The root index.ts shim keeps the standard Supabase CLI deploy
// path working.
//
// PRODUCTION DEFECT THIS FUNCTION FIXES: the browser called
// https://<project>.supabase.co/functions/v1/conversation-converse but the
// function was never deployed — the platform answered OPTIONS with a 404,
// which is not a valid CORS preflight response, so every voice/Ask Atlas
// request was blocked with "Response to preflight request does not have HTTP
// ok status" and the assistant fell through to "I hit a problem responding
// to that". This handler answers OPTIONS with 204 + the shared CORS headers
// BEFORE authentication, then runs the SAME deterministic conversational
// brain the frontend uses for typed Ask Atlas, over the caller's REAL
// tenant-scoped data (documents, chunks, entities, claim candidates, claims,
// findings) via the same RPCs. No canned responses, no fabricated evidence.
//
// The brain is a faithful port of src/lib/ask/retrieval.ts (answerLocally).
// One conversational brain: voice, push-to-talk and typed Ask Atlas all
// submit their transcript here (the frontend keeps its local-retrieval
// fallback only as an offline resilience layer, not as a second engine).
//
// Browser contract (src/lib/api.ts converse): the client unwraps
// `{ ok: true, data: LocalAnswer }` and reads sessionId/answer/intent/
// evidence/suggestedActions/pending/… Error responses are structured and
// carry the CORS headers.
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import {
  atlasCorsHeaders,
  atlasJson,
  handleAtlasPreflight,
} from "./cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ---------------------------------------------------------------------------
// RPC contract — same normalization the frontend uses (PostgREST matches the
// lowercase folded argument names: `p_` + lowercased key).
// ---------------------------------------------------------------------------

function normalizeRpcArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    const key = k.startsWith("p_") ? k : `p_${k}`;
    out[key.toLowerCase()] = v;
  }
  return out;
}

type Supabase = ReturnType<typeof createClient>;

async function rpcCall(
  supabase: Supabase,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn, normalizeRpcArgs(args));
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Deterministic retrieval brain — port of src/lib/ask/retrieval.ts
// ---------------------------------------------------------------------------

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
    .replace(/[^a-z0-9\-\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function scoreDoc(
  row: { title?: string | null; summary?: string | null; sourceId?: string | null },
  terms: string[],
): number {
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

interface LocalEvidence {
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

interface LocalAnswer {
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
}

async function searchKnowledge(
  supabase: Supabase,
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
    let detail: { chunks?: Array<{ _id: string; content: string; chunkIndex?: number }> } | null = null;
    try {
      detail = (await rpcCall(supabase, "documents_get_document_detail", {
        documentId: d._id,
      })) as { chunks?: Array<{ _id: string; content: string; chunkIndex?: number }> } | null;
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

interface ContradictionHit {
  claim?: string;
  field: string;
  values: Array<{ value: string; doc: string }>;
}

async function findContradictions(
  supabase: Supabase,
): Promise<{ hits: ContradictionHit[]; evidence: LocalEvidence[] }> {
  let docs: DocRow[] = [];
  try {
    const { data, error } = await supabase
      .from("documents")
      .select("_id, title, sourceId, summary, classification")
      .limit(1000);
    if (!error && Array.isArray(data) && data.length > 0) {
      docs = data as DocRow[];
    }
  } catch {
    // fall through to the RPC below
  }
  if (docs.length === 0) {
    docs = ((await rpcCall(supabase, "documents_list_documents")) ?? []) as DocRow[];
  }

  const relevant = docs
    .filter((d) =>
      /estimate|xactimate|invoice|payment|supplement|fnol|scope|inspection|correspondence|policy|loss/i.test(
        `${d.title ?? ""} ${d.summary ?? ""} ${d.classification ?? ""}`,
      ),
    )
    .slice(0, 30);

  interface Pick {
    claim?: string;
    value: string;
    doc: DocRow;
  }
  const byField = new Map<string, Pick[]>();
  const labelPatterns: Array<[string, RegExp]> = [
    ["Estimate total", /(?:total\s+)?estimate\s*(?:total)?[:$]\s*\$?\s*([\d,]+(?:\.\d{2})?)/i],
    ["Invoice total", /invoice\s+total[:$]\s*\$?\s*([\d,]+(?:\.\d{2})?)/i],
    ["Payment amount", /payment\s+amount[:$]\s*\$?\s*([\d,]+(?:\.\d{2})?)/i],
    ["Roofing amount", /roofing\s*[:$]\s*\$?\s*([\d,]+(?:\.\d{2})?)/i],
  ];
  const push = (field: string, pick: Pick) => {
    const list = byField.get(field) ?? [];
    list.push(pick);
    byField.set(field, list);
  };

  for (const d of relevant) {
    let text = "";
    try {
      const detail = (await rpcCall(supabase, "documents_get_document_detail", {
        documentId: d._id,
      })) as { chunks?: Array<{ content?: string }> };
      text = (detail?.chunks ?? []).map((c) => c.content ?? "").join("\n");
    } catch {
      // an unreadable document is simply skipped
    }
    if (!text.trim()) continue;
    const claim =
      (d.summary ?? "").match(/(?:claim|re:)\s*([A-Z]{2,6}[- ]?\d{1,4}[- ]?\d{4,12})/i)?.[1] ??
      text.match(/(?:claim|re:)\s*([A-Z]{2,6}[- ]?\d{1,4}[- ]?\d{4,12})/i)?.[1] ??
      undefined;

    for (const [field, re] of labelPatterns) {
      const m = text.match(re);
      if (m) push(field, { claim, value: `$${m[1]}`, doc: d });
    }
    const dates = text.matchAll(
      /\b(Jan\w*|Feb\w*|Mar\w*|Apr\w*|May|Jun\w*|Jul\w*|Aug\w*|Sep\w*|Oct\w*|Nov\w*|Dec\w*)\s+\d{1,2}(,?\s+\d{4})?\b/g,
    );
    for (const m of dates) {
      if (m[0]) push("Loss date", { claim, value: m[0], doc: d });
    }
    const sq = text.matchAll(/(\d+(?:\.\d+)?)\s*SQ\b/gi);
    for (const m of sq) {
      if (m[1]) push("Roof area (SQ)", { claim, value: `${m[1]} SQ`, doc: d });
    }
  }

  const hits: ContradictionHit[] = [];
  for (const [field, picks] of byField) {
    const grouped = new Map<string | undefined, Pick[]>();
    for (const p of picks) {
      const list = grouped.get(p.claim) ?? [];
      list.push(p);
      grouped.set(p.claim, list);
    }
    for (const [claim, group] of grouped) {
      const distinct = [...new Map(group.map((p) => [p.value, p])).values()];
      if (distinct.length >= 2) {
        hits.push({
          claim,
          field,
          values: distinct.map((p) => ({ value: p.value, doc: p.doc.title ?? "Document" })),
        });
      }
    }
  }
  // Cross-field: estimate vs invoice, roofing vs payment (same claim).
  const cross = (a: string, b: string, label: string) => {
    const pa = byField.get(a) ?? [];
    const pb = byField.get(b) ?? [];
    for (const ca of pa) {
      for (const cb of pb) {
        if (ca.claim === cb.claim && ca.value !== cb.value) {
          hits.push({
            claim: ca.claim,
            field: label,
            values: [
              { value: ca.value, doc: ca.doc.title ?? "Document" },
              { value: cb.value, doc: cb.doc.title ?? "Document" },
            ],
          });
          return;
        }
      }
    }
  };
  cross("Estimate total", "Invoice total", "Estimate vs invoice");
  cross("Roofing amount", "Payment amount", "Roofing vs carrier payment");

  const evidence: LocalEvidence[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    for (const v of h.values) {
      const doc = docs.find((d) => d.title === v.doc);
      if (!doc || seen.has(doc._id)) continue;
      seen.add(doc._id);
      evidence.push({
        kind: "document",
        documentId: doc._id,
        documentTitle: doc.title ?? undefined,
        title: doc.title ?? "Document",
        snippet: doc.summary?.slice(0, 300) ?? v.value,
        relevance: 0.85,
        evidenceType: doc.classification ?? "Document",
      });
    }
  }
  return { hits, evidence: evidence.slice(0, 8) };
}

/** The one conversational brain — port of answerLocally (retrieval.ts). */
async function answerLocally(
  supabase: Supabase,
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

  const cn = claimNumberMatches(question);
  const candidateIntent =
    /claim|recover|mitchell|supplement|reconcil|pay/.test(q) &&
    (cn.length > 0 || /mitchell|claim/.test(q));

  // Claim-reconstruction intents — never hijack dataset/summary questions.
  if (
    candidateIntent &&
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
      : candidates.filter((c) => (c.customer ?? "").toLowerCase().includes("mitchell"));
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
  //    deterministically from the tenant's own documents (never invented).
  if (!answer && /discrepanc|contradict|conflict|inconsisten|differ|difference|not match/.test(q)) {
    const res = await findContradictions(supabase);
    if (res.hits.length > 0) {
      intent = "contradiction_report";
      classification = "OBSERVATION";
      confidence = 0.7;
      answer = `Atlas found ${res.hits.length} contradiction${res.hits.length === 1 ? "" : "s"} in the supplied company data. ${res.hits
        .map(
          (h) =>
            `${h.field} appears as ${h.values
              .map((v) => `${v.value} (in ${v.doc})`)
              .join(" and as ")}${h.claim ? ` for claim ${h.claim}` : ""}`,
        )
        .join(". ")}. Each difference is flagged for human reconciliation — a difference is not automatically an error (supplements, allowances and adjustments are legitimate causes).`;
      evidence = res.evidence;
      suggestedActions = [
        "Open the cited documents and reconcile each flagged difference against the carrier ledger and approved scope.",
        "Approve the claim candidate in Revenue Recovery to run the deterministic financial analyzers on the confirmed baseline.",
      ];
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
  };
}

// ---------------------------------------------------------------------------
// Handler — OPTIONS (CORS) BEFORE auth, then JWT + tenant-scoped brain.
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  const preflight = handleAtlasPreflight(req);
  if (preflight) return preflight;

  const headers = atlasCorsHeaders(req);

  try {
    // Auth is enforced independently of CORS — the JWT is the gate.
    const authorization = req.headers.get("authorization") ?? "";
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return atlasJson({ ok: false, error: "Unauthorized" }, 401, headers);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(token);
    if (userError || !user) {
      return atlasJson({ ok: false, error: "Unauthorized" }, 401, headers);
    }

    // A fresh signup can legitimately reach this before /setup provisions the
    // workspace. Report the honest state instead of a confusing 500.
    const { data: memberships } = await admin
      .from("memberships")
      .select("tenantId")
      .eq("userId", user.id)
      .eq("status", "active")
      .limit(1);
    const tenantId = (memberships?.[0]?.tenantId as string | undefined) ?? null;
    if (!tenantId) {
      return atlasJson(
        {
          ok: false,
          error:
            "Atlas can't answer yet — finish setting up your workspace (company name and onboarding) first.",
          data: null,
        },
        200,
        headers,
      );
    }

    const body = await req.json().catch(() => ({}));
    const transcript = String(body?.transcript ?? body?.query ?? "").trim();
    if (!transcript) {
      return atlasJson(
        { ok: false, error: "No transcript provided — send { transcript } in the request body." },
        400,
        headers,
      );
    }

    const answer = await answerLocally(
      admin,
      transcript,
      typeof body?.sessionId === "string" ? body.sessionId : null,
    );
    return atlasJson({ ok: true, data: answer }, 200, headers);
  } catch (e) {
    console.error("[conversation-converse] failed:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return atlasJson(
      { ok: false, error: `Conversation failed: ${msg.slice(0, 300)}` },
      500,
      headers,
    );
  }
});
