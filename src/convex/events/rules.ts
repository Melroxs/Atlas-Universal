// ---------------------------------------------------------------------------
// Event rules abstraction.
//
// The future workflow engine will run on rules; this phase only lays the
// typed foundation: a rule declares a trigger, conditions, evidence
// requirements, an action, a confirmation policy and a verification plan.
//
// PURE module.
// ---------------------------------------------------------------------------

export interface EventRule {
  id: string;
  /** When this rule is eligible: event types + optional condition map. */
  trigger: {
    eventTypes: string[];
    conditions?: Record<string, unknown>;
  };
  /** Evidence that must be resolvable before the rule fires. */
  evidenceRequirements?: string[];
  /** What the rule does when it fires. */
  action: {
    kind: "knowledge" | "tool" | "notify";
    toolId?: string;
    notifyTitle?: string;
  };
  confirmationPolicy: "auto_read" | "auto_low_write" | "confirm" | "block";
  verificationPlan?: string;
  enabled: boolean;
}

/** Return the enabled rules whose trigger matches the event type. */
export function matchEventRules(
  eventType: string,
  rules: EventRule[],
): EventRule[] {
  return rules.filter(
    (r) =>
      r.enabled &&
      r.trigger.eventTypes.includes(eventType) &&
      ruleConditionsMatch(r, eventType),
  );
}

function ruleConditionsMatch(
  rule: EventRule,
  eventType: string,
): boolean {
  if (!rule.trigger.conditions) return true;
  const conditions = rule.trigger.conditions;
  if (conditions.eventType && conditions.eventType !== eventType) return false;
  return true;
}

/**
 * The default rule set ships EMPTY and disabled. Atlas never fabricates
 * automatic behavior: rules are authored by tenants or industry packs.
 */
export const DEFAULT_RULES: EventRule[] = [];

/** Example of what a pack-authored rule looks like (generic, disabled). */
export const EXAMPLE_RULES: EventRule[] = [
  {
    id: "example.drive_updated_resync",
    trigger: { eventTypes: ["drive.file_updated"] },
    evidenceRequirements: ["source_document"],
    action: { kind: "knowledge", toolId: "drive.get_file_metadata" },
    confirmationPolicy: "auto_read",
    verificationPlan: "Confirm the document's chunks were regenerated after re-sync.",
    enabled: false,
  },
];
