import { describe, expect, it } from "vitest";
import {
  canTransition,
  effectiveMaxActions,
  effectiveTimeoutMs,
  eventResumeKey,
  getContextPath,
  sanitizeWorkflowContext,
  stepExecutionKey,
  validateWorkflowDefinition,
  WORKFLOW_LIMITS,
  type WorkflowDefinition,
} from "./contract";

function baseDef(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: "test.workflow",
    name: "Test workflow",
    description: "A test workflow.",
    version: "1.0.0",
    industry: "universal",
    status: "active",
    trigger: { eventTypes: ["drive.file_created"] },
    steps: [
      { id: "step1", type: "notify", severity: "low", title: "hi" },
      { id: "done", type: "complete" },
    ],
    policies: { riskLevel: "READ", requiresApproval: false },
    requiredConnectors: [],
    requiredTools: [],
    timeoutMs: 1000,
    retryPolicy: { maxAttempts: 3, baseMs: 100 },
    createdBy: "test",
    updatedAt: "2026-01-01",
    ...overrides,
  };
}

const hasTool = () => true;
const hasConnector = () => true;

describe("validateWorkflowDefinition", () => {
  it("accepts a valid definition", () => {
    expect(validateWorkflowDefinition(baseDef(), { hasTool, hasConnector })).toEqual({ ok: true });
  });

  it("rejects a definition with no id/name/description", () => {
    const r = validateWorkflowDefinition(
      baseDef({ id: "", name: "", description: "" }),
      { hasTool, hasConnector },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain("id, name and description");
  });

  it("requires a version (versioning is mandatory)", () => {
    const r = validateWorkflowDefinition(baseDef({ version: "" }), { hasTool, hasConnector });
    expect(r.ok).toBe(false);
  });

  it("rejects a definition with no trigger event type", () => {
    const r = validateWorkflowDefinition(
      baseDef({ trigger: { eventTypes: [] } }),
      { hasTool, hasConnector },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain("trigger");
  });

  it("rejects unknown step types", () => {
    const r = validateWorkflowDefinition(
      baseDef({
        steps: [
          { id: "bad", type: "teleport" } as unknown as WorkflowDefinition["steps"][number],
          { id: "done", type: "complete" },
        ],
      }),
      { hasTool, hasConnector },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain("unknown type");
  });

  it("rejects duplicate step ids", () => {
    const r = validateWorkflowDefinition(
      baseDef({
        steps: [
          { id: "dup", type: "notify", severity: "low", title: "a" },
          { id: "dup", type: "notify", severity: "low", title: "b" },
          { id: "done", type: "complete" },
        ],
      }),
      { hasTool, hasConnector },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain("unique");
  });

  it("rejects a missing tool reference", () => {
    const r = validateWorkflowDefinition(
      baseDef({
        steps: [
          {
            id: "act",
            type: "action",
            toolId: "drive.nonexistent",
            args: [{ key: "fileId", from: "literal", value: "x" }],
          },
          { id: "done", type: "complete" },
        ],
        requiredTools: ["drive.nonexistent"],
      }),
      { hasTool: () => false, hasConnector },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain("drive.nonexistent");
  });

  it("rejects a missing connector reference", () => {
    const r = validateWorkflowDefinition(
      baseDef({ requiredConnectors: ["gmail"] }),
      { hasTool, hasConnector: () => false },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain("gmail");
  });

  it("requires the final step to be a complete step", () => {
    const r = validateWorkflowDefinition(
      baseDef({
        steps: [{ id: "only", type: "notify", severity: "low", title: "x" }],
      }),
      { hasTool, hasConnector },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain("complete");
  });

  it("rejects a time wait without duration and an event wait without eventType", () => {
    const badWait = validateWorkflowDefinition(
      baseDef({
        steps: [
          { id: "w", type: "wait", mode: "time" },
          { id: "done", type: "complete" },
        ],
      }),
      { hasTool, hasConnector },
    );
    expect(badWait.ok).toBe(false);
    const badEventWait = validateWorkflowDefinition(
      baseDef({
        steps: [
          { id: "w", type: "wait", mode: "event" },
          { id: "done", type: "complete" },
        ],
      }),
      { hasTool, hasConnector },
    );
    expect(badEventWait.ok).toBe(false);
  });

  it("rejects invalid approval roles", () => {
    const r = validateWorkflowDefinition(
      baseDef({
        steps: [
          {
            id: "a",
            type: "approval",
            role: "viewer" as "member",
            title: "t",
            description: "d",
          },
          { id: "done", type: "complete" },
        ],
      }),
      { hasTool, hasConnector },
    );
    expect(r.ok).toBe(false);
  });
});

describe("canTransition — explicit, validated transitions", () => {
  it("allows the engine's forward transitions", () => {
    expect(canTransition("pending", "running")).toBe(true);
    expect(canTransition("running", "waiting")).toBe(true);
    expect(canTransition("running", "awaiting_approval")).toBe(true);
    expect(canTransition("awaiting_approval", "running")).toBe(true);
    expect(canTransition("waiting", "running")).toBe(true);
    expect(canTransition("running", "completed")).toBe(true);
    expect(canTransition("running", "failed")).toBe(true);
    expect(canTransition("running", "timed_out")).toBe(true);
  });

  it("never allows terminal states to resume", () => {
    expect(canTransition("completed", "running")).toBe(false);
    expect(canTransition("failed", "running")).toBe(false);
    expect(canTransition("cancelled", "running")).toBe(false);
    expect(canTransition("timed_out", "pending")).toBe(false);
  });

  it("allows cancel from every active state", () => {
    for (const s of ["pending", "running", "waiting", "awaiting_approval", "paused"] as const) {
      expect(canTransition(s, "cancelled")).toBe(true);
    }
  });
});

describe("idempotency keys", () => {
  it("step execution keys are deterministic and attempt-scoped", () => {
    expect(stepExecutionKey("i1", "s1", 1)).toBe(stepExecutionKey("i1", "s1", 1));
    expect(stepExecutionKey("i1", "s1", 1)).not.toBe(stepExecutionKey("i1", "s1", 2));
    expect(stepExecutionKey("i1", "s1", 1)).not.toBe(stepExecutionKey("i2", "s1", 1));
  });

  it("event resume keys dedupe by type + resource", () => {
    expect(eventResumeKey("drive.file_updated", "abc")).toBe(
      eventResumeKey("drive.file_updated", "abc"),
    );
    expect(eventResumeKey("drive.file_updated", "abc")).not.toBe(
      eventResumeKey("drive.file_updated", "def"),
    );
  });
});

describe("sanitizeWorkflowContext", () => {
  it("redacts credentials everywhere in the tree", () => {
    const out = sanitizeWorkflowContext({
      token: "secret-token",
      Authorization: "Bearer xyz",
      api_key: "k",
      nested: { password: "pw", fine: "keep" },
    }) as Record<string, unknown>;
    expect(out.token).toBe("[redacted]");
    expect(out.Authorization).toBe("[redacted]");
    expect(out.api_key).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).password).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).fine).toBe("keep");
  });

  it("truncates deep structures so context never balloons", () => {
    let deep: unknown = { leaf: 1 };
    for (let i = 0; i < 10; i++) deep = { next: deep };
    const out = sanitizeWorkflowContext(deep) as Record<string, unknown>;
    // The depth budget is 6 — the 7th level of nesting becomes "[truncated]"
    // instead of unboundedly copying provider-shaped payloads.
    let node: Record<string, unknown> = out;
    for (let i = 0; i < 6; i++) node = node.next as Record<string, unknown>;
    expect(node.next).toBe("[truncated]");
  });

  it("keeps arrays intact and sanitized", () => {
    const out = sanitizeWorkflowContext(["a", { secret: "x" }]) as unknown[];
    expect(out[0]).toBe("a");
    expect((out[1] as Record<string, unknown>).secret).toBe("[redacted]");
  });
});

describe("context path lookup", () => {
  it("walks dot paths and fails closed", () => {
    const ctx = { triggerEvent: { payload: { fileId: "abc" } } };
    expect(getContextPath(ctx, "triggerEvent.payload.fileId")).toBe("abc");
    expect(getContextPath(ctx, "triggerEvent.payload.missing")).toBeUndefined();
    expect(getContextPath(ctx, "document._id")).toBeUndefined();
    expect(getContextPath(ctx, "")).toBeUndefined();
    expect(getContextPath(ctx, "triggerEvent.payload.fileId.name")).toBeUndefined();
  });
});

describe("limits", () => {
  it("honors definition overrides and falls back to global safety limits", () => {
    expect(effectiveMaxActions(baseDef())).toBe(WORKFLOW_LIMITS.maxActionsPerInstance);
    expect(effectiveMaxActions(baseDef({ policies: { riskLevel: "READ", requiresApproval: false, maxActions: 2 } }))).toBe(2);
    expect(effectiveMaxActions(baseDef(), 7)).toBe(7);
    expect(effectiveTimeoutMs(baseDef())).toBe(1000);
    expect(effectiveTimeoutMs(baseDef({ timeoutMs: 0 }))).toBe(WORKFLOW_LIMITS.maxRuntimeMs);
  });
});
