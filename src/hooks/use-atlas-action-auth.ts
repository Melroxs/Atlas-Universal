// ---------------------------------------------------------------------------
// useAtlasActionAuth
//
// Bridges the existing Supabase Auth system (useAuth) to the Atlas action
// execution layer. Every AtlasActionPanel, CommandCenter, DecisionCard,
// and ProactiveAtlas component should use this hook instead of hardcoded
// userRole/userId values.
//
// Provides:
//   - Real authenticated user ID (from Supabase Auth)
//   - Real platform role (from profiles table via access-gate)
//   - Real account status
//   - Workspace/tenant context (from profile row)
//   - Readiness state (auth loading, not yet authenticated, etc.)
// ---------------------------------------------------------------------------

import { useAuth } from "@/hooks/use-auth";
import type { AtlasUserRole } from "@/lib/atlas-experience/execution";

/**
 * Maps the Atlas access-gate role to the Atlas execution-layer role.
 * The execution layer uses its own `AtlasUserRole` type for authorization;
 * this bridge normalizes the profile's platform_role to match.
 */
function mapProfileRoleToActionRole(
  profileRole: string | undefined | null,
): AtlasUserRole {
  const r = (profileRole ?? "").toLowerCase().trim();
  if (r === "super_admin" || r === "atlas_admin") return r;
  if (r === "customer_admin") return r;
  if (r === "customer_user" || r === "user" || r === "") return "customer_user";
  return "customer_user";
}

export interface AtlasActionAuth {
  /** Whether auth is still loading / resolving */
  isLoading: boolean;
  /** Whether a valid, active authenticated session exists */
  isAuthenticated: boolean;
  /** The real Supabase Auth user ID (UUID). Empty string when not authenticated. */
  userId: string;
  /** The user's platform role mapped for the action execution layer */
  userRole: AtlasUserRole;
  /** The raw profile row from the profiles table */
  profile: {
    id: string;
    platform_role?: string | null;
    account_status?: string | null;
    tenant_id?: string | null;
    company_id?: string | null;
  } | null;
  /** Whether the current user has active account status */
  isAccountActive: boolean;
}

/**
 * Provides real authenticated identity for Atlas action components.
 *
 * Usage:
 *   const { userId, userRole, isLoading } = useAtlasActionAuth();
 *   <AtlasActionPanel userRole={userRole} userId={userId} ... />
 */
export function useAtlasActionAuth(): AtlasActionAuth {
  const { isLoading, isAuthenticated, user, role, accountStatus } = useAuth();

  return {
    isLoading,
    isAuthenticated,
    userId: user?.id ?? "",
    userRole: mapProfileRoleToActionRole(user?.platform_role ?? role),
    profile: user
      ? {
          id: user.id,
          platform_role: user.platform_role,
          account_status: user.account_status,
          tenant_id: (user as Record<string, unknown>).tenant_id as string | undefined,
          company_id: (user as Record<string, unknown>).company_id as string | undefined,
        }
      : null,
    isAccountActive: accountStatus === "active" || role === "super_admin",
  };
}
