// ---------------------------------------------------------------------------
// Recommendation decision contract — the single source of truth for the four
// UI actions (approve / reject / dismiss / mark executed) against the deployed
// recommendations_decide(p_recommendationid, p_status) RPC.
//
// Production defect this guards: the page used to call decide with ONLY
// { recommendationId }, but PostgREST resolves RPC arguments exactly against
// the folded schema cache and the deployed function requires BOTH arguments —
// the call failed with PGRST202 and every button surfaced "Action failed".
//
// The canonical state machine (PENDING → APPROVED/REJECTED, APPROVED →
// EXECUTED) is enforced here in the client AND in migration 0014 server-side,
// so the UI can never perform a transition the backend will reject.
// ---------------------------------------------------------------------------

export type RecommendationAction =
  | "approve"
  | "reject"
  | "dismiss"
  | "execute";

export type RecommendationStatus =
  | "open"
  | "approved"
  | "rejected"
  | "dismissed"
  | "executed";

/** The status value the deployed recommendations_decide expects per action. */
export function decisionStatusFor(action: RecommendationAction): RecommendationStatus {
  switch (action) {
    case "approve":
      return "approved";
    case "reject":
      return "rejected";
    case "dismiss":
      return "dismissed";
    case "execute":
      return "executed";
  }
}

/**
 * Validate a requested action against the recommendation's CURRENT status.
 * Returns a structured error message when the transition is not allowed, or
 * null when it is. Re-deciding the same status is idempotent (safe to retry).
 */
export function transitionError(
  action: RecommendationAction,
  currentStatus: RecommendationStatus,
): string | null {
  const target = decisionStatusFor(action);
  if (currentStatus === target) return null; // idempotent retry
  switch (action) {
    case "approve":
    case "reject":
    case "dismiss":
      // open → approved / rejected / dismissed. Anything already decided
      // cannot be re-decided (except an idempotent same-status retry above).
      return currentStatus === "open"
        ? null
        : `This recommendation is already ${currentStatus} — only open recommendations can be ${action}d.`;
    case "execute":
      // Only approved recommendations can be marked executed.
      return currentStatus === "approved"
        ? null
        : currentStatus === "open"
          ? "Execution failed: this recommendation must be approved before it can be marked executed."
          : `Execution failed: this recommendation is ${currentStatus}, not approved — it cannot be marked executed.`;
  }
}
