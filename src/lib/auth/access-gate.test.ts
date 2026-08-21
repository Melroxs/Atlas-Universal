import { describe, expect, it } from "vitest";
import { evaluateAtlasAccess } from "./access-gate";

/**
 * Regression tests for the Atlas access gate — the exact decision enforced by
 * RequireAuth/RequireAccess on every protected route.
 *
 * Guards the production regression where an authenticated-but-unapproved user
 * was (a) incorrectly denied when their profile was active, and later (b)
 * nearly shipped as a universal bypass that allowed ANY authenticated Clerk
 * user regardless of account_status. The gate must stay strict and
 * provider-independent: authentication ≠ authorization.
 */
describe("evaluateAtlasAccess", () => {
  it("allows a super_admin regardless of account_status", () => {
    expect(evaluateAtlasAccess({ platform_role: "super_admin", account_status: "active" })).toEqual({
      allowed: true,
      reason: "super_admin",
    });
    // Even a pending/suspended super_admin passes — the platform owner is
    // never locked out of the product they administer.
    expect(evaluateAtlasAccess({ platform_role: "super_admin", account_status: "pending" })?.allowed).toBe(true);
    expect(evaluateAtlasAccess({ platform_role: "super_admin", account_status: null })?.allowed).toBe(true);
  });

  it("allows an active regular user", () => {
    expect(evaluateAtlasAccess({ platform_role: "user", account_status: "active" })).toEqual({
      allowed: true,
      reason: "active",
    });
  });

  it("denies a pending user (pilot gating)", () => {
    expect(evaluateAtlasAccess({ platform_role: "user", account_status: "pending" })).toEqual({
      allowed: false,
      reason: "pending",
    });
  });

  it("denies suspended and revoked users", () => {
    expect(evaluateAtlasAccess({ platform_role: "user", account_status: "suspended" })).toEqual({
      allowed: false,
      reason: "suspended",
    });
    expect(evaluateAtlasAccess({ platform_role: "user", account_status: "revoked" })).toEqual({
      allowed: false,
      reason: "revoked",
    });
  });

  it("fails closed for a missing profile row", () => {
    expect(evaluateAtlasAccess(null)).toEqual({
      allowed: false,
      reason: "missing_profile",
    });
    expect(evaluateAtlasAccess(undefined)).toEqual({
      allowed: false,
      reason: "missing_profile",
    });
  });

  it("fails closed for null/unknown field values", () => {
    // Both fields null → defaults apply → pending → denied.
    expect(evaluateAtlasAccess({ account_status: null, platform_role: null })).toEqual({
      allowed: false,
      reason: "pending",
    });
    // Unknown status strings must never grant access.
    expect(evaluateAtlasAccess({ account_status: "something_else" })?.allowed).toBe(false);
    expect(evaluateAtlasAccess({ account_status: "" })?.allowed).toBe(false);
    // An unknown role is NOT super_admin — still gated by account_status.
    expect(evaluateAtlasAccess({ platform_role: "tenant_admin", account_status: "active" })?.allowed).toBe(true);
    expect(evaluateAtlasAccess({ platform_role: "tenant_admin", account_status: "pending" })?.allowed).toBe(false);
  });

  it("matches the two verified production accounts", () => {
    // Verified live against the deployed database (scripts/verify-real-accounts.mjs).
    expect(
      evaluateAtlasAccess({
        platform_role: "super_admin",
        account_status: "active",
      }).allowed,
    ).toBe(true); // Melissa (founder)
    expect(
      evaluateAtlasAccess({
        platform_role: "user",
        account_status: "active",
      }).allowed,
    ).toBe(true); // YC Demo
  });
});
