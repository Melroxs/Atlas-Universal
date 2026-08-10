import { describe, expect, it } from "vitest";
import { EVENT_BY_TYPE, EVENT_REGISTRY, getEventDefinition, isEventImplemented } from "./registry";

describe("event registry", () => {
  it("has unique ids and types", () => {
    const ids = EVENT_REGISTRY.map((e) => e.id);
    const types = EVENT_REGISTRY.map((e) => e.type);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(types).size).toBe(types.length);
    for (const e of EVENT_REGISTRY) expect(e.id).toBe(e.type);
  });

  it("every entry has a complete contract", () => {
    for (const e of EVENT_REGISTRY) {
      expect(e.provider).toBeTruthy();
      expect(e.connector).toBeTruthy();
      expect(e.description).toBeTruthy();
      expect(e.version).toBeTruthy();
      expect(e.source).toBeTruthy();
      expect(e.payloadSchema.fields.length).toBeGreaterThan(0);
      expect(e.deduplicationStrategy).toBeTruthy();
    }
  });

  it("implemented events have a handler; planned events do not", () => {
    for (const e of EVENT_REGISTRY) {
      if (e.implementationStatus === "implemented") {
        expect(e.handlerId, `${e.id} must have a handler`).toBeTruthy();
        // OAuth scopes only apply to connector-backed events; the internal
        // atlas_authority engine genuinely requires no external scope.
        if (e.provider === "google_drive") {
          expect(e.requiredScopes.length, `${e.id} must declare required scopes`).toBeGreaterThan(0);
        }
      } else {
        expect(e.implementationStatus).toBe("planned");
        expect(e.handlerId, `${e.id} must not claim a handler while planned`).toBeNull();
      }
    }
  });

  it("Google Drive is the only implemented connector source; atlas_authority is the internal engine family — all via honest polling", () => {
    const implemented = EVENT_REGISTRY.filter((e) => e.implementationStatus === "implemented");
    expect(implemented.length).toBeGreaterThanOrEqual(5);
    for (const e of implemented) {
      expect(e.sourceMechanism).toBe("polling");
      if (e.provider === "google_drive") {
        expect(e.deduplicationStrategy).toBe("provider_key");
        expect(e.source).toContain("poll");
      } else {
        // atlas_authority: internal authority-ingest events, hash-deduped.
        expect(e.provider).toBe("atlas_authority");
        expect(e.deduplicationStrategy).toBe("resource_hash");
        expect(e.handlerId).toBe("authority");
      }
    }
  });

  it("roadmap connectors are honestly planned, never implemented", () => {
    const planned = EVENT_REGISTRY.filter((e) => e.implementationStatus === "planned");
    expect(planned.length).toBeGreaterThanOrEqual(8);
    for (const e of planned) {
      expect(["google_gmail", "slack", "github", "stripe", "hubspot", "dropbox", "notion", "quickbooks", "microsoft365"]).toContain(e.provider);
    }
  });

  it("lookups resolve and implemented checks are honest", () => {
    expect(getEventDefinition("drive.file_created")).toBeDefined();
    expect(getEventDefinition("gmail.message_received")).toBeDefined();
    expect(getEventDefinition("nope.unknown")).toBeUndefined();
    expect(isEventImplemented(getEventDefinition("drive.file_created"))).toBe(true);
    expect(isEventImplemented(getEventDefinition("gmail.message_received"))).toBe(false);
  });

  it("every drive payload schema requires a fileId", () => {
    for (const e of EVENT_REGISTRY.filter((x) => x.provider === "google_drive")) {
      const fileId = e.payloadSchema.fields.find((f) => f.key === "fileId");
      expect(fileId?.required, `${e.id} must require fileId`).toBe(true);
    }
  });

  it("EVENT_BY_TYPE is consistent with the registry", () => {
    expect(Object.keys(EVENT_BY_TYPE).length).toBe(EVENT_REGISTRY.length);
  });
});
