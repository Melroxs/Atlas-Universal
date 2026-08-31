import { describe, expect, it } from "vitest";
import {
  evaluateAtlasAccess,
  normalizeRole,
  normalizeStatus,
  isInternalRole,
  canAccessPlatformAdmin,
  canAccessUserAdmin,
  canManageUsers,
  canAssignAdminRoles,
  getDefaultLandingPath,
} from "./access-gate";

/**
 * Regression tests for the Atlas access gate — the exact decision enforced by
 * RequireAuth/RequireAccess/RequireInternalAuth on every protected route.
 */
describe("evaluateAtlasAccess", () => {
  it("allows a super_admin regardless of account_status", () => {
    expect(evaluateAtlasAccess({ platform_role: "super_admin", account_status: "active" })).toEqual({
      allowed: true,
      reason: "super_admin",
    });
    expect(evaluateAtlasAccess({ platform_role: "super_admin", account_status: "pending" })?.allowed).toBe(true);
    expect(evaluateAtlasAccess({ platform_role: "super_admin", account_status: null })?.allowed).toBe(true);
  });

  it("allows an active regular user", () => {
    expect(evaluateAtlasAccess({ platform_role: "user", account_status: "active" })).toEqual({
      allowed: true,
      reason: "active",
    });
  });

  it("allows an active atlas_admin", () => {
    expect(evaluateAtlasAccess({ platform_role: "atlas_admin", account_status: "active" })).toEqual({
      allowed: true,
      reason: "active",
    });
  });

  it("allows an active customer_admin", () => {
    expect(evaluateAtlasAccess({ platform_role: "customer_admin", account_status: "active" })).toEqual({
      allowed: true,
      reason: "active",
    });
  });

  it("allows an active customer_user", () => {
    expect(evaluateAtlasAccess({ platform_role: "customer_user", account_status: "active" })).toEqual({
      allowed: true,
      reason: "active",
    });
  });

  it("denies a pending user", () => {
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
    expect(evaluateAtlasAccess({ account_status: null, platform_role: null })).toEqual({
      allowed: false,
      reason: "pending",
    });
    expect(evaluateAtlasAccess({ account_status: "something_else" })?.allowed).toBe(false);
    expect(evaluateAtlasAccess({ account_status: "" })?.allowed).toBe(false);
    expect(evaluateAtlasAccess({ platform_role: "tenant_admin", account_status: "active" })?.allowed).toBe(true);
    expect(evaluateAtlasAccess({ platform_role: "tenant_admin", account_status: "pending" })?.allowed).toBe(false);
  });

  it("matches the two verified production accounts", () => {
    expect(
      evaluateAtlasAccess({
        platform_role: "super_admin",
        account_status: "active",
      }).allowed,
    ).toBe(true);
    expect(
      evaluateAtlasAccess({
        platform_role: "user",
        account_status: "active",
      }).allowed,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Role normalization tests
// ---------------------------------------------------------------------------
describe("normalizeRole", () => {
  it("normalizes known roles", () => {
    expect(normalizeRole("super_admin")).toBe("super_admin");
    expect(normalizeRole("atlas_admin")).toBe("atlas_admin");
    expect(normalizeRole("customer_admin")).toBe("customer_admin");
    expect(normalizeRole("customer_user")).toBe("customer_user");
    expect(normalizeRole("user")).toBe("user");
  });

  it("defaults unknown roles to 'user'", () => {
    expect(normalizeRole("tenant_admin")).toBe("user");
    expect(normalizeRole("pilot_user")).toBe("user");
    expect(normalizeRole("random")).toBe("user");
    expect(normalizeRole("")).toBe("user");
    expect(normalizeRole(null)).toBe("user");
    expect(normalizeRole(undefined)).toBe("user");
  });

  it("handles case insensitivity", () => {
    expect(normalizeRole("SUPER_ADMIN")).toBe("super_admin");
    expect(normalizeRole("User")).toBe("user");
  });
});

describe("normalizeStatus", () => {
  it("normalizes known statuses", () => {
    expect(normalizeStatus("active")).toBe("active");
    expect(normalizeStatus("pending")).toBe("pending");
    expect(normalizeStatus("suspended")).toBe("suspended");
    expect(normalizeStatus("revoked")).toBe("revoked");
  });

  it("defaults unknown statuses to 'pending'", () => {
    expect(normalizeStatus("unknown")).toBe("pending");
    expect(normalizeStatus("")).toBe("pending");
    expect(normalizeStatus(null)).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// Permission helper tests
// ---------------------------------------------------------------------------
describe("isInternalRole", () => {
  it("returns true for super_admin and atlas_admin", () => {
    expect(isInternalRole("super_admin")).toBe(true);
    expect(isInternalRole("atlas_admin")).toBe(true);
  });

  it("returns false for customer and user roles", () => {
    expect(isInternalRole("customer_admin")).toBe(false);
    expect(isInternalRole("customer_user")).toBe(false);
    expect(isInternalRole("user")).toBe(false);
  });
});

describe("canAccessPlatformAdmin", () => {
  it("allows only super_admin", () => {
    expect(canAccessPlatformAdmin("super_admin")).toBe(true);
    expect(canAccessPlatformAdmin("atlas_admin")).toBe(false);
    expect(canAccessPlatformAdmin("customer_admin")).toBe(false);
    expect(canAccessPlatformAdmin("user")).toBe(false);
  });
});

describe("canAccessUserAdmin", () => {
  it("allows super_admin and atlas_admin", () => {
    expect(canAccessUserAdmin("super_admin")).toBe(true);
    expect(canAccessUserAdmin("atlas_admin")).toBe(true);
  });

  it("denies customer roles", () => {
    expect(canAccessUserAdmin("customer_admin")).toBe(false);
    expect(canAccessUserAdmin("user")).toBe(false);
  });
});

describe("canManageUsers", () => {
  it("allows super_admin and atlas_admin", () => {
    expect(canManageUsers("super_admin")).toBe(true);
    expect(canManageUsers("atlas_admin")).toBe(true);
  });

  it("denies customer roles", () => {
    expect(canManageUsers("customer_user")).toBe(false);
    expect(canManageUsers("user")).toBe(false);
  });
});

describe("canAssignAdminRoles", () => {
  it("allows only super_admin", () => {
    expect(canAssignAdminRoles("super_admin")).toBe(true);
    expect(canAssignAdminRoles("atlas_admin")).toBe(false);
    expect(canAssignAdminRoles("user")).toBe(false);
  });
});

describe("getDefaultLandingPath", () => {
  it("returns /dashboard for all roles", () => {
    expect(getDefaultLandingPath("super_admin")).toBe("/dashboard");
    expect(getDefaultLandingPath("atlas_admin")).toBe("/dashboard");
    expect(getDefaultLandingPath("customer_admin")).toBe("/dashboard");
    expect(getDefaultLandingPath("customer_user")).toBe("/dashboard");
    expect(getDefaultLandingPath("user")).toBe("/dashboard");
  });
});
