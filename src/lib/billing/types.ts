// ---------------------------------------------------------------------------
// Atlas billing types — subscription lifecycle, customer state, and checkout.
// ---------------------------------------------------------------------------

/** Atlas subscription status — mirrors the server-side state machine. */
export type SubscriptionStatus =
  | "none" // No subscription
  | "trialing" // Active trial (future use)
  | "active" // Paid and active
  | "past_due" // Payment failed, retrying
  | "canceled" // Canceled, active until period end
  | "incomplete" // Checkout session created but not completed
  | "incomplete_expired" // Checkout session expired
  | "unpaid" // Invoice unpaid after retries
  | "paused"; // Subscription paused (future use)

/** Customer lifecycle state. */
export type CustomerLifecycle =
  | "account_created"
  | "checkout_started"
  | "payment_pending"
  | "payment_confirmed"
  | "customer_active"
  | "onboarding_required"
  | "onboarding_complete";

/** Onboarding step state. */
export type OnboardingStep =
  | "company"
  | "business"
  | "systems"
  | "first_workflow"
  | "complete";

/**
 * Atlas subscription record — stored in the database and associated
 * with the organization.
 */
export interface AtlasSubscription {
  _id: string;
  organizationId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  planId: string;
  billingInterval: "monthly" | "annual";
  status: SubscriptionStatus;
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: number | null;
  trialStart: number | null;
  trialEnd: number | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Stripe Checkout Session creation request — sent to the Edge Function.
 */
export interface CreateCheckoutRequest {
  planId: string;
  billingInterval: "monthly" | "annual";
  successUrl: string;
  cancelUrl: string;
}

/**
 * Stripe Checkout Session creation response — returned from the Edge Function.
 */
export interface CreateCheckoutResponse {
  sessionId: string;
  url: string;
}

/**
 * Webhook event types we handle.
 */
export type HandledWebhookEvent =
  | "checkout.session.completed"
  | "customer.subscription.created"
  | "customer.subscription.updated"
  | "customer.subscription.deleted"
  | "invoice.paid"
  | "invoice.payment_failed";

/**
 * Stripe Checkout Session metadata — passed through the session and verified
 * on webhook receipt.
 */
export interface CheckoutMetadata {
  userId: string;
  organizationId: string;
  planId: string;
  billingInterval: "monthly" | "annual";
}
