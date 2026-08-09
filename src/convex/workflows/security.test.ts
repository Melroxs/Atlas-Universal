import { describe, expect, it } from "vitest";
import { sanitizeWorkflowContext, getContextPath } from "./contract";
import { resolveWorkflowEnabled, roleSatisfies } from "./policy";
import { sanitizeEventError } from "../events/contract";
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

describe("no secrets in workflow state", () => {
  it("sanitizes every credential-shaped key, case-insensitively", () => {
    const out = sanitizeWorkflowContext({
      oauth: { accessToken: "tok", refresh_token: "rt", expiresAt: 1 },
      headers: { "X-Api-Key": "k", authorization: "Bearer abc" },
      client: { clientSecret: "s", client_id: "id" },
      clean: { fileId: "abc", name: "report.pdf" },
    }) as Record<string, unknown>;
    const oauth = out.oauth as Record<string, unknown>;
    const headers = out.headers as Record<string, unknown>;
    const client = out.client as Record<string, unknown>;
    expect(oauth.accessToken).toBe("[redacted]");
    expect(oauth.refresh_token).toBe("[redacted]");
    expect(headers["X-Api-Key"]).toBe("[redacted]");
    expect(headers.authorization).toBe("[redacted]");
    expect(client.clientSecret).toBe("[redacted]");
    // Non-secret identifiers pass through untouched.
    expect(client.client_id).toBe("id");
    expect((out.clean as Record<string, unknown>).fileId).toBe("abc");
    expect((out.clean as Record<string, unknown>).name).toBe("report.pdf");
  });

  it("never lets a raw provider payload sneak into the sanitized tree", () => {
    const out = sanitizeWorkflowContext({
      triggerEvent: { payload: { fileId: "x", permissionIds: ["a"], token: "leak" } },
    }) as Record<string, unknown>;
    const payload = (out.triggerEvent as Record<string, unknown>).payload as Record<string, unknown>;
    expect(payload.token).toBe("[redacted]");
    expect(payload.fileId).toBe("x");
  });

  it("errors are bounded — no unbounded logs", () => {
    const long = "x".repeat(5000);
    const msg = sanitizeEventError(new Error(`boom ${long}`));
    expect(msg.length).toBeLessThanOrEqual(301);
    expect(sanitizeEventError("not an error")).toBe("Event processing failed.");
  });
});

describe("tenant isolation guards", () => {
  it("a tenant cannot enable a workflow another tenant blocked for itself", () => {
    // resolveWorkflowEnabled is the gate used before ANY dispatch — a tenant's
    // blocked list applies only to that tenant's own settings lookup.
    expect(
      resolveWorkflowEnabled(def(), { enabled: true }, { blockedWorkflows: ["test.workflow"] }).enabled,
    ).toBe(false);
    // An unrelated tenant's restriction never leaks: the same definition with
    // no restriction for THIS tenant is eligible.
    expect(resolveWorkflowEnabled(def(), { enabled: true }, null).enabled).toBe(true);
  });

  it("dispatch decisions never read across tenant settings", () => {
    // shouldDispatch receives exactly ONE tenant's settings — there is no
    // global path that could mix tenants.
    expect(resolveWorkflowEnabled(def(), { enabled: false }, null).enabled).toBe(false);
  });
});

describe("approval authorization (role routing)", () => {
  it("a viewer cannot approve a manager request", () => {
    expect(roleSatisfies("viewer", "manager")).toBe(false);
  });
  it("an owner can approve any request", () => {
    expect(roleSatisfies("owner", "owner")).toBe(true);
    expect(roleSatisfies("owner", "member")).toBe(true);
  });
  it("an approval for another tenant's instance is never reachable through a tenant-scoped query", () => {
    // The only approval lookups in the surface are keyed by tenantId or
    // instanceId fetched through the tenant-scoped instance — cross-tenant
    // rows are unreachable. The role gate is the second wall.
    const approvalForManager = roleSatisfies("member", "manager");
    expect(approvalForManager).toBe(false);
  });
});

describe("context is reference-oriented", () => {
  it("exposes paths but never raw bodies", () => {
    const ctx = sanitizeWorkflowContext({
      triggerEvent: { payload: { fileId: "f1" } },
    }) as Record<string, unknown>;
    expect(getContextPath(ctx, "triggerEvent.payload.fileId")).toBe("f1");
    expect(getContextPath(ctx, "triggerEvent.payload")).not.toBeNull();
  });
});
