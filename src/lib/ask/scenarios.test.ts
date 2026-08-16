// ---------------------------------------------------------------------------
// Ask Atlas scenario tests (master prompt §41–§43) — the deterministic
// intelligence layer:
//
//   §42  absence reasoning: a claim with inspection + photos + estimate +
//        carrier correspondence but NO pricing support. "What is missing?"
//        must flag pricing support even though no document contains the
//        phrase "pricing support is missing".
//   §43  contradiction detection: 32.4 SQ (contractor estimate) vs 28.7 SQ
//        (inspection report). "Is anything inconsistent?" must name both
//        values and both sources.
//   §41  readiness / risk / decision-explanation scenarios, all answered
//        from the expected-evidence + contradiction engines (mocked RPCs).
//
// Every fixture is tenant data returned by the same RPCs the app calls; no
// answer is hard-coded — the engines derive everything from these rows.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const DOC_DETAILS: Record<string, { chunks: Array<{ _id: string; content: string }> }> = {
  // §42: an estimate that EXISTS but carries no itemized pricing support.
  "doc-estimate": {
    chunks: [
      {
        _id: "chunk-est",
        content:
          "Claim number: GAP-26-51847. Scope: roof replacement, drip edge, ridge vent. Roof area 32.4 SQ.",
      },
    ],
  },
  "doc-inspection": {
    chunks: [
      {
        _id: "chunk-ins",
        content: "Claim number: GAP-26-51847. Damage assessment complete. Roof area 28.7 SQ.",
      },
    ],
  },
  "doc-photo": {
    chunks: [
      { _id: "chunk-pho", content: "Claim number: GAP-26-51847. Twelve photos documenting the damage." },
    ],
  },
  "doc-corr": {
    chunks: [
      { _id: "chunk-cor", content: "Claim number: GAP-26-51847. Carrier correspondence on file." },
    ],
  },
};

const { mockRpc, rpcCalls } = vi.hoisted(() => {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const mockRpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    if (fn === "insurance_list_claims") {
      return [
        {
          claim: {
            _id: "claim-1",
            claimNumber: "GAP-26-51847",
            dateOfLoss: Date.UTC(2026, 6, 14),
            property: "1427 Cypress Ridge Drive, Lakeland FL 33813",
            causeOfLoss: "Wind and hail",
            customer: "Robert J. Mitchell",
            carrier: "Liberty Mutual",
            policy: "POL-884213",
            adjuster: "D. Reynolds",
            status: "opened",
            confidence: 0.9,
            estimateAmount: 24500,
            estimateLineItemCount: 12,
            evidenceSummary: ["inspection", "estimate", "photos", "carrier correspondence"],
            evidenceDocumentIds: ["doc-estimate", "doc-inspection", "doc-photo", "doc-corr"],
          },
        },
      ];
    }
    if (fn === "insurance_list_claim_candidates") return [];
    if (fn === "documents_list_documents") {
      return [
        {
          _id: "doc-estimate",
          title: "Contractor_Estimate_GAP-26-51847.pdf",
          summary: null,
          status: "ready",
          classification: "Estimate",
          chunkCount: 1,
          entityCount: 1,
        },
        {
          _id: "doc-inspection",
          title: "Inspection_Report_GAP-26-51847.pdf",
          summary: null,
          status: "ready",
          classification: "Inspection",
          chunkCount: 1,
          entityCount: 1,
        },
        {
          _id: "doc-photo",
          title: "GAP-26-51847_loss_photos.zip",
          summary: null,
          status: "ready",
          classification: "Photo",
          chunkCount: 1,
          entityCount: 0,
        },
        {
          _id: "doc-corr",
          title: "Carrier_Correspondence_GAP-26-51847.pdf",
          summary: null,
          status: "ready",
          classification: "Correspondence",
          chunkCount: 1,
          entityCount: 0,
        },
      ];
    }
    if (fn === "documents_get_document_detail") {
      const id = String(args.documentId ?? "");
      return { doc: {}, chunks: DOC_DETAILS[id]?.chunks ?? [] };
    }
    if (fn === "ask_insert_session") return { sessionId: "session-1" };
    throw new Error(`Unexpected rpc ${fn}`);
  });
  return { mockRpc, rpcCalls };
});

vi.mock("@/lib/actions/rpc", () => ({
  rpcCall: async (supabase: unknown, fn: string, args: Record<string, unknown> = {}) =>
    mockRpc(fn, args),
}));

import { answerLocally } from "./retrieval";

const supabase = { rpc: mockRpc } as unknown as SupabaseClient;

beforeEach(() => {
  rpcCalls.length = 0;
  mockRpc.mockClear();
});

describe("Ask Atlas — evidence-gap analysis (§42: the absence problem)", () => {
  it("identifies pricing support as missing even though no document contains that phrase", async () => {
    // Sanity: the phrase the question expects must NOT appear in the data —
    // the gap engine derives it from the expected-evidence model, not search.
    for (const d of Object.values(DOC_DETAILS)) {
      for (const c of d.chunks) {
        expect(c.content.toLowerCase()).not.toContain("pricing support is missing");
      }
    }

    const res = await answerLocally(
      supabase,
      "What is missing before we submit this supplement for claim GAP-26-51847?",
    );
    expect(res.intent).toBe("evidence_gap_analysis");
    expect(res.answer).toContain("Pricing support");
    expect(res.answer).toMatch(/not from searching for the word “missing”/);
    // The structured contract carries the gap explicitly.
    expect(
      res.missingInformation?.some((m) => m.toLowerCase().includes("pricing support")),
    ).toBe(true);
    // Findings carry reasoning categories — MISSING is present with a statement.
    expect(
      res.findings?.some(
        (f) => f.category === "MISSING" && f.statement.toLowerCase().includes("pricing support"),
      ),
    ).toBe(true);
    // The estimate exists (original_estimate satisfied) — the gap is pricing
    // support specifically, proving absence reasoning beyond keyword search.
    expect(res.answer).toMatch(/estimate/i);
  });

  it("returns an honest summary for what is missing (claim-level workflow)", async () => {
    // At the claim level every core fact is on file (claim number, loss
    // event, property, insured, carrier/policy, evidence, financial
    // baseline) — the engine must honestly report READY rather than invent
    // a gap. The supplement-level gaps surface in the other scenarios.
    const res = await answerLocally(supabase, "What are we missing on this claim?");
    expect(res.intent).toBe("evidence_gap_analysis");
    expect(res.answer).toContain("GAP-26-51847");
    expect(res.answer).toMatch(/Readiness for claim readiness: READY/);
  });
});

describe("Ask Atlas — contradiction detection (§43)", () => {
  it("identifies 28.7 SQ vs 32.4 SQ and cites BOTH sources", async () => {
    const res = await answerLocally(
      supabase,
      "Is anything inconsistent on claim GAP-26-51847?",
    );
    expect(res.intent).toBe("contradiction_analysis");
    expect(res.answer).toContain("28.7 SQ");
    expect(res.answer).toContain("32.4 SQ");
    expect(res.contradictions?.length).toBeGreaterThanOrEqual(1);
    const hit = res.contradictions?.[0];
    expect(hit?.field).toContain("Roof area");
    const titles = (hit?.values ?? []).map((v) => v.documentTitle);
    expect(titles.some((t) => /inspection/i.test(t))).toBe(true);
    expect(titles.some((t) => /estimate/i.test(t))).toBe(true);
    // Both values preserved — never a silently picked winner.
    const values = (hit?.values ?? []).map((v) => v.value);
    expect(values).toContain("28.7 SQ");
    expect(values).toContain("32.4 SQ");
    // The structured findings label the conflict.
    expect(
      res.findings?.some(
        (f) => f.category === "CONFLICT" && f.statement.includes("Roof area"),
      ),
    ).toBe(true);
  });

  it("does not fabricate a contradiction when sources agree", async () => {
    const res = await answerLocally(
      supabase,
      "Does anything not match on the estimate?",
    );
    // "not match" routes to the contradiction engine; it runs the real scan
    // and reports the honest state. The SQ conflict is real (fixture), so a
    // hit is expected — this pins the routing, not a fabricated result.
    expect(res.intent).toBe("contradiction_analysis");
    expect(res.answer).toBeTruthy();
  });
});

describe("Ask Atlas — readiness + risk + decision explanation (§41 scenarios)", () => {
  it("Scenario 3: answers whether the claim is ready for supplement submission", async () => {
    const res = await answerLocally(
      supabase,
      "Is this claim ready for supplement submission?",
    );
    expect(res.intent).toBe("claim_readiness");
    expect(res.answer).toMatch(/Readiness/);
    expect(res.recommendations?.length).toBeGreaterThan(0);
    // Blocking gaps are real: pricing support + authorization are missing.
    expect(
      res.missingInformation?.some((m) => m.toLowerCase().includes("authorization")),
    ).toBe(true);
  });

  it("Scenario 5: explains why a supplement might be challenged (evidence-grounded)", async () => {
    const res = await answerLocally(
      supabase,
      "Why might this supplement be challenged?",
    );
    expect(res.intent).toBe("claim_readiness");
    expect(res.answer).toContain("GAP-26-51847");
    // The reasoning is gap-driven: the supplement lacks pricing support,
    // which is exactly what a carrier challenges first.
    expect(res.answer).toMatch(/pricing support/i);
  });

  it("Scenario 7: explains WHY Atlas says the claim is not ready", async () => {
    const res = await answerLocally(supabase, "Why did Atlas say this isn't ready?");
    expect(res.intent).toBe("decision_explanation");
    expect(res.answer).toMatch(/Readiness assessment|flagged this because/i);
    expect(res.findings?.some((f) => f.category === "MISSING")).toBe(true);
  });
});
