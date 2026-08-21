import { useAuth } from "@/hooks/use-auth";
import { evaluateAtlasAccess } from "@/lib/auth/access-gate";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
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
  const decision = evaluateAtlasAccess(user);
  if (!decision.allowed) {
    return <Navigate to="/access-denied" replace />;
  }

  return children;
}
