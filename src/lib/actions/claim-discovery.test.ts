// ---------------------------------------------------------------------------
// runClaimDiscovery — executor contract tests (pre-ship review §5/§15).
//
// Proves the claim-creation path against the REAL database guarantees
// (live-verified): insurance_upsert_candidates dedupes on tenantId + claimKey,
// insurance_approve_claim_candidate rejects a second approval, and a raw
// insurance_create_claim does NOT dedupe (two identical calls → two rows).
// Therefore a HIGH-confidence create MUST go through upsert → approve, and a
// rejected approval MUST adopt the concurrent run's claim instead of creating
// a duplicate.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const { mockRpc, rpcCalls, setHandler, clearHandlers } = vi.hoisted(() => {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const handlers: Record<
    string,
    (args: Record<string, unknown>, callIndex: number) => unknown
  > = {};
  // Mirror the real rpcCall arg contract (p_ prefix + folded lowercase) so
  // handler payloads and the recorded calls match production behavior.
  const normalize = (args: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
      const key = k.startsWith("p_") ? k : `p_${k}`;
      out[key.toLowerCase()] = v;
    }
    return out;
  };
  const mockRpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    const normalized = normalize(args);
    rpcCalls.push({ fn, args: normalized });
    const h = handlers[fn];
    if (!h) throw new Error(`Unexpected rpc ${fn}`);
    const callIndex = rpcCalls.filter((c) => c.fn === fn).length - 1;
    return h(normalized, callIndex);
  });
  return {
    mockRpc,
    rpcCalls,
    setHandler: (
      fn: string,
      h: (args: Record<string, unknown>, callIndex: number) => unknown,
    ) => {
      handlers[fn] = h;
    },
    clearHandlers: () => {
      for (const k of Object.keys(handlers)) delete handlers[k];
    },
  };
});

vi.mock("@/lib/actions/rpc", () => ({
  rpcCall: async (
    _supabase: unknown,
    fn: string,
    args: Record<string, unknown> = {},
  ) => mockRpc(fn, args),
}));

import { runClaimDiscovery } from "./claim-discovery";

const CLAIM_TEXT =
  "Claim number GAP-99-0001. Policy number POL-884213. 1427 Cypress Ridge Drive, Lakeland FL 33813. State Farm. Date of loss: 2026-07-14. Cause of loss: wind and hail. Total estimate: $24,500.";

const READY_DOC = {
  _id: "doc-1",
  title: "Claim_GAP-99-0001.pdf",
  summary: null,
  classification: "Estimate",
  status: "ready",
};

interface Setup {
  initialClaims?: Array<{ claim: Record<string, unknown> }>;
  recheckClaims?: Array<{ claim: Record<string, unknown> }>;
  initialCandidates?: Array<Record<string, unknown>>;
  candidatesAfterUpsert?: Array<Record<string, unknown>>;
  approveClaimId?: string;
  approveError?: boolean;
  createClaimId?: string;
}

function installHandlers(opts: Setup = {}) {
  setHandler("insurance_list_claims", (_args, i) => {
    if (i === 1) return opts.recheckClaims ?? [];
    return opts.initialClaims ?? [];
  });
  setHandler("insurance_list_claim_candidates", (_args, i) =>
    i === 1 ? (opts.candidatesAfterUpsert ?? []) : (opts.initialCandidates ?? []),
  );
  setHandler("documents_list_documents", () => [READY_DOC]);
  setHandler("documents_get_document_detail", () => ({
    doc: {},
    chunks: [{ _id: "chunk-1", content: CLAIM_TEXT }],
  }));
  setHandler("insurance_upsert_candidates", () => ({ ok: true }));
  setHandler("insurance_approve_claim_candidate", () => {
    if (opts.approveError) throw new Error("candidate already approved or not pending");
    return { claimId: opts.approveClaimId ?? "claim-created" };
  });
  setHandler("insurance_create_claim", () => ({
    claimId: opts.createClaimId ?? "claim-last-resort",
  }));
  setHandler("insurance_update_claim", () => ({ ok: true }));
  setHandler("insurance_attach_claim_evidence", () => ({ ok: true }));
}

const supabase = {} as SupabaseClient;

beforeEach(() => {
  rpcCalls.length = 0;
  clearHandlers();
  mockRpc.mockClear();
});

describe("runClaimDiscovery — claim creation is real and race-safe", () => {
  it("creates a HIGH-confidence claim through the deduped upsert→approve path — never a raw insurance_create_claim", async () => {
    installHandlers({
      candidatesAfterUpsert: [{ _id: "cand-1", claimKey: "GAP-99-0001", status: "pending" }],
    });
    const res = await runClaimDiscovery(supabase);

    expect(res.created).toBe(1);
    const fns = rpcCalls.map((c) => c.fn);
    expect(fns).toContain("insurance_upsert_candidates");
    expect(fns).toContain("insurance_approve_claim_candidate");
    // The raw create RPC is never the primary creation path.
    expect(fns).not.toContain("insurance_create_claim");
    // The upsert carried the reconstructed cluster.
    const upsert = rpcCalls.find((c) => c.fn === "insurance_upsert_candidates");
    const payload = (upsert?.args.p_candidates ?? []) as Array<Record<string, unknown>>;
    // clusterKey is the normalized cluster identifier (the DB dedupe key).
    expect(payload[0]?.claimKey).toBe("GAP990001");
    expect(payload[0]?.claimNumber).toBe("GAP-99-0001");
    // Evidence is attached to the created claim.
    const attach = rpcCalls.filter((c) => c.fn === "insurance_attach_claim_evidence");
    expect(attach.length).toBe(1);
    expect(attach[0]?.args.p_claimid).toBe("claim-created");
  });

  it("adopts the concurrent run's claim when approval is rejected — no duplicate claim is created", async () => {
    installHandlers({
      // The upsert is a no-op on the concurrent run's already-approved
      // candidate row — the row still resolves, and approval is rejected.
      candidatesAfterUpsert: [{ _id: "cand-1", claimKey: "GAP-99-0001", status: "approved" }],
      approveError: true,
      recheckClaims: [
        {
          claim: {
            _id: "claim-concurrent",
            claimNumber: "GAP-99-0001",
            customer: "Robert J. Mitchell",
            status: "opened",
          },
        },
      ],
    });
    const res = await runClaimDiscovery(supabase);

    expect(res.created).toBe(1);
    const fns = rpcCalls.map((c) => c.fn);
    expect(fns).toContain("insurance_upsert_candidates");
    expect(fns).not.toContain("insurance_create_claim");
    // Evidence is attached to the CONCURRENT claim, not a new one.
    const attach = rpcCalls.filter((c) => c.fn === "insurance_attach_claim_evidence");
    expect(attach.length).toBe(1);
    expect(attach[0]?.args.p_claimid).toBe("claim-concurrent");
  });

  it("falls back to insurance_create_claim only when no candidate row and no concurrent claim exist", async () => {
    // The upsert succeeds but the candidate list returns no row for the
    // cluster and no claim exists anywhere → the last-resort create is the
    // only safe way to persist the HIGH-confidence reconstruction.
    installHandlers({
      createClaimId: "claim-last",
    });
    const res = await runClaimDiscovery(supabase);

    expect(res.created).toBe(1);
    const creates = rpcCalls.filter((c) => c.fn === "insurance_create_claim");
    expect(creates.length).toBe(1);
    expect(creates[0]?.args.p_claimnumber).toBe("GAP-99-0001");
  });

  it("approves an existing pending candidate directly (canonical path) without re-upserting", async () => {
    installHandlers({
      initialCandidates: [
        { _id: "cand-existing", claimKey: "GAP-99-0001", claimNumber: "GAP-99-0001", status: "pending" },
      ],
      approveClaimId: "claim-from-candidate",
    });
    const res = await runClaimDiscovery(supabase);

    expect(res.created).toBe(1);
    const fns = rpcCalls.map((c) => c.fn);
    expect(fns).not.toContain("insurance_upsert_candidates");
    expect(fns).not.toContain("insurance_create_claim");
    const approve = rpcCalls.find((c) => c.fn === "insurance_approve_claim_candidate");
    expect(approve?.args.p_candidateid).toBe("cand-existing");
    const attach = rpcCalls.find((c) => c.fn === "insurance_attach_claim_evidence");
    expect(attach?.args.p_claimid).toBe("claim-from-candidate");
  });

  it("enriches an existing claim on a repeated run — never creates a duplicate (§5 idempotency)", async () => {
    installHandlers({
      initialClaims: [
        {
          claim: {
            _id: "claim-existing",
            claimNumber: "GAP-99-0001",
            customer: "Robert J. Mitchell",
            status: "opened",
          },
        },
      ],
    });
    const res = await runClaimDiscovery(supabase);

    expect(res.created).toBe(0);
    expect(res.enriched).toBe(1);
    const fns = rpcCalls.map((c) => c.fn);
    expect(fns).not.toContain("insurance_create_claim");
    expect(fns).not.toContain("insurance_upsert_candidates");
    expect(fns).not.toContain("insurance_approve_claim_candidate");
    // Missing fields on the claim are filled; evidence is attached.
    const update = rpcCalls.find((c) => c.fn === "insurance_update_claim");
    const patch = (update?.args.p_patch ?? {}) as Record<string, unknown>;
    expect(patch.carrier).toBe("State Farm");
    expect(patch.policy).toBe("POL-884213");
    const attach = rpcCalls.filter((c) => c.fn === "insurance_attach_claim_evidence");
    expect(attach.length).toBe(1);
  });

  it("keeps LOW-confidence evidence without creating anything", async () => {
    setHandler("documents_get_document_detail", () => ({
      doc: {},
      chunks: [
        {
          _id: "chunk-low",
          content: "Invoice total: $28,400.00. Policy number POL-884213.",
        },
      ],
    }));
    setHandler("documents_list_documents", () => [
      { _id: "doc-low", title: "Invoice.pdf", summary: null, classification: "Invoice", status: "ready" },
    ]);
    setHandler("insurance_list_claims", () => []);
    setHandler("insurance_list_claim_candidates", () => []);
    const res = await runClaimDiscovery(supabase);

    expect(res.kept).toBe(1);
    expect(res.created).toBe(0);
    const fns = rpcCalls.map((c) => c.fn);
    expect(fns).not.toContain("insurance_create_claim");
    expect(fns).not.toContain("insurance_upsert_candidates");
  });
});
