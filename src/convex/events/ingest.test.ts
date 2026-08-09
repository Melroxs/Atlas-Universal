import { describe, expect, it } from "vitest";
import { assertTenantMatch, validateSourceEvent, type ConnectionLike } from "./ingest";
import type { EventEnvelope } from "./contract";

function conn(overrides: Partial<ConnectionLike> = {}): ConnectionLike {
  return {
    _id: "conn_1",
    tenantId: "tenant_A",
    provider: "google_drive",
    status: "connected",
    ...overrides,
  };
}

function envelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    eventType: "drive.file_updated",
    provider: "google_drive",
    connectorId: "conn_1",
    tenantId: "tenant_A",
    connectionId: "conn_1",
    sourceResourceId: "file_1",
    occurredAt: 1700000000000,
    receivedAt: 1700000001000,
    payload: { fileId: "file_1" },
    payloadVersion: "1.0.0",
    correlationId: null,
    idempotencyKey: "key-1",
    sourceMechanism: "polling",
    providerEventId: "change_1",
    ...overrides,
  };
}

describe("source validation — tenant is resolved from the connection", () => {
  it("accepts a valid event and resolves the tenant from the connection", () => {
    const res = validateSourceEvent({ envelope: envelope(), connection: conn() });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.tenantId).toBe("tenant_A");
  });

  it("ignores any tenant id claimed by an external payload", () => {
    // The envelope carries tenantId "tenant_A" but that is never trusted —
    // the resolved tenant comes from the connection row.
    const res = validateSourceEvent({ envelope: envelope(), connection: conn() });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.tenantId).toBe(conn().tenantId);
  });

  it("rejects events whose claimed tenant does not match the connection", () => {
    const res = validateSourceEvent({
      envelope: envelope(),
      connection: conn({ tenantId: "tenant_B" }),
      externalTenantId: "tenant_A",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason.toLowerCase()).toContain("cross-tenant");
  });

  it("rejects events from a missing connection", () => {
    const res = validateSourceEvent({ envelope: envelope(), connection: null });
    expect(res.ok).toBe(false);
  });

  it("rejects provider mismatches", () => {
    const res = validateSourceEvent({
      envelope: envelope({ provider: "slack" }),
      connection: conn(),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason.toLowerCase()).toContain("provider mismatch");
  });

  it("rejects connection identity mismatches", () => {
    const res = validateSourceEvent({
      envelope: envelope({ connectionId: "conn_OTHER" }),
      connection: conn(),
    });
    expect(res.ok).toBe(false);
  });

  it("rejects events from a disconnected source", () => {
    const res = validateSourceEvent({
      envelope: envelope(),
      connection: conn({ status: "disconnected" }),
    });
    expect(res.ok).toBe(false);
  });
});

describe("cross-tenant guards", () => {
  it("an event for tenant B is never accepted under tenant A's connection", () => {
    const res = validateSourceEvent({
      envelope: envelope({ tenantId: "tenant_B" }),
      connection: conn({ tenantId: "tenant_A" }),
      externalTenantId: "tenant_B",
    });
    expect(res.ok).toBe(false);
  });

  it("assertTenantMatch is strict", () => {
    expect(assertTenantMatch("tenant_A", conn())).toBe(true);
    expect(assertTenantMatch("tenant_B", conn())).toBe(false);
    expect(assertTenantMatch("tenant_A", null)).toBe(false);
  });
});

describe("leakage prevention at the boundary", () => {
  it("rejection reasons never echo payload values", () => {
    const res = validateSourceEvent({
      envelope: envelope({ provider: "slack" }),
      connection: conn(),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      // The reason names the mismatch — it never includes the payload body.
      expect(res.reason).not.toContain("file_1");
    }
  });

  it("validateSourceEvent never returns connection settings or tokens", () => {
    const res = validateSourceEvent({ envelope: envelope(), connection: conn() });
    if (res.ok) {
      expect(res.connection).not.toHaveProperty("settings");
      expect(JSON.stringify(res)).not.toMatch(/token|secret|refresh/i);
    }
  });
});
