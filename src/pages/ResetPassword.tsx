import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { getSupabaseClient } from "@/lib/supabase";
import { Eye, EyeOff, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import logo from "@/assets/logo.svg";

/**
 * Handles the Supabase password recovery flow.
 *
 * When a user clicks the recovery link in the email, Supabase redirects them
 * here with `access_token` and `refresh_token` in the URL hash fragment.
 * The Supabase client's `detectSessionInUrl: true` setting automatically
 * exchanges these for a session.
 *
 * This page then displays a form for the user to set their new password.
 */
export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  // On mount, verify that the Supabase client has a valid session from the
  // recovery redirect. If not, the user arrived here without a valid token.
  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setError("Supabase is not configured.");
      setIsLoading(false);
      return;
    }

    // The session should already be established by detectSessionInUrl.
    // Give it a moment to process the hash fragment.
    const checkSession = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          setSessionReady(true);
        } else {
          // No session — the recovery link may have expired or been used already
          setError(
            "This password reset link has expired or is invalid. Please request a new one from the sign-in page.",
          );
        }
      } catch {
        setError("Unable to verify your session. Please try again.");
      } finally {
        setIsLoading(false);
      }
    };

    // Give the Supabase client time to process the hash fragment
    const timer = setTimeout(checkSession, 500);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase is not configured.");

      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) throw updateError;

      setSuccess(true);

      // After successful password update, redirect to sign-in after a delay
      setTimeout(() => {
        navigate("/auth", { replace: true });
      }, 3000);
    } catch (err) {
      console.error("Password reset error:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to update password. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Loading state — verifying session
  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Verifying your reset link…
          </p>
        </div>
      </main>
    );
  }

  // Error state — invalid/expired link
  if (error && !sessionReady) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md text-center space-y-6">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
            <AlertCircle className="h-8 w-8 text-red-500" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Reset Link Invalid
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {error}
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/auth", { replace: true })}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Back to Sign In
          </button>
        </div>
      </main>
    );
  }

  // Success state
  if (success) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md text-center space-y-6">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
            <CheckCircle className="h-8 w-8 text-emerald-500" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Password Updated
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Your password has been successfully updated. Redirecting to sign
              in…
            </p>
          </div>
        </div>
      </main>
    );
  }

  // Password reset form
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 text-center">
          <img
            src={logo}
            alt="Atlas logo"
            width={64}
            height={64}
            className="rounded-lg mx-auto mb-4 cursor-pointer"
            onClick={() => navigate("/")}
          />
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Set New Password
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter your new password below
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              New Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm pr-9"
                required
                minLength={6}
                autoFocus
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Confirm Password
            </label>
            <input
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              required
              minLength={6}
            />
          </div>

          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}

          <button
            type="submit"
            className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            disabled={isSubmitting || !password || !confirmPassword}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                Updating…
              </>
            ) : (
              "Update Password"
            )}
          </button>
        </form>

        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => navigate("/auth", { replace: true })}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Back to sign in
          </button>
        </div>
      </div>
    </main>
  );
}
