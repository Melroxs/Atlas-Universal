/**
 * Atlas access gate — the single, testable authorization decision layer.
 *
 * This is the EXACT logic the production RequireAuth/RequireAccess/RequireInternalAuth
 * guards enforce, extracted as a pure function so the authorization matrix can be
 * regression-tested directly (see access-gate.test.ts).
 *
 * The model:
 *   Roles (platform_role):
 *     super_admin     → full platform access + organization administration
 *     atlas_admin     → Atlas product access + user management
 *     customer_admin  → customer dashboard + team management
 *     customer_user   → customer dashboard only
 *     user            → default (treated as customer_user)
 *
 *   Account status (account_status):
 *     active          → allowed
 *     pending         → denied (onboarding gating)
 *     suspended       → denied
 *     revoked         → denied
 *     null/missing    → denied (fail-closed)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AtlasRole =
  | "super_admin"
  | "atlas_admin"
  | "customer_admin"
  | "customer_user"
  | "user";

export type AtlasAccountStatus = "active" | "pending" | "suspended" | "revoked";

export type AtlasAccessDecision =
  | { allowed: true; reason: "super_admin" | "active" }
  | {
      allowed: false;
      reason:
        | "missing_profile"
        | "pending"
        | "suspended"
        | "revoked"
        | "unknown_status";
    };

export interface AccessProfileLike {
  account_status?: string | null;
  platform_role?: string | null;
}

// ---------------------------------------------------------------------------
// Core access evaluation
// ---------------------------------------------------------------------------

/**
 * Decide Atlas access from a profile row. `null` (no profile row) fails
 * closed — an authenticated identity without an Atlas profile is NOT
 * authorized.
 */
export function evaluateAtlasAccess(
  profile: AccessProfileLike | null | undefined,
): AtlasAccessDecision {
  if (!profile) {
    return { allowed: false, reason: "missing_profile" };
  }

  const platformRole = normalizeRole(profile.platform_role);
  if (platformRole === "super_admin") {
    return { allowed: true, reason: "super_admin" };
  }

  const accountStatus = normalizeStatus(profile.account_status);
  switch (accountStatus) {
    case "active":
      return { allowed: true, reason: "active" };
    case "pending":
      return { allowed: false, reason: "pending" };
    case "suspended":
      return { allowed: false, reason: "suspended" };
    case "revoked":
      return { allowed: false, reason: "revoked" };
    default:
      return { allowed: false, reason: "unknown_status" };
  }
}

// ---------------------------------------------------------------------------
// Role normalization
// ---------------------------------------------------------------------------

const VALID_ROLES: AtlasRole[] = [
  "super_admin",
  "atlas_admin",
  "customer_admin",
  "customer_user",
  "user",
];

export function normalizeRole(raw?: string | null): AtlasRole {
  const r = (raw ?? "user").toLowerCase().trim();
  if ((VALID_ROLES as string[]).includes(r)) return r as AtlasRole;
  return "user";
}

const VALID_STATUSES: AtlasAccountStatus[] = [
  "active",
  "pending",
  "suspended",
  "revoked",
];

export function normalizeStatus(raw?: string | null): AtlasAccountStatus {
  const s = (raw ?? "pending").toLowerCase().trim();
  if ((VALID_STATUSES as string[]).includes(s)) return s as AtlasAccountStatus;
  return "pending";
}

// ---------------------------------------------------------------------------
// Permission helpers
// ---------------------------------------------------------------------------

/**
 * Is this role an internal Atlas operator (not a customer)?
 */
export function isInternalRole(role: AtlasRole): boolean {
  return role === "super_admin" || role === "atlas_admin";
}/**
 * @deprecated Pilot product removed. Pilot users are now customer_user.
 */
export function canAccessPilotAdmin(_role: AtlasRole): boolean {
  return false;
}

/**
/**
 * Can this role access the platform administration section?
 * Only super_admin has platform admin access (organization management).
 */
export function canAccessPlatformAdmin(role: AtlasRole): boolean {
  return role === "super_admin";
}

/**
 * Can this role access the Users & Access admin section?
 * super_admin and atlas_admin.
 */
export function canAccessUserAdmin(role: AtlasRole): boolean {
  return role === "super_admin" || role === "atlas_admin";
}

/**
 * Can this role manage other users (change roles, suspend, etc.)?
 * Only super_admin can assign admin-level roles.
 * atlas_admin can manage customer roles only.
 */
export function canManageUsers(role: AtlasRole): boolean {
  return role === "super_admin" || role === "atlas_admin";
}

/**
 * Can this role assign admin-level roles (super_admin, atlas_admin)?
 * Only super_admin.
 */
export function canAssignAdminRoles(role: AtlasRole): boolean {
  return role === "super_admin";
}

/**
 * Can this role access the normal Atlas customer dashboard?
 * Everyone except unauthenticated/pending users.
 */
export function canAccessAtlasDashboard(role: AtlasRole): boolean {
  return true; // All roles with an active account can see the dashboard
}

/**
 * Given a role, what is the default landing path after login?
 */
export function getDefaultLandingPath(role: AtlasRole): string {
  switch (role) {
    case "super_admin":
    case "atlas_admin":
      return "/dashboard";
    case "customer_admin":
      return "/dashboard";
    case "customer_user":
      return "/dashboard";

    default:
      return "/dashboard";
  }
}
