/**
 * purge-ycdemo-revenue.ts
 *
 * Comprehensive purge of ALL revenue recovery data for the YC Demo tenant.
 * Uses the same Supabase RPCs the app uses, plus direct table deletes.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// Read env vars from .env.local (same pattern as existing admin scripts)
const envLocal = readFileSync(".env.local", "utf8");
function getEnvVar(name: string): string | undefined {
  const match = envLocal.match(new RegExp(`^${name}=(.+)$`, "m"));
  return match?.[1]?.trim();
}

const SUPABASE_URL = getEnvVar("VITE_SUPABASE_URL");
const SUPABASE_ANON_KEY = getEnvVar("VITE_SUPABASE_ANON_KEY");
const SERVICE_ROLE_KEY =
  getEnvVar("SUPABASE_SERVICE_ROLE_KEY") ?? getEnvVar("SUPABASE_SERVICE_ROLE");

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const TENANT_ID = "6379923e-4997-4a6a-a75d-6cf20fd1c993";

interface DeleteResult {
  table: string;
  count: number;
  error?: string;
}

async function deleteFromTable(
  table: string,
  tenantColumn: string = "tenantId"
): Promise<DeleteResult> {
  // First count
  const { count, error: countErr } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(tenantColumn, TENANT_ID);

  if (countErr) {
    return { table, count: 0, error: countErr.message };
  }

  if (!count || count === 0) {
    return { table, count: 0 };
  }

  // Delete in batches (Supabase limit ~1000 per request)
  let totalDeleted = 0;
  while (totalDeleted < count) {
    const { data, error: fetchErr } = await supabase
      .from(table)
      .select("_id")
      .eq(tenantColumn, TENANT_ID)
      .limit(100);

    if (fetchErr || !data || data.length === 0) break;

    const ids = data.map((r: any) => r._id);

    const { error: delErr } = await supabase
      .from(table)
      .delete()
      .in("_id", ids);

    if (delErr) {
      return { table, count: totalDeleted, error: delErr.message };
    }

    totalDeleted += ids.length;
    if (ids.length < 100) break; // no more
  }

  return { table, count: totalDeleted };
}

async function main() {
  console.log("=== YC Demo Revenue Recovery Purge ===");
  console.log(`Tenant: ${TENANT_ID}`);
  console.log();

  // Step 1: Try the app's built-in removeDemo RPC
  console.log("--- Step 1: insurance_demo_remove RPC ---");
  try {
    const { data, error } = await supabase.rpc("insurance_demo_remove");
    if (error) {
      console.log(`  RPC error: ${error.message}`);
    } else {
      console.log(`  Result: ${JSON.stringify(data)}`);
    }
  } catch (e) {
    console.log(`  Exception: ${e}`);
  }
  console.log();

  // Step 2: Direct table deletes in dependency order
  console.log("--- Step 2: Direct table deletes ---");

  // These tables are the ones the revenue recovery page queries:
  // 1. claimfindings (child of claims)
  // 2. claimsupplements (child of claims)
  // 3. claimevidence (links claims to documents)
  // 4. claimcandidates (independent)
  // 5. insuranceclaims (parent)
  // 6. claimfindings for any remaining
  // 7. auditlogs (activity history)

  const tablesToPurge: Array<[string, string]> = [
    ["claimfindings", "tenantId"],
    ["claimsupplements", "tenantId"],
    ["claimevidence", "tenantId"],
    ["claimcandidates", "tenantId"],
    ["insuranceclaims", "tenantId"],
    ["auditlogs", "tenantId"],
    // Also check these for any activity/claims data
    ["recommendations", "tenantId"],
    ["conversationSessions", "tenantId"],
    ["askEvidence", "tenantId"],
  ];

  const results: DeleteResult[] = [];
  let totalPurged = 0;

  for (const [table, column] of tablesToPurge) {
    const result = await deleteFromTable(table, column);
    results.push(result);
    if (result.error) {
      console.log(`  ✗ ${table}: ${result.error}`);
    } else if (result.count > 0) {
      console.log(`  ✓ ${table}: ${result.count} deleted`);
      totalPurged += result.count;
    } else {
      console.log(`  · ${table}: already empty`);
    }
  }

  console.log();
  console.log(`--- Total purged: ${totalPurged} records ---`);
  console.log();

  // Step 3: Verify
  console.log("--- Step 3: Verification ---");
  for (const [table, column] of tablesToPurge) {
    const { count, error } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq(column, TENANT_ID);

    if (error) {
      console.log(`  ${table}: ERROR (${error.message})`);
    } else {
      console.log(`  ${table}: ${count ?? 0} remaining`);
    }
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
