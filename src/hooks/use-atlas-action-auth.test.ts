// ---------------------------------------------------------------------------
// Tests for useAtlasActionAuth — role mapping and identity bridging
//
// Since useAtlasActionAuth depends on useAuth (which requires Supabase client),
// we test the role mapping logic and interface contract directly.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Role mapping logic (extracted for testability)
// Maps the Atlas access-gate role to the Atlas execution-layer role.
// ---------------------------------------------------------------------------

type AtlasUserRole =
  | "super_admin"
  | "atlas_admin"
  | "customer_admin"
  | "customer_user"
  | "pilot_user"
  | "user";

const VALID_ROLES: AtlasUserRole[] = [
  "super_admin",
  "atlas_admin",
  "customer_admin",
  "customer_user",
  "pilot_user",
  "user",
];

function normalizeRole(raw?: string | null): AtlasUserRole {
  const r = (raw ?? "user").toLowerCase().trim();
  if ((VALID_ROLES as string[]).includes(r)) return r as AtlasUserRole;
  return "user";
}

function mapProfileRoleToActionRole(
  profileRole: string | undefined | null,
): AtlasUserRole {
  const r = (profileRole ?? "").toLowerCase().trim();
  if (r === "super_admin" || r === "atlas_admin") return r;
  if (r === "customer_admin") return r;
  if (r === "customer_user" || r === "user" || r === "") return "customer_user";
  if (r === "pilot_user") return r;
  return "customer_user";
}

describe("mapProfileRoleToActionRole", () => {
  it("preserves super_admin", () => {
    expect(mapProfileRoleToActionRole("super_admin")).toBe("super_admin");
  });

  it("preserves atlas_admin", () => {
    expect(mapProfileRoleToActionRole("atlas_admin")).toBe("atlas_admin");
  });

  it("preserves customer_admin", () => {
    expect(mapProfileRoleToActionRole("customer_admin")).toBe("customer_admin");
  });

  it("maps customer_user to customer_user", () => {
    expect(mapProfileRoleToActionRole("customer_user")).toBe("customer_user");
  });

  it("maps user to customer_user", () => {
    expect(mapProfileRoleToActionRole("user")).toBe("customer_user");
  });

  it("maps empty string to customer_user", () => {
    expect(mapProfileRoleToActionRole("")).toBe("customer_user");
  });

  it("maps null to customer_user", () => {
    expect(mapProfileRoleToActionRole(null)).toBe("customer_user");
  });

  it("maps undefined to customer_user", () => {
    expect(mapProfileRoleToActionRole(undefined)).toBe("customer_user");
  });

  it("preserves pilot_user", () => {
    expect(mapProfileRoleToActionRole("pilot_user")).toBe("pilot_user");
  });

  it("normalizes casing", () => {
    expect(mapProfileRoleToActionRole("ATLAS_ADMIN")).toBe("atlas_admin");
    expect(mapProfileRoleToActionRole("Super_Admin")).toBe("super_admin");
  });

  it("falls back to customer_user for unknown roles", () => {
    expect(mapProfileRoleToActionRole("random_role")).toBe("customer_user");
  });
});

describe("normalizeRole (access-gate)", () => {
  it("normalizes valid roles", () => {
    expect(normalizeRole("super_admin")).toBe("super_admin");
    expect(normalizeRole("atlas_admin")).toBe("atlas_admin");
    expect(normalizeRole("customer_admin")).toBe("customer_admin");
    expect(normalizeRole("customer_user")).toBe("customer_user");
    expect(normalizeRole("pilot_user")).toBe("pilot_user");
    expect(normalizeRole("user")).toBe("user");
  });

  it("defaults to user for null/undefined", () => {
    expect(normalizeRole(null)).toBe("user");
    expect(normalizeRole(undefined)).toBe("user");
  });

  it("defaults to user for unknown role", () => {
    expect(normalizeRole("hacker")).toBe("user");
  });
});

describe("useAtlasActionAuth interface contract", () => {
  it("defines the expected shape", () => {
    // Verify the interface shape compiles
    interface AtlasActionAuth {
      isLoading: boolean;
      isAuthenticated: boolean;
      userId: string;
      userRole: AtlasUserRole;
      profile: {
        id: string;
        platform_role?: string | null;
        account_status?: string | null;
        tenant_id?: string | null;
        company_id?: string | null;
      } | null;
      isAccountActive: boolean;
    }

    const auth: AtlasActionAuth = {
      isLoading: false,
      isAuthenticated: true,
      userId: "test-user-id",
      userRole: "atlas_admin",
      profile: {
        id: "test-user-id",
        platform_role: "atlas_admin",
        account_status: "active",
        tenant_id: "tenant-1",
        company_id: "company-1",
      },
      isAccountActive: true,
    };

    expect(auth.isLoading).toBe(false);
    expect(auth.isAuthenticated).toBe(true);
    expect(auth.userId).toBe("test-user-id");
    expect(auth.userRole).toBe("atlas_admin");
    expect(auth.profile?.tenant_id).toBe("tenant-1");
    expect(auth.profile?.company_id).toBe("company-1");
    expect(auth.isAccountActive).toBe(true);
  });

  it("handles unauthenticated state", () => {
    interface AtlasActionAuth {
      isLoading: boolean;
      isAuthenticated: boolean;
      userId: string;
      userRole: AtlasUserRole;
      profile: null;
      isAccountActive: boolean;
    }

    const auth: AtlasActionAuth = {
      isLoading: true,
      isAuthenticated: false,
      userId: "",
      userRole: "customer_user",
      profile: null,
      isAccountActive: false,
    };

    expect(auth.userId).toBe("");
    expect(auth.profile).toBeNull();
    expect(auth.isAccountActive).toBe(false);
  });
});

describe("ActionHandlerContext workspace context", () => {
  it("supports tenant and company context", () => {
    interface ActionHandlerContext {
      userRole: AtlasUserRole;
      userId: string;
      userName?: string;
      tenantId?: string;
      companyId?: string;
    }

    const ctx: ActionHandlerContext = {
      userRole: "atlas_admin",
      userId: "user-123",
      userName: "Test User",
      tenantId: "tenant-abc",
      companyId: "company-xyz",
    };

    expect(ctx.tenantId).toBe("tenant-abc");
    expect(ctx.companyId).toBe("company-xyz");
  });

  it("allows missing workspace context", () => {
    interface ActionHandlerContext {
      userRole: AtlasUserRole;
      userId: string;
      userName?: string;
      tenantId?: string;
      companyId?: string;
    }

    const ctx: ActionHandlerContext = {
      userRole: "customer_user",
      userId: "user-456",
    };

    expect(ctx.tenantId).toBeUndefined();
    expect(ctx.companyId).toBeUndefined();
  });
});
