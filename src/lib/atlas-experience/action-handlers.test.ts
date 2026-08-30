// ---------------------------------------------------------------------------
// Tests: Action Handlers — Registry, Dispatch, Preparation
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getActionHandler,
  registerActionHandler,
  executeAction,
  prepareSupplement,
  prepareEmail,
  handleUnsupportedAction,
  type ActionHandlerContext,
} from "./action-handlers";
import {
  createAction,
  getActionRisk,
} from "./execution";
import type { AtlasExecutableAction, AtlasUserRole } from "./execution";

// ---------------------------------------------------------------------------
// Mock Supabase
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => null, // Returns null to simulate unconfigured
}));

vi.mock("@/lib/actions/rpc", () => ({
  rpcCall: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const adminContext: ActionHandlerContext = {
  userRole: "atlas_admin" as AtlasUserRole,
  userId: "user-1",
  userName: "Atlas Admin",
};

const customerContext: ActionHandlerContext = {
  userRole: "customer_user" as AtlasUserRole,
  userId: "user-2",
};

// ---------------------------------------------------------------------------
// Handler Registry
// ---------------------------------------------------------------------------

describe("Action Handler Registry", () => {
  it("registers and retrieves custom handler", () => {
    const handler = vi.fn();
    registerActionHandler("navigate", handler);
    const retrieved = getActionHandler("navigate");
    expect(retrieved).toBe(handler);
  });

  it("returns null for unregistered handler", () => {
    const handler = getActionHandler("execute_workflow");
    expect(handler).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// handleUnsupportedAction
// ---------------------------------------------------------------------------

describe("handleUnsupportedAction", () => {
  it("returns failed result for unsupported action", async () => {
    const action = createAction(
      "execute_workflow",
      "Execute workflow",
      "Run workflow",
      { type: "claim", id: "1", label: "Claim" },
      {},
      "user-1",
    );
    const result = await handleUnsupportedAction(action, adminContext);
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("unsupported_action");
  });
});

// ---------------------------------------------------------------------------
// executeAction validation
// ---------------------------------------------------------------------------

describe("executeAction validation", () => {
  it("rejects action not in confirmed status", async () => {
    const action = createAction(
      "prepare_supplement",
      "Prepare supplement",
      "Atlas will prepare",
      { type: "claim", id: "1", label: "Claim" },
      { claimId: "1" },
      "user-1",
    );
    // action is in "proposed" status — not confirmed
    const result = await executeAction(action, adminContext);
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("validation_error");
  });
});

// ---------------------------------------------------------------------------
// Preparation flows (Supabase not configured)
// ---------------------------------------------------------------------------

describe("prepareSupplement", () => {
  it("creates action even when Supabase is not configured", async () => {
    const { action } = await prepareSupplement("1042", "atlas_admin", "user-1", {
      reason: "Test supplement",
    });
    expect(action.type).toBe("prepare_supplement");
    expect(action.entity.type).toBe("claim");
    expect(action.entity.id).toBe("1042");
    expect(action.status).toBe("proposed");
  });
});

describe("prepareEmail", () => {
  it("creates email action", async () => {
    const { action } = await prepareEmail("lead-1", "atlas_admin", "user-1", {
      instruction: "Follow up",
    });
    expect(action.type).toBe("prepare_email");
    expect(action.entity.type).toBe("organization");
  });
});
