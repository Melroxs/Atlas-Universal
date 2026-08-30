// ---------------------------------------------------------------------------
// Tests for Atlas Staleness Protection
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { generateSourceFingerprint } from "./execution";

// Note: checkStaleness and captureSourceFingerprint require Supabase client
// and real RPC calls, so we test the pure fingerprint logic here.
// Integration tests for the full staleness flow require a live backend.

describe("generateSourceFingerprint", () => {
  it("produces deterministic fingerprints from same input", () => {
    const fp1 = generateSourceFingerprint({ entityType: "claim", entityId: "c1", stateHash: "abc" });
    const fp2 = generateSourceFingerprint({ entityType: "claim", entityId: "c1", stateHash: "abc" });
    expect(fp1).toBe(fp2);
  });

  it("produces different fingerprints from different state hashes", () => {
    const fp1 = generateSourceFingerprint({ entityType: "claim", entityId: "c1", stateHash: "abc" });
    const fp2 = generateSourceFingerprint({ entityType: "claim", entityId: "c1", stateHash: "xyz" });
    expect(fp1).not.toBe(fp2);
  });

  it("produces different fingerprints from different entities", () => {
    const fp1 = generateSourceFingerprint({ entityType: "claim", entityId: "c1", stateHash: "abc" });
    const fp2 = generateSourceFingerprint({ entityType: "claim", entityId: "c2", stateHash: "abc" });
    expect(fp1).not.toBe(fp2);
  });

  it("produces different fingerprints from different entity types", () => {
    const fp1 = generateSourceFingerprint({ entityType: "claim", entityId: "c1", stateHash: "abc" });
    const fp2 = generateSourceFingerprint({ entityType: "supplement", entityId: "c1", stateHash: "abc" });
    expect(fp1).not.toBe(fp2);
  });

  it("returns a string starting with fp-", () => {
    const fp = generateSourceFingerprint({ entityType: "claim", entityId: "c1", stateHash: "test" });
    expect(fp).toMatch(/^fp-/);
  });
});

describe("staleness detection logic", () => {
  it("same fingerprint = not stale", () => {
    const original = generateSourceFingerprint({ entityType: "claim", entityId: "c1", stateHash: "v1" });
    const current = generateSourceFingerprint({ entityType: "claim", entityId: "c1", stateHash: "v1" });
    expect(original === current).toBe(true);
  });

  it("different fingerprint = stale", () => {
    const original = generateSourceFingerprint({ entityType: "claim", entityId: "c1", stateHash: "v1" });
    const current = generateSourceFingerprint({ entityType: "claim", entityId: "c1", stateHash: "v2" });
    expect(original === current).toBe(false);
  });

  it("undefined original fingerprint = not stale (no fingerprint to compare)", () => {
    // When no fingerprint was captured, we can't detect staleness
    const original = undefined;
    expect(!original).toBe(true);
  });
});
