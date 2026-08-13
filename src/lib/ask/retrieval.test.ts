// ---------------------------------------------------------------------------
// Tests for the deterministic Ask Atlas fallback. The RPCs are mocked with a
// realistic mini-dataset (claim candidate + documents + chunks) so the
// intents can be pinned: claim reconstruction, claim summary, data summary,
// and generic keyword retrieval — all grounded in "real" persisted rows.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const { mockRpc, rpcCalls } = vi.hoisted(() => {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const mockRpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    if (fn === "insurance_list_claim_candidates") {
      return [
        {
          _id: "cand-1",
          claimKey: "GAP2651847",
          claimNumber: "GAP-26-51847",
          customer: "Robert J. Mitchell",
          property: "1427 Cypress Ridge Drive, Lakeland FL 33813",
          confidence: 0.84,
          status: "pending",
          archiveId: "arch-1",
          evidence: [{ path: "Claims/GAP-26-51847/estimate.txt" }],
        },
      ];
    }
    if (fn === "documents_list_documents") {
      return [
        {
          _id: "doc-1",
          title: "Claim GAP-26-51847 estimate.txt",
          summary: "Estimate for roof replacement, drip edge, ridge vent",
          status: "ready",
          classification: "Estimate",
          chunkCount: 3,
          entityCount: 2,
        },
        {
          _id: "doc-2",
          title: "NPP_roofing_invoice.xlsx",
          summary: "Invoice ledger",
          status: "ready",
          classification: "Invoice",
          chunkCount: 1,
          entityCount: 0,
        },
      ];
    }
    if (fn === "documents_get_document_detail") {
      return {
        doc: {},
        chunks: [
          { _id: "chunk-1", content: "Estimate total $24,500. Drip edge and ridge vent are itemized." },
          { _id: "chunk-2", content: "Invoice total $28,400." },
        ],
      };
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

vi.mock("@/lib/insurance/logic", () => {
  const actual = vi.importActual<typeof import("@/lib/insurance/logic")>(
    "@/lib/insurance/logic",
  );
  return actual;
});

import { answerLocally } from "./retrieval";

const supabase = { rpc: mockRpc } as unknown as SupabaseClient;

beforeEach(() => {
  rpcCalls.length = 0;
  mockRpc.mockClear();
});

describe("answerLocally — deterministic Ask Atlas", () => {
  it("reports how many potential claims were reconstructed", async () => {
    const res = await answerLocally(supabase, "How many potential claims did you identify?");
    expect(res.intent).toBe("claim_summary");
    expect(res.answer).toContain("1 potential claim");
    expect(res.answer).toContain("GAP2651847");
    expect(res.evidence[0]?.kind).toBe("candidate");
  });

  it("answers the Robert Mitchell claim question with evidence", async () => {
    const res = await answerLocally(
      supabase,
      "What is missing from the Robert Mitchell claim GAP-26-51847?",
    );
    expect(res.intent).toBe("claim_reconstruction");
    expect(res.answer).toContain("GAP2651847");
    expect(res.answer.toLowerCase()).toContain("pending");
    expect(res.evidence[0]?.relevance).toBeGreaterThan(0.8);
  });

  it("answers revenue/recovery questions honestly (candidate not yet a ledger)", async () => {
    const res = await answerLocally(
      supabase,
      "What might we be leaving on the table for claim GAP-26-51847?",
    );
    expect(res.intent).toBe("claim_reconstruction");
    expect(res.answer).toContain("no confirmed carrier payment");
    expect(res.answer).toContain("human review");
  });

  it("summarizes what was found in the company data", async () => {
    const res = await answerLocally(supabase, "What did you find in this company data?");
    expect(res.intent).toBe("data_summary");
    expect(res.answer).toContain("2 usable documents");
    expect(res.answer).toContain("1 potential claim");
  });

  it("falls back to keyword chunk retrieval with cited evidence", async () => {
    const res = await answerLocally(supabase, "What is the drip edge estimate?");
    expect(res.intent).toBe("knowledge_search");
    expect(res.answer).toContain("drip edge");
    expect(res.evidence.some((e) => e.kind === "chunk")).toBe(true);
  });

  it("persists the turn into the ask-session history", async () => {
    await answerLocally(supabase, "How many potential claims did you identify?");
    const inserts = rpcCalls.filter((c) => c.fn === "ask_insert_session");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].args).toHaveProperty("question");
    expect(inserts[0].args).toHaveProperty("evidence");
  });
});
