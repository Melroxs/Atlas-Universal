import { useAuth } from "@/hooks/use-auth";
import { ShieldAlert } from "lucide-react";
import { Link } from "react-router";

export default function AccessDenied() {
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
            Your account is authenticated, but it has not been approved for
            Atlas access. Atlas is currently available through our pilot
            program.
          </p>
        </div>
        <div className="flex flex-col gap-3 items-center">
          <Link
            to="/pilot-apply"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Request Pilot Access
          </Link>
          <button
            type="button"
            onClick={() => signOut()}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </main>
  );
}
