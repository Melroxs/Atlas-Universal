// ---------------------------------------------------------------------------
// Auth error classification — pure, unit-tested mapping from raw auth errors
// to safe, actionable, user-facing messages.
//
// Safety: never include provider secrets, stack traces, tokens or headers in
// the surfaced messages. Supabase SDK errors carry a stable `code` like
// "invalid_credentials"; Convex exchange errors surface as plain Error
// messages from the backend (which are already sanitized server-side).
// ---------------------------------------------------------------------------

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error ?? "");
}

function codeOf(error: unknown): string {
  const candidate = (error as { code?: unknown })?.code;
  return typeof candidate === "string" ? candidate : "";
}

const SUPABASE_MESSAGES: Record<string, string> = {
  invalid_credentials:
    "The email or password is incorrect. Check both and try again, or reset your password.",
  email_exists:
    "An account with this email already exists. Sign in instead, or use a different email address.",
  user_already_exists:
    "An account with this email already exists. Sign in instead, or use a different email address.",
  weak_password:
    "That password is too weak. Use at least 6 characters — ideally a mix of letters, numbers and symbols.",
  over_email_send_rate_limit:
    "Too many attempts. Please wait a moment and try again.",
  over_request_rate_limit:
    "Too many attempts. Please wait a moment and try again.",
  email_not_confirmed:
    "This email hasn't been confirmed yet. Check your inbox for the confirmation link, then try again.",
  invalid_email:
    "That email address looks invalid. Please check it and try again.",
  validation_failed:
    "Some of the details you entered look invalid. Please check them and try again.",
  signup_disabled:
    "New account creation is currently disabled for this project.",
  email_provider_disabled:
    "Email/password sign-in is currently disabled for this project.",
  bad_json:
    "Unable to reach the sign-in service right now. Check your connection and try again.",
};

/**
 * True when the error means the email already has an account (signup 422
 * "User already registered" / user_already_exists / email_exists). Used by
 * the Auth page to offer an obvious "Sign in instead" path.
 */
export function isExistingAccountError(error: unknown): boolean {
  const msg = messageOf(error).toLowerCase();
  const code = codeOf(error).toLowerCase();
  if (
    code === "user_already_exists" ||
    code === "email_exists" ||
    code === "duplicate_email"
  ) {
    return true;
  }
  // Some SDK/gateway versions surface the 422 body only as a message without
  // a stable code — recognize the wording, never a stack trace or secret.
  return /(already registered|already exists|already in use)/.test(msg);
}

/**
 * Classify any auth error (Supabase SDK error or backend exchange error) into
 * a safe, actionable message. Generic by default — never leaks internals.
 */
export function classifyAuthError(error: unknown): string {
  const msg = messageOf(error);
  const code = codeOf(error);

  const known = SUPABASE_MESSAGES[code];
  if (known) return known;

  if (isExistingAccountError(error)) {
    return SUPABASE_MESSAGES.email_exists;
  }

  if (
    /not configured|supabase_service_role|vite_supabase|missing.*key|invalid.*service role/i.test(
      msg,
    )
  ) {
    return (
      "Email sign-in isn't fully configured for this deployment yet. Ask the administrator to " +
      "add the VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY keys plus the SUPABASE_URL and " +
      "SUPABASE_SERVICE_ROLE_KEY keys, then try again. You can also continue as Guest."
    );
  }
  if (/network|unreachable|temporarily unavailable|timeout|ECONN/i.test(msg)) {
    return "Unable to reach the sign-in service right now. Check your connection and try again.";
  }
  if (/invalid supabase|unverified|expired.*token|access token|jwt/i.test(msg)) {
    return "Your sign-in session expired. Please sign in again.";
  }
  return "Unable to sign in. Please try again.";
}
