/**
 * Atlas access gate — the single, testable authorization decision.
 *
 * This is the EXACT logic the production RequireAuth/RequireAccess guards
 * enforce, extracted as a pure function so the authorization matrix can be
 * regression-tested directly (see access-gate.test.ts).
 *
 * The model:
 *   - super_admin  → always allowed (platform owner)
 *   - active       → allowed (approved pilot user)
 *   - suspended / revoked / pending / unknown → denied
 *   - missing profile (null) → denied (fail-closed: unknown users must never
 *     silently become authorized)
 */

export type AtlasAccessDecision =
  | { allowed: true; reason: "super_admin" | "active" }
  | {
      allowed: false;
      reason: "missing_profile" | "pending" | "suspended" | "revoked" | "unknown_status";
    };

export interface AccessProfileLike {
  account_status?: string | null;
  platform_role?: string | null;
}

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

  const platformRole = profile.platform_role ?? "user";
  if (platformRole === "super_admin") {
    return { allowed: true, reason: "super_admin" };
  }

  const accountStatus = profile.account_status ?? "pending";
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
