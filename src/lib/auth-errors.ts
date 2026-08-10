// ---------------------------------------------------------------------------
// Auth error classification — pure, unit-tested mapping from raw auth errors
// to safe, actionable, user-facing messages.
//
// Safety: never include provider secrets, stack traces, tokens or headers in
// the surfaced messages. The backend already sanitizes relay errors (the OTP
// send path never serializes the axios request config); these classifiers only
// turn known error text into friendly guidance and keep everything else
// generic.
// ---------------------------------------------------------------------------

export type AuthSendErrorKind =
  | "not-configured" // relay rejects the request (missing/invalid VLY_EMAIL_API_KEY)
  | "service-unavailable" // relay/network unreachable or 5xx
  | "invalid-email" // relay rejected the address
  | "generic";

export interface ClassifiedAuthError {
  kind: AuthSendErrorKind;
  message: string;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error ?? "");
}

/**
 * Classify an error thrown while requesting the one-time code (step 1).
 * The backend surfaces "Failed to send verification email (status 401)" when
 * the relay rejects the x-api-key — the exact missing-configuration case that
 * blocks email login/signup until VLY_EMAIL_API_KEY is set in the Convex env.
 */
export function classifySendError(error: unknown): ClassifiedAuthError {
  const msg = messageOf(error);

  if (/status (401|403)/i.test(msg) || /unauthorized|forbidden/i.test(msg)) {
    return {
      kind: "not-configured",
      message:
        "Unable to send the verification code — email delivery isn't authorized for this deployment yet. " +
        "Ask the administrator to add the VLY_EMAIL_API_KEY project key, then try again. You can also continue as Guest.",
    };
  }
  if (/status 5\d\d/i.test(msg) || /network|unreachable|temporarily unavailable|timeout|ECONN/i.test(msg)) {
    return {
      kind: "service-unavailable",
      message:
        "The verification email service is temporarily unavailable. Please try again in a moment, or continue as Guest.",
    };
  }
  if (/invalid email|invalid address|rejected.*email|malformed/i.test(msg)) {
    return {
      kind: "invalid-email",
      message: "That email address looks invalid. Please check it and try again.",
    };
  }
  return {
    kind: "generic",
    message: "Unable to send the verification code. Please try again, or continue as Guest.",
  };
}

/**
 * Classify an error thrown while verifying the one-time code (step 2).
 * @convex-dev/auth throws a generic "Could not verify code" for both an
 * incorrect code and an expired code, so the message covers both honestly.
 */
export function classifyVerifyError(error: unknown): ClassifiedAuthError {
  const msg = messageOf(error);

  if (/expired/i.test(msg)) {
    return {
      kind: "generic",
      message: "Your verification code has expired. Request a new one and try again.",
    };
  }
  if (/could not verify|invalid|incorrect|wrong|does not match/i.test(msg)) {
    return {
      kind: "generic",
      message:
        "The verification code is incorrect or has expired. Check the code in your email and try again, or request a new one.",
    };
  }
  if (/network|unreachable|temporarily unavailable|timeout|ECONN/i.test(msg)) {
    return {
      kind: "generic",
      message: "Unable to verify right now — the authentication service is temporarily unavailable. Please try again.",
    };
  }
  return {
    kind: "generic",
    message: "Unable to sign in with that code. Please check the code and try again.",
  };
}
