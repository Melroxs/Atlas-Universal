// ---------------------------------------------------------------------------
// usePersistedActions
//
// React hook for server-authoritative action persistence with realtime.
// Uses Supabase as the source of truth with localStorage as offline cache.
// ---------------------------------------------------------------------------

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { useAtlasActionAuth } from "@/hooks/use-atlas-action-auth";
import {
  type PersistedAction,
  type RecoveryResult,
  type ActionStoreSummary,
  createAction,
  transitionActionStatus,
  confirmAction,
  getAction,
  listActions,
  setActionResult,
  recoverPersistedActions,
  getActiveActions as getActiveCached,
  getActionsForEntity as getEntityCached,
  getPersistedAction as getCached,
} from "@/lib/atlas-experience/action-persistence";
import {
  type AtlasExecutableAction,
  type AtlasActionStatus,
  isActionExpired,
} from "@/lib/atlas-experience/execution";

export interface UsePersistedActionsResult {
  actions: PersistedAction[];
  activeActions: PersistedAction[];
  summary: ActionStoreSummary;
  recovered: boolean;
  recoveryResult: RecoveryResult | null;
  loading: boolean;
  createAction: (
    action: AtlasExecutableAction,
    context?: { conversationId?: string; signalId?: string },
  ) => Promise<PersistedAction>;
  transitionStatus: (
    actionId: string,
    status: AtlasActionStatus,
    actor: string,
    reason?: string,
  ) => Promise<PersistedAction | null>;
  confirm: (
    actionId: string,
    token: string,
    actorId: string,
  ) => Promise<PersistedAction | null>;
  getResult: (actionId: string) => Promise<PersistedAction | null>;
  list: (filters?: {
    status?: AtlasActionStatus;
    entityType?: string;
    entityId?: string;
    actionType?: string;
    limit?: number;
    offset?: number;
  }) => Promise<PersistedAction[]>;
  getActionsForEntity: (entityType: string, entityId: string) => PersistedAction[];
  refresh: () => void;
}

export function usePersistedActions(): UsePersistedActionsResult {
  const { profile, userId } = useAtlasActionAuth();
  const tenantId = profile?.tenant_id ?? undefined;
  const companyId = profile?.company_id ?? undefined;
  const supabase = getSupabaseClient();

  const [actions, setActions] = useState<PersistedAction[]>([]);
  const [recovered, setRecovered] = useState(false);
  const [recoveryResult, setRecoveryResult] = useState<RecoveryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const channelRef = useRef<{ unsubscribe: () => void } | null>(null);

  // Recovery on mount
  useEffect(() => {
    if (!profile) return;
    const result = recoverPersistedActions(tenantId);
    setRecoveryResult(result);
    setActions(result.restored.concat(result.awaitingConfirmation));
    setRecovered(true);

    // Fetch from server
    listActions(supabase, { limit: 50 }, tenantId)
      .then((serverActions) => {
        if (serverActions.length > 0) {
          setActions(serverActions);
        }
      })
      .catch(() => { /* offline */ });
  }, [profile?.id, tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime subscription
  useEffect(() => {
    if (!supabase || !tenantId) return;

    const channel = supabase
      .channel(`atlas_actions:${tenantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "atlas_actions",
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          // Refresh actions on any change
          setTick((n) => n + 1);
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [supabase, tenantId]);

  // Refresh on tick (realtime)
  useEffect(() => {
    if (tick > 0 && profile) {
      listActions(supabase, { limit: 50 }, tenantId)
        .then((serverActions) => {
          if (serverActions.length > 0) {
            setActions(serverActions);
          }
        })
        .catch(() => { /* offline */ });
    }
  }, [tick, profile?.id, supabase, tenantId]);

  const createActionFn = useCallback(
    async (
      action: AtlasExecutableAction,
      context?: { conversationId?: string; signalId?: string },
    ): Promise<PersistedAction> => {
      const record = await createAction(supabase, action, {
        tenantId,
        companyId,
        conversationId: context?.conversationId,
        signalId: context?.signalId,
      });
      setActions((prev) => {
        const idx = prev.findIndex((a) => a.action.id === record.action.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = record;
          return next;
        }
        return [record, ...prev];
      });
      return record;
    },
    [supabase, tenantId, companyId],
  );

  const transitionStatusFn = useCallback(
    async (
      actionId: string,
      status: AtlasActionStatus,
      actor: string,
      reason?: string,
    ): Promise<PersistedAction | null> => {
      const result = await transitionActionStatus(supabase, actionId, status, actor, reason, tenantId);
      if (result) {
        setActions((prev) => {
          const idx = prev.findIndex((a) => a.action.id === actionId);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = result;
            return next;
          }
          return [result, ...prev];
        });
      }
      return result;
    },
    [supabase, tenantId],
  );

  const confirmFn = useCallback(
    async (actionId: string, token: string, actorId: string): Promise<PersistedAction | null> => {
      const result = await confirmAction(supabase, actionId, token, actorId, tenantId);
      if (result) {
        setActions((prev) => {
          const idx = prev.findIndex((a) => a.action.id === actionId);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = result;
            return next;
          }
          return [result, ...prev];
        });
      }
      return result;
    },
    [supabase, tenantId],
  );

  const getResultFn = useCallback(
    async (actionId: string): Promise<PersistedAction | null> => {
      return getAction(supabase, actionId, tenantId);
    },
    [supabase, tenantId],
  );

  const listFn = useCallback(
    async (filters?: {
      status?: AtlasActionStatus;
      entityType?: string;
      entityId?: string;
      actionType?: string;
      limit?: number;
      offset?: number;
    }): Promise<PersistedAction[]> => {
      const result = await listActions(supabase, filters as any, tenantId);
      return result;
    },
    [supabase, tenantId],
  );

  const getActionsForEntityFn = useCallback(
    (entityType: string, entityId: string): PersistedAction[] => {
      return getEntityCached(entityType, entityId, tenantId);
    },
    [tenantId],
  );

  const refresh = useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  const activeActions = useMemo(
    () => actions.filter((a) => !isTerminal(a.action.status)),
    [actions],
  );

  const summary = useMemo((): ActionStoreSummary => {
    const counts: ActionStoreSummary = {
      total: actions.length,
      pending: 0,
      preparing: 0,
      executing: 0,
      completed: 0,
      failed: 0,
      expired: 0,
    };
    for (const { action } of actions) {
      switch (action.status) {
        case "awaiting_confirmation": counts.pending++; break;
        case "preparing": case "prepared": counts.preparing++; break;
        case "executing": counts.executing++; break;
        case "executed": case "verified": counts.completed++; break;
        case "failed": counts.failed++; break;
        case "expired": case "stale": case "blocked": case "rejected": counts.expired++; break;
      }
    }
    return counts;
  }, [actions]);

  return {
    actions,
    activeActions,
    summary,
    recovered,
    recoveryResult,
    loading,
    createAction: createActionFn,
    transitionStatus: transitionStatusFn,
    confirm: confirmFn,
    getResult: getResultFn,
    list: listFn,
    getActionsForEntity: getActionsForEntityFn,
    refresh,
  };
}

function isTerminal(status: AtlasActionStatus): boolean {
  return ["executed", "verified", "failed", "blocked", "rejected", "expired", "stale"].includes(status);
}
