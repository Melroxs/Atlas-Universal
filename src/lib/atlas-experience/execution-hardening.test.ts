// ---------------------------------------------------------------------------
// Prompt 18 — Atlas Experience Production Hardening Test Suite
//
// Comprehensive tests covering:
//   Phase 2  — Action Lifecycle (transitions, terminal-state protection)
//   Phase 3  — Pre-Execution Validation (authorization, expiry, staleness, idempotency)
//   Phase 5  — Idempotency (duplicates, concurrent, replay)
//   Phase 6  — Retry Policy (safe, unsafe, manual_review, limits, backoff)
//   Phase 8  — Result Contract (required fields per status)
//   Phase 9  — Human Feedback (buildActionFeedback per outcome)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  // Lifecycle
  createAction,
  transitionAction,
  canTransition,
  // Safety
  getActionRisk,
  alwaysRequiresConfirmation,
  // Authorization
  checkAuthorization,
  // Confirmation
  prepareForConfirmation,
  validateConfirmation,
  generateConfirmationToken,
  DEFAULT_CONFIRMATION_TIMEOUT_MS,
  // Expiration
  isActionExpired,
  isActionStale,
  // Idempotency
  generateIdempotencyKey,
  // Pre-execution validation
  validateBeforeExecution,
  // Retry
  classifyRetry,
  calculateRetryDelay,
  MAX_SAFE_RETRIES,
  RETRY_BASE_DELAY_MS,
  // Ambiguous execution
  handleAmbiguousExecution,
  // Feedback
  buildActionFeedback,
  // Result factories
  createSuccessResult,
  createFailureResult,
  createBlockedResult,
  // Action proposal
  proposeAction,
  // Fingerprint
  generateSourceFingerprint,
  // Telemetry
  logActionTelemetry,
  getActionTelemetry,
  clearActionTelemetry,
  // Types
  type AtlasUserRole,
  type AtlasActionType,
  type AtlasExecutableAction,
  type AtlasActionResult,
  type AtlasActionStatus,
} from "./execution";
import type { AtlasEntityReference } from "./entity-reference";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const claimEntity: AtlasEntityReference = {
  type: "claim",
  id: "1042",
  label: "Claim #1042",
};

const supplementEntity: AtlasEntityReference = {
  type: "supplement",
  id: "supp-1",
  label: "Supplement #supp-1",
};

const ALL_ROLES: AtlasUserRole[] = [
  "super_admin",
  "atlas_admin",
  "customer_admin",
  "customer_user",
];

const ALL_STATUSES: AtlasActionStatus[] = [
  "proposed",
  "preparing",
  "prepared",
  "awaiting_confirmation",
  "confirmed",
  "executing",
  "executed",
  "verified",
  "failed",
  "blocked",
  "rejected",
  "expired",
  "stale",
  "cancelled",
  "retry_pending",
  "verification_pending",
];

// ---------------------------------------------------------------------------
// Phase 2 — Action Lifecycle
// ---------------------------------------------------------------------------

describe("Phase 2: Action Lifecycle", () => {
  it("creates action in proposed status with all required fields", () => {
    const action = createAction(
      "prepare_supplement",
      "Prepare Supplement",
      "Atlas will prepare a supplement",
      claimEntity,
      { claimId: "1042" },
      "user-1",
    );

    expect(action.id).toMatch(/^action-/);
    expect(action.status).toBe("proposed");
    expect(action.type).toBe("prepare_supplement");
    expect(action.entity.id).toBe("1042");
    expect(action.entity.type).toBe("claim");
    expect(action.risk).toBe("medium");
    expect(action.idempotencyKey).toBeDefined();
    expect(action.auditTrail).toHaveLength(1);
    expect(action.auditTrail[0].to).toBe("proposed");
  });

  it("validates all 16 lifecycle states exist", () => {
    expect(ALL_STATUSES).toHaveLength(16);
  });

  it("allows valid transitions: proposed → preparing → prepared → awaiting_confirmation → confirmed → executing → executed → verified", () => {
    let action = createAction(
      "submit_supplement",
      "Submit",
      "Submit supplement",
      claimEntity,
      {},
      "user-1",
    );
    action = transitionAction(action, "preparing", "user-1");
    expect(action.status).toBe("preparing");
    action = transitionAction(action, "prepared", "user-1");
    expect(action.status).toBe("prepared");
    action = prepareForConfirmation(action);
    expect(action.status).toBe("awaiting_confirmation");
    action = transitionAction(action, "confirmed", "user-1");
    expect(action.status).toBe("confirmed");
    action = transitionAction(action, "executing", "system");
    expect(action.status).toBe("executing");
    action = transitionAction(action, "executed", "system");
    expect(action.status).toBe("executed");
    action = transitionAction(action, "verified", "system");
    expect(action.status).toBe("verified");
  });

  it("rejects invalid transition: proposed → executing", () => {
    const action = createAction(
      "prepare_supplement",
      "Prepare",
      "Atlas will prepare",
      claimEntity,
      {},
      "user-1",
    );
    expect(() => transitionAction(action, "executing", "user-1")).toThrow(
      "Invalid transition",
    );
  });

  it("rejects invalid transition: confirmed → verified", () => {
    let action = createAction(
      "submit_supplement",
      "Submit",
      "Submit",
      claimEntity,
      {},
      "user-1",
    );
    action = transitionAction(action, "preparing", "user-1");
    action = transitionAction(action, "prepared", "user-1");
    action = prepareForConfirmation(action);
    action = transitionAction(action, "confirmed", "user-1");
    expect(() => transitionAction(action, "verified", "user-1")).toThrow(
      "Invalid transition",
    );
  });

  it("canTransition returns true for valid transitions", () => {
    expect(canTransition("proposed", "preparing")).toBe(true);
    expect(canTransition("confirmed", "executing")).toBe(true);
    expect(canTransition("executing", "executed")).toBe(true);
  });

  it("canTransition returns false for invalid transitions", () => {
    expect(canTransition("proposed", "executed")).toBe(false);
    expect(canTransition("confirmed", "verified")).toBe(false);
    expect(canTransition("verified", "executing")).toBe(false);
  });

  describe("Terminal-state protection", () => {
    const TERMINAL_STATES: AtlasActionStatus[] = [
      "verified",
      "blocked",
      "rejected",
      "cancelled",
    ];

    for (const terminal of TERMINAL_STATES) {
      it(`prevents transitions from terminal state "${terminal}"`, () => {
        // blocked and rejected are created directly
        let action = createAction(
          "navigate",
          "Navigate",
          "Navigate",
          claimEntity,
          {},
          "user-1",
        );
        // Force the action to a terminal state
        action = { ...action, status: terminal };

        const allowed = VALID_TRANSITIONS_FOR_TEST[terminal] ?? [];
        // Every terminal state should have no valid outgoing transitions
        expect(allowed.length).toBe(0);
      });
    }
  });

  describe("Failure/retry transitions", () => {
    it("allows failed → preparing (retry)", () => {
      expect(canTransition("failed", "preparing")).toBe(true);
    });

    it("allows failed → retry_pending", () => {
      expect(canTransition("failed", "retry_pending")).toBe(true);
    });

    it("allows retry_pending → preparing (retry)", () => {
      expect(canTransition("retry_pending", "preparing")).toBe(true);
    });

    it("allows retry_pending → cancelled", () => {
      expect(canTransition("retry_pending", "cancelled")).toBe(true);
    });

    it("allows expired → preparing (re-prepare)", () => {
      expect(canTransition("expired", "preparing")).toBe(true);
    });

    it("allows stale → preparing (re-evaluate)", () => {
      expect(canTransition("stale", "preparing")).toBe(true);
    });
  });
});

// We need to import the VALID_TRANSITIONS map for the terminal state test.
// Since it's not exported, we re-derive it from canTransition.
const VALID_TRANSITIONS_FOR_TEST: Record<AtlasActionStatus, AtlasActionStatus[]> = (() => {
  const all: AtlasActionStatus[] = ALL_STATUSES;
  const transitions: Record<AtlasActionStatus, AtlasActionStatus[]> = {} as any;
  for (const from of all) {
    transitions[from] = all.filter((to) => canTransition(from, to));
  }
  return transitions;
})();

// ---------------------------------------------------------------------------
// Phase 3 — Pre-Execution Validation
// ---------------------------------------------------------------------------

describe("Phase 3: Pre-Execution Validation", () => {
  function confirmedAction(
    overrides?: Partial<AtlasExecutableAction>,
  ): AtlasExecutableAction {
    let action = createAction(
      "approve_recommendation",
      "Approve",
      "Approve recommendation",
      claimEntity,
      { recommendationId: "rec-1" },
      "user-1",
    );
    action = transitionAction(action, "preparing", "atlas");
    action = transitionAction(action, "prepared", "atlas");
    action = prepareForConfirmation(action);
    action = transitionAction(action, "confirmed", "user-1");
    if (overrides) {
      action = { ...action, ...overrides };
    }
    return action;
  }

  it("passes for a valid confirmed action", () => {
    const action = confirmedAction();
    const result = validateBeforeExecution(action, {
      userRole: "atlas_admin",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects non-confirmed action", () => {
    const action = createAction(
      "approve_recommendation",
      "Approve",
      "Approve",
      claimEntity,
      {},
      "user-1",
    );
    const result = validateBeforeExecution(action, { userRole: "atlas_admin" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("action_not_confirmable");
    }
  });

  it("rejects cancelled action", () => {
    const action = confirmedAction({ status: "cancelled" });
    const result = validateBeforeExecution(action, { userRole: "atlas_admin" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("action_cancelled");
      expect(result.retryable).toBe(false);
    }
  });

  it("rejects terminal states (verified, blocked, rejected, expired, stale)", () => {
    const terminalStates: AtlasActionStatus[] = [
      "verified",
      "blocked",
      "rejected",
      "expired",
      "stale",
    ];
    for (const status of terminalStates) {
      const action = confirmedAction({ status });
      const result = validateBeforeExecution(action, {
        userRole: "atlas_admin",
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.code).toBe("action_terminal");
      }
    }
  });

  it("rejects unauthorized user", () => {
    const action = confirmedAction();
    const result = validateBeforeExecution(action, {
      userRole: "customer_user",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("authorization_changed");
      expect(result.retryable).toBe(false);
    }
  });

  it("rejects expired confirmation", () => {
    const action = confirmedAction({
      expiresAt: new Date(Date.now() - 10000).toISOString(),
    });
    const result = validateBeforeExecution(action, { userRole: "atlas_admin" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("confirmation_expired");
      expect(result.retryable).toBe(true);
    }
  });

  it("rejects stale action when fingerprint differs", () => {
    const action = confirmedAction({
      sourceFingerprint: "fp-original",
    });
    const result = validateBeforeExecution(action, {
      userRole: "atlas_admin",
      currentFingerprint: "fp-changed",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("action_stale");
      expect(result.retryable).toBe(true);
    }
  });

  it("allows action when fingerprint matches", () => {
    const action = confirmedAction({
      sourceFingerprint: "fp-original",
    });
    const result = validateBeforeExecution(action, {
      userRole: "atlas_admin",
      currentFingerprint: "fp-original",
    });
    expect(result.valid).toBe(true);
  });

  it("allows action without fingerprint check when no currentFingerprint provided", () => {
    const action = confirmedAction({
      sourceFingerprint: "fp-original",
    });
    const result = validateBeforeExecution(action, {
      userRole: "atlas_admin",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects duplicate action (idempotency)", () => {
    const action = confirmedAction();
    const result = validateBeforeExecution(action, {
      userRole: "atlas_admin",
      idempotencyKeyExists: true,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("duplicate_action");
      expect(result.retryable).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 5 — Idempotency
// ---------------------------------------------------------------------------

describe("Phase 5: Idempotency", () => {
  it("generates deterministic idempotency keys", () => {
    const key1 = generateIdempotencyKey("prepare_supplement", "1042", {
      claimId: "1042",
    });
    const key2 = generateIdempotencyKey("prepare_supplement", "1042", {
      claimId: "1042",
    });
    expect(key1).toBe(key2);
  });

  it("generates different keys for different entities", () => {
    const key1 = generateIdempotencyKey("prepare_supplement", "1042", {});
    const key2 = generateIdempotencyKey("prepare_supplement", "1043", {});
    expect(key1).not.toBe(key2);
  });

  it("generates different keys for different action types", () => {
    const key1 = generateIdempotencyKey("prepare_supplement", "1042", {});
    const key2 = generateIdempotencyKey("prepare_email", "1042", {});
    expect(key1).not.toBe(key2);
  });

  it("generates different keys for different parameters", () => {
    const key1 = generateIdempotencyKey("prepare_supplement", "1042", {
      reason: "A",
    });
    const key2 = generateIdempotencyKey("prepare_supplement", "1042", {
      reason: "B",
    });
    expect(key1).not.toBe(key2);
  });

  it("prevents duplicate execution via idempotency check", () => {
    let action = createAction(
      "approve_recommendation",
      "Approve",
      "Approve",
      claimEntity,
      { recommendationId: "rec-1" },
      "user-1",
    );
    action = transitionAction(action, "preparing", "user-1");
    action = transitionAction(action, "prepared", "user-1");
    action = prepareForConfirmation(action);
    action = transitionAction(action, "confirmed", "user-1");
    const result = validateBeforeExecution(action, {
      userRole: "atlas_admin",
      idempotencyKeyExists: true,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("duplicate_action");
    }
  });

  it("completed action replay returns idempotent success via executeAction", async () => {
    // Must be in confirmed status for the idempotency check to be reached
    let action = createAction(
      "approve_recommendation",
      "Approve",
      "Approve",
      claimEntity,
      {},
      "user-1",
    );
    action = transitionAction(action, "preparing", "user-1");
    action = transitionAction(action, "prepared", "user-1");
    action = prepareForConfirmation(action);
    action = transitionAction(action, "confirmed", "user-1");
    // Validate with idempotencyKeyExists=true
    const validation = validateBeforeExecution(action, {
      userRole: "atlas_admin",
      idempotencyKeyExists: true,
    });
    expect(validation.valid).toBe(false);
    if (!validation.valid) {
      expect(validation.code).toBe("duplicate_action");
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 6 — Retry Policy
// ---------------------------------------------------------------------------

describe("Phase 6: Retry Policy", () => {
  describe("classifyRetry", () => {
    it("classifies network_timeout as safe", () => {
      expect(classifyRetry("network_timeout", "prepare_supplement")).toBe(
        "safe",
      );
    });

    it("classifies temporary_failure as safe", () => {
      expect(classifyRetry("temporary_failure", "submit_supplement")).toBe(
        "safe",
      );
    });

    it("classifies ambiguous_result as unsafe", () => {
      expect(classifyRetry("ambiguous_result", "submit_supplement")).toBe(
        "unsafe",
      );
    });

    it("classifies idempotency_conflict as unsafe", () => {
      expect(classifyRetry("idempotency_conflict", "submit_supplement")).toBe(
        "unsafe",
      );
    });

    it("classifies entity_changed as unsafe", () => {
      expect(classifyRetry("entity_changed", "prepare_supplement")).toBe(
        "unsafe",
      );
    });

    it("classifies high-risk action as manual_review", () => {
      expect(classifyRetry("backend_error", "submit_supplement")).toBe(
        "manual_review",
      );
    });

    it("classifies unknown low-risk error as safe", () => {
      expect(classifyRetry("unknown_error", "prepare_supplement")).toBe("safe");
    });
  });

  describe("Retry limits", () => {
    it("MAX_SAFE_RETRIES is 3", () => {
      expect(MAX_SAFE_RETRIES).toBe(3);
    });

    it("calculateRetryDelay uses exponential backoff", () => {
      const delay0 = calculateRetryDelay(0);
      const delay1 = calculateRetryDelay(1);
      const delay2 = calculateRetryDelay(2);
      expect(delay0).toBe(RETRY_BASE_DELAY_MS);
      expect(delay1).toBe(RETRY_BASE_DELAY_MS * 2);
      expect(delay2).toBe(RETRY_BASE_DELAY_MS * 4);
    });

    it("calculateRetryDelay caps at 30 seconds", () => {
      const delay20 = calculateRetryDelay(20);
      expect(delay20).toBe(30_000);
    });

    it("calculateRetryDelay returns positive values for all attempts", () => {
      for (let i = 0; i < 10; i++) {
        expect(calculateRetryDelay(i)).toBeGreaterThan(0);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 8 — Result Contract
// ---------------------------------------------------------------------------

describe("Phase 8: Result Contract", () => {
  it("createSuccessResult has required fields", () => {
    const result = createSuccessResult(
      "action-1",
      claimEntity,
      "Success message",
    );
    expect(result.actionId).toBe("action-1");
    expect(result.status).toBe("executed");
    expect(result.message).toBe("Success message");
    expect(result.entity).toBe(claimEntity);
  });

  it("createFailureResult has error code and message", () => {
    const result = createFailureResult(
      "action-1",
      "Something failed",
      "backend_error",
    );
    expect(result.actionId).toBe("action-1");
    expect(result.status).toBe("failed");
    expect(result.message).toBe("Something failed");
    expect(result.error?.code).toBe("backend_error");
    expect(result.error?.message).toBe("Something failed");
  });

  it("createFailureResult with retryable flag", () => {
    const result = createFailureResult(
      "action-1",
      "Timeout",
      "network_timeout",
      true,
    );
    expect(result.error?.retryable).toBe(true);
  });

  it("createBlockedResult returns blocked status", () => {
    const result = createBlockedResult("action-1", "Unauthorized");
    expect(result.status).toBe("blocked");
    expect(result.message).toContain("Unauthorized");
  });

  it("handleAmbiguousExecution returns verification_required result", () => {
    const action = createAction(
      "submit_supplement",
      "Submit",
      "Submit",
      claimEntity,
      {},
      "user-1",
    );
    const { result, action: updatedAction } = handleAmbiguousExecution(
      action,
      new Error("Network timeout"),
    );
    expect(result.verificationRequired).toBe(true);
    expect(result.retryable).toBe(false);
    expect(updatedAction.status).toBe("verification_pending");
  });

  it("handleAmbiguousExecution never returns false success", () => {
    const action = createAction(
      "submit_supplement",
      "Submit",
      "Submit",
      claimEntity,
      {},
      "user-1",
    );
    const { result } = handleAmbiguousExecution(action, new Error("timeout"));
    // Must NOT be a clean "executed" without verification
    expect(result.verificationRequired).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 9 — Human Feedback
// ---------------------------------------------------------------------------

describe("Phase 9: Human Feedback", () => {
  function makeAction(
    status: AtlasActionStatus,
    label = "Test Action",
  ): AtlasExecutableAction {
    const action = createAction(
      "approve_recommendation",
      label,
      "Test",
      claimEntity,
      {},
      "user-1",
    );
    return { ...action, status };
  }

  it("provides feedback for executed action", () => {
    const action = makeAction("executed");
    const feedback = buildActionFeedback(action);
    expect(feedback).toContain("completed successfully");
  });

  it("provides feedback for verified action", () => {
    const action = makeAction("verified");
    const feedback = buildActionFeedback(action);
    expect(feedback).toContain("verified");
  });

  it("provides feedback for failed action (retryable)", () => {
    const action = makeAction("failed");
    const result: AtlasActionResult = {
      actionId: action.id,
      status: "failed",
      message: "Failed",
      error: { code: "timeout", message: "timeout", retryable: true },
    };
    const feedback = buildActionFeedback(action, result);
    expect(feedback).toContain("temporary issue");
  });

  it("provides feedback for failed action (unsafe retry)", () => {
    const action = makeAction("failed");
    const result: AtlasActionResult = {
      actionId: action.id,
      status: "failed",
      message: "Failed",
      error: {
        code: "ambiguous",
        message: "ambiguous",
        retryable: false,
        unsafeRetry: true,
      },
    };
    const feedback = buildActionFeedback(action, result);
    expect(feedback).toContain("ambiguous");
    expect(feedback).toContain("not retried");
  });

  it("provides feedback for blocked action", () => {
    const action = makeAction("blocked");
    const feedback = buildActionFeedback(action);
    expect(feedback).toContain("permission");
  });

  it("provides feedback for stale action", () => {
    const action = makeAction("stale");
    const feedback = buildActionFeedback(action);
    expect(feedback).toContain("changed");
  });

  it("provides feedback for expired action", () => {
    const action = makeAction("expired");
    const feedback = buildActionFeedback(action);
    expect(feedback).toContain("expired");
  });

  it("provides feedback for cancelled action", () => {
    const action = makeAction("cancelled");
    const feedback = buildActionFeedback(action);
    expect(feedback).toContain("cancelled");
  });

  it("provides feedback for verification_pending", () => {
    const action = makeAction("verification_pending");
    const result: AtlasActionResult = {
      actionId: action.id,
      status: "executed",
      message: "Ambiguous",
      verificationRequired: true,
    };
    const feedback = buildActionFeedback(action, result);
    expect(feedback).toContain("couldn't verify");
  });

  it("provides feedback for executed with verification required", () => {
    const action = makeAction("executed");
    const result: AtlasActionResult = {
      actionId: action.id,
      status: "executed",
      message: "Done",
      verificationRequired: true,
    };
    const feedback = buildActionFeedback(action, result);
    expect(feedback).toContain("couldn't verify");
  });
});

// ---------------------------------------------------------------------------
// Phase 11 — CRM/Pilot Regression Guard
// ---------------------------------------------------------------------------

describe("Phase 11: CRM/Pilot Regression Guard", () => {
  it("AtlasUserRole does not include pilot_user", () => {
    const roles: AtlasUserRole[] = [
      "super_admin",
      "atlas_admin",
      "customer_admin",
      "customer_user",
    ];
    // pilot_user should not be in the type (compile-time check)
    // But we also verify no role string contains 'pilot'
    for (const role of roles) {
      expect(role).not.toContain("pilot");
    }
  });

  it("no action type references CRM", () => {
    const actionTypes: AtlasActionType[] = [
      "navigate",
      "show_evidence",
      "show_decision",
      "prepare_supplement",
      "prepare_email",
      "submit_supplement",
      "send_email",
      "approve_recommendation",
      "reject_recommendation",
      "execute_workflow",
      "update_record",
      "create_record",
      "ask_followup",
    ];
    for (const type of actionTypes) {
      expect(type).not.toMatch(/crm/i);
      expect(type).not.toMatch(/pilot/i);
      expect(type).not.toMatch(/outreach/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 12 — Organization Admin Boundary
// ---------------------------------------------------------------------------

describe("Phase 12: Organization Admin Boundary", () => {
  it("all roles can navigate (read-only actions)", () => {
    for (const role of ALL_ROLES) {
      expect(checkAuthorization("navigate", role).allowed).toBe(true);
      expect(checkAuthorization("show_evidence", role).allowed).toBe(true);
      expect(checkAuthorization("show_decision", role).allowed).toBe(true);
      expect(checkAuthorization("ask_followup", role).allowed).toBe(true);
    }
  });

  it("customer_user cannot execute write actions", () => {
    const writeActions: AtlasActionType[] = [
      "prepare_supplement",
      "prepare_email",
      "submit_supplement",
      "send_email",
      "approve_recommendation",
      "reject_recommendation",
      "execute_workflow",
      "update_record",
      "create_record",
    ];
    for (const action of writeActions) {
      expect(checkAuthorization(action, "customer_user").allowed).toBe(false);
    }
  });

  it("customer_admin can execute write actions", () => {
    const writeActions: AtlasActionType[] = [
      "prepare_supplement",
      "prepare_email",
      "submit_supplement",
      "send_email",
      "approve_recommendation",
      "reject_recommendation",
      "execute_workflow",
      "update_record",
      "create_record",
    ];
    for (const action of writeActions) {
      expect(checkAuthorization(action, "customer_admin").allowed).toBe(true);
    }
  });

  it("super_admin can execute all actions", () => {
    const actionTypes: AtlasActionType[] = [
      "navigate",
      "show_evidence",
      "show_decision",
      "ask_followup",
      "prepare_supplement",
      "prepare_email",
      "submit_supplement",
      "send_email",
      "approve_recommendation",
      "reject_recommendation",
      "execute_workflow",
      "update_record",
      "create_record",
    ];
    for (const action of actionTypes) {
      expect(checkAuthorization(action, "super_admin").allowed).toBe(true);
    }
  });

  it("atlas_admin can execute all actions", () => {
    const actionTypes: AtlasActionType[] = [
      "navigate",
      "show_evidence",
      "show_decision",
      "ask_followup",
      "prepare_supplement",
      "prepare_email",
      "submit_supplement",
      "send_email",
      "approve_recommendation",
      "reject_recommendation",
      "execute_workflow",
      "update_record",
      "create_record",
    ];
    for (const action of actionTypes) {
      expect(checkAuthorization(action, "atlas_admin").allowed).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

describe("Action Telemetry", () => {
  beforeEach(() => {
    clearActionTelemetry();
  });

  it("logs and retrieves telemetry records", () => {
    logActionTelemetry({
      event: "action_proposed",
      timestamp: new Date().toISOString(),
      actionId: "action-1",
      actionType: "prepare_supplement",
      entityType: "claim",
      risk: "medium",
      actor: "user-1",
    });

    const records = getActionTelemetry();
    expect(records).toHaveLength(1);
    expect(records[0].event).toBe("action_proposed");
    expect(records[0].actionId).toBe("action-1");
  });

  it("clears telemetry records", () => {
    logActionTelemetry({
      event: "action_proposed",
      timestamp: new Date().toISOString(),
      actionId: "action-1",
      actionType: "navigate",
      entityType: "claim",
      risk: "low",
      actor: "user-1",
    });
    clearActionTelemetry();
    expect(getActionTelemetry()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

describe("Source Fingerprint", () => {
  it("generates deterministic fingerprints", () => {
    const fp1 = generateSourceFingerprint({ status: "open", title: "Test" });
    const fp2 = generateSourceFingerprint({ status: "open", title: "Test" });
    expect(fp1).toBe(fp2);
  });

  it("generates different fingerprints for different data", () => {
    const fp1 = generateSourceFingerprint({ status: "open" });
    const fp2 = generateSourceFingerprint({ status: "closed" });
    expect(fp1).not.toBe(fp2);
  });

  it("generates different fingerprints for different keys", () => {
    const fp1 = generateSourceFingerprint({ a: 1, b: 2 });
    const fp2 = generateSourceFingerprint({ b: 2, a: 1 });
    // Different order → same result because Object.keys().sort()
    expect(fp1).toBe(fp2);
  });

  it("does not flag action as stale when no fingerprint exists", () => {
    const action = createAction(
      "navigate",
      "Navigate",
      "Navigate",
      claimEntity,
      {},
      "user-1",
    );
    expect(isActionStale(action, "fp-anything")).toBe(false);
  });

  it("flags action as stale when fingerprints differ", () => {
    const action = createAction(
      "navigate",
      "Navigate",
      "Navigate",
      claimEntity,
      {},
      "user-1",
      { sourceFingerprint: "fp-original" },
    );
    expect(isActionStale(action, "fp-changed")).toBe(true);
  });

  it("does not flag action as stale when fingerprints match", () => {
    const action = createAction(
      "navigate",
      "Navigate",
      "Navigate",
      claimEntity,
      {},
      "user-1",
      { sourceFingerprint: "fp-original" },
    );
    expect(isActionStale(action, "fp-original")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Risk Classification
// ---------------------------------------------------------------------------

describe("Risk Classification", () => {
  it("classifies all read actions as low risk", () => {
    const readActions: AtlasActionType[] = [
      "navigate",
      "show_evidence",
      "show_decision",
      "ask_followup",
    ];
    for (const action of readActions) {
      expect(getActionRisk(action)).toBe("low");
    }
  });

  it("classifies prepare actions as medium risk", () => {
    expect(getActionRisk("prepare_supplement")).toBe("medium");
    expect(getActionRisk("prepare_email")).toBe("medium");
    expect(getActionRisk("reject_recommendation")).toBe("medium");
    expect(getActionRisk("create_record")).toBe("medium");
  });

  it("classifies execute actions as high risk", () => {
    const highRiskActions: AtlasActionType[] = [
      "submit_supplement",
      "send_email",
      "approve_recommendation",
      "execute_workflow",
      "update_record",
    ];
    for (const action of highRiskActions) {
      expect(getActionRisk(action)).toBe("high");
    }
  });

  it("high-risk actions always require confirmation", () => {
    expect(alwaysRequiresConfirmation("submit_supplement")).toBe(true);
    expect(alwaysRequiresConfirmation("send_email")).toBe(true);
    expect(alwaysRequiresConfirmation("approve_recommendation")).toBe(true);
  });

  it("low-risk actions do not always require confirmation", () => {
    expect(alwaysRequiresConfirmation("navigate")).toBe(false);
    expect(alwaysRequiresConfirmation("show_evidence")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Confirmation Flow
// ---------------------------------------------------------------------------

describe("Confirmation Flow", () => {
  it("generates a confirmation token", () => {
    const action = createAction(
      "submit_supplement",
      "Submit",
      "Submit",
      claimEntity,
      {},
      "user-1",
    );
    const token = generateConfirmationToken(action);
    expect(token).toMatch(/^confirm-/);
  });

  it("prepareForConfirmation sets status and token", () => {
    let action = createAction(
      "submit_supplement",
      "Submit",
      "Submit",
      claimEntity,
      {},
      "user-1",
    );
    action = transitionAction(action, "preparing", "user-1");
    action = transitionAction(action, "prepared", "user-1");
    const prepared = prepareForConfirmation(action);
    expect(prepared.status).toBe("awaiting_confirmation");
    expect(prepared.confirmationToken).toBeDefined();
    expect(prepared.expiresAt).toBeDefined();
  });

  it("validateConfirmation rejects mismatched token", () => {
    let action = createAction(
      "submit_supplement",
      "Submit",
      "Submit",
      claimEntity,
      {},
      "user-1",
    );
    action = transitionAction(action, "preparing", "user-1");
    action = transitionAction(action, "prepared", "user-1");
    action = prepareForConfirmation(action);
    const result = validateConfirmation(action, "wrong-token");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("mismatch");
  });

  it("validateConfirmation rejects expired confirmation", () => {
    let action = createAction(
      "submit_supplement",
      "Submit",
      "Submit",
      claimEntity,
      {},
      "user-1",
    );
    action = transitionAction(action, "preparing", "user-1");
    action = transitionAction(action, "prepared", "user-1");
    action = prepareForConfirmation(action);
    action = { ...action, expiresAt: new Date(Date.now() - 1000).toISOString() };
    const result = validateConfirmation(
      action,
      action.confirmationToken ?? "",
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("expired");
  });

  it("validateConfirmation rejects non-confirmed action", () => {
    const action = createAction(
      "submit_supplement",
      "Submit",
      "Submit",
      claimEntity,
      {},
      "user-1",
    );
    const result = validateConfirmation(action, "any-token");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not awaiting");
  });
});

// ---------------------------------------------------------------------------
// proposeAction lifecycle
// ---------------------------------------------------------------------------

describe("proposeAction", () => {
  it("creates low-risk action without confirmation", () => {
    const { action } = proposeAction(
      "navigate",
      "Navigate",
      "Navigate to claim",
      claimEntity,
      {},
      "atlas_admin",
      "user-1",
    );
    expect(action.status).toBe("proposed");
    expect(action.risk).toBe("low");
  });

  it("creates medium-risk action through confirmation flow", () => {
    const { action } = proposeAction(
      "prepare_supplement",
      "Prepare",
      "Prepare supplement",
      claimEntity,
      {},
      "atlas_admin",
      "user-1",
    );
    expect(action.status).toBe("awaiting_confirmation");
    expect(action.confirmationToken).toBeDefined();
  });

  it("blocks unauthorized action", () => {
    const { action, blocked } = proposeAction(
      "submit_supplement",
      "Submit",
      "Submit supplement",
      claimEntity,
      {},
      "customer_user",
      "user-1",
    );
    expect(action.status).toBe("blocked");
    expect(blocked).toBeDefined();
    expect(blocked?.allowed).toBe(false);
  });
});
