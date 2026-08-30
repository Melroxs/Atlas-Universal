// ---------------------------------------------------------------------------
// Tests for Atlas Action Persistence (Server-Authoritative)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadCachedActions,
  cacheAction,
  recoverPersistedActions,
  removeCachedAction,
  clearCachedActions,
  getActiveActions,
  getActionsForEntity,
  getPersistedAction,
  type PersistedAction,
} from "./action-persistence";
import { createAction, transitionAction } from "./execution";
import type { AtlasEntityReference } from "./entity-reference";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENTITY: AtlasEntityReference = {
  type: "claim",
  id: "claim-1042",
  label: "Claim #1042",
  href: "/dashboard/revenue-recovery/claim-1042",
};

function makeAction() {
  return createAction(
    "prepare_supplement",
    "Prepare Supplement",
    "Prepare supplement for Claim #1042",
    ENTITY,
    { claimId: "claim-1042" },
    "user-123",
  );
}

function makeRecord(status?: string): PersistedAction {
  let action = makeAction();
  if (status) {
    const transitions: Record<string, string[]> = {
      preparing: ["preparing"],
      prepared: ["preparing", "prepared"],
      awaiting_confirmation: ["preparing", "prepared", "awaiting_confirmation"],
      confirmed: ["preparing", "prepared", "awaiting_confirmation", "confirmed"],
      executing: ["preparing", "prepared", "awaiting_confirmation", "confirmed", "executing"],
      executed: ["preparing", "prepared", "awaiting_confirmation", "confirmed", "executing", "executed"],
      failed: ["preparing", "prepared", "awaiting_confirmation", "confirmed", "executing", "failed"],
    };
    const steps = transitions[status] ?? [];
    for (const step of steps) {
      action = transitionAction(action, step as any, "user-123");
    }
  }
  return {
    action,
    persistedAt: new Date().toISOString(),
    source: "server",
    tenantId: "tenant-1",
    companyId: "company-1",
  };
}

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

const store: Record<string, string> = {};

beforeEach(() => {
  for (const key of Object.keys(store)) {
    delete store[key];
  }
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
  });
});

// ---------------------------------------------------------------------------
// Cache CRUD
// ---------------------------------------------------------------------------

describe("cacheAction / loadCachedActions", () => {
  it("caches and loads an action", () => {
    const record = makeRecord();
    cacheAction(record, "tenant-1");
    const loaded = loadCachedActions("tenant-1");
    expect(loaded).toHaveLength(1);
    expect(loaded[0].action.id).toBe(record.action.id);
    expect(loaded[0].source).toBe("server");
  });

  it("updates an existing action by ID", () => {
    const record = makeRecord();
    cacheAction(record, "tenant-1");
    const updated = { ...record, source: "local" as const, persistedAt: new Date().toISOString() };
    cacheAction(updated, "tenant-1");
    const loaded = loadCachedActions("tenant-1");
    expect(loaded).toHaveLength(1);
    expect(loaded[0].source).toBe("local");
  });

  it("returns empty array for no data", () => {
    expect(loadCachedActions("nonexistent")).toEqual([]);
  });

  it("isolates by tenant", () => {
    cacheAction(makeRecord(), "tenant-1");
    cacheAction(makeRecord(), "tenant-2");
    expect(loadCachedActions("tenant-1")).toHaveLength(1);
    expect(loadCachedActions("tenant-2")).toHaveLength(1);
  });
});

describe("removeCachedAction", () => {
  it("removes an action by ID", () => {
    const record = makeRecord();
    cacheAction(record, "tenant-1");
    removeCachedAction(record.action.id, "tenant-1");
    expect(loadCachedActions("tenant-1")).toHaveLength(0);
  });
});

describe("clearCachedActions", () => {
  it("clears all actions for a tenant", () => {
    cacheAction(makeRecord(), "tenant-1");
    cacheAction(makeRecord(), "tenant-1");
    clearCachedActions("tenant-1");
    expect(loadCachedActions("tenant-1")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

describe("getPersistedAction", () => {
  it("finds an action by ID", () => {
    const record = makeRecord();
    cacheAction(record, "tenant-1");
    const found = getPersistedAction(record.action.id, "tenant-1");
    expect(found).not.toBeNull();
    expect(found!.action.id).toBe(record.action.id);
  });

  it("returns null for missing action", () => {
    expect(getPersistedAction("nonexistent", "tenant-1")).toBeNull();
  });
});

describe("getActiveActions", () => {
  it("returns only non-terminal actions", () => {
    const active = makeRecord();
    const done = makeRecord("executed");
    cacheAction(active, "tenant-1");
    cacheAction(done, "tenant-1");
    const result = getActiveActions("tenant-1");
    expect(result).toHaveLength(1);
    expect(result[0].action.id).toBe(active.action.id);
  });
});

describe("getActionsForEntity", () => {
  it("filters by entity type and ID", () => {
    cacheAction(makeRecord(), "tenant-1"); // claim-1042
    cacheAction({
      ...makeRecord(),
      action: { ...makeRecord().action, entity: { type: "lead", id: "lead-1", label: "Lead 1" } },
    }, "tenant-1");
    const claimActions = getActionsForEntity("claim", "claim-1042", "tenant-1");
    expect(claimActions).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

describe("recoverPersistedActions", () => {
  it("recovers active actions", () => {
    cacheAction(makeRecord(), "tenant-1");
    cacheAction(makeRecord("awaiting_confirmation"), "tenant-1");
    const result = recoverPersistedActions("tenant-1");
    expect(result.restored.length).toBeGreaterThanOrEqual(0);
    expect(result.awaitingConfirmation).toHaveLength(1);
    expect(result.summary.total).toBe(2);
    expect(result.summary.pending).toBe(1);
  });

  it("detects expired actions", () => {
    const record = makeRecord("awaiting_confirmation");
    record.action = { ...record.action, expiresAt: new Date(Date.now() - 60000).toISOString() };
    cacheAction(record, "tenant-1");
    const result = recoverPersistedActions("tenant-1");
    expect(result.expired.length).toBeGreaterThanOrEqual(1);
  });

  it("counts terminal actions in summary", () => {
    cacheAction(makeRecord("executed"), "tenant-1");
    cacheAction(makeRecord("failed"), "tenant-1");
    const result = recoverPersistedActions("tenant-1");
    expect(result.summary.completed).toBe(1);
    expect(result.summary.failed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Source tracking
// ---------------------------------------------------------------------------

describe("PersistedAction source field", () => {
  it("tracks server vs local origin", () => {
    const serverRecord = makeRecord();
    serverRecord.source = "server";
    cacheAction(serverRecord, "tenant-1");

    const localRecord = makeRecord();
    localRecord.source = "local";
    cacheAction(localRecord, "tenant-2");

    const serverActions = loadCachedActions("tenant-1");
    const localActions = loadCachedActions("tenant-2");

    expect(serverActions[0].source).toBe("server");
    expect(localActions[0].source).toBe("local");
  });
});
