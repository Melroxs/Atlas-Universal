// ---------------------------------------------------------------------------
// Event → Action policy.
//
// Event-triggered actions are STRICTER than user-requested actions:
//
//   READ            may execute automatically
//   LOW_RISK_WRITE  automatic ONLY when the tenant explicitly opts in
//   HIGH_WRITE      always requires human approval
//   IRREVERSIBLE    always requires human approval
//
// No event may bypass confirmation because it originated from a trusted
// connector. The policy surface is the per-tenant eventPolicies table;
// defaults and industry recommendations live here.
//
// PURE module.
// ---------------------------------------------------------------------------

import type { RiskLevel } from "../tools/registry";

export interface TenantEventPolicy {
  tenantId: string;
  eventType: string;
  enabled: boolean;
  autoLowRiskWrite: boolean;
  allowedTools?: string[];
  blockedTools?: string[];
  riskOverrides?: Record<string, unknown> | null;
  confirmationOverride?: string;
}

export type EventActionMode = "auto" | "confirm" | "blocked";

export interface ActionDecision {
  mode: EventActionMode;
  reason: string;
  /** True when the decision came from an explicit tenant policy override. */
  fromPolicy?: boolean;
}

/**
 * The autonomous-action safety ladder. Risk always wins over intent: a
 * high-risk tool is confirmed even if the tenant toggled auto-writes on.
 */
export function resolveEventActionPolicy(opts: {
  riskLevel: RiskLevel;
  toolId: string;
  policy?: TenantEventPolicy | null;
}): ActionDecision {
  const { riskLevel, toolId, policy } = opts;

  if (policy && !policy.enabled) {
    return {
      mode: "blocked",
      reason: `Automation is disabled for this event type in the workspace policy.`,
      fromPolicy: true,
    };
  }
  if (policy?.blockedTools?.includes(toolId)) {
    return {
      mode: "blocked",
      reason: `Tool "${toolId}" is blocked by the workspace event policy.`,
      fromPolicy: true,
    };
  }
  if (policy?.allowedTools && policy.allowedTools.length > 0) {
    if (!policy.allowedTools.includes(toolId)) {
      return {
        mode: "blocked",
        reason: `Tool "${toolId}" is not in the workspace's allowed tools for this event.`,
        fromPolicy: true,
      };
    }
  }

  if (riskLevel === "READ") {
    return { mode: "auto", reason: "Read-only verification — safe to run automatically." };
  }
  if (riskLevel === "LOW_WRITE") {
    if (policy?.autoLowRiskWrite) {
      return {
        mode: "auto",
        reason: "Low-risk write permitted by the workspace event policy.",
        fromPolicy: true,
      };
    }
    return {
      mode: "confirm",
      reason: "Low-risk write — requires approval unless the workspace enables automatic low-risk writes.",
    };
  }
  // HIGH_WRITE and IRREVERSIBLE always require a human.
  return {
    mode: "confirm",
    reason: "High-impact change — human approval is always required, even for event-triggered actions.",
  };
}

/** Default stance when no tenant policy row exists. */
export const DEFAULT_EVENT_POLICY = {
  enabled: true,
  autoLowRiskWrite: false,
} as const;

/**
 * Recommended event policies contributed by industry/company packs. Generic
 * by design — the core never hardcodes a vertical's behavior; packs provide
 * the recommendations, tenants provide the overrides.
 */
export const INDUSTRY_POLICY_RECOMMENDATIONS: Array<{
  eventType: string;
  title: string;
  recommendation: string;
}> = [
  {
    eventType: "drive.file_created",
    title: "New document arrives",
    recommendation:
      "Ingest the document into the knowledge base and record a verification read of its current state.",
  },
  {
    eventType: "drive.file_updated",
    title: "Document changed",
    recommendation:
      "Re-sync the changed content, regenerate chunks and embeddings, and preserve prior provenance.",
  },
  {
    eventType: "drive.file_deleted",
    title: "Document removed",
    recommendation:
      "Keep the existing knowledge (provenance preserved) and flag the source record as deleted — never hard-delete knowledge on an external removal.",
  },
];
