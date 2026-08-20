/**
 * Clerk key validation.
 *
 * A valid Clerk publishable key starts with `pk_test_` or `pk_live_`.
 * Freebuff's build pipeline can inline VITE_ vars as opaque encrypted blobs
 * that are non-empty but not valid Clerk keys — we must reject those to
 * prevent Clerk from being activated without a usable key.
 */

export function isValidClerkKey(key: string | undefined | null): boolean {
  if (!key || typeof key !== "string") return false;
  return key.startsWith("pk_test_") || key.startsWith("pk_live_");
}

/** The raw value of the Vite env var (may be empty or invalid). */
const rawKey =
  (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string) || "";

/**
 * True when a valid Clerk publishable key is available.
 * Only VITE_CLERK_PUBLISHABLE_KEY is checked — no legacy CLERK_PUBLISHABLE_KEY fallback.
 */
export const isClerkConfigured: boolean = isValidClerkKey(rawKey);

/**
 * The resolved Clerk publishable key, or empty string if not configured/valid.
 */
export const clerkPublishableKey: string = isClerkConfigured ? rawKey : "";
