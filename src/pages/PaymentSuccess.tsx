import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { getSupabaseClient } from "@/lib/supabase";
import { CheckCircle2, Loader2, AlertTriangle, ArrowRight } from "lucide-react";

/**
 * Payment Success page — shown after Stripe Checkout redirects back.
 *
 * IMPORTANT: This page does NOT activate the customer based on the URL.
 * It shows a processing state while the Stripe webhook confirms payment
 * server-side. The actual activation happens through the webhook → Edge
 * Function → database flow.
 */
export default function PaymentSuccess() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"processing" | "confirmed" | "error">(
    "processing",
  );
  const [message, setMessage] = useState("Confirming your payment…");

  useEffect(() => {
    const sessionId = searchParams.get("session_id");

    if (!sessionId) {
      setStatus("error");
      setMessage("No session ID found. Please check your email for confirmation.");
      return;
    }

    // Poll the Edge Function to check if the webhook has processed
    // the checkout session. Do NOT activate the customer based on
    // the URL — wait for server-side webhook confirmation.
    let attempts = 0;
    const maxAttempts = 30; // 30 × 2s = 60s max wait

    const checkStatus = async () => {
      attempts++;
      try {
        const supabase = getSupabaseClient();
        if (!supabase) throw new Error("Supabase not configured");

        const { data, error } = await supabase.functions.invoke(
          "stripe-checkout-status",
          { body: { sessionId } },
        );

        if (error) throw error;

        const payload = data as {
          status?: string;
          subscriptionStatus?: string;
          error?: string;
        } | null;

        if (payload?.status === "complete" || payload?.subscriptionStatus === "active") {
          setStatus("confirmed");
          setMessage("Payment confirmed! Setting up your workspace…");
          // Redirect to setup/onboarding after a brief delay
          setTimeout(() => navigate("/setup"), 2000);
          return;
        }

        if (payload?.status === "open") {
          // Still processing — the webhook may not have fired yet
          if (attempts < maxAttempts) {
            setTimeout(checkStatus, 2000);
          } else {
            setStatus("error");
            setMessage(
              "Payment is being processed. You'll receive a confirmation email shortly.",
            );
          }
          return;
        }

        if (payload?.status === "expired") {
          setStatus("error");
          setMessage("Your checkout session has expired. Please try again.");
          return;
        }

        // Unknown status
        if (attempts < maxAttempts) {
          setTimeout(checkStatus, 2000);
        } else {
          setStatus("error");
          setMessage(
            "We're still processing your payment. Check your email for confirmation.",
          );
        }
      } catch {
        if (attempts < maxAttempts) {
          setTimeout(checkStatus, 2000);
        } else {
          setStatus("error");
          setMessage(
            "We couldn't verify your payment status. Check your email or contact support.",
          );
        }
      }
    };

    checkStatus();
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-5">
      <div className="max-w-md text-center">
        {status === "processing" && (
          <>
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-teal-400/15 text-teal-600 ring-1 ring-teal-400/30">
              <Loader2 className="size-8 animate-spin" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">
              Confirming your payment
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">{message}</p>
          </>
        )}

        {status === "confirmed" && (
          <>
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-emerald-400/15 text-emerald-600 ring-1 ring-emerald-400/30">
              <CheckCircle2 className="size-8" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">
              Payment confirmed!
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">{message}</p>
            <div className="mt-6">
              <button
                type="button"
                onClick={() => navigate("/setup")}
                className="inline-flex items-center gap-2 rounded-lg bg-teal-400 px-5 py-2.5 text-sm font-semibold text-teal-950 transition-colors hover:bg-teal-300"
              >
                Continue to Setup
                <ArrowRight className="size-4" />
              </button>
            </div>
          </>
        )}

        {status === "error" && (
          <>
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-600 ring-1 ring-amber-400/30">
              <AlertTriangle className="size-8" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">
              Payment status
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">{message}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => navigate("/pricing")}
                className="rounded-lg border border-border/70 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-teal-400/40"
              >
                View Plans
              </button>
              <button
                type="button"
                onClick={() => navigate("/dashboard")}
                className="rounded-lg bg-teal-400 px-4 py-2 text-sm font-semibold text-teal-950 transition-colors hover:bg-teal-300"
              >
                Go to Dashboard
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
