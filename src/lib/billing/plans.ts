// ---------------------------------------------------------------------------
// Atlas billing plans — configurable plan architecture.
//
// Stripe Price IDs are read from Vite env vars so they can be configured
// per-environment without changing application logic. The server must
// validate the selected plan against these configured values — never trust
// a client-provided price.
// ---------------------------------------------------------------------------

export type BillingInterval = "monthly" | "annual";

export interface AtlasPlanFeature {
  label: string;
  included: boolean;
}

export interface AtlasPlan {
  id: string;
  name: string;
  tagline: string;
  monthlyPriceId: string | null;
  annualPriceId: string | null;
  monthlyDisplay: string;
  annualDisplay: string;
  monthlyUnitPrice: number;
  annualUnitPrice: number;
  features: AtlasPlanFeature[];
  highlighted?: boolean;
  cta: string;
}

// ---------------------------------------------------------------------------
// Stripe Price ID resolution from environment
//
// These MUST be set in the Supabase Edge Function environment or through
// the Freebuff Keys/API keys UI as VITE_ env vars for the frontend display.
// The authoritative validation happens server-side in the Edge Function.
// ---------------------------------------------------------------------------

function envPrice(key: string): string | null {
  const val = import.meta.env[key] as string | undefined;
  return val && val.length > 0 ? val : null;
}

// ---------------------------------------------------------------------------
// Plan definitions
//
// Pricing is NOT hardcoded in the application logic. The display prices
// below are for UI presentation only. The actual charge is determined by
// the Stripe Price ID attached to the Checkout Session, created server-side.
// ---------------------------------------------------------------------------

export const ATLAS_PLANS: AtlasPlan[] = [
  {
    id: "starter",
    name: "Atlas Starter",
    tagline: "For smaller restoration companies beginning with Atlas",
    monthlyPriceId: envPrice("VITE_STRIPE_PRICE_STARTER_MONTHLY"),
    annualPriceId: envPrice("VITE_STRIPE_PRICE_STARTER_ANNUAL"),
    monthlyDisplay: "$199",
    annualDisplay: "$169",
    monthlyUnitPrice: 199,
    annualUnitPrice: 169,
    features: [
      { label: "Up to 50 claims monitored", included: true },
      { label: "Core Atlas intelligence", included: true },
      { label: "Evidence analysis", included: true },
      { label: "Ask Atlas (text + voice)", included: true },
      { label: "Revenue opportunity detection", included: true },
      { label: "1 connected system", included: true },
      { label: "3 team members", included: true },
      { label: "Email support", included: true },
      { label: "Advanced workflows", included: false },
      { label: "Custom integrations", included: false },
    ],
    cta: "Get Started",
  },
  {
    id: "professional",
    name: "Atlas Professional",
    tagline: "For established restoration companies requiring broader functionality",
    monthlyPriceId: envPrice("VITE_STRIPE_PRICE_PROFESSIONAL_MONTHLY"),
    annualPriceId: envPrice("VITE_STRIPE_PRICE_PROFESSIONAL_ANNUAL"),
    monthlyDisplay: "$499",
    annualDisplay: "$419",
    monthlyUnitPrice: 499,
    annualUnitPrice: 419,
    features: [
      { label: "Up to 500 claims monitored", included: true },
      { label: "Everything in Starter", included: true },
      { label: "Atlas DecisionRoom", included: true },
      { label: "Atlas Evidence Intelligence", included: true },
      { label: "Atlas Activity & Audit Trail", included: true },
      { label: "5 connected systems", included: true },
      { label: "10 team members", included: true },
      { label: "Priority support", included: true },
      { label: "Custom workflows", included: true },
      { label: "API access", included: false },
    ],
    highlighted: true,
    cta: "Start Professional",
  },
  {
    id: "enterprise",
    name: "Atlas Enterprise",
    tagline: "For larger restoration organizations, networks and enterprise customers",
    monthlyPriceId: envPrice("VITE_STRIPE_PRICE_ENTERPRISE_MONTHLY"),
    annualPriceId: envPrice("VITE_STRIPE_PRICE_ENTERPRISE_ANNUAL"),
    monthlyDisplay: "Custom",
    annualDisplay: "Custom",
    monthlyUnitPrice: 0,
    annualUnitPrice: 0,
    features: [
      { label: "Unlimited claims", included: true },
      { label: "Everything in Professional", included: true },
      { label: "Unlimited connected systems", included: true },
      { label: "Unlimited team members", included: true },
      { label: "Custom AI models", included: true },
      { label: "Dedicated support", included: true },
      { label: "Custom integrations", included: true },
      { label: "SSO / SAML", included: true },
      { label: "SLA guarantee", included: true },
      { label: "On-premise option", included: true },
    ],
    cta: "Contact Sales",
  },
];

/**
 * Resolve the Stripe Price ID for a given plan and billing interval.
 * Returns null for the Enterprise plan (custom pricing) or when the
 * Price ID is not configured.
 */
export function resolvePriceId(
  plan: AtlasPlan,
  interval: BillingInterval,
): string | null {
  if (plan.id === "enterprise") return null;
  return interval === "monthly" ? plan.monthlyPriceId : plan.annualPriceId;
}

/**
 * Check whether the billing system is configured (at least Starter plan
 * has Price IDs set).
 */
export function isBillingConfigured(): boolean {
  const starter = ATLAS_PLANS.find((p) => p.id === "starter");
  return Boolean(starter?.monthlyPriceId || starter?.annualPriceId);
}

/**
 * Check whether a given plan ID is valid.
 */
export function isValidPlanId(planId: string): boolean {
  return ATLAS_PLANS.some((p) => p.id === planId);
}

/**
 * Check whether a given billing interval is valid.
 */
export function isValidInterval(interval: string): interval is BillingInterval {
  return interval === "monthly" || interval === "annual";
}
