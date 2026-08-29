// ---------------------------------------------------------------------------
// Atlas Execution Layer — Tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import {
  // Action lifecycle
  transitionAction,
  canTransition,
  createAction,
  // Safety
  getActionRisk,
  alwaysRequiresConfirmation,
  safetyLevelToActionRisk,
  // Authorization
  checkAuthorization,
  // Confirmation
  generateConfirmationToken,
  prepareForConfirmation,
  validateConfirmation,
  // Expiration
  isActionExpired,
  isActionStale,
  generateSourceFingerprint,
  // Idempotency
  generateIdempotencyKey,
  // Capability registry
  registerCapability,
  registerCapabilities,
  getCapability,
  getAllCapabilities,
  getCapabilitiesByCategory,
  getCapabilitiesForRole,
  clearCapabilities,
  registerDefaultCapabilities,
  // Validation
  validateActionInput,
  // Results
  createSuccessResult,
  createFailureResult,
  createBlockedResult,
  // Orchestration
  proposeAction,
  resolveActionEntity,
  buildConfirmationPrompt,
  // Audit
  getAuditTrail,
  summarizeAuditTrail,
  // Decision bridge
  decisionToAction,
  // Intent resolution
  resolvePrepareIntent,
  resolveSubmitIntent,
  // Telemetry
  logActionTelemetry,
  getActionTelemetry,
  clearActionTelemetry,
  DEFAULT_CONFIRMATION_TIMEOUT_MS,
  type AtlasExecutableAction,
  type AtlasCapability,
  type AtlasDecision,
} from "./execution";
import type { AtlasEntityReference } from "./entity-reference";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLAIM_ENTITY: AtlasEntityReference = {
  type: "claim",
  id: "claim-1042",
  label: "Claim #1042",
};

const DOCUMENT_ENTITY: AtlasEntityReference = {
  type: "document",
  id: "doc-201",
  label: "Document #201",
};

function makeAction(
  overrides?: Partial<AtlasExecutableAction>,
): AtlasExecutableAction {
  return createAction(
    "prepare_supplement",
    "Prepare supplement",
    "Prepare supplement for Claim #1042",
    CLAIM_ENTITY,
    { claimId: "claim-1042" },
    "atlas",
    overrides,
  );
}

// ---------------------------------------------------------------------------
// 1. Action Lifecycle Transitions
// ---------------------------------------------------------------------------

describe("Action Lifecycle Transitions", () => {
  it("proposed → preparing is valid", () => {
    const action = makeAction();
    const result = transitionAction(action, "preparing", "atlas", "Starting preparation");
    expect(result.status).toBe("preparing");
    expect(result.auditTrail).toHaveLength(2); // created + transition
  });

  it("proposed → preparing → prepared → awaiting_confirmation is valid", () => {
    let action = makeAction();
    action = transitionAction(action, "preparing", "atlas");
    action = transitionAction(action, "prepared", "atlas");
    action = transitionAction(action, "awaiting_confirmation", "atlas");
    expect(action.status).toBe("awaiting_confirmation");
  });

  it("awaiting_confirmation → confirmed → executing → executed → verified", () => {
    let action = makeAction();
    action = transitionAction(action, "preparing", "atlas");
    action = transitionAction(action, "prepared", "atlas");
    action = transitionAction(action, "awaiting_confirmation", "atlas");
    action = transitionAction(action, "confirmed", "user");
    action = transitionAction(action, "executing", "atlas");
    action = transitionAction(action, "executed", "system");
    action = transitionAction(action, "verified", "system");
    expect(action.status).toBe("verified");
  });

  it("proposed → blocked is valid", () => {
    const action = makeAction();
    const result = transitionAction(action, "blocked", "system", "Unauthorized");
    expect(result.status).toBe("blocked");
  });

  it("awaiting_confirmation → rejected is valid", () => {
    let action = makeAction();
    action = transitionAction(action, "preparing", "atlas");
    action = transitionAction(action, "prepared", "atlas");
    action = transitionAction(action, "awaiting_confirmation", "atlas");
    const result = transitionAction(action, "rejected", "user");
    expect(result.status).toBe("rejected");
  });

  it("awaiting_confirmation → expired is valid", () => {
    let action = makeAction();
    action = transitionAction(action, "preparing", "atlas");
    action = transitionAction(action, "prepared", "atlas");
    action = transitionAction(action, "awaiting_confirmation", "atlas");
    const result = transitionAction(action, "expired", "system");
    expect(result.status).toBe("expired");
  });

  it("executing → failed is valid", () => {
    let action = makeAction();
    action = transitionAction(action, "preparing", "atlas");
    action = transitionAction(action, "prepared", "atlas");
    action = transitionAction(action, "executing", "atlas");
    const result = transitionAction(action, "failed", "system");
    expect(result.status).toBe("failed");
  });

  it("failed → preparing is valid (retry)", () => {
    let action = makeAction();
    action = transitionAction(action, "preparing", "atlas");
    action = transitionAction(action, "failed", "system");
    const result = transitionAction(action, "preparing", "atlas", "Retrying");
    expect(result.status).toBe("preparing");
  });

  it("verified → anything throws (terminal state)", () => {
    let action = makeAction();
    action = transitionAction(action, "preparing", "atlas");
    action = transitionAction(action, "prepared", "atlas");
    action = transitionAction(action, "executing", "atlas");
    action = transitionAction(action, "executed", "system");
    action = transitionAction(action, "verified", "system");
    expect(() => transitionAction(action, "proposed", "system")).toThrow("Invalid transition");
  });

  it("blocked → anything throws (terminal state)", () => {
    const action = makeAction();
    const blocked = transitionAction(action, "blocked", "system");
    expect(() => transitionAction(blocked, "proposed", "system")).toThrow("Invalid transition");
  });

  it("rejected → anything throws (terminal state)", () => {
    let action = makeAction();
    action = transitionAction(action, "preparing", "atlas");
    action = transitionAction(action, "prepared", "atlas");
    action = transitionAction(action, "rejected", "user");
    expect(() => transitionAction(action, "proposed", "system")).toThrow("Invalid transition");
  });

  it("canTransition returns correct boolean", () => {
    expect(canTransition("proposed", "preparing")).toBe(true);
    expect(canTransition("proposed", "executed")).toBe(false);
    expect(canTransition("awaiting_confirmation", "confirmed")).toBe(true);
    expect(canTransition("awaiting_confirmation", "executing")).toBe(false);
  });

  it("audit trail accumulates across transitions", () => {
    let action = makeAction();
    action = transitionAction(action, "preparing", "atlas");
    action = transitionAction(action, "prepared", "atlas");
    expect(action.auditTrail).toHaveLength(3); // created + 2 transitions
  });
});

// ---------------------------------------------------------------------------
// 2. Safety Classification
// ---------------------------------------------------------------------------

describe("Safety Classification", () => {
  it("navigate is low risk", () => {
    expect(getActionRisk("navigate")).toBe("low");
  });

  it("show_evidence is low risk", () => {
    expect(getActionRisk("show_evidence")).toBe("low");
  });

  it("show_decision is low risk", () => {
    expect(getActionRisk("show_decision")).toBe("low");
  });

  it("ask_followup is low risk", () => {
    expect(getActionRisk("ask_followup")).toBe("low");
  });

  it("prepare_supplement is medium risk", () => {
    expect(getActionRisk("prepare_supplement")).toBe("medium");
  });

  it("prepare_email is medium risk", () => {
    expect(getActionRisk("prepare_email")).toBe("medium");
  });

  it("prepare_crm_activity is medium risk", () => {
    expect(getActionRisk("prepare_crm_activity")).toBe("medium");
  });

  it("submit_supplement is high risk", () => {
    expect(getActionRisk("submit_supplement")).toBe("high");
  });

  it("send_email is high risk", () => {
    expect(getActionRisk("send_email")).toBe("high");
  });

  it("approve_recommendation is high risk", () => {
    expect(getActionRisk("approve_recommendation")).toBe("high");
  });

  it("update_record is high risk", () => {
    expect(getActionRisk("update_record")).toBe("high");
  });

  it("create_record is medium risk", () => {
    expect(getActionRisk("create_record")).toBe("medium");
  });

  it("alwaysRequiresConfirmation returns true for high risk", () => {
    expect(alwaysRequiresConfirmation("submit_supplement")).toBe(true);
    expect(alwaysRequiresConfirmation("send_email")).toBe(true);
    expect(alwaysRequiresConfirmation("approve_recommendation")).toBe(true);
  });

  it("alwaysRequiresConfirmation returns false for low/medium risk", () => {
    expect(alwaysRequiresConfirmation("navigate")).toBe(false);
    expect(alwaysRequiresConfirmation("prepare_supplement")).toBe(false);
  });

  it("safetyLevelToActionRisk maps correctly", () => {
    expect(safetyLevelToActionRisk("low")).toBe("low");
    expect(safetyLevelToActionRisk("medium")).toBe("medium");
    expect(safetyLevelToActionRisk("high")).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// 3. Authorization
// ---------------------------------------------------------------------------

describe("Authorization", () => {
  it("super_admin can do everything", () => {
    expect(checkAuthorization("navigate", "super_admin").allowed).toBe(true);
    expect(checkAuthorization("submit_supplement", "super_admin").allowed).toBe(true);
    expect(checkAuthorization("send_email", "super_admin").allowed).toBe(true);
    expect(checkAuthorization("approve_recommendation", "super_admin").allowed).toBe(true);
  });

  it("atlas_admin can do everything", () => {
    expect(checkAuthorization("navigate", "atlas_admin").allowed).toBe(true);
    expect(checkAuthorization("submit_supplement", "atlas_admin").allowed).toBe(true);
  });

  it("customer_admin can do most things", () => {
    expect(checkAuthorization("navigate", "customer_admin").allowed).toBe(true);
    expect(checkAuthorization("prepare_supplement", "customer_admin").allowed).toBe(true);
    expect(checkAuthorization("submit_supplement", "customer_admin").allowed).toBe(true);
    expect(checkAuthorization("send_email", "customer_admin").allowed).toBe(true);
  });

  it("customer_user can read but not write", () => {
    expect(checkAuthorization("navigate", "customer_user").allowed).toBe(true);
    expect(checkAuthorization("show_evidence", "customer_user").allowed).toBe(true);
    expect(checkAuthorization("prepare_supplement", "customer_user").allowed).toBe(false);
    expect(checkAuthorization("submit_supplement", "customer_user").allowed).toBe(false);
    expect(checkAuthorization("send_email", "customer_user").allowed).toBe(false);
  });

  it("pilot_user can read but not write", () => {
    expect(checkAuthorization("navigate", "pilot_user").allowed).toBe(true);
    expect(checkAuthorization("prepare_supplement", "pilot_user").allowed).toBe(false);
    expect(checkAuthorization("submit_supplement", "pilot_user").allowed).toBe(false);
  });

  it("customer_user gets requiresApproval for high-risk actions (if allowed)", () => {
    // customer_user is blocked entirely, so approval is irrelevant
    const check = checkAuthorization("approve_recommendation", "customer_user");
    expect(check.allowed).toBe(false);
  });

  it("returns disallowed for unknown action types", () => {
    // @ts-expect-error testing invalid type
    const result = checkAuthorization("fake_action", "super_admin");
    expect(result.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Confirmation Flow
// ---------------------------------------------------------------------------

describe("Confirmation Flow", () => {
  it("generateConfirmationToken produces a string", () => {
    const action = makeAction();
    const token = generateConfirmationToken(action);
    expect(typeof token).toBe("string");
    expect(token).toContain("confirm-");
  });

  it("same action produces same token (deterministic)", () => {
    const action = makeAction();
    const t1 = generateConfirmationToken(action);
    const t2 = generateConfirmationToken(action);
    expect(t1).toBe(t2);
  });

  it("different actions produce different tokens", () => {
    const a1 = createAction(
      "prepare_supplement", "P1", "D1",
      CLAIM_ENTITY, { claimId: "c1" }, "atlas",
    );
    const a2 = createAction(
      "prepare_supplement", "P2", "D2",
      DOCUMENT_ENTITY, { docId: "d1" }, "atlas",
    );
    expect(generateConfirmationToken(a1)).not.toBe(generateConfirmationToken(a2));
  });

  it("prepareForConfirmation sets awaiting_confirmation status", () => {
    const action = makeAction();
    const prepared = prepareForConfirmation(action);
    expect(prepared.status).toBe("awaiting_confirmation");
    expect(prepared.confirmationToken).toBeDefined();
    expect(prepared.expiresAt).toBeDefined();
  });

  it("validateConfirmation succeeds with correct token", () => {
    let action = makeAction();
    action = transitionAction(action, "preparing", "atlas");
    action = transitionAction(action, "prepared", "atlas");
    action = prepareForConfirmation(action);

    const result = validateConfirmation(action, action.confirmationToken!);
    expect(result.valid).toBe(true);
    expect(result.action).toBeDefined();
  });

  it("validateConfirmation fails with wrong token", () => {
    let action = makeAction();
    action = transitionAction(action, "preparing", "atlas");
    action = transitionAction(action, "prepared", "atlas");
    action = prepareForConfirmation(action);

    const result = validateConfirmation(action, "wrong-token");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("mismatch");
  });

  it("validateConfirmation fails if not awaiting_confirmation", () => {
    const action = makeAction(); // status: proposed
    const result = validateConfirmation(action, "any-token");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not awaiting");
  });

  it("validateConfirmation fails if expired", () => {
    let action = makeAction();
    action = transitionAction(action, "preparing", "atlas");
    action = transitionAction(action, "prepared", "atlas");
    action = prepareForConfirmation(action, -1); // expired immediately

    const result = validateConfirmation(action, action.confirmationToken!);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("expired");
  });
});

// ---------------------------------------------------------------------------
// 5. Expiration & Staleness
// ---------------------------------------------------------------------------

describe("Expiration & Staleness", () => {
  it("isActionExpired returns false when no expiration", () => {
    const action = makeAction();
    expect(isActionExpired(action)).toBe(false);
  });

  it("isActionExpired returns true when past expiration", () => {
    const action = makeAction();
    action.expiresAt = new Date(Date.now() - 1000).toISOString();
    expect(isActionExpired(action)).toBe(true);
  });

  it("isActionExpired returns false when before expiration", () => {
    const action = makeAction();
    action.expiresAt = new Date(Date.now() + 60000).toISOString();
    expect(isActionExpired(action)).toBe(false);
  });

  it("isActionStale returns false when no fingerprint", () => {
    const action = makeAction();
    expect(isActionStale(action, "any")).toBe(false);
  });

  it("isActionStale returns true when fingerprint differs", () => {
    const action = makeAction();
    action.sourceFingerprint = "fp-abc";
    expect(isActionStale(action, "fp-xyz")).toBe(true);
  });

  it("isActionStale returns false when fingerprint matches", () => {
    const action = makeAction();
    action.sourceFingerprint = "fp-abc";
    expect(isActionStale(action, "fp-abc")).toBe(false);
  });

  it("generateSourceFingerprint is deterministic", () => {
    const data = { a: 1, b: "hello" };
    const fp1 = generateSourceFingerprint(data);
    const fp2 = generateSourceFingerprint(data);
    expect(fp1).toBe(fp2);
  });

  it("generateSourceFingerprint differs for different data", () => {
    const fp1 = generateSourceFingerprint({ a: 1 });
    const fp2 = generateSourceFingerprint({ a: 2 });
    expect(fp1).not.toBe(fp2);
  });
});

// ---------------------------------------------------------------------------
// 6. Idempotency
// ---------------------------------------------------------------------------

describe("Idempotency", () => {
  it("same inputs produce same key", () => {
    const k1 = generateIdempotencyKey("submit_supplement", "c1", { claimId: "c1" });
    const k2 = generateIdempotencyKey("submit_supplement", "c1", { claimId: "c1" });
    expect(k1).toBe(k2);
  });

  it("different entity produces different key", () => {
    const k1 = generateIdempotencyKey("submit_supplement", "c1", {});
    const k2 = generateIdempotencyKey("submit_supplement", "c2", {});
    expect(k1).not.toBe(k2);
  });

  it("different parameters produce different key", () => {
    const k1 = generateIdempotencyKey("send_email", "r1", { subject: "Hello" });
    const k2 = generateIdempotencyKey("send_email", "r1", { subject: "Goodbye" });
    expect(k1).not.toBe(k2);
  });

  it("parameter order does not matter (sorted)", () => {
    const k1 = generateIdempotencyKey("send_email", "r1", { subject: "Hello", body: "World" });
    const k2 = generateIdempotencyKey("send_email", "r1", { body: "World", subject: "Hello" });
    expect(k1).toBe(k2);
  });
});

// ---------------------------------------------------------------------------
// 7. Capability Registry
// ---------------------------------------------------------------------------

describe("Capability Registry", () => {
  beforeEach(() => {
    clearCapabilities();
  });

  it("registerCapability stores a capability", () => {
    const cap: AtlasCapability = {
      id: "test-cap",
      name: "Test",
      description: "Test capability",
      actionType: "navigate",
      risk: "low",
      requiredRoles: ["super_admin"],
      requiresConfirmation: false,
      requiresApproval: false,
      parameters: [],
      category: "test",
    };
    registerCapability(cap);
    expect(getCapability("test-cap")).toBeDefined();
    expect(getCapability("test-cap")!.name).toBe("Test");
  });

  it("getAllCapabilities returns all registered", () => {
    registerCapabilities([
      { id: "a", name: "A", description: "", actionType: "navigate", risk: "low", requiredRoles: [], requiresConfirmation: false, requiresApproval: false, parameters: [], category: "cat1" },
      { id: "b", name: "B", description: "", actionType: "navigate", risk: "low", requiredRoles: [], requiresConfirmation: false, requiresApproval: false, parameters: [], category: "cat2" },
    ]);
    expect(getAllCapabilities()).toHaveLength(2);
  });

  it("getCapabilitiesByCategory filters correctly", () => {
    registerCapabilities([
      { id: "a", name: "A", description: "", actionType: "navigate", risk: "low", requiredRoles: [], requiresConfirmation: false, requiresApproval: false, parameters: [], category: "read" },
      { id: "b", name: "B", description: "", actionType: "navigate", risk: "low", requiredRoles: [], requiresConfirmation: false, requiresApproval: false, parameters: [], category: "write" },
    ]);
    expect(getCapabilitiesByCategory("read")).toHaveLength(1);
    expect(getCapabilitiesByCategory("read")[0].id).toBe("a");
  });

  it("getCapabilitiesForRole filters by role", () => {
    registerCapabilities([
      { id: "a", name: "A", description: "", actionType: "navigate", risk: "low", requiredRoles: ["super_admin", "customer_user"], requiresConfirmation: false, requiresApproval: false, parameters: [], category: "" },
      { id: "b", name: "B", description: "", actionType: "navigate", risk: "low", requiredRoles: ["super_admin"], requiresConfirmation: false, requiresApproval: false, parameters: [], category: "" },
    ]);
    expect(getCapabilitiesForRole("customer_user")).toHaveLength(1);
    expect(getCapabilitiesForRole("super_admin")).toHaveLength(2);
  });

  it("clearCapabilities empties the registry", () => {
    registerCapability({ id: "x", name: "X", description: "", actionType: "navigate", risk: "low", requiredRoles: [], requiresConfirmation: false, requiresApproval: false, parameters: [], category: "" });
    expect(getAllCapabilities()).toHaveLength(1);
    clearCapabilities();
    expect(getAllCapabilities()).toHaveLength(0);
  });

  it("registerDefaultCapabilities loads built-in capabilities", () => {
    registerDefaultCapabilities();
    expect(getAllCapabilities().length).toBeGreaterThan(0);
    expect(getCapability("search_entities")).toBeDefined();
    expect(getCapability("prepare_supplement")).toBeDefined();
    expect(getCapability("submit_supplement")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 8. Input Validation
// ---------------------------------------------------------------------------

describe("Input Validation", () => {
  beforeEach(() => {
    clearCapabilities();
  });

  const cap: AtlasCapability = {
    id: "test",
    name: "Test",
    description: "",
    actionType: "navigate",
    risk: "low",
    requiredRoles: [],
    requiresConfirmation: false,
    requiresApproval: false,
    parameters: [
      { name: "query", type: "string", required: true, description: "Query" },
      { name: "count", type: "number", required: false, description: "Count" },
      { name: "mode", type: "enum", required: false, description: "Mode", enum: ["fast", "slow"] },
    ],
    category: "",
  };

  it("validates successfully with all required params", () => {
    const result = validateActionInput(cap, { query: "test" });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails when required param is missing", () => {
    const result = validateActionInput(cap, {});
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required parameter: query");
  });

  it("fails when wrong type is provided", () => {
    const result = validateActionInput(cap, { query: 123 });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("must be a string");
  });

  it("validates enum values", () => {
    const result = validateActionInput(cap, { query: "test", mode: "invalid" });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("must be one of");
  });

  it("accepts valid enum values", () => {
    const result = validateActionInput(cap, { query: "test", mode: "fast" });
    expect(result.valid).toBe(true);
  });

  it("validates number type", () => {
    const result = validateActionInput(cap, { query: "test", count: "not-a-number" });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("must be a number");
  });
});

// ---------------------------------------------------------------------------
// 9. Action Creation
// ---------------------------------------------------------------------------

describe("Action Creation", () => {
  it("creates a proposed action with correct defaults", () => {
    const action = createAction(
      "prepare_supplement",
      "Prepare supplement",
      "Prepare a supplement draft",
      CLAIM_ENTITY,
      { claimId: "c1" },
      "atlas",
    );
    expect(action.status).toBe("proposed");
    expect(action.type).toBe("prepare_supplement");
    expect(action.risk).toBe("medium");
    expect(action.requiresConfirmation).toBe(false);
    expect(action.entity.id).toBe("claim-1042");
    expect(action.idempotencyKey).toBeDefined();
    expect(action.auditTrail).toHaveLength(1);
    expect(action.auditTrail[0].to).toBe("proposed");
  });

  it("sets requiresConfirmation for high-risk actions", () => {
    const action = createAction(
      "submit_supplement",
      "Submit",
      "Submit supplement",
      CLAIM_ENTITY,
      {},
      "atlas",
    );
    expect(action.requiresConfirmation).toBe(true);
    expect(action.risk).toBe("high");
  });

  it("sets decisionId when provided", () => {
    const action = createAction(
      "approve_recommendation",
      "Approve",
      "Approve recommendation",
      CLAIM_ENTITY,
      {},
      "atlas",
      { decisionId: "d1" },
    );
    expect(action.decisionId).toBe("d1");
  });
});

// ---------------------------------------------------------------------------
// 10. Results
// ---------------------------------------------------------------------------

describe("Action Results", () => {
  it("createSuccessResult returns executed status", () => {
    const result = createSuccessResult("a1", CLAIM_ENTITY, "Done");
    expect(result.status).toBe("executed");
    expect(result.actionId).toBe("a1");
    expect(result.entity).toBe(CLAIM_ENTITY);
    expect(result.message).toBe("Done");
  });

  it("createFailureResult returns failed status with error", () => {
    const result = createFailureResult("a1", "Something broke", "E001", true);
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("E001");
    expect(result.error?.retryable).toBe(true);
  });

  it("createBlockedResult returns blocked status", () => {
    const result = createBlockedResult("a1", "Unauthorized");
    expect(result.status).toBe("blocked");
    expect(result.message).toContain("Unauthorized");
  });
});

// ---------------------------------------------------------------------------
// 11. Propose Action Orchestrator
// ---------------------------------------------------------------------------

describe("Propose Action", () => {
  it("proposes a low-risk action without confirmation", () => {
    const { action } = proposeAction(
      "navigate",
      "Open claim",
      "Open Claim #1042",
      CLAIM_ENTITY,
      {},
      "customer_user",
      "atlas",
    );
    expect(action.status).toBe("proposed");
    expect(action.risk).toBe("low");
    expect(action.requiresConfirmation).toBe(false);
  });

  it("proposes a medium-risk action with confirmation", () => {
    const { action } = proposeAction(
      "prepare_supplement",
      "Prepare supplement",
      "Prepare supplement draft",
      CLAIM_ENTITY,
      {},
      "customer_admin",
      "atlas",
    );
    expect(action.status).toBe("awaiting_confirmation");
    expect(action.confirmationToken).toBeDefined();
  });

  it("blocks an unauthorized action", () => {
    const { action, blocked } = proposeAction(
      "submit_supplement",
      "Submit",
      "Submit supplement",
      CLAIM_ENTITY,
      {},
      "customer_user", // not authorized
      "atlas",
    );
    expect(action.status).toBe("blocked");
    expect(blocked).toBeDefined();
    expect(blocked!.allowed).toBe(false);
  });

  it("marks high-risk action as not requiring approval for admin roles", () => {
    const { action } = proposeAction(
      "submit_supplement",
      "Submit",
      "Submit supplement",
      CLAIM_ENTITY,
      {},
      "customer_admin",
      "atlas",
    );
    expect(action.requiresApproval).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 12. Entity Resolution
// ---------------------------------------------------------------------------

describe("Entity Resolution", () => {
  it("resolves 'it' to current entity", () => {
    const result = resolveActionEntity("it", CLAIM_ENTITY);
    expect(result).toBe(CLAIM_ENTITY);
  });

  it("resolves 'this' to current entity", () => {
    const result = resolveActionEntity("this", CLAIM_ENTITY);
    expect(result).toBe(CLAIM_ENTITY);
  });

  it("resolves 'that' to last entity when no current", () => {
    const result = resolveActionEntity("that", undefined, DOCUMENT_ENTITY);
    expect(result).toBe(DOCUMENT_ENTITY);
  });

  it("resolves 'the claim' to current entity", () => {
    const result = resolveActionEntity("the claim", CLAIM_ENTITY);
    expect(result).toBe(CLAIM_ENTITY);
  });

  it("returns undefined for unknown references", () => {
    const result = resolveActionEntity("submit it");
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 13. Confirmation Prompt
// ---------------------------------------------------------------------------

describe("Confirmation Prompt", () => {
  it("builds a prompt for a medium-risk action", () => {
    const action = makeAction();
    const prompt = buildConfirmationPrompt(action);
    expect(prompt).toContain("Prepare supplement");
    expect(prompt).toContain("Claim #1042");
    expect(prompt).toContain("Confirm this action");
  });

  it("includes risk warning for high-risk actions", () => {
    const action = createAction(
      "submit_supplement",
      "Submit supplement",
      "Submit for processing",
      CLAIM_ENTITY,
      {},
      "atlas",
    );
    const prompt = buildConfirmationPrompt(action);
    expect(prompt).toContain("cannot be easily undone");
  });
});

// ---------------------------------------------------------------------------
// 14. Decision → Action Bridge
// ---------------------------------------------------------------------------

describe("Decision → Action Bridge", () => {
  it("converts a decision with prepare action", () => {
    const decision: AtlasDecision = {
      id: "d1",
      entity: CLAIM_ENTITY,
      observation: { title: "Evidence found", summary: "New evidence" },
      importance: { severity: "high" },
      evidence: [],
      recommendation: { title: "Prepare supplement", summary: "Prepare a supplement", reasoning: "Evidence supports" },
      action: {
        label: "Prepare supplement",
        actionType: "prepare",
        requiresApproval: false,
      },
      status: "new",
      requiresApproval: false,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const result = decisionToAction(decision, "customer_admin");
    expect(result).toBeDefined();
    expect(result!.type).toBe("prepare_supplement");
    expect(result!.decisionId).toBe("d1");
  });

  it("returns undefined for decision without action", () => {
    const decision: AtlasDecision = {
      id: "d2",
      entity: CLAIM_ENTITY,
      observation: { title: "No action", summary: "" },
      importance: { severity: "low" },
      evidence: [],
      recommendation: { title: "Review", summary: "", reasoning: "" },
      status: "new",
      requiresApproval: false,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const result = decisionToAction(decision, "super_admin");
    expect(result).toBeUndefined();
  });

  it("maps submit action type correctly", () => {
    const decision: AtlasDecision = {
      id: "d3",
      entity: CLAIM_ENTITY,
      observation: { title: "Submit", summary: "" },
      importance: { severity: "high" },
      evidence: [],
      recommendation: { title: "Submit", summary: "", reasoning: "" },
      action: {
        label: "Submit supplement",
        actionType: "submit",
        requiresApproval: true,
      },
      status: "new",
      requiresApproval: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const result = decisionToAction(decision, "super_admin");
    expect(result!.type).toBe("submit_supplement");
  });
});

// ---------------------------------------------------------------------------
// 15. Intent Resolution
// ---------------------------------------------------------------------------

describe("Intent Resolution", () => {
  it("resolvePrepareIntent maps claim to prepare_supplement", () => {
    const action = resolvePrepareIntent("claim", CLAIM_ENTITY, "customer_admin");
    expect(action.type).toBe("prepare_supplement");
    expect(action.entity.id).toBe("claim-1042");
  });

  it("resolvePrepareIntent maps lead to prepare_email", () => {
    const leadEntity: AtlasEntityReference = { type: "lead", id: "l1", label: "Lead 1" };
    const action = resolvePrepareIntent("lead", leadEntity, "customer_admin");
    expect(action.type).toBe("prepare_email");
  });

  it("resolveSubmitIntent maps supplement to submit_supplement", () => {
    const suppEntity: AtlasEntityReference = { type: "supplement", id: "s1", label: "Supplement #1" };
    const action = resolveSubmitIntent(suppEntity, { supplementId: "s1" }, "super_admin");
    expect(action.type).toBe("submit_supplement");
  });

  it("resolveSubmitIntent maps email to send_email", () => {
    const emailEntity: AtlasEntityReference = { type: "email", id: "e1", label: "Email 1" };
    const action = resolveSubmitIntent(emailEntity, {}, "super_admin");
    expect(action.type).toBe("send_email");
  });
});

// ---------------------------------------------------------------------------
// 16. Audit Trail
// ---------------------------------------------------------------------------

describe("Audit Trail", () => {
  it("getAuditTrail returns all entries", () => {
    const action = makeAction();
    const trail = getAuditTrail(action);
    expect(trail.length).toBeGreaterThanOrEqual(1);
  });

  it("summarizeAuditTrail formats entries", () => {
    let action = makeAction();
    action = transitionAction(action, "preparing", "atlas");
    const summary = summarizeAuditTrail(action);
    expect(summary).toContain("preparing");
    expect(summary).toContain("atlas");
  });
});

// ---------------------------------------------------------------------------
// 17. Telemetry
// ---------------------------------------------------------------------------

describe("Telemetry", () => {
  beforeEach(() => {
    clearActionTelemetry();
  });

  it("logActionTelemetry stores records", () => {
    logActionTelemetry({
      event: "action_proposed",
      timestamp: new Date().toISOString(),
      actionId: "a1",
      actionType: "navigate",
      entityType: "claim",
      risk: "low",
      actor: "atlas",
    });
    expect(getActionTelemetry()).toHaveLength(1);
  });

  it("getActionTelemetry respects limit", () => {
    for (let i = 0; i < 10; i++) {
      logActionTelemetry({
        event: "action_proposed",
        timestamp: new Date().toISOString(),
        actionId: `a${i}`,
        actionType: "navigate",
        entityType: "claim",
        risk: "low",
        actor: "atlas",
      });
    }
    expect(getActionTelemetry(5)).toHaveLength(5);
  });

  it("clearActionTelemetry empties the store", () => {
    logActionTelemetry({
      event: "action_proposed",
      timestamp: new Date().toISOString(),
      actionId: "a1",
      actionType: "navigate",
      entityType: "claim",
      risk: "low",
      actor: "atlas",
    });
    clearActionTelemetry();
    expect(getActionTelemetry()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 18. End-to-End Scenario: Supplement Preparation
// ---------------------------------------------------------------------------

describe("End-to-End: Supplement Preparation", () => {
  it("full lifecycle: propose → confirm → execute → verify", () => {
    // 1. Propose
    const { action: proposed } = proposeAction(
      "prepare_supplement",
      "Prepare supplement",
      "Prepare supplement for Claim #1042",
      CLAIM_ENTITY,
      { claimId: "claim-1042" },
      "customer_admin",
      "atlas",
    );
    expect(proposed.status).toBe("awaiting_confirmation");
    expect(proposed.confirmationToken).toBeDefined();

    // 2. Validate confirmation
    const confirmation = validateConfirmation(proposed, proposed.confirmationToken!);
    expect(confirmation.valid).toBe(true);

    // 3. Transition to confirmed
    let action = transitionAction(proposed, "confirmed", "user", "User confirmed");
    expect(action.status).toBe("confirmed");

    // 4. Execute
    action = transitionAction(action, "executing", "atlas", "Executing preparation");
    expect(action.status).toBe("executing");

    // 5. Complete
    action = transitionAction(action, "executed", "system", "Preparation complete");
    expect(action.status).toBe("executed");

    // 6. Verify
    action = transitionAction(action, "verified", "system", "Verified");
    expect(action.status).toBe("verified");

    // 7. Result
    const result = createSuccessResult(action.id, CLAIM_ENTITY, "Supplement prepared");
    expect(result.status).toBe("executed");

    // 8. Audit trail has full lifecycle
    expect(action.auditTrail.length).toBeGreaterThanOrEqual(6);
  });
});

// ---------------------------------------------------------------------------
// 19. End-to-End Scenario: Unauthorized Action
// ---------------------------------------------------------------------------

describe("End-to-End: Unauthorized Action", () => {
  it("customer_user cannot submit supplement", () => {
    const { action, blocked } = proposeAction(
      "submit_supplement",
      "Submit supplement",
      "Submit supplement for processing",
      CLAIM_ENTITY,
      {},
      "customer_user",
      "atlas",
    );
    expect(action.status).toBe("blocked");
    expect(blocked).toBeDefined();
    expect(blocked!.allowed).toBe(false);
    expect(blocked!.reason).toContain("not authorized");

    // Verify cannot transition from blocked
    expect(() => transitionAction(action, "executing", "atlas")).toThrow("Invalid transition");
  });
});

// ---------------------------------------------------------------------------
// 20. End-to-End Scenario: Rejection
// ---------------------------------------------------------------------------

describe("End-to-End: Rejection", () => {
  it("user can reject a proposed action", () => {
    let action = makeAction();
    action = transitionAction(action, "preparing", "atlas");
    action = transitionAction(action, "prepared", "atlas");
    action = prepareForConfirmation(action);

    // User rejects
    action = transitionAction(action, "rejected", "user", "I don't want this");
    expect(action.status).toBe("rejected");

    // Terminal state
    expect(() => transitionAction(action, "proposed", "system")).toThrow("Invalid transition");
  });
});

// ---------------------------------------------------------------------------
// 21. Default Timeout
// ---------------------------------------------------------------------------

describe("Default Confirmation Timeout", () => {
  it("DEFAULT_CONFIRMATION_TIMEOUT_MS is 5 minutes", () => {
    expect(DEFAULT_CONFIRMATION_TIMEOUT_MS).toBe(5 * 60 * 1000);
  });

  it("prepareForConfirmation uses default timeout", () => {
    const action = makeAction();
    const prepared = prepareForConfirmation(action);
    const expiresAt = new Date(prepared.expiresAt!).getTime();
    const createdAt = new Date(prepared.createdAt).getTime();
    const diff = expiresAt - createdAt;
    expect(diff).toBe(DEFAULT_CONFIRMATION_TIMEOUT_MS);
  });
});
