import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/api";
import { useMutation } from "@/hooks/use-supabase";
import { evaluateAtlasAccess } from "@/lib/auth/access-gate";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, user } = useAuth();
  const location = useLocation();
  const claimInvites = useMutation(api.tenants.claimInvites);
  const [claimingInvites, setClaimingInvites] = useState(false);
  const [inviteClaimed, setInviteClaimed] = useState(false);
  const hasAttemptedClaim = useRef(false);

  // When an authenticated user has a pending account_status, try to claim
  // any pending invites. This handles the invitation flow where:
  // 1. Admin creates invite → pending invite record exists
  // 2. User clicks invite link → Supabase creates auth user
  // 3. handle_new_user trigger creates profile with account_status='pending'
  // 4. tenants_claim_invites creates membership AND activates the profile
  useEffect(() => {
    if (!isAuthenticated || isLoading || user === undefined || user === null) return;
    if (hasAttemptedClaim.current) return;

    const accountStatus = user?.account_status ?? "pending";
    if (accountStatus === "pending") {
      hasAttemptedClaim.current = true;
      setClaimingInvites(true);
      void claimInvites()
        .then((result) => {
          const claimed = (result as { claimed?: number })?.claimed ?? 0;
          if (claimed > 0) {
            setInviteClaimed(true);
          }
        })
        .catch(() => {
          // Non-blocking — if claiming fails, the user will see access-denied
        })
        .finally(() => {
          setClaimingInvites(false);
        });
    }
  }, [isAuthenticated, isLoading, user, claimInvites]);

  if (isLoading || claimingInvites) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <span className="text-sm">
            {claimingInvites ? "Setting up your access…" : "Loading…"}
          </span>
        </div>
      </main>
    );
  }

  if (!isAuthenticated) {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <Navigate
        to={`/auth?returnTo=${encodeURIComponent(returnTo)}`}
        replace
      />
    );
  }

  // Authorization is independent of authentication: a valid session does NOT
  // imply an approved account. The gate fails closed — super_admin or an
  // active account_status passes; pending/suspended/revoked/missing profiles
  // are denied. There is deliberately NO provider-based bypass.
  //
  // When inviteClaimed is true, the user just had their pending invite claimed
  // and their profile was activated. We skip the gate check for this render
  // to let the user through — the next render will have the updated profile.
  const decision = evaluateAtlasAccess(user);
  if (!decision.allowed && !inviteClaimed) {
    return (
      <Navigate
        to={`/access-denied?reason=${decision.reason}`}
        replace
      />
    );
  }

  return children;
}
