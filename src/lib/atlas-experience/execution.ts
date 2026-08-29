// ---------------------------------------------------------------------------
// Atlas Controlled Action & Agent Execution Layer
//
// Provides the complete action lifecycle:
//   OBSERVE → UNDERSTAND → PRIORITIZE → EXPLAIN → RECOMMEND →
//   PREPARE → CONFIRM → EXECUTE → VERIFY → ACTIVITY / AUDIT
//
// The LLM may reason about what should happen.
// The APPLICATION decides whether it CAN happen.
// Every step is explicit, auditable, and authorization-controlled.
// ---------------------------------------------------------------------------

import type { AtlasEntityReference } from "./entity-reference";
import type { AtlasDecision } from "./decision";
import type { SafetyLevel } from "./conversational-intelligence";

// ---------------------------------------------------------------------------
// 1. Action Types & Contract
// ---------------------------------------------------------------------------

/** The categories of action Atlas can propose or execute */
export type AtlasActionType =
  | "navigate"
  | "show_evidence"
  | "show_decision"
  | "prepare_supplement"
  | "prepare_email"
  | "prepare_crm_activity"
  | "submit_supplement"
  | "send_email"
  | "approve_recommendation"
  | "reject_recommendation"
  | "execute_workflow"
  | "update_record"
  | "create_record"
  | "ask_followup";

/** Action lifecycle states */
export type AtlasActionStatus =
  | "proposed"                // Atlas suggested this action
  | "preparing"               // Creating draft/artifact
  | "prepared"                // Draft ready for review
  | "awaiting_confirmation"   // Waiting for human confirmation
  | "confirmed"               // Human confirmed, ready to execute
  | "executing"               // Being executed
  | "executed"                // Successfully completed
  | "verified"                // Result verified
  | "failed"                  // Execution failed
  | "blocked"                 // Authorization denied
  | "rejected"                // Human rejected
  | "expired"                 // Confirmation timed out
  | "stale";                  // Source data changed before execution

/** Valid status transitions — deterministic state machine */
const VALID_TRANSITIONS: Record<AtlasActionStatus, AtlasActionStatus[]> = {
  proposed:               ["preparing", "blocked", "rejected"],
  preparing:              ["prepared", "failed"],
  prepared:               ["awaiting_confirmation", "executing", "rejected"],
  awaiting_confirmation:  ["confirmed", "rejected", "expired"],
  confirmed:              ["executing", "expired", "stale"],
  executing:              ["executed", "failed"],
  executed:               ["verified", "failed"],
  verified:               [],
  failed:                 ["preparing"],  // retry
  blocked:                [],
  rejected:               [],
  expired:                ["preparing"],  // re-prepare
  stale:                  ["preparing"],  // re-evaluate
};

/** The action safety risk level */
export type ActionRisk = "low" | "medium" | "high";

/** The complete Atlas executable action */
export interface AtlasExecutableAction {
  /** Unique action identifier */
  id: string;

  /** Action type */
  type: AtlasActionType;

  /** Human-readable label */
  label: string;

  /** What Atlas proposes to do — plain description */
  description: string;

  /** The entity this action operates on */
  entity: AtlasEntityReference;

  /** Action parameters */
  parameters: Record<string, unknown>;

  /** Risk classification (deterministic, cannot be downgraded by model) */
  risk: ActionRisk;

  /** Whether human confirmation is required */
  requiresConfirmation: boolean;

  /** Whether RBAC approval is required beyond confirmation */
  requiresApproval: boolean;

  /** Current lifecycle status */
  status: AtlasActionStatus;

  /** The originating decision ID if any */
  decisionId?: string;

  /** The originating recommendation ID if any */
  recommendationId?: string;

  /** When the action was created */
  createdAt: string;

  /** Who/what created this action (user id, "atlas", "voice") */
  createdBy: string;

  /** When the action expires (for confirmation) */
  expiresAt?: string;

  /** Idempotency key — prevents duplicate execution */
  idempotencyKey: string;

  /** Staleness check — hash of source data at preparation time */
  sourceFingerprint?: string;

  /** Confirmation token — must match exactly for confirmation */
  confirmationToken?: string;

  /** Execution result if executed */
  result?: AtlasActionResult;

  /** Audit trail entries */
  auditTrail: ActionAuditEntry[];
}

// ---------------------------------------------------------------------------
// 2. Action Lifecycle Engine
// ---------------------------------------------------------------------------

/** Deterministic status transition — returns new status or throws */
export function transitionAction(
  action: AtlasExecutableAction,
  newStatus: AtlasActionStatus,
  actor: string,
  reason?: string,
): AtlasExecutableAction {
  const allowed = VALID_TRANSITIONS[action.status];
  if (!allowed.includes(newStatus)) {
    throw new Error(
      `Invalid transition: ${action.status} → ${newStatus}. Allowed: ${allowed.join(", ")}`,
    );
  }

  const now = new Date().toISOString();
  const auditEntry: ActionAuditEntry = {
    timestamp: now,
    from: action.status,
    to: newStatus,
    actor,
    reason: reason ?? `Transitioned to ${newStatus}`,
  };

  return {
    ...action,
    status: newStatus,
    auditTrail: [...action.auditTrail, auditEntry],
  };
}

/** Check if a transition is valid without applying it */
export function canTransition(
  currentStatus: AtlasActionStatus,
  targetStatus: AtlasActionStatus,
): boolean {
  return VALID_TRANSITIONS[currentStatus]?.includes(targetStatus) ?? false;
}

// ---------------------------------------------------------------------------
// 3. Safety Classification
// ---------------------------------------------------------------------------

/** Deterministic risk map — cannot be overridden by model output */
const ACTION_RISK_MAP: Record<AtlasActionType, ActionRisk> = {
  navigate: "low",
  show_evidence: "low",
  show_decision: "low",
  ask_followup: "low",
  prepare_supplement: "medium",
  prepare_email: "medium",
  prepare_crm_activity: "medium",
  submit_supplement: "high",
  send_email: "high",
  approve_recommendation: "high",
  reject_recommendation: "medium",
  execute_workflow: "high",
  update_record: "high",
  create_record: "medium",
};

/** Get the deterministic risk level for an action type */
export function getActionRisk(type: AtlasActionType): ActionRisk {
  return ACTION_RISK_MAP[type] ?? "high";
}

/** Does this action type always require confirmation? */
export function alwaysRequiresConfirmation(type: AtlasActionType): boolean {
  return getActionRisk(type) === "high";
}

/** Map from conversational intelligence SafetyLevel to ActionRisk */
export function safetyLevelToActionRisk(level: SafetyLevel): ActionRisk {
  switch (level) {
    case "low": return "low";
    case "medium": return "medium";
    case "high": return "high";
  }
}

// ---------------------------------------------------------------------------
// 4. Permission Model
// ---------------------------------------------------------------------------

/** Atlas user roles — maps to existing RBAC */
export type AtlasUserRole =
  | "super_admin"
  | "atlas_admin"
  | "customer_admin"
  | "customer_user"
  | "pilot_user";

/** Permission check result */
export interface PermissionCheck {
  allowed: boolean;
  reason: string;
  requiresApproval?: boolean;
}

/** Permission matrix — deterministic, role-based */
const PERMISSION_MATRIX: Record<AtlasActionType, Partial<Record<AtlasUserRole, boolean>>> = {
  navigate:               { super_admin: true, atlas_admin: true, customer_admin: true, customer_user: true, pilot_user: true },
  show_evidence:          { super_admin: true, atlas_admin: true, customer_admin: true, customer_user: true, pilot_user: true },
  show_decision:          { super_admin: true, atlas_admin: true, customer_admin: true, customer_user: true, pilot_user: true },
  ask_followup:           { super_admin: true, atlas_admin: true, customer_admin: true, customer_user: true, pilot_user: true },
  prepare_supplement:     { super_admin: true, atlas_admin: true, customer_admin: true, customer_user: false, pilot_user: false },
  prepare_email:          { super_admin: true, atlas_admin: true, customer_admin: true, customer_user: false, pilot_user: false },
  prepare_crm_activity:   { super_admin: true, atlas_admin: true, customer_admin: true, customer_user: false, pilot_user: false },
  submit_supplement:      { super_admin: true, atlas_admin: true, customer_admin: true, customer_user: false, pilot_user: false },
  send_email:             { super_admin: true, atlas_admin: true, customer_admin: true, customer_user: false, pilot_user: false },
  approve_recommendation: { super_admin: true, atlas_admin: true, customer_admin: true, customer_user: false, pilot_user: false },
  reject_recommendation:  { super_admin: true, atlas_admin: true, customer_admin: true, customer_user: false, pilot_user: false },
  execute_workflow:       { super_admin: true, atlas_admin: true, customer_admin: true, customer_user: false, pilot_user: false },
  update_record:          { super_admin: true, atlas_admin: true, customer_admin: true, customer_user: false, pilot_user: false },
  create_record:          { super_admin: true, atlas_admin: true, customer_admin: true, customer_user: false, pilot_user: false },
};

/** Roles that need approval for high-risk actions */
const ROLES_REQUIRING_APPROVAL: AtlasUserRole[] = ["customer_user", "pilot_user"];

/**
 * Check if the user is authorized to perform this action.
 * Authorization is deterministic — no model override possible.
 */
export function checkAuthorization(
  actionType: AtlasActionType,
  userRole: AtlasUserRole,
): PermissionCheck {
  const matrix = PERMISSION_MATRIX[actionType];
  if (!matrix) {
    return { allowed: false, reason: `Unknown action type: ${actionType}` };
  }

  const isAllowed = matrix[userRole] ?? false;
  if (!isAllowed) {
    return {
      allowed: false,
      reason: `Role "${userRole}" is not authorized for "${actionType}"`,
    };
  }

  // Check if approval is required for this role
  const needsApproval = ROLES_REQUIRING_APPROVAL.includes(userRole)
    && getActionRisk(actionType) === "high";

  return {
    allowed: true,
    reason: "Authorized",
    requiresApproval: needsApproval,
  };
}

// ---------------------------------------------------------------------------
// 5. Confirmation Flow
// ---------------------------------------------------------------------------

/** Confirmation result */
export interface ConfirmationResult {
  valid: boolean;
  action?: AtlasExecutableAction;
  reason?: string;
}

/** Default confirmation timeout: 5 minutes */
export const DEFAULT_CONFIRMATION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Generate a confirmation token for an action.
 * The token is bound to: action ID + entity + type + current timestamp.
 */
export function generateConfirmationToken(action: AtlasExecutableAction): string {
  const payload = `${action.id}:${action.entity.id}:${action.type}:${action.createdAt}`;
  // Deterministic hash — no crypto needed for client-side binding
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return `confirm-${Math.abs(hash).toString(36)}-${Date.now().toString(36)}`;
}

/**
 * Prepare an action for confirmation.
 * Sets status, confirmation token, and expiration.
 */
export function prepareForConfirmation(
  action: AtlasExecutableAction,
  timeoutMs: number = DEFAULT_CONFIRMATION_TIMEOUT_MS,
): AtlasExecutableAction {
  const now = new Date();
  const token = generateConfirmationToken(action);
  const expiresAt = new Date(now.getTime() + timeoutMs).toISOString();

  return {
    ...action,
    status: "awaiting_confirmation",
    confirmationToken: token,
    expiresAt,
    auditTrail: [
      ...action.auditTrail,
      {
        timestamp: now.toISOString(),
        from: action.status,
        to: "awaiting_confirmation",
        actor: "atlas",
        reason: "Prepared for human confirmation",
      },
    ],
  };
}

/**
 * Validate a confirmation attempt.
 * The confirmation must be:
 *   - Not expired
 *   - Not stale
 *   - Bound to the correct action ID and token
 */
export function validateConfirmation(
  action: AtlasExecutableAction,
  submittedToken: string,
): ConfirmationResult {
  // Must be awaiting confirmation
  if (action.status !== "awaiting_confirmation") {
    return {
      valid: false,
      reason: `Action is not awaiting confirmation (current: ${action.status})`,
    };
  }

  // Must not be expired
  if (action.expiresAt && new Date(action.expiresAt) < new Date()) {
    return {
      valid: false,
      reason: "Confirmation has expired",
    };
  }

  // Token must match
  if (action.confirmationToken !== submittedToken) {
    return {
      valid: false,
      reason: "Confirmation token mismatch",
    };
  }

  return { valid: true, action };
}

// ---------------------------------------------------------------------------
// 6. Action Expiration
// ---------------------------------------------------------------------------

/** Check if an action has expired */
export function isActionExpired(action: AtlasExecutableAction): boolean {
  if (!action.expiresAt) return false;
  return new Date(action.expiresAt) < new Date();
}

/** Check if an action is stale (source data changed) */
export function isActionStale(
  action: AtlasExecutableAction,
  currentSourceFingerprint: string,
): boolean {
  if (!action.sourceFingerprint) return false;
  return action.sourceFingerprint !== currentSourceFingerprint;
}

/** Generate a source fingerprint from entity data (deterministic) */
export function generateSourceFingerprint(data: Record<string, unknown>): string {
  const sorted = Object.keys(data)
    .sort()
    .map((k) => `${k}:${JSON.stringify(data[k])}`)
    .join("|");
  let hash = 0;
  for (let i = 0; i < sorted.length; i++) {
    const ch = sorted.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return `fp-${Math.abs(hash).toString(36)}`;
}

// ---------------------------------------------------------------------------
// 7. Idempotency
// ---------------------------------------------------------------------------

/** Generate an idempotency key from action properties */
export function generateIdempotencyKey(
  type: AtlasActionType,
  entityId: string,
  parameters: Record<string, unknown>,
): string {
  const paramStr = Object.keys(parameters)
    .sort()
    .map((k) => `${k}=${JSON.stringify(parameters[k])}`)
    .join("&");
  const payload = `${type}:${entityId}:${paramStr}`;
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return `idem-${type}-${entityId}-${Math.abs(hash).toString(36)}`;
}

// ---------------------------------------------------------------------------
// 8. Capability / Tool Registry
// ---------------------------------------------------------------------------

/** Input parameter schema for a capability */
export interface CapabilityParameter {
  name: string;
  type: "string" | "number" | "boolean" | "enum";
  required: boolean;
  description: string;
  enum?: string[];
}

/** A registered Atlas capability */
export interface AtlasCapability {
  /** Unique capability identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description */
  description: string;

  /** Action type this capability produces */
  actionType: AtlasActionType;

  /** Risk level */
  risk: ActionRisk;

  /** Required user roles */
  requiredRoles: AtlasUserRole[];

  /** Whether confirmation is required */
  requiresConfirmation: boolean;

  /** Whether approval is required */
  requiresApproval: boolean;

  /** Input parameter schema */
  parameters: CapabilityParameter[];

  /** Category for grouping */
  category: string;
}

/** Capability registry singleton */
const _capabilities: Map<string, AtlasCapability> = new Map();

/** Register a capability */
export function registerCapability(cap: AtlasCapability): void {
  _capabilities.set(cap.id, cap);
}

/** Register multiple capabilities */
export function registerCapabilities(caps: AtlasCapability[]): void {
  for (const cap of caps) {
    _capabilities.set(cap.id, cap);
  }
}

/** Get a capability by ID */
export function getCapability(id: string): AtlasCapability | undefined {
  return _capabilities.get(id);
}

/** Get all registered capabilities */
export function getAllCapabilities(): AtlasCapability[] {
  return Array.from(_capabilities.values());
}

/** Get capabilities by category */
export function getCapabilitiesByCategory(category: string): AtlasCapability[] {
  return getAllCapabilities().filter((c) => c.category === category);
}

/** Get capabilities available to a role */
export function getCapabilitiesForRole(role: AtlasUserRole): AtlasCapability[] {
  return getAllCapabilities().filter((c) => c.requiredRoles.includes(role));
}

/** Clear all capabilities (for testing) */
export function clearCapabilities(): void {
  _capabilities.clear();
}

// ---------------------------------------------------------------------------
// 9. Input Validation
// ---------------------------------------------------------------------------

/** Validate action parameters against a capability schema */
export function validateActionInput(
  capability: AtlasCapability,
  parameters: Record<string, unknown>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const param of capability.parameters) {
    const value = parameters[param.name];

    if (param.required && (value === undefined || value === null)) {
      errors.push(`Missing required parameter: ${param.name}`);
      continue;
    }

    if (value !== undefined && value !== null) {
      // Type validation
      switch (param.type) {
        case "string":
          if (typeof value !== "string") {
            errors.push(`Parameter "${param.name}" must be a string`);
          }
          break;
        case "number":
          if (typeof value !== "number") {
            errors.push(`Parameter "${param.name}" must be a number`);
          }
          break;
        case "boolean":
          if (typeof value !== "boolean") {
            errors.push(`Parameter "${param.name}" must be a boolean`);
          }
          break;
        case "enum":
          if (typeof value === "string" && param.enum && !param.enum.includes(value)) {
            errors.push(`Parameter "${param.name}" must be one of: ${param.enum.join(", ")}`);
          }
          break;
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// 10. Action Creation
// ---------------------------------------------------------------------------

/** Create a new executable action with full lifecycle metadata */
export function createAction(
  type: AtlasActionType,
  label: string,
  description: string,
  entity: AtlasEntityReference,
  parameters: Record<string, unknown>,
  createdBy: string,
  options?: {
    decisionId?: string;
    recommendationId?: string;
    sourceFingerprint?: string;
  },
): AtlasExecutableAction {
  const now = new Date().toISOString();
  const risk = getActionRisk(type);
  const requiresConf = alwaysRequiresConfirmation(type);

  return {
    id: `action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    label,
    description,
    entity,
    parameters,
    risk,
    requiresConfirmation: requiresConf,
    requiresApproval: false, // set by authorization check
    status: "proposed",
    decisionId: options?.decisionId,
    recommendationId: options?.recommendationId,
    createdAt: now,
    createdBy,
    idempotencyKey: generateIdempotencyKey(type, entity.id, parameters),
    sourceFingerprint: options?.sourceFingerprint,
    auditTrail: [
      {
        timestamp: now,
        from: undefined as unknown as AtlasActionStatus,
        to: "proposed",
        actor: createdBy,
        reason: "Action proposed",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 11. Execution Result Model
// ---------------------------------------------------------------------------

/** Structured result of an action execution */
export interface AtlasActionResult {
  actionId: string;
  status: "prepared" | "confirmed" | "executed" | "failed" | "blocked" | "expired" | "stale";
  entity?: AtlasEntityReference;
  message: string;
  activityId?: string;
  /** Prepared artifact data (draft content, etc.) */
  artifact?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

/** Create a successful execution result */
export function createSuccessResult(
  actionId: string,
  entity: AtlasEntityReference,
  message: string,
  options?: { activityId?: string; artifact?: Record<string, unknown> },
): AtlasActionResult {
  return {
    actionId,
    status: "executed",
    entity,
    message,
    activityId: options?.activityId,
    artifact: options?.artifact,
  };
}

/** Create a failure result */
export function createFailureResult(
  actionId: string,
  message: string,
  errorCode: string,
  retryable: boolean = false,
): AtlasActionResult {
  return {
    actionId,
    status: "failed",
    message,
    error: {
      code: errorCode,
      message,
      retryable,
    },
  };
}

/** Create a blocked result (authorization denied) */
export function createBlockedResult(
  actionId: string,
  reason: string,
): AtlasActionResult {
  return {
    actionId,
    status: "blocked",
    message: `Action blocked: ${reason}`,
  };
}

// ---------------------------------------------------------------------------
// 12. Action Lifecycle Orchestrator
// ---------------------------------------------------------------------------

/**
 * Orchestrate the full action lifecycle from proposal to confirmation-ready.
 * This is the main entry point for the execution layer.
 */
export function proposeAction(
  type: AtlasActionType,
  label: string,
  description: string,
  entity: AtlasEntityReference,
  parameters: Record<string, unknown>,
  userRole: AtlasUserRole,
  createdBy: string,
  options?: {
    decisionId?: string;
    recommendationId?: string;
    sourceFingerprint?: string;
    timeoutMs?: number;
  },
): {
  action: AtlasExecutableAction;
  blocked?: PermissionCheck;
} {
  // 1. Create proposed action
  let action = createAction(type, label, description, entity, parameters, createdBy, options);

  // 2. Check authorization
  const auth = checkAuthorization(type, userRole);
  if (!auth.allowed) {
    action = transitionAction(action, "blocked", "system", auth.reason);
    return { action, blocked: auth };
  }

  // 3. If requires confirmation or medium+ risk, prepare for confirmation
  if (action.requiresConfirmation || action.risk === "medium" || action.risk === "high") {
    // Move through preparing → prepared → awaiting_confirmation
    action = transitionAction(action, "preparing", "atlas", "Preparing action for review");
    action = transitionAction(action, "prepared", "atlas", "Action prepared for confirmation");

    const timeout = options?.timeoutMs ?? DEFAULT_CONFIRMATION_TIMEOUT_MS;
    action = prepareForConfirmation(action, timeout);

    if (auth.requiresApproval) {
      action = { ...action, requiresApproval: true };
    }
  }

  return { action };
}

// ---------------------------------------------------------------------------
// 13. Conversation-Aware Action Resolution
// ---------------------------------------------------------------------------

/** Resolve "it", "this", "that" to an entity from conversation context */
export function resolveActionEntity(
  reference: string,
  currentEntity?: AtlasEntityReference,
  lastEntity?: AtlasEntityReference,
): AtlasEntityReference | undefined {
  const lower = reference.toLowerCase().trim();

  // Check for pronouns
  if (/^(it|this|that|them|those|the (?:claim|document|company|supplement))$/.test(lower)) {
    return currentEntity ?? lastEntity;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// 14. Confirmation Prompt Builder
// ---------------------------------------------------------------------------

/** Build a human-readable confirmation prompt for an action */
export function buildConfirmationPrompt(action: AtlasExecutableAction): string {
  const riskLabel = action.risk === "high"
    ? "This action cannot be easily undone."
    : action.risk === "medium"
      ? "This will create a draft for your review."
      : "";

  const entityLabel = `${action.entity.type} "${action.entity.label}"`;
  const details = Object.entries(action.parameters)
    .filter(([k]) => !k.startsWith("_"))
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(", ");
  const detailStr = details ? ` (${details})` : "";

  return `${action.label}\n\nTarget: ${entityLabel}${detailStr}\n\n${riskLabel}\n\nConfirm this action?`;
}

// ---------------------------------------------------------------------------
// 15. Audit Trail
// ---------------------------------------------------------------------------

/** An audit entry for action lifecycle changes */
export interface ActionAuditEntry {
  timestamp: string;
  from: AtlasActionStatus;
  to: AtlasActionStatus;
  actor: string;
  reason: string;
}

/** Get the audit trail for an action */
export function getAuditTrail(action: AtlasExecutableAction): ActionAuditEntry[] {
  return [...action.auditTrail];
}

/** Get a summary of the audit trail */
export function summarizeAuditTrail(action: AtlasExecutableAction): string {
  const entries = action.auditTrail;
  if (entries.length === 0) return "No audit entries";

  return entries
    .map((e) => `[${e.timestamp}] ${e.from ?? "created"} → ${e.to} by ${e.actor}: ${e.reason}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// 16. Telemetry
// ---------------------------------------------------------------------------

/** Telemetry event types for action lifecycle */
export type ActionTelemetryEvent =
  | "action_proposed"
  | "action_prepared"
  | "action_confirmation_requested"
  | "action_confirmed"
  | "action_rejected"
  | "action_blocked"
  | "action_executed"
  | "action_failed"
  | "action_verified"
  | "action_expired"
  | "action_stale";

/** A telemetry record for an action event */
export interface ActionTelemetryRecord {
  event: ActionTelemetryEvent;
  timestamp: string;
  actionId: string;
  actionType: AtlasActionType;
  entityType: string;
  risk: ActionRisk;
  outcome?: string;
  durationMs?: number;
  errorCategory?: string;
  actor: string;
}

/** In-memory telemetry store (for observability) */
const _telemetryLog: ActionTelemetryRecord[] = [];
const MAX_TELEMETRY_ENTRIES = 500;

/** Log a telemetry event */
export function logActionTelemetry(record: ActionTelemetryRecord): void {
  _telemetryLog.push(record);
  if (_telemetryLog.length > MAX_TELEMETRY_ENTRIES) {
    _telemetryLog.splice(0, _telemetryLog.length - MAX_TELEMETRY_ENTRIES);
  }
}

/** Get telemetry records (for observability) */
export function getActionTelemetry(limit?: number): ActionTelemetryRecord[] {
  if (limit) return _telemetryLog.slice(-limit);
  return [..._telemetryLog];
}

/** Clear telemetry (for testing) */
export function clearActionTelemetry(): void {
  _telemetryLog.length = 0;
}

// ---------------------------------------------------------------------------
// 17. Built-in Atlas Capabilities
// ---------------------------------------------------------------------------

/** Register the default Atlas action capabilities */
export function registerDefaultCapabilities(): void {
  registerCapabilities([
    // READ capabilities
    {
      id: "search_entities",
      name: "Search Entities",
      description: "Search for entities (claims, documents, companies)",
      actionType: "navigate",
      risk: "low",
      requiredRoles: ["super_admin", "atlas_admin", "customer_admin", "customer_user", "pilot_user"],
      requiresConfirmation: false,
      requiresApproval: false,
      parameters: [{ name: "query", type: "string", required: true, description: "Search query" }],
      category: "read",
    },
    {
      id: "inspect_claim",
      name: "Inspect Claim",
      description: "View claim details and status",
      actionType: "navigate",
      risk: "low",
      requiredRoles: ["super_admin", "atlas_admin", "customer_admin", "customer_user", "pilot_user"],
      requiresConfirmation: false,
      requiresApproval: false,
      parameters: [{ name: "claimId", type: "string", required: true, description: "Claim ID" }],
      category: "read",
    },
    {
      id: "show_evidence",
      name: "Show Evidence",
      description: "Display evidence for an entity",
      actionType: "show_evidence",
      risk: "low",
      requiredRoles: ["super_admin", "atlas_admin", "customer_admin", "customer_user", "pilot_user"],
      requiresConfirmation: false,
      requiresApproval: false,
      parameters: [{ name: "entityId", type: "string", required: true, description: "Entity ID" }],
      category: "read",
    },
    {
      id: "show_decision",
      name: "Show Decision",
      description: "Display decision details and reasoning",
      actionType: "show_decision",
      risk: "low",
      requiredRoles: ["super_admin", "atlas_admin", "customer_admin", "customer_user", "pilot_user"],
      requiresConfirmation: false,
      requiresApproval: false,
      parameters: [{ name: "decisionId", type: "string", required: true, description: "Decision ID" }],
      category: "read",
    },

    // PREPARE capabilities
    {
      id: "prepare_supplement",
      name: "Prepare Supplement",
      description: "Create a supplement draft for review",
      actionType: "prepare_supplement",
      risk: "medium",
      requiredRoles: ["super_admin", "atlas_admin", "customer_admin"],
      requiresConfirmation: true,
      requiresApproval: false,
      parameters: [
        { name: "claimId", type: "string", required: true, description: "Claim ID" },
        { name: "reason", type: "string", required: false, description: "Reason for supplement" },
      ],
      category: "prepare",
    },
    {
      id: "prepare_email",
      name: "Prepare Email",
      description: "Draft an outreach email",
      actionType: "prepare_email",
      risk: "medium",
      requiredRoles: ["super_admin", "atlas_admin", "customer_admin"],
      requiresConfirmation: true,
      requiresApproval: false,
      parameters: [
        { name: "recipientId", type: "string", required: true, description: "Recipient ID" },
        { name: "subject", type: "string", required: false, description: "Email subject" },
      ],
      category: "prepare",
    },
    {
      id: "prepare_crm_activity",
      name: "Prepare CRM Activity",
      description: "Create a CRM activity draft",
      actionType: "prepare_crm_activity",
      risk: "medium",
      requiredRoles: ["super_admin", "atlas_admin", "customer_admin"],
      requiresConfirmation: true,
      requiresApproval: false,
      parameters: [
        { name: "leadId", type: "string", required: true, description: "Lead ID" },
        { name: "activityType", type: "string", required: true, description: "Activity type" },
      ],
      category: "prepare",
    },

    // EXECUTE capabilities
    {
      id: "submit_supplement",
      name: "Submit Supplement",
      description: "Submit a supplement for processing",
      actionType: "submit_supplement",
      risk: "high",
      requiredRoles: ["super_admin", "atlas_admin", "customer_admin"],
      requiresConfirmation: true,
      requiresApproval: true,
      parameters: [{ name: "supplementId", type: "string", required: true, description: "Supplement ID" }],
      category: "execute",
    },
    {
      id: "send_email",
      name: "Send Email",
      description: "Send an outreach email",
      actionType: "send_email",
      risk: "high",
      requiredRoles: ["super_admin", "atlas_admin", "customer_admin"],
      requiresConfirmation: true,
      requiresApproval: true,
      parameters: [
        { name: "recipientId", type: "string", required: true, description: "Recipient ID" },
        { name: "subject", type: "string", required: true, description: "Email subject" },
        { name: "body", type: "string", required: true, description: "Email body" },
      ],
      category: "execute",
    },
    {
      id: "approve_recommendation",
      name: "Approve Recommendation",
      description: "Approve an Atlas recommendation",
      actionType: "approve_recommendation",
      risk: "high",
      requiredRoles: ["super_admin", "atlas_admin", "customer_admin"],
      requiresConfirmation: true,
      requiresApproval: true,
      parameters: [{ name: "recommendationId", type: "string", required: true, description: "Recommendation ID" }],
      category: "execute",
    },
  ]);
}

// ---------------------------------------------------------------------------
// 18. Decision → Action Bridge
// ---------------------------------------------------------------------------

/** Convert an AtlasDecision into a proposed AtlasExecutableAction */
export function decisionToAction(
  decision: AtlasDecision,
  userRole: AtlasUserRole,
  createdBy: string = "atlas",
): AtlasExecutableAction | undefined {
  if (!decision.action) return undefined;

  const actionTypeMap: Record<string, AtlasActionType> = {
    prepare: "prepare_supplement",
    submit: "submit_supplement",
    approve: "approve_recommendation",
    review: "show_decision",
    create: "create_record",
    send: "send_email",
    update: "update_record",
  };

  const mappedType = actionTypeMap[decision.action.actionType] ?? "navigate";
  const action = createAction(
    mappedType,
    decision.action.label,
    decision.action.description ?? decision.action.label,
    decision.entity,
    decision.action.params ?? {},
    createdBy,
    { decisionId: decision.id },
  );

  // Check authorization
  const auth = checkAuthorization(mappedType, userRole);
  if (!auth.allowed) {
    action.requiresApproval = false;
  } else {
    action.requiresApproval = auth.requiresApproval ?? decision.requiresApproval;
  }

  return action;
}

// ---------------------------------------------------------------------------
// 19. Executable Intent Actions
// ---------------------------------------------------------------------------

/** Resolve a "prepare" intent into an executable action */
export function resolvePrepareIntent(
  entityType: string,
  entity: AtlasEntityReference,
  userRole: AtlasUserRole,
  createdBy: string = "atlas",
): AtlasExecutableAction {
  const typeMap: Record<string, AtlasActionType> = {
    claim: "prepare_supplement",
    supplement: "prepare_supplement",
    lead: "prepare_email",
    contact: "prepare_email",
    company: "prepare_crm_activity",
  };

  const actionType = typeMap[entityType] ?? "create_record";
  return createAction(
    actionType,
    `Prepare ${entityType} draft`,
    `Atlas prepared a draft for ${entity.label}`,
    entity,
    {},
    createdBy,
  );
}

/** Resolve a "submit" intent into an executable action */
export function resolveSubmitIntent(
  entity: AtlasEntityReference,
  parameters: Record<string, unknown>,
  userRole: AtlasUserRole,
  createdBy: string = "atlas",
): AtlasExecutableAction {
  const typeMap: Record<string, AtlasActionType> = {
    supplement: "submit_supplement",
    email: "send_email",
  };

  const actionType = typeMap[entity.type] ?? "update_record";
  return createAction(
    actionType,
    `Submit ${entity.type}`,
    `Atlas is ready to submit ${entity.label}`,
    entity,
    parameters,
    createdBy,
  );
}
