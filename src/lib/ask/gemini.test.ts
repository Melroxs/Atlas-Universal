// ---------------------------------------------------------------------------
// Atlas Gemini reasoning core — unit tests.
//
// Tests the Deno-free module that the deployed conversation-converse Edge
// Function uses (supabase/functions/conversation-converse/source/gemini.ts).
// It never touches the network except through an injected fetch, never holds
// a real API key, and proves the fallback/validation/citation behavior that
// keeps Ask Atlas and Atlas Voice honest when the model misbehaves.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  ATLAS_SYSTEM_PROMPT,
  appendHistory,
  buildEvidenceContext,
  buildGeminiRequestBody,
  callGemini,
  configFromEnv,
  DEFAULT_GEMINI_MODEL,
  deriveConfidence,
  evidenceContextId,
  extractJsonObject,
  GEMINI_FREE_MODELS,
  normalizeHistory,
  resolveEvidenceIds,
  validateStructuredAnswer,
  type GeminiCallResult,
} from "../../../supabase/functions/conversation-converse/source/gemini.ts";

// ---------------------------------------------------------------------------
// Fake fetch helpers
// ---------------------------------------------------------------------------

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function geminiOk(text: string): Response {
  return jsonResponse(200, { candidates: [{ content: { parts: [{ text }] } }] });
}

async function callWith(
  fetchImpl: typeof fetch,
): Promise<GeminiCallResult> {
  return callGemini(
    { apiKey: "test-key", model: DEFAULT_GEMINI_MODEL, timeoutMs: 2000 },
    {
      contents: [],
      systemInstruction: { parts: [{ text: "sys" }] },
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
        topP: 0.9,
        maxOutputTokens: 200,
      },
    },
    fetchImpl,
  );
}

const VALID_ENV = {
  AI_PROVIDER: "gemini",
  GEMINI_API_KEY: "AIza-test",
  GEMINI_MODEL: "",
};

// ---------------------------------------------------------------------------
// 1. Provider configuration
// ---------------------------------------------------------------------------

describe("configFromEnv", () => {
  it("is configured with a gemini provider and API key", () => {
    const { configured, config } = configFromEnv(VALID_ENV);
    expect(configured).toBe(true);
    expect(config?.provider).toBe("gemini");
    expect(config?.apiKey).toBe("AIza-test");
  });

  it("defaults the model to the current free-tier conversational model", () => {
    const { config } = configFromEnv(VALID_ENV);
    expect(config?.model).toBe(DEFAULT_GEMINI_MODEL);
    expect(GEMINI_FREE_MODELS).toContain(DEFAULT_GEMINI_MODEL);
  });

  it("honors an explicit GEMINI_MODEL override", () => {
    const { config } = configFromEnv({ ...VALID_ENV, GEMINI_MODEL: "gemini-3.7-flash" });
    expect(config?.model).toBe("gemini-3.7-flash");
  });

  it("rejects an unsupported provider (deterministic fallback)", () => {
    const { configured, reason } = configFromEnv({
      AI_PROVIDER: "openai",
      GEMINI_API_KEY: "sk-test",
    });
    expect(configured).toBe(false);
    expect(reason).toMatch(/not supported/);
  });

  it("is NOT configured when the API key is missing (never fabricates)", () => {
    const { configured, reason } = configFromEnv({ AI_PROVIDER: "gemini" });
    expect(configured).toBe(false);
    expect(reason).toMatch(/GEMINI_API_KEY is not configured/);
  });
});

// ---------------------------------------------------------------------------
// 2. API success + error classification
// ---------------------------------------------------------------------------

describe("callGemini", () => {
  it("returns the model text on success", async () => {
    const res = await callWith((async () => geminiOk('{"answer":"ok"}')) as typeof fetch);
    expect(res.ok).toBe(true);
    if (res.ok) expect(JSON.parse(res.text).answer).toBe("ok");
  });

  it("classifies HTTP 429 as rate_limited", async () => {
    const res = await callWith((async () =>
      jsonResponse(429, { error: { message: "quota" } })) as typeof fetch);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("rate_limited");
  });

  it("classifies HTTP 500 as server", async () => {
    const res = await callWith((async () => jsonResponse(500, {})) as typeof fetch);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("server");
  });

  it("classifies HTTP 401 as auth (bad key, never leaked)", async () => {
    const res = await callWith((async () => jsonResponse(401, {})) as typeof fetch);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("auth");
      expect(res.message).not.toContain("test-key");
    }
  });

  it("classifies a 404 model as model_unavailable", async () => {
    const res = await callWith((async () => jsonResponse(404, {})) as typeof fetch);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("model_unavailable");
  });

  it("times out instead of hanging forever", async () => {
    // A fetch that never settles unless the AbortSignal fires — mirrors a
    // hung upstream so the timeout path is what actually triggers.
    const never = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted", "AbortError")),
        );
      })) as unknown as typeof fetch;
    const res = await callGemini(
      { apiKey: "k", model: DEFAULT_GEMINI_MODEL, timeoutMs: 50 },
      {
        contents: [],
        systemInstruction: { parts: [{ text: "" }] },
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
          topP: 0.9,
          maxOutputTokens: 100,
        },
      },
      never,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("timeout");
  });

  it("classifies a network failure as network", async () => {
    const fail = (() => Promise.reject(new Error("ECONNRESET"))) as unknown as typeof fetch;
    const res = await callGemini(
      { apiKey: "k", model: DEFAULT_GEMINI_MODEL, timeoutMs: 500 },
      {
        contents: [],
        systemInstruction: { parts: [{ text: "" }] },
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
          topP: 0.9,
          maxOutputTokens: 100,
        },
      },
      fail,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("network");
  });

  it("classifies a non-JSON 200 body as malformed", async () => {
    const res = await callWith(
      (async () => new Response("<html>", { status: 200 })) as typeof fetch,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("malformed");
  });

  it("classifies an empty candidate text (safety block) as malformed", async () => {
    const res = await callWith((async () => geminiOk("   ")) as typeof fetch);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("malformed");
  });
});

// ---------------------------------------------------------------------------
// 3. Structured output parsing + validation
// ---------------------------------------------------------------------------

describe("validateStructuredAnswer", () => {
  it("accepts a well-formed answer", () => {
    const v = validateStructuredAnswer({
      answer: "Atlas found a discrepancy.",
      intent: "contradiction_report",
      evidenceIds: ["doc:abc"],
      recommendations: ["Reconcile the documents."],
      limitations: [],
      followUpQuestions: ["Want the details?"],
      spoken: "I found a discrepancy.",
    });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.answer?.answer).toContain("discrepancy");
      expect(v.answer?.evidenceIds).toEqual(["doc:abc"]);
      expect(v.answer?.spoken).toBe("I found a discrepancy.");
    }
  });

  it("rejects a non-object response", () => {
    expect(validateStructuredAnswer("just prose").ok).toBe(false);
    expect(validateStructuredAnswer(null).ok).toBe(false);
    expect(validateStructuredAnswer([1, 2]).ok).toBe(false);
  });

  it("rejects a missing/empty answer string", () => {
    expect(validateStructuredAnswer({ answer: "  " }).ok).toBe(false);
    expect(validateStructuredAnswer({}).ok).toBe(false);
  });

  it("parses categorized findings (§23 reasoning categories)", () => {
    const v = validateStructuredAnswer({
      answer: "Atlas found a discrepancy.",
      findings: [
        {
          category: "FACT",
          statement: "The contractor estimate lists 32.4 squares.",
          evidenceIds: ["doc:contractor-estimate"],
        },
        {
          category: "FACT",
          statement: "The inspection report lists 28.7 squares.",
          evidenceIds: ["doc:inspection"],
        },
        {
          category: "CONFLICT",
          statement: "The quantities disagree.",
          evidenceIds: ["doc:contractor-estimate", "doc:inspection"],
        },
        {
          category: "RECOMMENDATION",
          statement: "Verify the roof measurement before submission.",
          evidenceIds: [],
        },
      ],
    });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.answer?.findings).toHaveLength(4);
      expect(v.answer?.findings?.[2].category).toBe("CONFLICT");
      expect(v.answer?.findings?.[0].evidenceIds).toEqual(["doc:contractor-estimate"]);
    }
  });

  it("drops malformed findings (unknown category / empty statement) but keeps the answer", () => {
    const v = validateStructuredAnswer({
      answer: "ok",
      findings: [
        { category: "MADE_UP", statement: "nope" },
        { category: "FACT", statement: "  " },
        { category: "MISSING", statement: "Pricing support is not in the records." },
        "not an object",
      ],
    });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.answer?.findings).toHaveLength(1);
      expect(v.answer?.findings?.[0].category).toBe("MISSING");
    }
  });

  it("treats absent findings as undefined (not an empty array)", () => {
    const v = validateStructuredAnswer({ answer: "plain answer" });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.answer?.findings).toBeUndefined();
  });

  it("clamps the model's confidence to 0..1 and defaults it when absent", () => {
    const withConf = validateStructuredAnswer({ answer: "ok", confidence: 1.4 });
    expect(withConf.ok).toBe(true);
    if (withConf.ok) expect(withConf.answer?.confidence).toBe(1);
    const absent = validateStructuredAnswer({ answer: "ok" });
    expect(absent.ok).toBe(true);
    if (absent.ok) expect(absent.answer?.confidence).toBeUndefined();
  });
});

describe("extractJsonObject", () => {
  it("parses raw JSON", () => {
    expect((extractJsonObject('{"a":1}') as { a: number }).a).toBe(1);
  });

  it("strips markdown fences", () => {
    const v = extractJsonObject('```json\n{"a":2}\n```') as { a: number };
    expect(v.a).toBe(2);
  });

  it("extracts the object from surrounding prose", () => {
    const v = extractJsonObject('Here you go: {"a":3} hope that helps') as { a: number };
    expect(v.a).toBe(3);
  });

  it("returns null for garbage", () => {
    expect(extractJsonObject("nope")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Citations: real evidence only, hallucinations dropped
// ---------------------------------------------------------------------------

const SAMPLE_EVIDENCE = [
  {
    kind: "chunk",
    chunkId: "11111111-1111-4111-8111-111111111111",
    documentId: "22222222-2222-4222-8222-222222222222",
    documentTitle: "FNOL_Report.pdf",
    snippet: "Reported loss date May 18, 2026.",
    relevance: 0.9,
  },
  {
    kind: "document",
    documentId: "33333333-3333-4333-8333-333333333333",
    documentTitle: "Carrier_Payment_60811.pdf",
    snippet: "Payment amount $18,000.",
    relevance: 0.85,
  },
  {
    kind: "candidate",
    title: "Potential claim GAP-26-51847 (pending)",
    snippet: "Claim number evidence: GAP-26-51847.",
    relevance: 0.9,
    evidenceType: "Claim candidate",
  },
];

describe("buildEvidenceContext", () => {
  it("builds stable ids for chunks, documents and candidates", () => {
    const { items, byId } = buildEvidenceContext(SAMPLE_EVIDENCE, {
      maxEvidenceItems: 8,
      maxSnippetChars: 900,
    });
    expect(items).toHaveLength(3);
    expect(byId.has("chunk:11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(byId.has("doc:33333333-3333-4333-8333-333333333333")).toBe(true);
    // Candidate without a claimKey field derives one from its title.
    expect(byId.has("candidate:GAP-26-51847")).toBe(true);
  });
});

describe("resolveEvidenceIds", () => {
  const { byId } = buildEvidenceContext(SAMPLE_EVIDENCE, {
    maxEvidenceItems: 8,
    maxSnippetChars: 900,
  });

  it("keeps only ids that exist in the retrieved evidence", () => {
    const { kept, dropped } = resolveEvidenceIds(
      ["doc:33333333-3333-4333-8333-333333333333", "doc:does-not-exist", "chunk:11111111-1111-4111-8111-111111111111"],
      byId,
    );
    expect(kept).toEqual([
      "doc:33333333-3333-4333-8333-333333333333",
      "chunk:11111111-1111-4111-8111-111111111111",
    ]);
    expect(dropped).toBe(1);
  });

  it("rejects a hallucinated id even when it looks plausible (tenant isolation of citations)", () => {
    // A different tenant's document id — never in this retrieval's byId map.
    const { kept, dropped } = resolveEvidenceIds(
      ["doc:99999999-9999-4999-8999-999999999999"],
      byId,
    );
    expect(kept).toEqual([]);
    expect(dropped).toBe(1);
  });

  it("handles undefined/empty citations", () => {
    expect(resolveEvidenceIds(undefined, byId)).toEqual({ kept: [], dropped: 0 });
    expect(resolveEvidenceIds([], byId)).toEqual({ kept: [], dropped: 0 });
  });
});

// ---------------------------------------------------------------------------
// 5. Confidence derived from retrieval quality, not the model's number
// ---------------------------------------------------------------------------

describe("deriveConfidence", () => {
  it("is high when several independent evidence items agree", () => {
    expect(deriveConfidence(3, 0)).toBeGreaterThanOrEqual(0.7);
  });

  it("is medium with sparse evidence", () => {
    expect(deriveConfidence(1, 0)).toBe(0.62);
  });

  it("is low with no evidence", () => {
    expect(deriveConfidence(0, 0)).toBe(0.3);
  });

  it("contradictions reduce confidence even with many evidence items", () => {
    const withConflict = deriveConfidence(5, 1);
    const withoutConflict = deriveConfidence(5, 0);
    expect(withConflict).toBeLessThan(withoutConflict);
    expect(withConflict).toBe(0.45);
  });

  it("the model's own number only nudges the derived value", () => {
    const base = deriveConfidence(2, 0);
    const nudged = deriveConfidence(2, 0, 1);
    expect(Math.abs(nudged - base)).toBeLessThanOrEqual(0.06);
  });
});

// ---------------------------------------------------------------------------
// 6. Evidence-grounded request building + conversation memory
// ---------------------------------------------------------------------------

describe("buildGeminiRequestBody", () => {
  it("puts ONLY retrieved evidence plus bounded history into the model context", () => {
    const { items } = buildEvidenceContext(SAMPLE_EVIDENCE, {
      maxEvidenceItems: 8,
      maxSnippetChars: 900,
    });
    const body = buildGeminiRequestBody(
      { maxOutputTokens: 300 },
      ATLAS_SYSTEM_PROMPT,
      "what claims need attention?",
      [
        { role: "user", text: "what claims need attention?" },
        { role: "model", text: "Here is the list." },
      ],
      items,
    );
    const userTurn = body.contents[body.contents.length - 1].parts[0].text;
    expect(userTurn).toContain("<evidence>");
    expect(userTurn).toContain("chunk:11111111-1111-4111-8111-111111111111");
    expect(userTurn).toContain("what claims need attention?");
    expect(userTurn).toContain("Cite ONLY evidence ids");
    expect(body.systemInstruction.parts[0].text).toContain("evidence-first");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.contents).toHaveLength(3); // history (2) + current turn
  });

  it("never includes evidence that was not retrieved", () => {
    const body = buildGeminiRequestBody(
      { maxOutputTokens: 300 },
      ATLAS_SYSTEM_PROMPT,
      "anything",
      [],
      [],
    );
    const userTurn = body.contents[0].parts[0].text;
    expect(userTurn).toContain("(no evidence was retrieved for this question)");
  });
});

describe("normalizeHistory + appendHistory", () => {
  it("normalizes Gemini-style stored messages", () => {
    const h = normalizeHistory(
      [
        { role: "user", parts: [{ text: "q1" }] },
        { role: "model", parts: [{ text: "a1" }] },
        { role: "assistant", text: "legacy a2" },
        "plain string",
        { role: "system", parts: [{ text: "ignored" }] },
      ],
      4,
    );
    expect(h).toEqual([
      { role: "user", text: "q1" },
      { role: "model", text: "a1" },
      { role: "model", text: "legacy a2" },
      { role: "user", text: "plain string" },
    ]);
  });

  it("bounds the history to maxTurns pairs", () => {
    const turns = appendHistory(
      [
        { role: "user", text: "u1" },
        { role: "model", text: "a1" },
        { role: "user", text: "u2" },
        { role: "model", text: "a2" },
      ],
      "u3",
      "a3",
      2,
    );
    expect(turns).toHaveLength(4); // 2 pairs (u2/a2 + u3/a3)
    expect(turns[0].parts[0].text).toBe("u2");
    expect(turns[turns.length - 1].parts[0].text).toBe("a3");
  });
});

// ---------------------------------------------------------------------------
// 7. Evidence id derivation stays consistent (context ↔ resolution)
// ---------------------------------------------------------------------------

describe("evidenceContextId", () => {
  it("derives the same id the context builder hands the model", () => {
    for (const e of SAMPLE_EVIDENCE) {
      const { byId } = buildEvidenceContext([e], { maxEvidenceItems: 8, maxSnippetChars: 900 });
      const id = evidenceContextId(e);
      expect(id).not.toBeNull();
      expect(byId.has(id as string)).toBe(true);
    }
  });

  it("returns null for items with no resolvable record", () => {
    expect(evidenceContextId({ kind: "document", title: "no id" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8. Missing key never yields an AI path (deterministic fallback contract)
// ---------------------------------------------------------------------------

describe("deterministic fallback when Gemini unavailable", () => {
  it("reports not configured without a key (the UI shows evidence retrieval)", () => {
    const { configured, config } = configFromEnv({});
    expect(configured).toBe(false);
    expect(config).toBeNull();
  });

  it("a malformed model answer is rejected so retrieval wins", () => {
    const parsed = extractJsonObject('{"answer":""}');
    expect(validateStructuredAnswer(parsed).ok).toBe(false);
  });
});
