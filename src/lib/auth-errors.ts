// ---------------------------------------------------------------------------
// Auth error classification — pure, unit-tested mapping from raw auth errors
// to safe, actionable, user-facing messages.
//
// Safety: never include provider secrets, stack traces, tokens or headers in
// the surfaced messages. Firebase SDK errors carry a stable `code` like
// "auth/wrong-password"; Convex exchange errors surface as plain Error
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

const FIREBASE_MESSAGES: Record<string, string> = {
  "auth/email-already-in-use":
    "An account with this email already exists. Sign in instead, or use a different email address.",
  "auth/invalid-email":
    "That email address looks invalid. Please check it and try again.",
  "auth/weak-password":
    "That password is too weak. Use at least 6 characters — ideally a mix of letters, numbers and symbols.",
  "auth/wrong-password":
    "The password is incorrect. Check it and try again, or use “Forgot password?” to reset it.",
  "auth/user-not-found":
    "No account exists for that email. Create an account instead.",
  "auth/invalid-credential":
    "The email or password is incorrect. Check both and try again, or reset your password.",
  "auth/too-many-requests":
    "Too many attempts. Please wait a moment and try again.",
  "auth/network-request-failed":
    "Unable to reach the sign-in service right now. Check your connection and try again.",
  "auth/operation-not-allowed":
    "Email/password sign-in is currently disabled for this Firebase project.",
  "auth/configuration-not-found":
    "Firebase auth isn't configured for this deployment. Ask the administrator to add the VITE_FIREBASE_* keys, then try again.",
  "auth/unauthorized-domain":
    "This domain isn't authorized for Firebase sign-in. Ask the administrator to add it to the Firebase console's authorized domains.",
};

/**
 * Classify any auth error (Firebase SDK error or backend exchange error) into
 * a safe, actionable message. Generic by default — never leaks internals.
 */
export function classifyAuthError(error: unknown): string {
  const msg = messageOf(error);
  const code = codeOf(error);

  const known = FIREBASE_MESSAGES[code];
  if (known) return known;

  if (
    /not configured|firebase_service_account|vite_firebase|missing.*key|invalid.*service account/i.test(
      msg,
    )
  ) {
    return (
      "Email sign-in isn't fully configured for this deployment yet. Ask the administrator to " +
      "add the VITE_FIREBASE_* keys and the FIREBASE_SERVICE_ACCOUNT_JSON key, then try again. " +
      "You can also continue as Guest."
    );
  }
  if (/network|unreachable|temporarily unavailable|timeout|ECONN/i.test(msg)) {
    return "Unable to reach the sign-in service right now. Check your connection and try again.";
  }
  if (/invalid firebase|unverified|expired.*token|id token/i.test(msg)) {
    return "Your sign-in session expired. Please sign in again.";
  }
  return "Unable to sign in. Please try again.";
}
