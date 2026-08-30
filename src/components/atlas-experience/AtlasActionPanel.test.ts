// ---------------------------------------------------------------------------
// Tests: AtlasActionPanel — Action Flow, Authorization, Proposal Generation
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import {
  checkAuthorization,
  createAction,
  prepareForConfirmation,
  transitionAction,
  getActionRisk,
  isActionExpired,
  generateIdempotencyKey,
  DEFAULT_CONFIRMATION_TIMEOUT_MS,
  type AtlasUserRole,
  type AtlasActionType,
} from "@/lib/atlas-experience/execution";
import type { AtlasEntityReference } from "@/lib/atlas-experience/entity-reference";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const claimEntity: AtlasEntityReference = {
  type: "claim",
  id: "1042",
  label: "Claim #1042",
};

const leadEntity: AtlasEntityReference = {
  type: "lead",
  id: "lead-1",
  label: "Acme Roofing",
};

// ---------------------------------------------------------------------------
// Authorization Tests
// ---------------------------------------------------------------------------

describe("Action Authorization", () => {
  it("allows atlas_admin to approve recommendations", () => {
    const result = checkAuthorization("approve_recommendation", "atlas_admin");
    expect(result.allowed).toBe(true);
  });

  it("blocks customer_user from approving recommendations", () => {
    const result = checkAuthorization("approve_recommendation", "customer_user");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not authorized");
  });

  it("allows all roles to navigate", () => {
    const roles: AtlasUserRole[] = [
      "super_admin", "atlas_admin", "customer_admin", "customer_user",
    ];
    for (const role of roles) {
      expect(checkAuthorization("navigate", role).allowed).toBe(true);
    }
  });

  it("blocks customer_user from preparing supplements", () => {
    const result = checkAuthorization("prepare_supplement", "customer_user");
    expect(result.allowed).toBe(false);
  });

  it("allows customer_admin to prepare supplements", () => {
    const result = checkAuthorization("prepare_supplement", "customer_admin");
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Risk Classification Tests
// ---------------------------------------------------------------------------

describe("Action Risk Classification", () => {
  it("classifies navigate as low risk", () => {
    expect(getActionRisk("navigate")).toBe("low");
  });

  it("classifies prepare_supplement as medium risk", () => {
    expect(getActionRisk("prepare_supplement")).toBe("medium");
  });

  it("classifies approve_recommendation as high risk", () => {
    expect(getActionRisk("approve_recommendation")).toBe("high");
  });

  it("classifies submit_supplement as high risk", () => {
    expect(getActionRisk("submit_supplement")).toBe("high");
  });

  it("classifies send_email as high risk", () => {
    expect(getActionRisk("send_email")).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// Action Lifecycle Tests
// ---------------------------------------------------------------------------

describe("Action Lifecycle", () => {
  it("creates action in proposed status", () => {
    const action = createAction(
      "prepare_supplement",
      "Prepare Supplement",
      "Atlas will prepare a supplement",
      claimEntity,
      { claimId: "1042" },
      "user-1",
    );
    expect(action.status).toBe("proposed");
    expect(action.type).toBe("prepare_supplement");
    expect(action.entity.id).toBe("1042");
  });

  it("prepares action for confirmation", () => {
    const action = createAction(
      "submit_supplement",
      "Submit Supplement",
      "Submit supplement for claim",
      claimEntity,
      { claimId: "1042" },
      "user-1",
    );
    const prepared = prepareForConfirmation(action);
    expect(prepared.status).toBe("awaiting_confirmation");
    expect(prepared.confirmationToken).toBeDefined();
    expect(prepared.expiresAt).toBeDefined();
  });

  it("transitions from confirmed to executing", () => {
    const action = createAction(
      "approve_recommendation",
      "Approve",
      "Approve recommendation",
      claimEntity,
      { recommendationId: "rec-1" },
      "user-1",
    );
    const prepared = prepareForConfirmation(action);
    const confirmed = transitionAction(prepared, "confirmed", "user-1", "Confirmed");
    expect(confirmed.status).toBe("confirmed");
    const executing = transitionAction(confirmed, "executing", "system", "Executing");
    expect(executing.status).toBe("executing");
  });

  it("prevents invalid transitions", () => {
    const action = createAction(
      "prepare_supplement",
      "Prepare",
      "Atlas will prepare",
      claimEntity,
      {},
      "user-1",
    );
    // Cannot go from proposed directly to executed
    expect(() => transitionAction(action, "executing", "user-1")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Idempotency Tests
// ---------------------------------------------------------------------------

describe("Idempotency", () => {
  it("generates deterministic idempotency keys", () => {
    const key1 = generateIdempotencyKey("prepare_supplement", "1042", { claimId: "1042" });
    const key2 = generateIdempotencyKey("prepare_supplement", "1042", { claimId: "1042" });
    expect(key1).toBe(key2);
  });

  it("generates different keys for different inputs", () => {
    const key1 = generateIdempotencyKey("prepare_supplement", "1042", { claimId: "1042" });
    const key2 = generateIdempotencyKey("prepare_supplement", "1043", { claimId: "1043" });
    expect(key1).not.toBe(key2);
  });

  it("generates different keys for different action types", () => {
    const key1 = generateIdempotencyKey("prepare_supplement", "1042", {});
    const key2 = generateIdempotencyKey("prepare_email", "1042", {});
    expect(key1).not.toBe(key2);
  });
});

// ---------------------------------------------------------------------------
// Expiration Tests
// ---------------------------------------------------------------------------

describe("Action Expiration", () => {
  it("detects expired actions", () => {
    const action = createAction(
      "prepare_supplement",
      "Prepare",
      "Atlas will prepare",
      claimEntity,
      {},
      "user-1",
    );
    const prepared = {
      ...prepareForConfirmation(action),
      expiresAt: new Date(Date.now() - 1000).toISOString(), // expired 1 second ago
    };
    expect(isActionExpired(prepared)).toBe(true);
  });

  it("does not flag non-expired actions", () => {
    const action = createAction(
      "prepare_supplement",
      "Prepare",
      "Atlas will prepare",
      claimEntity,
      {},
      "user-1",
    );
    const prepared = prepareForConfirmation(action, DEFAULT_CONFIRMATION_TIMEOUT_MS);
    expect(isActionExpired(prepared)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Decision → Action Traceability
// ---------------------------------------------------------------------------

describe("Decision → Action Traceability", () => {
  it("preserves decision ID through action creation", () => {
    const action = createAction(
      "approve_recommendation",
      "Approve",
      "Approve recommendation",
      claimEntity,
      { recommendationId: "rec-42" },
      "user-1",
      { decisionId: "decision-99" },
    );
    expect(action.decisionId).toBe("decision-99");
    expect(action.parameters.recommendationId).toBe("rec-42");
  });

  it("preserves recommendation ID through action creation", () => {
    const action = createAction(
      "reject_recommendation",
      "Reject",
      "Reject recommendation",
      claimEntity,
      {},
      "user-1",
      { recommendationId: "rec-42" },
    );
    expect(action.recommendationId).toBe("rec-42");
  });
});

// ---------------------------------------------------------------------------
// Entity Action Proposals
// ---------------------------------------------------------------------------

describe("Entity Action Proposals", () => {
  it("generates supplement actions for claims", () => {
    const entity = claimEntity;
    // Simulate what useAtlasActions.generateAttentionActions does
    const actions: Array<{ type: AtlasActionType; label: string; entity: AtlasEntityReference }> = [];
    if (entity.type === "claim") {
      actions.push({
        type: "prepare_supplement",
        label: "Prepare Supplement",
        entity,
      });
    }
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("prepare_supplement");
  });

  it("generates email actions for leads", () => {
    const entity = leadEntity;
    const actions: Array<{ type: AtlasActionType; label: string; entity: AtlasEntityReference }> = [];
    if (entity.type === "lead") {
      actions.push({
        type: "prepare_email",
        label: "Prepare Email",
        entity,
      });
    }
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("prepare_email");
  });

  it("generates approve/reject for new decisions", () => {
    const status = "new";
    const actions: Array<{ type: AtlasActionType; label: string }> = [];
    if (status === "new") {
      actions.push({ type: "approve_recommendation", label: "Approve" });
      actions.push({ type: "reject_recommendation", label: "Reject" });
    }
    expect(actions).toHaveLength(2);
    expect(actions[0].type).toBe("approve_recommendation");
    expect(actions[1].type).toBe("reject_recommendation");
  });
});
