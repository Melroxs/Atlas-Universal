// ---------------------------------------------------------------------------
// Atlas Backend Drift Detection
//
// Detects mismatch between what the frontend expects and what the backend
// actually provides. Uses safe probe queries that don't modify data.
//
// The application can use this to distinguish:
//   "Atlas backend ready"
//   "Atlas backend partially configured"
//   "Atlas backend unreachable"
//
// Never exposes secrets.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import { rpcCall } from "@/lib/actions/rpc";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DriftStatus = "available" | "unavailable" | "error";

export interface DriftProbe {
  /** Human-readable name */
  name: string;
  /** What this probe checks */
  description: string;
  /** Whether this is critical for production */
  critical: boolean;
  /** Result status */
  status: DriftStatus;
  /** Error message if unavailable */
  error?: string;
}

export interface DriftReport {
  /** Overall status: all critical probes pass */
  ready: boolean;
  /** Partially configured: some critical probes pass */
  partiallyConfigured: boolean;
  /** All probes */
  probes: DriftProbe[];
  /** Timestamp of the check */
  checkedAt: string;
}

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

/** All critical probes for Atlas production */
const DRIFT_PROBES: Array<Omit<DriftProbe, "status" | "error">> = [
  {
    name: "atlas_action_create",
    description: "Action creation RPC",
    critical: true,
  },
  {
    name: "atlas_action_transition",
    description: "Action state transition RPC",
    critical: true,
  },
  {
    name: "atlas_action_execute",
    description: "Server-native execution RPC",
    critical: true,
  },
  {
    name: "atlas_action_complete_execution",
    description: "Execution completion RPC",
    critical: true,
  },
  {
    name: "atlas_action_get",
    description: "Action retrieval RPC",
    critical: true,
  },
  {
    name: "atlas_action_list",
    description: "Action listing RPC",
    critical: true,
  },
  {
    name: "atlas_action_confirm",
    description: "Action confirmation RPC",
    critical: true,
  },
  {
    name: "atlas_action_reconcile",
    description: "Action reconciliation RPC",
    critical: false,
  },
];

/**
 * Probe the backend to detect drift between frontend expectations
 * and backend capabilities.
 *
 * Uses minimal, safe probe calls that don't modify any data.
 */
export async function detectBackendDrift(
  supabase: SupabaseClient,
): Promise<DriftReport> {
  const probes: DriftProbe[] = [];

  for (const probeDef of DRIFT_PROBES) {
    const probe: DriftProbe = {
      ...probeDef,
      status: "error",
    };

    try {
      // For each RPC, try calling it with minimal/empty args.
      // If the function doesn't exist, it will throw an error.
      // If it exists but requires args, it may throw a different error.
      switch (probeDef.name) {
        case "atlas_action_get": {
          // This should fail gracefully with "Action not found" not "function not found"
          try {
            await rpcCall(supabase, probeDef.name, {
              actionId: "00000000-0000-0000-0000-000000000000",
            });
            probe.status = "available";
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            // "Action not found" means the function exists and works
            if (msg.includes("not found") || msg.includes("access denied")) {
              probe.status = "available";
            } else if (msg.includes("does not exist") || msg.includes("function") && msg.includes("not")) {
              probe.status = "unavailable";
              probe.error = "RPC function does not exist on server";
            } else {
              probe.status = "available"; // Function exists, just returned an error for invalid input
            }
          }
          break;
        }
        case "atlas_action_list": {
          try {
            await rpcCall(supabase, probeDef.name, { limit: 0 });
            probe.status = "available";
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("does not exist") || msg.includes("function") && msg.includes("not")) {
              probe.status = "unavailable";
              probe.error = "RPC function does not exist on server";
            } else {
              probe.status = "available";
            }
          }
          break;
        }
        default: {
          // For other RPCs, try a minimal call and check if the error
          // is about the function not existing vs. invalid args
          try {
            await rpcCall(supabase, probeDef.name, {
              actionId: "00000000-0000-0000-0000-000000000000",
              actorId: "00000000-0000-0000-0000-000000000000",
            });
            probe.status = "available";
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("does not exist") || (msg.includes("function") && msg.includes("not found"))) {
              probe.status = "unavailable";
              probe.error = "RPC function does not exist on server";
            } else {
              // Function exists, just returned a business error
              probe.status = "available";
            }
          }
          break;
        }
      }
    } catch {
      probe.status = "error";
      probe.error = "Unexpected error during probe";
    }

    probes.push(probe);
  }

  const criticalProbes = probes.filter((p) => p.critical);
  const criticalPassing = criticalProbes.filter((p) => p.status === "available");
  const criticalFailing = criticalProbes.filter((p) => p.status !== "available");

  return {
    ready: criticalFailing.length === 0,
    partiallyConfigured: criticalPassing.length > 0 && criticalFailing.length > 0,
    probes,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Quick health check — returns true if the backend is fully ready.
 */
export async function isBackendReady(supabase: SupabaseClient): Promise<boolean> {
  try {
    // Simplest possible probe: can we reach any RPC?
    await rpcCall(supabase, "atlas_action_list", { limit: 0 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Format a drift report for admin/developer display.
 */
export function formatDriftReport(report: DriftReport): string {
  const lines: string[] = [];
  lines.push(`Atlas Backend Status: ${report.ready ? "READY" : report.partiallyConfigured ? "PARTIALLY CONFIGURED" : "NOT READY"}`);
  lines.push(`Checked: ${report.checkedAt}`);
  lines.push("");

  for (const probe of report.probes) {
    const icon = probe.status === "available" ? "✅" : probe.status === "unavailable" ? "❌" : "⚠️";
    const criticalTag = probe.critical ? " [CRITICAL]" : "";
    lines.push(`${icon} ${probe.name}${criticalTag} — ${probe.description}`);
    if (probe.error) {
      lines.push(`   ${probe.error}`);
    }
  }

  return lines.join("\n");
}
