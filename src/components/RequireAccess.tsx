import { useAuth } from "@/hooks/use-auth";
import { Loader2, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

/**
 * Wraps children and only renders them when the user is:
 *   1. Authenticated (has a valid session)
 *   2. Has an "active" account status
 *   3. Has an approved membership
 *
 * When the user is authenticated but not approved, shows an access-denied
 * page that directs them to request pilot access.
 */
export function RequireAccess({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, user } = useAuth();

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!isAuthenticated) {
    // This should normally be caught by RequireAuth first.
    // If we reach here, the user is not signed in at all.
    return (
      <AccessDenied
        message="You need to sign in to access Atlas."
        ctaText="Sign In"
        ctaHref="/auth"
      />
    );
  }

  // Check account status
  const accountStatus = user?.account_status ?? "pending";
  const platformRole = user?.platform_role ?? "user";

  // Super admins always have access
  if (platformRole === "super_admin") {
    return <>{children}</>;
  }

  // Active users with memberships have access
  if (accountStatus === "active") {
    return <>{children}</>;
  }

  // Suspended/revoked users
  if (accountStatus === "suspended" || accountStatus === "revoked") {
    return (
      <AccessDenied
        message="Your Atlas access has been suspended. Please contact support for assistance."
        ctaText="Contact Support"
        ctaHref="/pilot"
      />
    );
  }

  // Pending users — show access denied with consultation CTA
  return (
    <AccessDenied
      message="Atlas access has not been approved for this account. Atlas is currently available through our pilot program. Request a consultation to get started."
      ctaText="Request Pilot Access"
      ctaHref="/pilot-apply"
      showSignOut
    />
  );
}

function AccessDenied({
  message,
  ctaText,
  ctaHref,
  showSignOut,
}: {
  message: string;
  ctaText: string;
  ctaHref: string;
  showSignOut?: boolean;
}) {
  const { signOut } = useAuth();

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md text-center space-y-6">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <ShieldAlert className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Access Not Approved
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {message}
          </p>
        </div>
        <div className="flex flex-col gap-3 items-center">
          <Link
            to={ctaHref}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {ctaText}
          </Link>
          {showSignOut && (
            <button
              type="button"
              onClick={() => signOut()}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign out
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
