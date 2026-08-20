import { SignIn, SignUp, useAuth } from "@clerk/clerk-react";
import { useEffect, Suspense, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import logo from "@/assets/logo.svg";
import { ArrowLeft } from "lucide-react";

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
  const { isLoaded, isSignedIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );
  const [mode, setMode] = useState<Mode>("signIn");

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      navigate(redirect);
    }
  }, [isLoaded, isSignedIn, navigate, redirect]);

  const afterSignUpUrl = "/setup";
  const afterSignInUrl = redirect;

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
              {mode === "signIn" ? "Welcome to Atlas" : "Create your account"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === "signIn"
                ? "Sign in to your workspace"
                : "Create your account and get started"}
            </p>
          </div>

          {mode === "signIn" ? (
            <SignIn
              routing="hash"
              signUpUrl="#/sign-up"
              afterSignInUrl={afterSignInUrl}
              appearance={{
                elements: {
                  rootBox: "mx-auto",
                  card: "shadow-none border border-border/70 bg-card",
                },
              }}
            />
          ) : (
            <SignUp
              routing="hash"
              signInUrl="#/sign-in"
              afterSignUpUrl={afterSignUpUrl}
              appearance={{
                elements: {
                  rootBox: "mx-auto",
                  card: "shadow-none border border-border/70 bg-card",
                },
              }}
            />
          )}

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => setMode(mode === "signIn" ? "signUp" : "signIn")}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {mode === "signIn"
                ? "Don't have an account? Create one"
                : "Already have an account? Sign in"}
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

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
