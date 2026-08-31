// ---------------------------------------------------------------------------
// useLiveClaimMonitor
//
// Subscribes to Supabase realtime changes on the insurance claim's related
// tables (evidence, findings, supplements) while a DecisionRoom is open.
//
// Signals when source data has changed so the DecisionRoom can mark itself
// stale and prompt re-analysis.
// ---------------------------------------------------------------------------

import { useState, useEffect, useRef, useCallback } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { useAtlasActionAuth } from "@/hooks/use-atlas-action-auth";

export interface ClaimChangeEvent {
  table: string;
  eventType: "INSERT" | "UPDATE" | "DELETE";
  timestamp: number;
  label: string;
}

export interface UseLiveClaimMonitorResult {
  /** Whether the claim data has changed since monitoring started */
  hasChanged: boolean;
  /** Description of what changed */
  changes: ClaimChangeEvent[];
  /** Call to acknowledge changes and reset */
  acknowledge: () => void;
  /** Whether monitoring is active */
  isMonitoring: boolean;
}

const MONITORED_TABLES = [
  { table: "evidenceDocs", label: "Evidence documents" },
  { table: "claimSupplements", label: "Supplements" },
] as const;

/**
 * Monitor claim-related tables for changes while a DecisionRoom is open.
 * Uses Supabase Postgres realtime subscriptions.
 */
export function useLiveClaimMonitor(
  claimId: string | null,
  enabled: boolean = false,
): UseLiveClaimMonitorResult {
  const { profile } = useAtlasActionAuth();
  const tenantId = profile?.tenant_id ?? undefined;
  const supabase = getSupabaseClient();

  const [changes, setChanges] = useState<ClaimChangeEvent[]>([]);
  const [hasChanged, setHasChanged] = useState(false);
  const channelRef = useRef<{ unsubscribe: () => void } | null>(null);

  const acknowledge = useCallback(() => {
    setChanges([]);
    setHasChanged(false);
  }, []);

  useEffect(() => {
    if (!supabase || !tenantId || !claimId || !enabled) {
      // Clean up existing subscription
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        channelRef.current = null;
      }
      return;
    }

    // Track seen events to avoid duplicates
    const seenEvents = new Set<string>();

    const channel = supabase
      .channel(`claim_monitor:${claimId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "evidenceDocs",
          filter: `claim_id=eq.${claimId}`,
        },
        (payload) => {
          const key = `${payload.eventType}:${((payload.new ?? payload.old) as Record<string, unknown>)?.id ?? "unknown"}:${Date.now()}`;
          if (seenEvents.has(key)) return;
          seenEvents.add(key);

          const label =
            payload.eventType === "INSERT"
              ? "New evidence document added"
              : payload.eventType === "UPDATE"
                ? "Evidence document updated"
                : "Evidence document removed";

          const change: ClaimChangeEvent = {
            table: "evidenceDocs",
            eventType: payload.eventType as ClaimChangeEvent["eventType"],
            timestamp: Date.now(),
            label,
          };

          setChanges((prev) => [...prev, change]);
          setHasChanged(true);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "claimSupplements",
          filter: `claim_id=eq.${claimId}`,
        },
        (payload) => {
          const key = `${payload.eventType}:${((payload.new ?? payload.old) as Record<string, unknown>)?.id ?? "unknown"}:${Date.now()}`;
          if (seenEvents.has(key)) return;
          seenEvents.add(key);

          const label =
            payload.eventType === "INSERT"
              ? "New supplement created"
              : payload.eventType === "UPDATE"
                ? "Supplement updated"
                : "Supplement removed";

          const change: ClaimChangeEvent = {
            table: "claimSupplements",
            eventType: payload.eventType as ClaimChangeEvent["eventType"],
            timestamp: Date.now(),
            label,
          };

          setChanges((prev) => [...prev, change]);
          setHasChanged(true);
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [supabase, tenantId, claimId, enabled]);

  // Reset changes when claimId or enabled changes
  useEffect(() => {
    setChanges([]);
    setHasChanged(false);
  }, [claimId, enabled]);

  return {
    hasChanged,
    changes,
    acknowledge,
    isMonitoring: enabled && !!claimId && !!tenantId,
  };
}
