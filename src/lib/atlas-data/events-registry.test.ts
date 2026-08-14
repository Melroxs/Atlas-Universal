// ---------------------------------------------------------------------------
// Regression tests — Events page policy contract.
//
// Production defect guarded: the page called events_list_policies (which does
// not exist in the deployed schema — the backend exposes events_raw_policies),
// so the query failed with 404 and the page crashed with
// "Cannot read properties of null (reading 'map')" when it `.map()`ed the
// null result. The fix moves the merge to the boundary: the frontend reads
// the existing events_raw_policies RPC and merges it with the static event
// registry. These tests pin the merge contract so it can never crash the
// page again, whatever the backend returns.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  EVENT_REGISTRY,
  mergeEventPolicies,
  type EventPolicyRow,
} from "./events-registry";

describe("mergeEventPolicies (Events page contract)", () => {
  it("returns one row per registered event type, merged with tenant policy state", () => {
    const rows = mergeEventPolicies(EVENT_REGISTRY, [
      {
        _id: "p1",
        eventType: "drive.file_created",
        enabled: true,
        autoLowRiskWrite: true,
      },
      {
        _id: "p2",
        eventType: "authority.changed",
        enabled: false,
        autoLowRiskWrite: false,
      },
    ]);
    expect(rows.length).toBe(EVENT_REGISTRY.length);
    const drive = rows.find((r) => r.eventType === "drive.file_created");
    expect(drive?.name).toBe("Google Drive");
    expect(drive?.policy?.enabled).toBe(true);
    expect(drive?.policy?.autoLowRiskWrite).toBe(true);
    const disabled = rows.find((r) => r.eventType === "authority.changed");
    expect(disabled?.policy?.enabled).toBe(false);
  });

  it("renders a null policy (defaults) for event types with no custom policy", () => {
    const rows = mergeEventPolicies(EVENT_REGISTRY, null);
    expect(rows.every((r) => r.policy === null)).toBe(true);
    expect(rows.every((r) => typeof r.eventType === "string")).toBe(true);
    expect(rows.every((r) => typeof r.description === "string")).toBe(true);
    expect(rows.every((r) => typeof r.sourceMechanism === "string")).toBe(true);
  });

  it("never throws and returns a usable array when the backend returns null/undefined/garbage", () => {
    for (const raw of [null, undefined, "oops", 42, {}, [{ eventType: 1 }]]) {
      const rows = mergeEventPolicies(EVENT_REGISTRY, raw as never);
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBe(EVENT_REGISTRY.length);
    }
  });

  it("skips malformed raw rows without breaking the rest", () => {
    const rows = mergeEventPolicies(EVENT_REGISTRY, [
      null,
      { eventType: "drive.file_created", enabled: true, autoLowRiskWrite: false },
      { eventType: "unknown.type" },
    ]);
    const drive = rows.find((r) => r.eventType === "drive.file_created");
    expect(drive?.policy?.enabled).toBe(true);
    // A raw row with an unregistered type is ignored entirely.
    expect(rows.find((r) => r.eventType === "unknown.type")).toBeUndefined();
  });

  it("produces exactly the PolicyRow shape the Events page renders", () => {
    const rows: EventPolicyRow[] = mergeEventPolicies(EVENT_REGISTRY, []);
    const sample = rows[0];
    expect(Object.keys(sample).sort()).toEqual(
      ["description", "eventType", "handlerId", "name", "policy", "sourceMechanism"].sort(),
    );
  });
});
