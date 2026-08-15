// ---------------------------------------------------------------------------
// Atlas Gemini reasoning layer — Deno-free, unit-testable core.
//
// DEPLOYMENT CONTRACT: this file lives INSIDE the conversation-converse
// function package directory so the Freebuff bundler ships it with the
// function. It contains NO Deno imports and NO repository imports, so the
// project's vitest suite can exercise it directly (see
// src/lib/ask/gemini.test.ts).
//
// Responsibilities:
//   - read the Gemini configuration from environment-shaped input
//   - build the centralized Atlas system prompt
//   - construct the generateContent request body
//   - call the Gemini REST API with timeout + error classification
//   - parse the model's JSON output and validate it against the Atlas
//     structured-answer schema
//   - resolve the model's cited evidence IDs against the REAL evidence that
//     was retrieved (hallucinated IDs are dropped, never returned)
//   - derive confidence from retrieval quality instead of trusting the
//     model's own number
//
// The Gemini API key NEVER leaves the server boundary: it is read from the
// function's environment and used only in the Authorization header of the
// server-to-server request. Nothing here is ever exposed to the browser.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Free-tier Gemini models appropriate for fast conversational reasoning. */
export const GEMINI_FREE_MODELS = [
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-2.5-flash",
];

/**
 * Default model. Selected because the Gemini Developer API pricing page
 * lists Gemini 3.6 Flash on the Free Tier ("Free of charge" input/output)
 * with no credit-card requirement, and it is explicitly described as built
 * for fast, conversational reasoning. Configurable via GEMINI_MODEL; the
 * function falls back to deterministic retrieval if the configured model is
 * unavailable on the account.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";

export interface GeminiConfig {
  /** "gemini" when a key is configured, otherwise the provider is off. */
  provider: "gemini" | "none";
  apiKey: string;
  model: string;
  /** Max tokens Gemini may emit for one answer. */
  maxOutputTokens: number;
  /** Total request timeout in ms (includes the Gemini round trip). */
  timeoutMs: number;
  /** Max retrieved evidence items included in the prompt. */
  maxEvidenceItems: number;
  /** Max characters per evidence snippet. */
  maxSnippetChars: number;
  /** Max conversation-history turns (user+assistant pairs) sent to Gemini. */
  maxHistoryTurns: number;
}

export const DEFAULT_GEMINI_CONFIG: Omit<GeminiConfig, "provider" | "apiKey" | "model"> = {
  maxOutputTokens: 600,
  timeoutMs: 20_000,
  maxEvidenceItems: 8,
  maxSnippetChars: 900,
  maxHistoryTurns: 4,
};

/**
 * Build the Gemini config from an environment-shaped object (the deployed
 * function passes Deno.env.toObject(); tests pass plain objects). Never
 * returns a key — only the boolean `configured` flag travels onward.
 */
export function configFromEnv(
  env: Record<string, string | undefined>,
): { config: GeminiConfig | null; configured: boolean; reason?: string } {
  const provider = (env.AI_PROVIDER ?? "").trim().toLowerCase();
  const apiKey = (env.GEMINI_API_KEY ?? "").trim();
  const model = (env.GEMINI_MODEL ?? "").trim() || DEFAULT_GEMINI_MODEL;

  if (provider && provider !== "gemini") {
    return {
      config: null,
      configured: false,
      reason: `AI_PROVIDER="${provider}" is not supported (only "gemini" is). Using deterministic retrieval.`,
    };
  }
  if (!apiKey) {
    return {
      config: null,
      configured: false,
      reason:
        "GEMINI_API_KEY is not configured — Atlas answers from evidence retrieval until it is added as an Edge Function secret.",
    };
  }

  const int = (v: string | undefined, fallback: number): number => {
    const n = Number.parseInt((v ?? "").trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  return {
    configured: true,
    config: {
      provider: "gemini",
      apiKey,
      model,
      maxOutputTokens: int(env.GEMINI_MAX_OUTPUT_TOKENS, DEFAULT_GEMINI_CONFIG.maxOutputTokens),
      timeoutMs: int(env.GEMINI_TIMEOUT_MS, DEFAULT_GEMINI_CONFIG.timeoutMs),
      maxEvidenceItems: int(env.ATLAS_MAX_EVIDENCE, DEFAULT_GEMINI_CONFIG.maxEvidenceItems),
      maxSnippetChars: int(env.ATLAS_MAX_SNIPPET_CHARS, DEFAULT_GEMINI_CONFIG.maxSnippetChars),
      maxHistoryTurns: int(env.ATLAS_MAX_HISTORY_TURNS, DEFAULT_GEMINI_CONFIG.maxHistoryTurns),
    },
  };
}

// ---------------------------------------------------------------------------
// System prompt (the single source of truth for Atlas's reasoning behavior)
// ---------------------------------------------------------------------------

export const ATLAS_SYSTEM_PROMPT = `You are Atlas, an AI operating system for restoration companies.

You help restoration operators understand their company's claims, documents,
revenue recovery opportunities, workflows, evidence, and operational
information.

You are evidence-first. You must distinguish between:
1. verified facts — directly supported by the retrieved evidence;
2. reasonable interpretation — clearly labelled as interpretation; and
3. missing information — stated as missing.

Never fabricate evidence. Never invent claim numbers, payment amounts,
insurance carrier decisions, dates, policy information, customer information,
document contents, recommendations, or financial figures. If the evidence
does not support an answer, say so explicitly — for example:
"I couldn't verify that from the documents currently available to me."

When evidence conflicts, explicitly identify the contradiction and name the
documents on each side. When evidence is incomplete, say so instead of
guessing. When recommending an action, explain the evidence supporting the
recommendation, and structure it as:
  FACT        — what the evidence says
  REASONING   — why it matters
  RECOMMENDATION — what the operator could do
You never execute actions yourself; you only recommend them for a human to
approve.

Reasoning about restoration work: scope and estimate documents (estimates,
Xactimate, invoices, payments, supplements, FNOL reports, inspection reports,
correspondence, policy documents) carry the financial facts. A difference
between two documents is a flag for human reconciliation, not proof of an
error — supplements, allowances, and adjustments are legitimate causes.

Citations: cite ONLY evidence IDs from the <evidence> list provided in the
user turn. Never invent an evidence ID. If you cannot support a statement
with a provided ID, do not make the statement.

Voice: also produce "spoken", a short, natural, speech-optimized version of
the answer (2-4 sentences, no document filenames unless essential, no
markdown).`;

// ---------------------------------------------------------------------------
// Structured answer schema
// ---------------------------------------------------------------------------

export interface AtlasStructuredAnswer {
  /** The full answer for the UI. */
  answer: string;
  /** Intent label, e.g. "claim_reconstruction", "contradiction_report". */
  intent?: string;
  /** Evidence IDs cited by the model — must match provided evidence ids. */
  evidenceIds: string[];
  /** Suggested next actions for the operator (never executed automatically). */
  recommendations: string[];
  /** Honest limitations of the answer. */
  limitations: string[];
  /** Suggested follow-up questions. */
  followUpQuestions: string[];
  /** Speech-optimized answer (optional; falls back to `answer`). */
  spoken?: string;
}

export interface ValidationResult {
  ok: boolean;
  answer?: AtlasStructuredAnswer;
  reason?: string;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 8);
}

/**
 * Validate a parsed model response against the Atlas structured-answer
 * schema. Strict about the fields the frontend and citation resolver depend
 * on; lenient about optional cosmetics.
 */
export function validateStructuredAnswer(obj: unknown): ValidationResult {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return { ok: false, reason: "model response is not a JSON object" };
  }
  const o = obj as Record<string, unknown>;
  const answer = typeof o.answer === "string" ? o.answer.trim() : "";
  if (!answer) {
    return { ok: false, reason: "missing non-empty answer string" };
  }
  const intent = typeof o.intent === "string" && o.intent.trim() ? o.intent.trim() : undefined;
  const spoken =
    typeof o.spoken === "string" && o.spoken.trim() ? o.spoken.trim() : undefined;
  return {
    ok: true,
    answer: {
      answer,
      intent,
      evidenceIds: asStringArray(o.evidenceIds),
      recommendations: asStringArray(o.recommendations),
      limitations: asStringArray(o.limitations),
      followUpQuestions: asStringArray(o.followUpQuestions),
      spoken,
    },
  };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Strip markdown fences / surrounding noise and parse JSON. */
export function extractJsonObject(text: string): unknown {
  let t = (text ?? "").trim();
  // Strip ```json ... ``` fences.
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) t = fence[1].trim();
  // Some models wrap the object in prose — take the first {...} block.
  if (!t.startsWith("{")) {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start !== -1 && end > start) t = t.slice(start, end + 1);
  }
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Evidence context + citation resolution
// ---------------------------------------------------------------------------

/** A normalized retrieval-evidence item the model may cite. */
export interface EvidenceContextItem {
  /** Stable id handed to the model: chunk:<id> | doc:<id> | candidate:<key> | finding:<id> */
  evidenceId: string;
  kind: string;
  title: string;
  snippet: string;
}

/**
 * The stable id used to hand a retrieval-evidence item to the model AND to
 * resolve its citations back to the original record. Must stay in sync with
 * buildEvidenceContext below.
 */
export function evidenceContextId(e: Record<string, unknown>): string | null {
  const kind = String(e.kind ?? "document");
  if (kind === "chunk" && typeof e.chunkId === "string" && e.chunkId) {
    return `chunk:${e.chunkId}`;
  }
  if (kind === "candidate") {
    const key =
      (typeof e.claimKey === "string" && e.claimKey) ||
      String(e.title ?? "").match(/([A-Z]{2,6}[- ]?\d{1,4}[- ]?\d{4,12})/i)?.[1] ||
      "";
    if (key) return `candidate:${key}`;
  }
  if (typeof e.documentId === "string" && e.documentId) {
    return `doc:${e.documentId}`;
  }
  if (typeof e.entityId === "string" && e.entityId) {
    return `entity:${e.entityId}`;
  }
  return null;
}

/**
 * Build the bounded evidence context for the prompt from the deterministic
 * retrieval output (the source of truth). The model may ONLY cite these ids.
 */
export function buildEvidenceContext(
  evidence: Array<Record<string, unknown>>,
  config: Pick<GeminiConfig, "maxEvidenceItems" | "maxSnippetChars">,
): { items: EvidenceContextItem[]; byId: Map<string, EvidenceContextItem> } {
  const items: EvidenceContextItem[] = [];
  for (const e of evidence.slice(0, config.maxEvidenceItems)) {
    const kind = String(e.kind ?? "document");
    const evidenceId = evidenceContextId(e);
    if (!evidenceId) continue;
    const title = String(e.documentTitle ?? e.title ?? e.evidenceType ?? kind).slice(0, 120);
    const snippet = String(e.snippet ?? e.evidenceType ?? "").slice(
      0,
      config.maxSnippetChars,
    );
    items.push({ evidenceId, kind, title, snippet });
  }
  return { items, byId: new Map(items.map((i) => [i.evidenceId, i])) };
}

/**
 * Keep only the evidence IDs the model cited that actually exist in the
 * retrieved evidence. Hallucinated ids are dropped (never surfaced to the
 * frontend as citations).
 */
export function resolveEvidenceIds(
  cited: string[] | undefined,
  byId: Map<string, EvidenceContextItem>,
): { kept: string[]; dropped: number } {
  if (!Array.isArray(cited) || cited.length === 0) return { kept: [], dropped: 0 };
  const seen = new Set<string>();
  const kept: string[] = [];
  let dropped = 0;
  for (const raw of cited) {
    const id = typeof raw === "string" ? raw.trim() : "";
    if (!id) continue;
    if (byId.has(id) && !seen.has(id)) {
      seen.add(id);
      kept.push(id);
    } else {
      dropped++;
    }
  }
  return { kept: kept.slice(0, 8), dropped };
}

/**
 * Derive confidence from retrieval quality rather than the model's number:
 *   high    — several independent evidence items, no contradictions
 *   medium  — some evidence, or contradictions present
 *   low     — weak or no evidence
 * The model's own confidence only nudges the result by ±0.05.
 */
export function deriveConfidence(
  evidenceCount: number,
  contradictionCount: number,
  modelConfidence?: number,
): number {
  let conf: number;
  if (evidenceCount === 0) {
    conf = 0.3;
  } else if (evidenceCount >= 3 && contradictionCount === 0) {
    conf = Math.min(0.9, 0.55 + evidenceCount * 0.08);
  } else if (contradictionCount > 0) {
    // Contradictions reduce confidence — the answer flags a conflict, so it
    // is an observation, not a settled fact.
    conf = 0.45;
  } else {
    conf = 0.62;
  }
  if (typeof modelConfidence === "number" && Number.isFinite(modelConfidence)) {
    conf += (Math.min(1, Math.max(0, modelConfidence)) - 0.5) * 0.1;
  }
  return Math.min(0.95, Math.max(0.2, Math.round(conf * 100) / 100));
}

// ---------------------------------------------------------------------------
// Gemini REST call
// ---------------------------------------------------------------------------

export type GeminiFailureCode =
  | "network"
  | "timeout"
  | "auth"
  | "rate_limited"
  | "model_unavailable"
  | "server"
  | "malformed";

export type GeminiCallResult =
  | { ok: true; text: string; latencyMs: number }
  | { ok: false; code: GeminiFailureCode; status?: number; message: string; latencyMs: number };

export interface GeminiRequestBody {
  contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>;
  systemInstruction: { parts: Array<{ text: string }> };
  generationConfig: {
    responseMimeType: "application/json";
    temperature: number;
    topP: number;
    maxOutputTokens: number;
  };
}

/** Build the generateContent request body for a question + evidence context. */
export function buildGeminiRequestBody(
  config: Pick<GeminiConfig, "maxOutputTokens">,
  systemPrompt: string,
  question: string,
  history: Array<{ role: "user" | "model"; text: string }>,
  evidenceItems: EvidenceContextItem[],
): GeminiRequestBody {
  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [
    // Bounded recent conversation (short-term memory).
    ...history.map((h) => ({
      role: h.role,
      parts: [{ text: h.text }],
    })),
    // The current turn: evidence context + question.
    {
      role: "user",
      parts: [
        {
          text:
            `<evidence>\n${
              evidenceItems.length
                ? evidenceItems
                    .map(
                      (e, i) =>
                        `[E${i + 1}] id=${e.evidenceId} kind=${e.kind} source=${e.title}\n${e.snippet}`,
                    )
                    .join("\n\n")
                : "(no evidence was retrieved for this question)"
            }\n</evidence>\n\nQuestion: ${question}\n\nRespond ONLY with a JSON object of the form {\"answer\": string, \"intent\": string, \"evidenceIds\": string[], \"recommendations\": string[], \"limitations\": string[], \"followUpQuestions\": string[], \"spoken\": string}. Cite ONLY evidence ids from the <evidence> list. If no evidence supports the question, answer honestly that Atlas could not verify it from the documents available.`,
        },
      ],
    },
  ];

  return {
    contents,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: config.maxOutputTokens,
    },
  };
}

/**
 * Call the Gemini generateContent REST API with a hard timeout. Classifies
 * failures (auth / rate limit / model unavailable / server / timeout /
 * network / malformed) so the caller can report honest diagnostics and fall
 * back to deterministic retrieval.
 *
 * `fetchImpl` is injectable for tests; it defaults to globalThis.fetch.
 */
export async function callGemini(
  config: Pick<GeminiConfig, "apiKey" | "model" | "timeoutMs">,
  body: GeminiRequestBody,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<GeminiCallResult> {
  const t0 = Date.now();
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(config.model)}:generateContent`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": config.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      return {
        ok: false,
        code: aborted ? "timeout" : "network",
        message: aborted
          ? `Gemini request timed out after ${config.timeoutMs}ms`
          : `Gemini request failed: ${e instanceof Error ? e.message : String(e)}`,
        latencyMs: Date.now() - t0,
      };
    }

    const latencyMs = Date.now() - t0;
    const raw = await res.text().catch(() => "");
    if (!res.ok) {
      const status = res.status;
      let code: GeminiFailureCode = "server";
      let message = `Gemini API error (HTTP ${status})`;
      if (status === 400 || status === 404) {
        code = status === 404 ? "model_unavailable" : "malformed";
        message = `Gemini rejected the request (HTTP ${status}) — the configured model "${config.model}" may be unavailable on this account.`;
      } else if (status === 401 || status === 403) {
        code = "auth";
        message = "Gemini authentication failed (HTTP 401/403) — check GEMINI_API_KEY.";
      } else if (status === 429) {
        code = "rate_limited";
        message = "Gemini rate limit exceeded (HTTP 429) — using evidence retrieval for this answer.";
      }
      const detail = raw.slice(0, 300).replace(/\s+/g, " ").trim();
      if (detail) message += ` — ${detail}`;
      return { ok: false, code, status, message, latencyMs };
    }

    let payload: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    try {
      payload = JSON.parse(raw || "{}") as typeof payload;
    } catch {
      return {
        ok: false,
        code: "malformed",
        message: "Gemini returned a non-JSON response body.",
        latencyMs: Date.now() - t0,
      };
    }
    const text = payload.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("\n")
      .trim();
    if (!text) {
      return {
        ok: false,
        code: "malformed",
        message: "Gemini returned an empty response (possible safety block).",
        latencyMs: Date.now() - t0,
      };
    }
    return { ok: true, text, latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Conversation memory helpers
// ---------------------------------------------------------------------------

/** Normalize stored conversationSessions.messages into Gemini contents. */
export function normalizeHistory(raw: unknown, maxTurns: number): Array<{ role: "user" | "model"; text: string }> {
  if (!Array.isArray(raw)) return [];
  const turns: Array<{ role: "user" | "model"; text: string }> = [];
  for (const item of raw) {
    if (typeof item === "string") {
      turns.push({ role: "user", text: item.slice(0, 4000) });
      continue;
    }
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const role = o.role === "model" || o.role === "assistant" ? "model" : o.role === "user" ? "user" : null;
    if (!role) continue;
    let text = "";
    if (Array.isArray(o.parts)) {
      text = o.parts
        .map((p) => (typeof p === "object" && p !== null && typeof (p as Record<string, unknown>).text === "string" ? ((p as Record<string, unknown>).text as string) : ""))
        .join("\n")
        .trim();
    } else if (typeof o.text === "string") {
      text = o.text.trim();
    }
    if (!text) continue;
    turns.push({ role, text: text.slice(0, 4000) });
    if (turns.length >= maxTurns * 2) break;
  }
  return turns.slice(-maxTurns * 2);
}

/** Append the latest turn and keep the history bounded. */
export function appendHistory(
  history: Array<{ role: "user" | "model"; text: string }>,
  question: string,
  answer: string,
  maxTurns: number,
): Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> {
  const next = [
    ...history,
    { role: "user" as const, text: question.slice(0, 4000) },
    { role: "model" as const, text: answer.slice(0, 4000) },
  ];
  const bounded = next.slice(-maxTurns * 2);
  return bounded.map((h) => ({ role: h.role, parts: [{ text: h.text }] }));
}
