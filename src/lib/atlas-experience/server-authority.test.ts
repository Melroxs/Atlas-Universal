// ---------------------------------------------------------------------------
// Tests for Atlas Server Authority
// Covers: staleness enforcement, action state recovery, voice status,
//         and the failure modes required by Phase 13.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import {
  enforceStalenessBeforeExecution,
  getEntityActionStatus,
  recordActionActivity,
} from "./server-authority";
import {
  createAction,
  transitionAction,
  canTransition,
  generateSourceFingerprint,
  isActionStale,
  isActionExpired,
  validateBeforeExecution,
  type AtlasExecutableAction,
  type AtlasActionStatus,
} from "./execution";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAction(
  overrides: Partial<AtlasExecutableAction> = {},
): AtlasExecutableAction {
  const base = createAction(
    "prepare_supplement",
    "Prepare Supplement",
    "Prepare a supplement for review",
    { type: "claim", id: "claim-123", label: "Claim #123" },
    { claimId: "claim-123" },
    "user-1",
  );
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// 1. Action State Machine Transitions
// ---------------------------------------------------------------------------

describe("Action state machine", () => {
  it("allows valid transitions", () => {
    expect(canTransition("proposed", "preparing")).toBe(true);
    expect(canTransition("preparing", "prepared")).toBe(true);
    expect(canTransition("prepared", "awaiting_confirmation")).toBe(true);
    expect(canTransition("awaiting_confirmation", "confirmed")).toBe(true);
    expect(canTransition("confirmed", "executing")).toBe(true);
    expect(canTransition("executing", "executed")).toBe(true);
    expect(canTransition("executed", "verified")).toBe(true);
  });

  it("blocks invalid transitions", () => {
    expect(canTransition("proposed", "executed")).toBe(false);
    expect(canTransition("proposed", "confirmed")).toBe(false);
    expect(canTransition("executed", "preparing")).toBe(false);
    expect(canTransition("verified", "executing")).toBe(false);
    expect(canTransition("blocked", "confirmed")).toBe(false);
    expect(canTransition("cancelled", "executing")).toBe(false);
  });

  it("allows retry from failed state", () => {
    expect(canTransition("failed", "preparing")).toBe(true);
    expect(canTransition("failed", "retry_pending")).toBe(true);
    expect(canTransition("retry_pending", "preparing")).toBe(true);
    expect(canTransition("retry_pending", "cancelled")).toBe(true);
  });

  it("allows re-prepare from stale", () => {
    expect(canTransition("stale", "preparing")).toBe(true);
  });

  it("allows re-prepare from expired", () => {
    expect(canTransition("expired", "preparing")).toBe(true);
  });

  it("terminal states cannot transition", () => {
    const terminal: AtlasActionStatus[] = [
      "verified",
      "blocked",
      "rejected",
      "cancelled",
    ];
    for (const status of terminal) {
      for (const target of [
        "proposed",
        "preparing",
        "confirmed",
        "executing",
        "executed",
      ]) {
        expect(canTransition(status, target)).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Pre-Execution Validation Pipeline
// ---------------------------------------------------------------------------

describe("Pre-execution validation", () => {
  it("blocks non-existent action", () => {
    const action = makeAction({ id: "" });
    const result = validateBeforeExecution(action, {
      userRole: "customer_admin",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("action_not_found");
  });

  it("blocks action not in confirmed state", () => {
    const action = makeAction({ status: "proposed" });
    const result = validateBeforeExecution(action, {
      userRole: "customer_admin",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("action_not_confirmable");
  });

  it("blocks cancelled action", () => {
    const action = makeAction({ status: "cancelled" });
    const result = validateBeforeExecution(action, {
      userRole: "customer_admin",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("action_cancelled");
  });

  it("blocks terminal action", () => {
    const action = makeAction({ status: "verified" });
    const result = validateBeforeExecution(action, {
      userRole: "customer_admin",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("action_terminal");
  });

  it("blocks expired confirmation", () => {
    const action = makeAction({
      status: "confirmed",
      expiresAt: new Date(Date.now() - 100000).toISOString(),
    });
    const result = validateBeforeExecution(action, {
      userRole: "customer_admin",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("confirmation_expired");
  });

  it("blocks stale action when fingerprint mismatches", () => {
    const action = makeAction({
      status: "confirmed",
      sourceFingerprint: "fp-old123",
    });
    const result = validateBeforeExecution(action, {
      userRole: "customer_admin",
      currentFingerprint: "fp-new456",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("action_stale");
  });

  it("allows confirmed action with matching fingerprint", () => {
    const action = makeAction({
      status: "confirmed",
      sourceFingerprint: "fp-abc",
    });
    const result = validateBeforeExecution(action, {
      userRole: "customer_admin",
      currentFingerprint: "fp-abc",
    });
    expect(result.valid).toBe(true);
  });

  it("allows confirmed action without fingerprint (no check)", () => {
    const action = makeAction({ status: "confirmed" });
    const result = validateBeforeExecution(action, {
      userRole: "customer_admin",
    });
    expect(result.valid).toBe(true);
  });

  it("blocks when idempotency key already exists", () => {
    const action = makeAction({ status: "confirmed" });
    const result = validateBeforeExecution(action, {
      userRole: "customer_admin",
      idempotencyKeyExists: true,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("duplicate_action");
  });
});

// ---------------------------------------------------------------------------
// 3. Staleness Detection
// ---------------------------------------------------------------------------

describe("Staleness detection", () => {
  it("detects fingerprint mismatch", () => {
    const action = makeAction({ sourceFingerprint: "fp-old" });
    expect(isActionStale(action, "fp-new")).toBe(true);
  });

  it("allows matching fingerprint", () => {
    const action = makeAction({ sourceFingerprint: "fp-abc" });
    expect(isActionStale(action, "fp-abc")).toBe(false);
  });

  it("allows missing fingerprint", () => {
    const action = makeAction();
    expect(isActionStale(action, "fp-new")).toBe(false);
  });

  it("generates deterministic fingerprint", () => {
    const fp1 = generateSourceFingerprint({ a: 1, b: "hello" });
    const fp2 = generateSourceFingerprint({ a: 1, b: "hello" });
    expect(fp1).toBe(fp2);
  });

  it("different data produces different fingerprint", () => {
    const fp1 = generateSourceFingerprint({ a: 1 });
    const fp2 = generateSourceFingerprint({ a: 2 });
    expect(fp1).not.toBe(fp2);
  });
});

// ---------------------------------------------------------------------------
// 4. Expiration Detection
// ---------------------------------------------------------------------------

describe("Expiration detection", () => {
  it("detects expired action", () => {
    const action = makeAction({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(isActionExpired(action)).toBe(true);
  });

  it("allows non-expired action", () => {
    const action = makeAction({
      expiresAt: new Date(Date.now() + 100000).toISOString(),
    });
    expect(isActionExpired(action)).toBe(false);
  });

  it("allows action without expiration", () => {
    const action = makeAction();
    expect(isActionExpired(action)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Voice Action Status Recovery
// ---------------------------------------------------------------------------

describe("Voice action status recovery", () => {
  it("returns empty when no actions exist", async () => {
    // getEntityActionStatus makes RPC calls — in unit tests these will fail
    // gracefully and return empty
    const result = await getEntityActionStatus(
      {} as any, // mock supabase
      "claim",
      "claim-123",
    );
    expect(result.hasActiveAction).toBe(false);
    expect(result.recentActions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. Action Activity Recording
// ---------------------------------------------------------------------------

describe("Action activity recording", () => {
  it("records activity without throwing", async () => {
    const action = makeAction();
    // recordActionActivity makes RPC calls — should not throw even on failure
    await expect(
      recordActionActivity({} as any, action, "action_executed"),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 7. Critical Failure Scenarios
// ---------------------------------------------------------------------------

describe("Failure mode scenarios", () => {
  it("stale action between preparation and approval is blocked", () => {
    // Action is in awaiting_confirmation — the server would block because
    // the action hasn't been confirmed yet
    const prepared = makeAction({
      status: "awaiting_confirmation",
      sourceFingerprint: "fp-original",
    });
    const result = validateBeforeExecution(prepared, {
      userRole: "customer_admin",
      currentFingerprint: "fp-changed",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      // Staleness is checked only on confirmed actions — before that,
      // the action is blocked because it's not in the right state
      expect(["action_not_confirmable", "action_stale"]).toContain(result.code);
    }
  });

  it("stale action between approval and execution is blocked", () => {
    const confirmed = makeAction({
      status: "confirmed",
      sourceFingerprint: "fp-original",
    });
    const result = validateBeforeExecution(confirmed, {
      userRole: "customer_admin",
      currentFingerprint: "fp-changed",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("action_stale");
  });

  it("duplicate execution request is blocked by idempotency", () => {
    const confirmed = makeAction({ status: "confirmed" });
    const result = validateBeforeExecution(confirmed, {
      userRole: "customer_admin",
      idempotencyKeyExists: true,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("duplicate_action");
  });

  it("unauthorized user cannot execute", () => {
    const confirmed = makeAction({ status: "confirmed" });
    const result = validateBeforeExecution(confirmed, {
      userRole: "customer_user", // customer_user cannot prepare/execute
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("authorization_changed");
  });

  it("expired action cannot execute", () => {
    const confirmed = makeAction({
      status: "confirmed",
      expiresAt: new Date(Date.now() - 5000).toISOString(),
    });
    const result = validateBeforeExecution(confirmed, {
      userRole: "customer_admin",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("confirmation_expired");
  });

  it("cancelled action cannot execute", () => {
    const action = makeAction({ status: "cancelled" });
    const result = validateBeforeExecution(action, {
      userRole: "customer_admin",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("action_cancelled");
  });

  it("failed action can retry through preparing", () => {
    expect(canTransition("failed", "preparing")).toBe(true);
  });

  it("verified action cannot execute again", () => {
    const action = makeAction({ status: "verified" });
    const result = validateBeforeExecution(action, {
      userRole: "customer_admin",
    });
    expect(result.valid).toBe(false);
  });

  it("stale action shows retryable status", () => {
    const action = makeAction({
      status: "confirmed",
      sourceFingerprint: "fp-old",
    });
    const result = validateBeforeExecution(action, {
      userRole: "customer_admin",
      currentFingerprint: "fp-new",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.retryable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Role Enforcement
// ---------------------------------------------------------------------------

describe("Role enforcement", () => {
  it("customer_user cannot prepare actions", () => {
    const action = makeAction({
      type: "prepare_supplement",
      status: "confirmed",
    });
    const result = validateBeforeExecution(action, {
      userRole: "customer_user",
    });
    expect(result.valid).toBe(false);
  });

  it("customer_admin can prepare actions", () => {
    const action = makeAction({
      type: "prepare_supplement",
      status: "confirmed",
    });
    const result = validateBeforeExecution(action, {
      userRole: "customer_admin",
    });
    expect(result.valid).toBe(true);
  });

  it("atlas_admin can prepare actions", () => {
    const action = makeAction({
      type: "prepare_supplement",
      status: "confirmed",
    });
    const result = validateBeforeExecution(action, {
      userRole: "atlas_admin",
    });
    expect(result.valid).toBe(true);
  });

  it("super_admin can prepare actions", () => {
    const action = makeAction({
      type: "prepare_supplement",
      status: "confirmed",
    });
    const result = validateBeforeExecution(action, {
      userRole: "super_admin",
    });
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. Complete Lifecycle Test
// ---------------------------------------------------------------------------

describe("Complete action lifecycle", () => {
  it("validates full lifecycle from proposed to verified", () => {
    let action = makeAction();

    // proposed → preparing
    expect(canTransition(action.status, "preparing")).toBe(true);
    action = transitionAction(action, "preparing", "atlas", "Preparing");

    // preparing → prepared
    expect(canTransition(action.status, "prepared")).toBe(true);
    action = transitionAction(action, "prepared", "atlas", "Prepared");

    // prepared → awaiting_confirmation
    expect(canTransition(action.status, "awaiting_confirmation")).toBe(true);
    action = transitionAction(action, "awaiting_confirmation", "system", "Awaiting confirmation");

    // Pre-execution check on awaiting_confirmation — fails because not confirmed
    const preCheck = validateBeforeExecution(action, {
      userRole: "customer_admin",
    });
    expect(preCheck.valid).toBe(false);

    // awaiting_confirmation → confirmed
    action = transitionAction(action, "confirmed", "user-1", "User confirmed");

    // Pre-execution check on confirmed — passes
    const validation = validateBeforeExecution(action, {
      userRole: "customer_admin",
    });
    expect(validation.valid).toBe(true);

    // confirmed → executing
    expect(canTransition(action.status, "executing")).toBe(true);
    action = transitionAction(action, "executing", "user-1", "Executing");

    // executing → executed
    expect(canTransition(action.status, "executed")).toBe(true);
    action = transitionAction(action, "executed", "system", "Execution complete");

    // executed → verified
    expect(canTransition(action.status, "verified")).toBe(true);
    action = transitionAction(action, "verified", "system", "Verified");

    expect(action.status).toBe("verified");
    expect(action.auditTrail.length).toBeGreaterThan(0);
  });

  it("validates stale → re-prepare → execute flow", () => {
    let action = makeAction({ sourceFingerprint: "fp-old" });

    // Go through: proposed → preparing → prepared → awaiting_confirmation → confirmed
    action = transitionAction(action, "preparing", "atlas", "");
    action = transitionAction(action, "prepared", "atlas", "");
    action = transitionAction(action, "awaiting_confirmation", "system", "");

    // Pre-execution staleness check fails
    const staleCheck = validateBeforeExecution(action, {
      userRole: "customer_admin",
      currentFingerprint: "fp-new",
    });
    expect(staleCheck.valid).toBe(false);

    // Mark as stale (confirmed → stale is valid)
    action = transitionAction(action, "confirmed", "user-1", "User confirmed");
    action = transitionAction(action, "stale", "system", "Source changed");

    // Re-prepare
    expect(canTransition("stale", "preparing")).toBe(true);
    action = transitionAction(action, "preparing", "atlas", "Re-preparing");

    // Update fingerprint
    action = { ...action, sourceFingerprint: "fp-new" };

    action = transitionAction(action, "prepared", "atlas", "Re-prepared");

    // Now validation should pass with new fingerprint (still not confirmed yet)
    const preCheck = validateBeforeExecution(action, {
      userRole: "customer_admin",
      currentFingerprint: "fp-new",
    });
    expect(preCheck.valid).toBe(false); // not confirmed yet
    if (!preCheck.valid) expect(preCheck.code).toBe("action_not_confirmable");

    // Confirm it
    action = transitionAction(action, "awaiting_confirmation", "system", "");
    action = transitionAction(action, "confirmed", "user-1", "Confirmed");

    const validCheck = validateBeforeExecution(action, {
      userRole: "customer_admin",
      currentFingerprint: "fp-new",
    });
    expect(validCheck.valid).toBe(true);
  });
});
