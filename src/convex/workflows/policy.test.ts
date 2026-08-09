import { describe, expect, it } from "vitest";
import {
  checkWorkflowLimits,
  resolveActionExecution,
  resolveWorkflowEnabled,
  roleSatisfies,
  shouldDispatch,
  type WorkflowSettingsLike,
} from "./policy";
import type { WorkflowDefinition } from "./contract";

function def(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: "test.workflow",
    name: "Test",
    description: "d",
    version: "1.0.0",
    industry: "universal",
    status: "active",
    trigger: { eventTypes: ["drive.file_created"] },
    steps: [{ id: "done", type: "complete" }],
    policies: { riskLevel: "READ", requiresApproval: false },
    requiredConnectors: [],
    requiredTools: [],
    timeoutMs: 60000,
    retryPolicy: { maxAttempts: 3, baseMs: 100 },
    createdBy: "test",
    updatedAt: "2026-01-01",
    ...overrides,
  };
}

describe("resolveWorkflowEnabled", () => {
  it("requires the definition to be active", () => {
    expect(resolveWorkflowEnabled(def({ status: "draft" }), null).enabled).toBe(false);
    expect(resolveWorkflowEnabled(def(), null).enabled).toBe(true);
  });

  it("honors tenant blocked and allowed lists", () => {
    expect(
      resolveWorkflowEnabled(def(), null, { blockedWorkflows: ["test.workflow"] }).enabled,
    ).toBe(false);
    expect(
      resolveWorkflowEnabled(def(), null, { allowedWorkflows: ["other"] }).enabled,
    ).toBe(false);
    expect(
      resolveWorkflowEnabled(def(), null, { allowedWorkflows: ["test.workflow"] }).enabled,
    ).toBe(true);
  });

  it("honors the tenant setting override", () => {
    const off: WorkflowSettingsLike = { enabled: false };
    expect(resolveWorkflowEnabled(def(), off).enabled).toBe(false);
  });
});

describe("shouldDispatch — trigger + loop protection", () => {
  it("dispatches an eligible event", () => {
    expect(shouldDispatch({ def: def(), settings: null, now: 1000 }).ok).toBe(true);
  });

  it("does not dispatch a disabled workflow", () => {
    const r = shouldDispatch({ def: def(), settings: { enabled: false }, now: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/disabled/);
  });

  it("applies the cooldown so update→event→update loops are broken", () => {
    const recent = shouldDispatch({
      def: def(),
      settings: null,
      lastInstanceStartedAt: 10_000,
      now: 20_000,
      cooldownMs: 60_000,
    });
    expect(recent.ok).toBe(false);
    if (!recent.ok) expect(recent.reason).toMatch(/loop protection/);

    const older = shouldDispatch({
      def: def(),
      settings: null,
      lastInstanceStartedAt: 0,
      now: 20_000,
      cooldownMs: 60_000,
    });
    expect(older.ok).toBe(true);
  });
});

describe("resolveActionExecution — the workflow cannot elevate its own permissions", () => {
  it("READ executes automatically", () => {
    expect(
      resolveActionExecution({
        riskLevel: "READ",
        toolId: "drive.get_file_metadata",
        approvalGrantedForStep: false,
        autoLowRiskWrite: false,
      }).mode,
    ).toBe("execute");
  });

  it("LOW_WRITE needs approval unless the tenant allows auto-writes", () => {
    expect(
      resolveActionExecution({
        riskLevel: "LOW_WRITE",
        toolId: "drive.update_file",
        approvalGrantedForStep: false,
        autoLowRiskWrite: false,
      }).mode,
    ).toBe("request_approval");
    expect(
      resolveActionExecution({
        riskLevel: "LOW_WRITE",
        toolId: "drive.update_file",
        approvalGrantedForStep: false,
        autoLowRiskWrite: true,
      }).mode,
    ).toBe("execute");
  });

  it("HIGH_WRITE and IRREVERSIBLE always require approval — even from a trusted workflow", () => {
    for (const riskLevel of ["HIGH_WRITE", "IRREVERSIBLE"] as const) {
      expect(
        resolveActionExecution({
          riskLevel,
          toolId: "drive.move_file",
          approvalGrantedForStep: false,
          autoLowRiskWrite: true,
        }).mode,
      ).toBe("request_approval");
    }
  });

  it("a granted approval authorizes the specific step", () => {
    expect(
      resolveActionExecution({
        riskLevel: "HIGH_WRITE",
        toolId: "drive.move_file",
        approvalGrantedForStep: true,
        autoLowRiskWrite: false,
      }).mode,
    ).toBe("execute");
  });

  it("blocked and allowed tool lists are enforced", () => {
    expect(
      resolveActionExecution({
        riskLevel: "READ",
        toolId: "drive.get_file_metadata",
        blockedTools: ["drive.get_file_metadata"],
        approvalGrantedForStep: true,
        autoLowRiskWrite: false,
      }).mode,
    ).toBe("blocked");
    expect(
      resolveActionExecution({
        riskLevel: "READ",
        toolId: "drive.get_file_metadata",
        allowedTools: ["drive.update_file"],
        approvalGrantedForStep: false,
        autoLowRiskWrite: false,
      }).mode,
    ).toBe("blocked");
  });
});

describe("roleSatisfies — approval routing", () => {
  it("viewers can never approve", () => {
    expect(roleSatisfies("viewer", "member")).toBe(false);
    expect(roleSatisfies("viewer", "manager")).toBe(false);
    expect(roleSatisfies("viewer", "owner")).toBe(false);
  });

  it("members satisfy member requests but not manager/owner", () => {
    expect(roleSatisfies("member", "member")).toBe(true);
    expect(roleSatisfies("member", "manager")).toBe(false);
    expect(roleSatisfies("member", "owner")).toBe(false);
  });

  it("managers satisfy manager and below", () => {
    expect(roleSatisfies("manager", "manager")).toBe(true);
    expect(roleSatisfies("manager", "member")).toBe(true);
    expect(roleSatisfies("manager", "owner")).toBe(false);
  });

  it("owners satisfy everything", () => {
    expect(roleSatisfies("owner", "owner")).toBe(true);
    expect(roleSatisfies("owner", "manager")).toBe(true);
    expect(roleSatisfies("owner", "member")).toBe(true);
  });

  it("missing role satisfies nothing", () => {
    expect(roleSatisfies(undefined, "member")).toBe(false);
  });
});

describe("checkWorkflowLimits", () => {
  it("flags timeouts as timed_out", () => {
    const r = checkWorkflowLimits({ def: def(), startedAt: 0, now: 120_000, actionCount: 0, completedSteps: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure).toBe("timed_out");
  });

  it("flags runaway action counts as failed (loop protection)", () => {
    const r = checkWorkflowLimits({
      def: def({ policies: { riskLevel: "LOW_WRITE", requiresApproval: true, maxActions: 2 } }),
      startedAt: 0,
      now: 100,
      actionCount: 2,
      completedSteps: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure).toBe("failed");
  });

  it("flags runaway step counts as failed", () => {
    const r = checkWorkflowLimits({
      def: def(),
      startedAt: 0,
      now: 100,
      actionCount: 0,
      completedSteps: 31,
    });
    expect(r.ok).toBe(false);
  });

  it("passes within limits", () => {
    const r = checkWorkflowLimits({ def: def(), startedAt: 0, now: 100, actionCount: 0, completedSteps: 2 });
    expect(r.ok).toBe(true);
  });
});
