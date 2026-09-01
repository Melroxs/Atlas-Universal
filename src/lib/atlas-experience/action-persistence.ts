// ---------------------------------------------------------------------------
// Atlas Action Persistence
//
// Server-authoritative action persistence with localStorage cache.
//
// Architecture:
//   Supabase (authoritative)
//       ↓
//   action-persistence.ts (sync layer)
//       ↓
//   localStorage (offline cache)
//       ↓
//   React hooks (UI state)
//
// When authenticated and connected: Supabase is authoritative.
// When temporarily offline: localStorage provides UI continuity but never
// falsely reports execution success.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type AtlasExecutableAction,
  type AtlasActionStatus,
  type AtlasActionType,
  type ActionRisk,
  isActionExpired,
  canTransition,
  transitionAction,
} from "./execution";
import type { AtlasEntityReference } from "./entity-reference";
import {
  serverCreateAction,
  serverTransitionAction,
  serverConfirmAction,
  serverGetAction,
  serverListActions,
  serverSetActionResult,
  serverRecordToAction,
  type ServerActionRecord,
  type ActionCreateResult,
} from "./action-rpc";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PersistedAction {
  action: AtlasExecutableAction;
  persistedAt: string;
  source: "server" | "local";  // Where this record came from
  tenantId?: string;
  companyId?: string;
  conversationId?: string;
  signalId?: string;
}

export interface ActionStoreSummary {
  total: number;
  pending: number;
  preparing: number;
  executing: number;
  completed: number;
  failed: number;
  expired: number;
}

export interface RecoveryResult {
  restored: PersistedAction[];
  expired: PersistedAction[];
  stale: PersistedAction[];
  failed: PersistedAction[];
  awaitingConfirmation: PersistedAction[];
  summary: ActionStoreSummary;
}

// ---------------------------------------------------------------------------
// localStorage cache (offline fallback)
// ---------------------------------------------------------------------------

const STORAGE_KEY = "atlas_actions";
const MAX_CACHED_ACTIONS = 100;

function getStorageKey(tenantId?: string): string {
  return tenantId ? `${STORAGE_KEY}:${tenantId}` : STORAGE_KEY;
}

export function loadCachedActions(tenantId?: string): PersistedAction[] {
  try {
    const raw = localStorage.getItem(getStorageKey(tenantId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedAction[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function cacheAction(record: PersistedAction, tenantId?: string): void {
  const actions = loadCachedActions(tenantId);
  const idx = actions.findIndex((a) => a.action.id === record.action.id);

  if (idx >= 0) {
    actions[idx] = record;
  } else {
    actions.push(record);
  }

  // Enforce max size
  if (actions.length > MAX_CACHED_ACTIONS) {
    const terminal = ["executed", "verified", "failed", "blocked", "rejected", "expired", "stale"];
    const nonTerminal = actions.filter((a) => !terminal.includes(a.action.status));
    const terminalActions = actions
      .filter((a) => terminal.includes(a.action.status))
      .sort((a, b) => new Date(b.persistedAt).getTime() - new Date(a.persistedAt).getTime())
      .slice(0, MAX_CACHED_ACTIONS - nonTerminal.length);
    actions.splice(0, actions.length, ...nonTerminal, ...terminalActions);
  }

  try {
    localStorage.setItem(getStorageKey(tenantId), JSON.stringify(actions));
  } catch {
    // localStorage full — drop oldest terminal
  }
}

export function removeCachedAction(actionId: string, tenantId?: string): void {
  const actions = loadCachedActions(tenantId);
  const filtered = actions.filter((a) => a.action.id !== actionId);
  try {
    localStorage.setItem(getStorageKey(tenantId), JSON.stringify(filtered));
  } catch { /* ignore */ }
}

export function clearCachedActions(tenantId?: string): void {
  try {
    localStorage.removeItem(getStorageKey(tenantId));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Server-backed operations
// ---------------------------------------------------------------------------

/**
 * Create an action on the server. Falls back to local cache if offline.
 */
export async function createAction(
  supabase: SupabaseClient | null,
  action: AtlasExecutableAction,
  context: {
    tenantId?: string;
    companyId?: string;
    conversationId?: string;
    signalId?: string;
  } = {},
): Promise<PersistedAction> {
  const record: PersistedAction = {
    action,
    persistedAt: new Date().toISOString(),
    source: "local",
    tenantId: context.tenantId,
    companyId: context.companyId,
    conversationId: context.conversationId,
    signalId: context.signalId,
  };

  if (supabase) {
    try {
      const result = await serverCreateAction(supabase, action, context);
      record.source = "server";
      // Update action ID if server assigned a new one
      if (result.id && result.id !== action.id) {
        record.action = { ...action, id: result.id };
      }
    } catch {
      // Offline — keep as local
      record.source = "local";
    }
  }

  cacheAction(record, context.tenantId);
  return record;
}

/**
 * Transition an action's status on the server.
 */
/**
 * Consequential statuses that MUST be server-confirmed before returning success.
 * These are never allowed to fall back to local-only state.
 */
const CONSEQUENTIAL_STATUSES: Set<string> = new Set([
  "executing",
  "executed",
  "verified",
  "confirmed",
  "stale",
  "failed",
  "blocked",
  "rejected",
  "expired",
  "cancelled",
]);

export async function transitionActionStatus(
  supabase: SupabaseClient | null,
  actionId: string,
  newStatus: AtlasActionStatus,
  actorId: string,
  reason?: string,
  tenantId?: string,
): Promise<PersistedAction | null> {
  const isConsequential = CONSEQUENTIAL_STATUSES.has(newStatus);

  if (supabase) {
    try {
      const result = await serverTransitionAction(supabase, actionId, newStatus, actorId, reason);
      // Fetch updated record from server
      const serverRecord = await serverGetAction(supabase, actionId);
      const action = serverRecordToAction(serverRecord);
      const record: PersistedAction = {
        action,
        persistedAt: new Date().toISOString(),
        source: "server",
        tenantId,
      };
      cacheAction(record, tenantId);
      return record;
    } catch (err) {
      // For consequential statuses, server failure MUST NOT fall back to local.
      // The server is the source of truth.
      if (isConsequential) {
        return null;
      }
      // For non-consequential statuses (preparing, prepared), local fallback is acceptable
      // because these are draft states that will be overwritten by server state later.
    }
  } else if (isConsequential) {
    // No supabase client AND the transition is consequential: cannot proceed
    return null;
  }

  // Local fallback — only for non-consequential statuses when supabase is null or failed
  const cached = loadCachedActions(tenantId);
  const record = cached.find((a) => a.action.id === actionId);
  if (!record) return null;

  try {
    const updatedAction = transitionAction(record.action, newStatus, actorId, reason);
    const updatedRecord: PersistedAction = {
      ...record,
      action: updatedAction,
      persistedAt: new Date().toISOString(),
      source: "local",
    };
    cacheAction(updatedRecord, tenantId);
    return updatedRecord;
  } catch {
    return null;
  }
}

/**
 * Confirm an action (validates token + expiry server-side).
 */
export async function confirmAction(
  supabase: SupabaseClient | null,
  actionId: string,
  token: string,
  actorId: string,
  tenantId?: string,
): Promise<PersistedAction | null> {
  if (supabase) {
    try {
      await serverConfirmAction(supabase, actionId, token, actorId);
      const serverRecord = await serverGetAction(supabase, actionId);
      const action = serverRecordToAction(serverRecord);
      const record: PersistedAction = {
        action,
        persistedAt: new Date().toISOString(),
        source: "server",
        tenantId,
      };
      cacheAction(record, tenantId);
      return record;
    } catch {
      // Fall through to local
    }
  }

  // Local fallback
  return transitionActionStatus(supabase, actionId, "confirmed", actorId, "User confirmed", tenantId);
}

/**
 * Get a single action by ID (server-first, cache fallback).
 */
export async function getAction(
  supabase: SupabaseClient | null,
  actionId: string,
  tenantId?: string,
): Promise<PersistedAction | null> {
  if (supabase) {
    try {
      const serverRecord = await serverGetAction(supabase, actionId);
      const action = serverRecordToAction(serverRecord);
      const record: PersistedAction = {
        action,
        persistedAt: new Date().toISOString(),
        source: "server",
        tenantId,
      };
      cacheAction(record, tenantId);
      return record;
    } catch {
      // Fall through to cache
    }
  }

  const cached = loadCachedActions(tenantId);
  return cached.find((a) => a.action.id === actionId) ?? null;
}

/**
 * List actions (server-first, cache fallback).
 */
export async function listActions(
  supabase: SupabaseClient | null,
  filters: {
    status?: AtlasActionStatus;
    entityType?: string;
    entityId?: string;
    actionType?: AtlasActionType;
    limit?: number;
    offset?: number;
  } = {},
  tenantId?: string,
): Promise<PersistedAction[]> {
  if (supabase) {
    try {
      const serverRecords = await serverListActions(supabase, filters);
      const records: PersistedAction[] = serverRecords.map((sr) => ({
        action: serverRecordToAction(sr),
        persistedAt: sr.updated_at ?? sr.created_at,
        source: "server" as const,
        tenantId,
      }));
      // Update cache
      for (const record of records) {
        cacheAction(record, tenantId);
      }
      return records;
    } catch {
      // Fall through to cache
    }
  }

  // Cache fallback
  let cached = loadCachedActions(tenantId);

  if (filters.status) {
    cached = cached.filter((a) => a.action.status === filters.status);
  }
  if (filters.entityType) {
    cached = cached.filter((a) => a.action.entity.type === filters.entityType);
  }
  if (filters.entityId) {
    cached = cached.filter((a) => a.action.entity.id === filters.entityId);
  }
  if (filters.actionType) {
    cached = cached.filter((a) => a.action.type === filters.actionType);
  }

  return cached.slice(0, filters.limit ?? 50);
}

/**
 * Set execution result on the server.
 */
export async function setActionResult(
  supabase: SupabaseClient | null,
  actionId: string,
  result: { status: string; message: string; error?: { message: string; category: string } },
  actorId: string,
  tenantId?: string,
): Promise<PersistedAction | null> {
  if (supabase) {
    try {
      await serverSetActionResult(supabase, actionId, result as any, actorId);
      const serverRecord = await serverGetAction(supabase, actionId);
      const action = serverRecordToAction(serverRecord);
      const record: PersistedAction = {
        action,
        persistedAt: new Date().toISOString(),
        source: "server",
        tenantId,
      };
      cacheAction(record, tenantId);
      return record;
    } catch {
      // Fall through to local
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

export function recoverPersistedActions(
  tenantId?: string,
  now?: string,
): RecoveryResult {
  const actions = loadCachedActions(tenantId);
  const currentTime = now ?? new Date().toISOString();

  const restored: PersistedAction[] = [];
  const expired: PersistedAction[] = [];
  const stale: PersistedAction[] = [];
  const failed: PersistedAction[] = [];
  const awaitingConfirmation: PersistedAction[] = [];

  for (const record of actions) {
    const action = record.action;

    if (isActionExpired(action)) {
      if (canTransition(action.status, "expired")) {
        const expiredAction = transitionAction(
          action, "expired", "system", "Action expired while browser was closed",
        );
        const expiredRecord = { ...record, action: expiredAction };
        expired.push(expiredRecord);
        cacheAction(expiredRecord, tenantId);
      } else {
        expired.push(record);
      }
      continue;
    }

    switch (action.status) {
      case "awaiting_confirmation":
        awaitingConfirmation.push(record);
        break;
      case "failed":
        failed.push(record);
        break;
      case "executed":
      case "verified":
        restored.push(record);
        break;
      case "blocked":
      case "rejected":
      case "expired":
      case "stale":
        expired.push(record);
        break;
      default:
        restored.push(record);
    }
  }

  const summary: ActionStoreSummary = {
    total: actions.length,
    pending: awaitingConfirmation.length,
    preparing: restored.filter((r) => r.action.status === "preparing").length,
    executing: restored.filter((r) => r.action.status === "executing").length,
    completed: restored.filter((r) => ["executed", "verified"].includes(r.action.status)).length,
    failed: failed.length,
    expired: expired.length,
  };

  return { restored, expired, stale, failed, awaitingConfirmation, summary };
}

// ---------------------------------------------------------------------------
// Convenience queries (local cache)
// ---------------------------------------------------------------------------

export function getActiveActions(tenantId?: string): PersistedAction[] {
  const actions = loadCachedActions(tenantId);
  const terminal = ["executed", "verified", "failed", "blocked", "rejected", "expired", "stale"];
  return actions.filter((a) => !terminal.includes(a.action.status));
}

export function getActionsForEntity(
  entityType: string,
  entityId: string,
  tenantId?: string,
): PersistedAction[] {
  return loadCachedActions(tenantId).filter(
    (a) => a.action.entity.type === entityType && a.action.entity.id === entityId,
  );
}

export function getPersistedAction(actionId: string, tenantId?: string): PersistedAction | null {
  return loadCachedActions(tenantId).find((a) => a.action.id === actionId) ?? null;
}
