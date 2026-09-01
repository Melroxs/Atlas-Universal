import { useState } from "react";
import { useNavigate } from "react-router";
import { motion, type Variants } from "framer-motion";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Loader2,
  Lock,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ATLAS_PLANS,
  resolvePriceId,
  isBillingConfigured,
  type AtlasPlan,
  type BillingInterval,
} from "@/lib/billing";
import { useAuth } from "@/hooks/use-auth";
import { getSupabaseClient } from "@/lib/supabase";
import { toast } from "sonner";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
};

function PlanCard({
  plan,
  interval,
  onSelect,
  loading,
}: {
  plan: AtlasPlan;
  interval: BillingInterval;
  onSelect: (plan: AtlasPlan) => void;
  loading: string | null;
}) {
  const priceId = resolvePriceId(plan, interval);
  const isEnterprise = plan.id === "enterprise";
  const displayPrice = interval === "monthly" ? plan.monthlyDisplay : plan.annualDisplay;
  const isSelected = loading === plan.id;

  return (
    <motion.div
      variants={fadeUp}
      className={cn(
        "relative flex flex-col rounded-2xl border p-6 transition-all",
        plan.highlighted
          ? "border-teal-400/50 bg-teal-400/[0.04] shadow-lg shadow-teal-400/10"
          : "border-border/70 bg-card/60 hover:border-teal-400/30",
      )}
    >
      {plan.highlighted && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center gap-1 rounded-full bg-teal-400 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-teal-950">
            <Sparkles className="size-3" />
            Most Popular
          </span>
        </div>
      )}

      <div className="mb-4">
        <h3 className="text-lg font-semibold tracking-tight text-foreground">
          {plan.name}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>
      </div>

      <div className="mb-6">
        {isEnterprise ? (
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold tracking-tight text-foreground">
              Custom
            </span>
          </div>
        ) : (
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold tracking-tight text-foreground">
              {displayPrice}
            </span>
            <span className="text-sm text-muted-foreground">/mo</span>
          </div>
        )}
        {!isEnterprise && interval === "annual" && (
          <p className="mt-1 text-xs text-teal-600 dark:text-teal-300">
            Billed annually — save {Math.round((1 - plan.annualUnitPrice / plan.monthlyUnitPrice) * 100)}%
          </p>
        )}
      </div>

      <ul className="mb-6 flex-1 space-y-2.5">
        {plan.features.map((f) => (
          <li
            key={f.label}
            className={cn(
              "flex items-start gap-2 text-sm",
              f.included ? "text-foreground/90" : "text-muted-foreground/50",
            )}
          >
            {f.included ? (
              <Check className="mt-0.5 size-4 shrink-0 text-teal-600 dark:text-teal-300" />
            ) : (
              <span className="mt-0.5 size-4 shrink-0 rounded-full border border-border/60" />
            )}
            {f.label}
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => onSelect(plan)}
        disabled={isSelected || (!isEnterprise && !priceId)}
        className={cn(
          "group flex w-full items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-all",
          plan.highlighted
            ? "bg-teal-400 text-teal-950 hover:bg-teal-300 shadow-[0_0_24px_rgba(45,212,191,0.25)] hover:shadow-[0_0_36px_rgba(45,212,191,0.4)]"
            : "border border-border/70 bg-background text-foreground hover:border-teal-400/40 hover:text-teal-700 dark:hover:text-teal-200",
          isSelected && "opacity-70",
          !isEnterprise && !priceId && "opacity-50 cursor-not-allowed",
        )}
      >
        {isSelected ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Redirecting…
          </>
        ) : (
          <>
            {plan.cta}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </>
        )}
      </button>

      {!isEnterprise && !priceId && (
        <p className="mt-2 text-center text-[11px] text-muted-foreground/60">
          Price not yet configured
        </p>
      )}
    </motion.div>
  );
}

export default function Pricing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [loading, setLoading] = useState<string | null>(null);

  const billingConfigured = isBillingConfigured();

  const handleSelectPlan = async (plan: AtlasPlan) => {
    if (plan.id === "enterprise") {
      // Enterprise: contact sales — navigate to auth or mail
      navigate("/auth");
      return;
    }

    const priceId = resolvePriceId(plan, interval);
    if (!priceId) {
      toast.error("This plan is not yet available. Please try again later.");
      return;
    }

    setLoading(plan.id);

    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error("Supabase is not configured.");
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        // Not signed in — go to auth with return to pricing
        navigate(`/auth?returnTo=${encodeURIComponent(`/pricing?plan=${plan.id}&interval=${interval}`)}`);
        return;
      }

      const appOrigin = window.location.origin;

      // Call the Edge Function to create a Stripe Checkout Session
      const { data, error } = await supabase.functions.invoke(
        "stripe-create-checkout",
        {
          body: {
            planId: plan.id,
            billingInterval: interval,
            successUrl: `${appOrigin}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${appOrigin}/pricing?canceled=true`,
          },
        },
      );

      if (error) throw error;

      const payload = data as { url?: string; error?: string } | null;
      if (payload?.error) {
        throw new Error(payload.error);
      }
      if (!payload?.url) {
        throw new Error("No checkout URL returned.");
      }

      // Redirect to Stripe Checkout
      window.location.href = payload.url;
    } catch (err) {
      console.error("[pricing] checkout creation failed:", err);
      toast.error(
        err instanceof Error
          ? `Could not start checkout: ${err.message}`
          : "Could not start checkout. Please try again.",
      );
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4">
          <a
            href="/"
            className="flex items-center gap-2 text-lg font-semibold tracking-tight"
          >
            Atlas
          </a>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            {user ? (
              <button
                type="button"
                onClick={() => navigate("/dashboard")}
                className="rounded-lg px-3 py-1.5 font-medium text-foreground transition-colors hover:text-teal-600 dark:hover:text-teal-300"
              >
                Dashboard
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => navigate("/auth")}
                  className="rounded-lg px-3 py-1.5 font-medium transition-colors hover:text-foreground"
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/auth")}
                  className="rounded-lg bg-teal-400 px-4 py-1.5 text-sm font-semibold text-teal-950 transition-colors hover:bg-teal-300"
                >
                  Sign Up
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Canceled notice */}
      <div className="mx-auto w-full max-w-6xl px-5 pt-6">
        {new URLSearchParams(window.location.search).get("canceled") === "true" && (
          <div className="mb-6 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            <strong>Checkout canceled.</strong> No payment was processed. You can
            select a plan below when you're ready.
          </div>
        )}
      </div>

      {/* Hero */}
      <section className="relative z-10 mx-auto w-full max-w-4xl px-5 pb-8 pt-16 text-center">
        <motion.div
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.1 } } }}
        >
          <motion.p
            variants={fadeUp}
            className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-teal-600 dark:text-teal-300"
          >
            Pricing
          </motion.p>
          <motion.h1
            variants={fadeUp}
            className="text-4xl font-semibold tracking-tight sm:text-5xl"
          >
            Start recovering revenue.
          </motion.h1>
          <motion.p
            variants={fadeUp}
            className="mx-auto mt-5 max-w-lg text-base leading-7 text-muted-foreground"
          >
            Choose the Atlas plan that fits your company. All plans include our
            core intelligence engine, evidence analysis, and revenue opportunity
            detection.
          </motion.p>

          {/* Billing interval toggle */}
          <motion.div
            variants={fadeUp}
            className="mt-8 inline-flex items-center gap-1 rounded-lg border border-border/70 bg-card/60 p-1"
          >
            <button
              type="button"
              onClick={() => setInterval("monthly")}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm font-medium transition-all",
                interval === "monthly"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setInterval("annual")}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm font-medium transition-all",
                interval === "annual"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Annual
              <span className="ml-1.5 rounded-full bg-teal-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-teal-600 dark:text-teal-300">
                Save 15%
              </span>
            </button>
          </motion.div>
        </motion.div>
      </section>

      {/* Plans */}
      <section className="relative z-10 mx-auto w-full max-w-5xl px-5 pb-24">
        <motion.div
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.08 } } }}
          className="grid gap-6 md:grid-cols-3"
        >
          {ATLAS_PLANS.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              interval={interval}
              onSelect={handleSelectPlan}
              loading={loading}
            />
          ))}
        </motion.div>

        {/* Trust signals */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground/70">
          <span className="flex items-center gap-1.5">
            <Lock className="size-3.5" />
            Secure checkout powered by Stripe
          </span>
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5" />
            Cancel anytime
          </span>
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5" />
            No long-term contracts
          </span>
        </div>

        {!billingConfigured && (
          <div className="mt-8 rounded-lg border border-border/70 bg-card/40 p-4 text-center text-sm text-muted-foreground">
            <strong>Billing not yet configured.</strong> Stripe Price IDs need
            to be set in the project's environment before checkout can proceed.
            Contact your administrator to complete setup.
          </div>
        )}
      </section>
    </div>
  );
}
