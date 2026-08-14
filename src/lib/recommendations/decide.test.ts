// ---------------------------------------------------------------------------
// Regression tests for the recommendation decision contract.
//
// Production defect: the page called recommendations_decide with ONLY
// { recommendationId }, but the deployed function requires BOTH
// (p_recommendationid, p_status) → PostgREST PGRST202 → every Approve/Reject/
// Dismiss/Mark-executed button surfaced "Action failed". These tests pin the
// corrected contract: every action maps to the exact status value the deployed
// RPC expects, and the canonical state machine is enforced client-side.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  decisionStatusFor,
  transitionError,
  type RecommendationAction,
} from "./decide";
import { normalizeRpcArgs } from "@/lib/actions/rpc";

const ACTIONS: RecommendationAction[] = ["approve", "reject", "dismiss", "execute"];

describe("decisionStatusFor — maps each UI action to the deployed RPC status", () => {
  it("maps to the exact status values recommendations_decide accepts", () => {
    expect(decisionStatusFor("approve")).toBe("approved");
    expect(decisionStatusFor("reject")).toBe("rejected");
    expect(decisionStatusFor("dismiss")).toBe("dismissed");
    expect(decisionStatusFor("execute")).toBe("executed");
  });

  it("produces the exact PostgREST args the deployed schema resolves", () => {
    // This is the regression: the frontend must send BOTH p_recommendationid
    // AND p_status — a call with only p_recommendationid fails with PGRST202.
    for (const action of ACTIONS) {
      const args = normalizeRpcArgs({
        recommendationId: "rec-1",
        status: decisionStatusFor(action),
      });
      expect(args).toEqual({ p_recommendationid: "rec-1", p_status: decisionStatusFor(action) });
    }
  });
});

describe("transitionError — canonical state machine", () => {
  it("allows open → approved / rejected / dismissed", () => {
    expect(transitionError("approve", "open")).toBeNull();
    expect(transitionError("reject", "open")).toBeNull();
    expect(transitionError("dismiss", "open")).toBeNull();
  });

  it("allows approved → executed", () => {
    expect(transitionError("execute", "approved")).toBeNull();
  });

  it("blocks executing an open recommendation with an actionable message", () => {
    expect(transitionError("execute", "open")).toMatch(/must be approved before/);
  });

  it("blocks re-deciding a closed recommendation", () => {
    expect(transitionError("approve", "rejected")).toMatch(/already rejected/);
    expect(transitionError("reject", "approved")).toMatch(/already approved/);
    expect(transitionError("execute", "rejected")).toMatch(/not approved/);
    expect(transitionError("execute", "dismissed")).toMatch(/not approved/);
  });

  it("is idempotent for same-status retries", () => {
    // The deployed RPC treats a same-status re-decision as a safe no-op; the
    // client must never block a retry that would succeed.
    expect(transitionError("approve", "approved")).toBeNull();
    expect(transitionError("reject", "rejected")).toBeNull();
    expect(transitionError("execute", "executed")).toBeNull();
    expect(transitionError("dismiss", "dismissed")).toBeNull();
  });
});
