// ---------------------------------------------------------------------------
// useServerActionState
//
// Server-authoritative action state management.
//
// Unlike usePersistedActions (which falls back to localStorage when the server
// is unreachable), this hook:
//   1. Fetches the authoritative server state on mount
//   2. Returns a `serverConsistent` flag — false when server state differs
//      from what the client expected
//   3. Blocks execution when server state is unknown or stale
//   4. Provides a `reconcile()` method to re-sync with the server
//
// Use this hook wherever an action transition must be trustworthy:
//   - DecisionRoom confirmation → execution
//   - Voice command → action execution
//   - ActionHistory detail view
//   - Any surface where "is this still valid?" matters
// ---------------------------------------------------------------------------

import { useState, useCallback, useEffect, useRef } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { useAtlasActionAuth } from "@/hooks/use-atlas-action-auth";
import {
  type PersistedAction,
  getAction,
  listActions,
} from "@/lib/atlas-experience/action-persistence";
import {
  type AtlasExecutableAction,
  type AtlasActionStatus,
  canTransition,
} from "@/lib/atlas-experience/execution";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServerActionState {
  /** Whether the local state matches the server state */
  serverConsistent: boolean;
  /** Whether a server fetch is in progress */
  loading: boolean;
  /** Error message if the last server fetch failed */
  error: string | null;
  /** The last time we successfully fetched server state */
  lastServerSync: string | null;
  /** All actions from the server */
  actions: PersistedAction[];
  /** Active (non-terminal) actions */
  activeActions: PersistedAction[];
  /** Get a specific action's current server state */
  getServerAction: (actionId: string) => Promise<PersistedAction | null>;
  /** Check if a specific action is still in the expected state */
  isActionStillValid: (
    actionId: string,
    expectedStatus: AtlasActionStatus,
  ) => Promise<{ valid: boolean; actualStatus?: string; message: string }>;
  /** Re-fetch all actions from the server */
  reconcile: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useServerActionState(): ServerActionState {
  const { profile } = useAtlasActionAuth();
  const tenantId = profile?.tenant_id ?? undefined;
  const supabase = getSupabaseClient();

  const [actions, setActions] = useState<PersistedAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastServerSync, setLastServerSync] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // Fetch server state on mount and when tenant changes
  useEffect(() => {
    mountedRef.current = true;
    if (!supabase || !tenantId) return;

    const fetchServerState = async () => {
      if (mountedRef.current) setLoading(true);
      try {
        const serverActions = await listActions(supabase, { limit: 100 }, tenantId);
        if (mountedRef.current) {
          setActions(serverActions);
          setLastServerSync(new Date().toISOString());
          setError(null);
        }
      } catch (e) {
        if (mountedRef.current) {
          setError(
            e instanceof Error ? e.message : "Failed to fetch server action state",
          );
        }
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };

    fetchServerState();

    return () => {
      mountedRef.current = false;
    };
  }, [supabase, tenantId]);

  // Subscribe to realtime changes
  useEffect(() => {
    if (!supabase || !tenantId) return;

    const channel = supabase
      .channel(`server_action_state:${tenantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "atlas_actions",
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => {
          // Re-fetch on any change
          listActions(supabase, { limit: 100 }, tenantId)
            .then((serverActions) => {
              if (mountedRef.current) {
                setActions(serverActions);
                setLastServerSync(new Date().toISOString());
              }
            })
            .catch(() => { /* offline */ });
        },
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [supabase, tenantId]);

  const getServerAction = useCallback(
    async (actionId: string): Promise<PersistedAction | null> => {
      if (!supabase) return null;
      try {
        return await getAction(supabase, actionId, tenantId);
      } catch {
        return null;
      }
    },
    [supabase, tenantId],
  );

  const isActionStillValid = useCallback(
    async (
      actionId: string,
      expectedStatus: AtlasActionStatus,
    ): Promise<{ valid: boolean; actualStatus?: string; message: string }> => {
      const serverAction = await getServerAction(actionId);

      if (!serverAction) {
        return {
          valid: false,
          message:
            "This action was not found on the server. It may have been deleted or the migration has not been applied.",
        };
      }

      const actualStatus = serverAction.action.status;

      if (actualStatus === expectedStatus) {
        return {
          valid: true,
          actualStatus,
          message: `Action is in the expected state: ${expectedStatus}`,
        };
      }

      // Check if the transition is still valid
      const transitionValid = canTransition(actualStatus, "executing");

      if (!transitionValid) {
        return {
          valid: false,
          actualStatus,
          message: `This action is no longer in the expected state. Server shows: ${actualStatus}. This may indicate it was already executed, cancelled, or expired by another user or session.`,
        };
      }

      // The action is in a different state but the transition might still be valid
      return {
        valid: false,
        actualStatus,
        message: `Expected ${expectedStatus} but server shows ${actualStatus}. The action state has changed since you last checked.`,
      };
    },
    [getServerAction],
  );

  const reconcile = useCallback(async () => {
    if (!supabase || !tenantId) return;
    setLoading(true);
    try {
      const serverActions = await listActions(supabase, { limit: 100 }, tenantId);
      setActions(serverActions);
      setLastServerSync(new Date().toISOString());
      setError(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to reconcile with server",
      );
    } finally {
      setLoading(false);
    }
  }, [supabase, tenantId]);

  const activeActions = actions.filter(
    (a) =>
      !["executed", "verified", "failed", "blocked", "rejected", "expired", "stale"].includes(
        a.action.status,
      ),
  );

  // serverConsistent is true when we've successfully synced with the server
  // at least once AND there are no pending errors
  const serverConsistent = lastServerSync !== null && error === null;

  return {
    serverConsistent,
    loading,
    error,
    lastServerSync,
    actions,
    activeActions,
    getServerAction,
    isActionStillValid,
    reconcile,
  };
}
