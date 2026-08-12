import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useAuth } from "@/hooks/use-auth";
import { classifyAuthError } from "@/lib/auth-errors";
import {
  isSupabaseConfigured,
  supabaseSendPasswordReset,
  supabaseSignIn,
  supabaseSignUp,
} from "@/lib/supabase";
import logo from "@/assets/logo.svg";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogIn,
  Mail,
  UserPlus,
  UserX,
} from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

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

  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
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

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signUp") {
        const { needsEmailConfirmation } = await supabaseSignUp({
          email,
          password,
          name,
        });
        if (needsEmailConfirmation) {
          // Supabase email confirmation is enabled — the user must confirm
          // before their account can be used.
          setNotice(
            `Almost there! We sent a confirmation link to ${email.trim()}. ` +
              "Click it to activate your account, then sign in.",
          );
          setIsLoading(false);
          return;
        }
      } else {
        await supabaseSignIn(email, password);
      }
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
    setNotice(null);
    try {
      await signIn("anonymous");
      navigate(redirect);
    } catch (err) {
      console.error("Guest login error:", err);
      setError(`Failed to sign in as guest: ${classifyAuthError(err)}`);
      setIsLoading(false);
    }
  };

  const emailInput = (
    <div className="space-y-1.5">
      <Label htmlFor="email" className="text-xs font-medium text-muted-foreground">
        Email
      </Label>
      <div className="relative">
        <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="pl-9"
          disabled={isLoading || !supabaseClientConfigured}
          required
        />
      </div>
    </div>
  );

  const passwordInput = (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label
          htmlFor="password"
          className="text-xs font-medium text-muted-foreground"
        >
          Password
        </Label>
        {mode === "signIn" && (
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 text-xs"
            onClick={() => setResetting((r) => !r)}
            disabled={isLoading}
          >
            Forgot password?
          </Button>
        )}
      </div>
      <div className="relative">
        <Input
          id="password"
          name="password"
          type={showPassword ? "text" : "password"}
          autoComplete={mode === "signUp" ? "new-password" : "current-password"}
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="pr-9"
          disabled={isLoading || !supabaseClientConfigured}
          required
          minLength={mode === "signUp" ? 6 : undefined}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShowPassword((s) => !s)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
          aria-label={showPassword ? "Hide password" : "Show password"}
        >
          {showPassword ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );

  const statusBanner = !supabaseClientConfigured ? (
    <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-left text-xs leading-5 text-amber-800 dark:text-amber-200">
      <AlertTriangle className="mr-1.5 inline size-3.5 -translate-y-px" />
      Email sign-in isn't configured for this deployment yet. Ask the
      administrator to add the{" "}
      <code className="font-mono">VITE_SUPABASE_URL</code> and{" "}
      <code className="font-mono">VITE_SUPABASE_ANON_KEY</code> project keys —
      or continue as Guest below.
    </div>
  ) : null;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Auth Content */}
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center justify-center h-full flex-col">
          <Card className="min-w-[350px] pb-0 border shadow-md">
            <CardHeader className="text-center">
              <div className="flex justify-center">
                <img
                  src={logo}
                  alt="Atlas logo"
                  width={64}
                  height={64}
                  className="rounded-lg mb-4 mt-4 cursor-pointer"
                  onClick={() => navigate("/")}
                />
              </div>
              <CardTitle className="text-xl">
                {resetting ? "Reset your password" : "Welcome to Atlas"}
              </CardTitle>
              <CardDescription>
                {resetting
                  ? "We'll email you a link to set a new password"
                  : mode === "signIn"
                    ? "Sign in to your workspace"
                    : "Create your account and workspace"}
              </CardDescription>
              {statusBanner}
            </CardHeader>

            {resetting ? (
              <form onSubmit={handleReset}>
                <CardContent className="space-y-4">
                  {emailInput}
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={() => {
                      setResetting(false);
                      setError(null);
                      setNotice(null);
                    }}
                    disabled={isLoading}
                  >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to sign in
                  </Button>
                  {error && (
                    <p className="mt-2 text-sm text-red-500">{error}</p>
                  )}
                  {notice && (
                    <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-300">
                      {notice}
                    </p>
                  )}
                </CardContent>
                <CardFooter>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isLoading || !supabaseClientConfigured || !email}
                  >
                    {isLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <KeyRound className="mr-2 h-4 w-4" />
                    )}
                    Send reset link
                  </Button>
                </CardFooter>
              </form>
            ) : (
              <>
                <Tabs
                  value={mode}
                  onValueChange={(v) => {
                    setMode(v as Mode);
                    setError(null);
                    setNotice(null);
                  }}
                  className="px-6"
                >
                  <TabsList className="w-full">
                    <TabsTrigger value="signIn" className="flex-1">
                      <LogIn className="h-4 w-4" />
                      Sign in
                    </TabsTrigger>
                    <TabsTrigger value="signUp" className="flex-1">
                      <UserPlus className="h-4 w-4" />
                      Create account
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                <form onSubmit={handleSubmit}>
                  <CardContent className="space-y-4">
                    {mode === "signUp" && (
                      <div className="space-y-1.5">
                        <Label
                          htmlFor="name"
                          className="text-xs font-medium text-muted-foreground"
                        >
                          Full name
                        </Label>
                        <Input
                          id="name"
                          name="name"
                          type="text"
                          autoComplete="name"
                          placeholder="Alex Rivera"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          disabled={isLoading || !supabaseClientConfigured}
                        />
                      </div>
                    )}
                    {emailInput}
                    {passwordInput}
                    {error && (
                      <p className="mt-2 text-sm text-red-500">{error}</p>
                    )}
                    {notice && (
                      <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-300">
                        {notice}
                      </p>
                    )}

                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-background px-2 text-muted-foreground">
                          Or
                        </span>
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={handleGuestLogin}
                      disabled={isLoading}
                    >
                      <UserX className="mr-2 h-4 w-4" />
                      Continue as Guest
                    </Button>
                  </CardContent>
                  <CardFooter>
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={
                        isLoading ||
                        !supabaseClientConfigured ||
                        !email ||
                        !password
                      }
                    >
                      {isLoading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : mode === "signUp" ? (
                        <UserPlus className="mr-2 h-4 w-4" />
                      ) : (
                        <LogIn className="mr-2 h-4 w-4" />
                      )}
                      {mode === "signUp" ? "Create account" : "Sign in"}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </CardFooter>
                </form>
              </>
            )}
          </Card>
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
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
