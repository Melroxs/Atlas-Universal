import { useAuth } from "@/hooks/use-auth";
import { isClerkConfigured } from "@/lib/clerk-config";
import {
  isSupabaseConfigured,
  supabaseSendPasswordReset,
  supabaseSignIn,
} from "@/lib/supabase";
import { classifyAuthError } from "@/lib/auth-errors";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import logo from "@/assets/logo.svg";
import { ArrowLeft, Eye, EyeOff, KeyRound, LogIn } from "lucide-react";

// Static imports — ClerkProvider is mounted synchronously at the app root,
// so these components are always safe to render inside the provider tree.
import { SignIn } from "@clerk/react";

interface AuthProps {
  redirectAfterAuth?: string;
}

function resolveRedirectAfterAuth(
  returnTo: string | null,
  fallback = "/dashboard",
) {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }
  return fallback;
}

type Mode = "signIn" | "signUp";

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );

  const [mode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const supabaseClientConfigured = isSupabaseConfigured();

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(redirect);
    }
  }, [authLoading, isAuthenticated, navigate, redirect]);

  const afterSignUpUrl = "/pilot-apply";
  const afterSignInUrl = redirect;

  // ---------- Supabase auth handlers ----------

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    setNotice(null);
    try {
      // Sign-up is no longer self-service — users must request pilot access.
      // This handler only processes sign-in.
      await supabaseSignIn(email, password);
      navigate(redirect);
    } catch (err) {
      console.error("Auth error:", err);
      setError(classifyAuthError(err));
      setIsLoading(false);
    }
  };

  const handleReset = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    setNotice(null);
    try {
      await supabaseSendPasswordReset(email);
      setNotice(
        `If an account exists for ${email}, a password reset link is on its way. Check your inbox.`,
      );
      setResetting(false);
    } catch (err) {
      console.error("Password reset error:", err);
      setError(classifyAuthError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleGuestLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await signIn("anonymous");
      navigate(redirect);
    } catch (err) {
      console.error("Guest login error:", err);
      setError(`Failed to sign in as guest: ${classifyAuthError(err)}`);
      setIsLoading(false);
    }
  };

  // ---------- Clerk mode: render Clerk's built-in components ----------

  if (isClerkConfigured) {
    return (
      <div className="min-h-screen flex flex-col">
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center justify-center h-full flex-col">
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
                Welcome to Atlas
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Sign in to your workspace
              </p>
            </div>

            <SignIn
              routing="hash"
              signUpFallbackRedirectUrl="/pilot-apply"
              fallbackRedirectUrl={afterSignInUrl}
              appearance={{
                elements: {
                  rootBox: "mx-auto",
                  card: "shadow-none border border-border/70 bg-card",
                },
              }}
            />

            <div className="mt-4 text-center space-y-2">
              <button
                type="button"
                onClick={() => navigate("/pilot-apply")}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Don't have access? Request pilot access
              </button>
            </div>
          </div>
        </div>

        <div className="py-4 px-6 text-xs text-center text-muted-foreground">
          Secured by{" "}
          <a
            href="https://clerk.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-primary transition-colors"
          >
            Clerk
          </a>
        </div>
      </div>
    );
  }

  // ---------- Supabase fallback: email/password form ----------

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-[380px] px-4">
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
              {resetting ? "Reset your password" : "Welcome to Atlas"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {resetting
                ? "We'll email you a link to set a new password"
                : "Sign in to your workspace"}
            </p>
          </div>

          {resetting ? (
            <form onSubmit={handleReset} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Email</label>
                <input
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  required
                />
              </div>
              <button
                type="button"
                onClick={() => { setResetting(false); setError(null); setNotice(null); }}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="mr-1 inline h-3 w-3" />
                Back to sign in
              </button>
              {error && <p className="text-sm text-red-500">{error}</p>}
              {notice && <p className="text-sm text-emerald-600 dark:text-emerald-300">{notice}</p>}
              <button
                type="submit"
                className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                disabled={isLoading || !supabaseClientConfigured || !email}
              >
                {isLoading ? "..." : <><KeyRound className="mr-2 inline h-4 w-4" /> Send reset link</>}
              </button>
            </form>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Email</label>
                  <input
                    type="email"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground">Password</label>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setResetting(true)}
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm pr-9"
                      required
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {error && <p className="text-sm text-red-500">{error}</p>}
                {notice && <p className="text-sm text-emerald-600 dark:text-emerald-300">{notice}</p>}

                <button
                  type="submit"
                  className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  disabled={isLoading || !supabaseClientConfigured || !email || !password}
                >
                  {isLoading ? "..." : <><LogIn className="mr-2 inline h-4 w-4" /> Sign in</>}
                </button>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">Or</span>
                  </div>
                </div>

                <button
                  type="button"
                  className="w-full rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
                  onClick={handleGuestLogin}
                  disabled={isLoading}
                >
                  Continue as Guest
                </button>
              </form>

              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={() => navigate("/pilot-apply")}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Don't have access? Request pilot access
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="py-4 px-6 text-xs text-center text-muted-foreground">
        Secured by{" "}
        <a
          href="https://freebuff.com"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-primary transition-colors"
        >
          freebuff.com
        </a>
      </div>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return <Auth {...props} />;
}
