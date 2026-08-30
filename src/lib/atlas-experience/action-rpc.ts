// ---------------------------------------------------------------------------
// Atlas Action RPC Layer
//
// Server-side functions that interact with the atlas_actions table through
// Supabase RPCs. Every lifecycle transition is validated server-side.
//
// The client calls these instead of directly modifying action state.
// The server enforces: authentication, RBAC, tenant isolation, transition
// validity, confirmation security, idempotency, and staleness detection.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import { rpcCall } from "@/lib/actions/rpc";
import type {
  AtlasExecutableAction,
  AtlasActionType,
  AtlasActionStatus,
  AtlasUserRole,
  ActionRisk,
  AtlasActionResult,
} from "./execution";
import type { AtlasEntityReference } from "./entity-reference";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw action record as returned from Supabase */
export interface ServerActionRecord {
  id: string;
  tenant_id: string;
  company_id: string | null;
  actor_id: string;
  action_type: string;
  entity_type: string;
  entity_id: string;
  parameters: Record<string, unknown>;
  risk: string;
  description: string;
  status: string;
  idempotency_key: string;
  confirmation_token: string | null;
  confirmation_expires_at: string | null;
  source_decision_id: string | null;
  source_signal_id: string | null;
  source_conversation_id: string | null;
  source_fingerprint: string | null;
  result: AtlasActionResult | null;
  error: { message: string; category: string } | null;
  created_at: string;
  updated_at: string;
  executed_at: string | null;
  verified_at: string | null;
  audit_trail: Array<{
    timestamp: string;
    from: string | undefined;
    to: string;
    actor: string;
    reason: string;
  }>;
}

export interface ActionCreateResult {
  id: string;
  status: string;
  idempotent: boolean;
  message: string;
}

export interface ActionTransitionResult {
  id: string;
  status: string;
  message: string;
}

// ---------------------------------------------------------------------------
// RPC Functions
// ---------------------------------------------------------------------------

/**
 * Create a new action on the server (idempotent via idempotency_key).
 */
export async function serverCreateAction(
  supabase: SupabaseClient,
  action: AtlasExecutableAction,
  context: {
    tenantId?: string;
    companyId?: string;
    conversationId?: string;
    signalId?: string;
  } = {},
): Promise<ActionCreateResult> {
  const result = (await rpcCall(supabase, "atlas_action_create", {
    actorId: action.createdBy,
    actionType: action.type,
    entityType: action.entity.type,
    entityId: action.entity.id,
    parameters: action.parameters,
    risk: action.risk,
    description: action.description,
    idempotencyKey: action.idempotencyKey,
    sourceDecisionId: action.decisionId ?? null,
    sourceSignalId: context.signalId ?? null,
    sourceConversationId: context.conversationId ?? null,
    sourceFingerprint: action.sourceFingerprint ?? null,
    companyId: context.companyId ?? null,
  })) as ActionCreateResult;

  return result;
}

/**
 * Transition an action's status on the server (validated lifecycle).
 */
export async function serverTransitionAction(
  supabase: SupabaseClient,
  actionId: string,
  newStatus: AtlasActionStatus,
  actorId: string,
  reason?: string,
): Promise<ActionTransitionResult> {
  const result = (await rpcCall(supabase, "atlas_action_transition", {
    actionId,
    newStatus,
    actorId,
    reason: reason ?? `Transitioned to ${newStatus}`,
  })) as ActionTransitionResult;

  return result;
}

/**
 * Confirm an action (validates token + expiry server-side).
 */
export async function serverConfirmAction(
  supabase: SupabaseClient,
  actionId: string,
  token: string,
  actorId: string,
): Promise<ActionTransitionResult> {
  const result = (await rpcCall(supabase, "atlas_action_confirm", {
    actionId,
    token,
    actorId,
  })) as ActionTransitionResult;

  return result;
}

/**
 * Get a single action by ID.
 */
export async function serverGetAction(
  supabase: SupabaseClient,
  actionId: string,
): Promise<ServerActionRecord> {
  const result = (await rpcCall(supabase, "atlas_action_get", {
    actionId,
  })) as ServerActionRecord;

  return result;
}

/**
 * List actions with optional filtering.
 */
export async function serverListActions(
  supabase: SupabaseClient,
  filters: {
    status?: AtlasActionStatus;
    entityType?: string;
    entityId?: string;
    actionType?: AtlasActionType;
    limit?: number;
    offset?: number;
  } = {},
): Promise<ServerActionRecord[]> {
  const result = (await rpcCall(supabase, "atlas_action_list", {
    status: filters.status ?? null,
    entityType: filters.entityType ?? null,
    entityId: filters.entityId ?? null,
    actionType: filters.actionType ?? null,
    limit: filters.limit ?? 50,
    offset: filters.offset ?? 0,
  })) as ServerActionRecord[];

  return Array.isArray(result) ? result : [];
}

/**
 * Store execution result on the server.
 */
export async function serverSetActionResult(
  supabase: SupabaseClient,
  actionId: string,
  result: AtlasActionResult,
  actorId: string,
): Promise<ActionTransitionResult> {
  const response = (await rpcCall(supabase, "atlas_action_set_result", {
    actionId,
    result: result.status === "executed"
      ? { status: "executed", message: result.message }
      : null,
    error: result.status === "failed" && result.error
      ? { message: result.error.message, code: result.error.code, retryable: result.error.retryable }
      : null,
    actorId,
  })) as ActionTransitionResult;

  return response;
}

// ---------------------------------------------------------------------------
// Server Action → AtlasExecutableAction conversion
// ---------------------------------------------------------------------------

/**
 * Convert a server action record back to the client-side AtlasExecutableAction.
 */
export function serverRecordToAction(record: ServerActionRecord): AtlasExecutableAction {
  return {
    id: record.id,
    type: record.action_type as AtlasActionType,
    label: record.description || record.action_type.replace(/_/g, " "),
    description: record.description,
    entity: {
      type: record.entity_type as AtlasEntityReference["type"],
      id: record.entity_id,
      label: `${record.entity_type} ${record.entity_id}`,
    },
    parameters: record.parameters ?? {},
    risk: record.risk as ActionRisk,
    requiresConfirmation: record.risk !== "low",
    requiresApproval: record.risk === "high",
    status: record.status as AtlasActionStatus,
    decisionId: record.source_decision_id ?? undefined,
    recommendationId: record.source_decision_id ?? undefined,
    createdAt: record.created_at,
    createdBy: record.actor_id,
    expiresAt: record.confirmation_expires_at ?? undefined,
    idempotencyKey: record.idempotency_key,
    sourceFingerprint: record.source_fingerprint ?? undefined,
    confirmationToken: record.confirmation_token ?? undefined,
    result: record.result ?? undefined,
    auditTrail: (record.audit_trail ?? []).map((entry) => ({
      timestamp: entry.timestamp,
      from: (entry.from ?? "") as AtlasActionStatus,
      to: entry.to as AtlasActionStatus,
      actor: entry.actor,
      reason: entry.reason,
    })),
  };
}
