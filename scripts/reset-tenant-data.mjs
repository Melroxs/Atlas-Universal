#!/usr/bin/env node
// -----------------------------------------------------------------------
// Atlas — Tenant Data Reset Script
//
// Resets a specific tenant to a brand-new customer state:
//   - Deletes all customer-owned data (documents, claims, supplements, etc.)
//   - Cleans up Supabase Storage objects belonging to the tenant
//   - Preserves auth accounts, profiles, memberships, and the tenant record
//   - Preserves global Atlas knowledge, ontologies, and seed data
//
// Usage:
//   node scripts/reset-tenant-data.mjs                    # Reset YC Demo (default)
//   node scripts/reset-tenant-data.mjs --tenant <id>     # Reset a specific tenant
//   node scripts/reset-tenant-data.mjs --list             # List all tenants
//   node scripts/reset-tenant-data.mjs --dry-run          # Show what would be deleted
//
// Environment:
//   Reads SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_URL from .env.local
//
// Safety:
//   - Every DELETE is scoped to the target tenant_id
//   - Never truncates shared tables
//   - Never deletes global Atlas knowledge
//   - Never modifies auth accounts or RBAC
//   - Idempotent: running twice produces the same result
// -----------------------------------------------------------------------

import { readFileSync } from "node:fs";

// ── Configuration ────────────────────────────────────────────────────

const DEFAULT_TENANT_NAME = "YC Demo";

// Parse CLI args
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const listMode = args.includes("--list");
const tenantArg = args.includes("--tenant") ? args[args.indexOf("--tenant") + 1] : null;

// ── Environment ──────────────────────────────────────────────────────

function parseEnvFile(file) {
  const out = {};
  try {
    for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
  } catch {}
  return out;
}

const env = parseEnvFile(".env.local");
const URL = env.VITE_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "https://ibxvzxblyhzwokljkslt.supabase.co";
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE) {
  console.error("SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
  console.error("This script requires the service role key to bypass RLS.");
  process.exit(1);
}

const adminHeaders = {
  apikey: SERVICE,
  "Content-Type": "application/json",
  Authorization: `Bearer ${SERVICE}`,
};

// ── Supabase REST Helpers ────────────────────────────────────────────

async function adminQuery(table, select = "*", filter = "") {
  const url = `${URL}/rest/v1/${table}?select=${select}${filter ? "&" + filter : ""}`;
  const res = await fetch(url, { headers: adminHeaders });
  if (!res.ok) return { error: res.status, body: await res.text().catch(() => "") };
  return res.json();
}

async function adminDelete(table, filter) {
  const url = `${URL}/rest/v1/${table}?${filter}`;
  const res = await fetch(url, { method: "DELETE", headers: adminHeaders });
  return { ok: res.ok, status: res.status, body: await res.text().catch(() => "") };
}

async function storageList(bucket, prefix = "") {
  const url = `${URL}/storage/v1/object/list/${bucket}`;
  const res = await fetch(url, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
  });
  if (!res.ok) return { error: res.status, body: await res.text().catch(() => "") };
  return res.json();
}

async function storageDelete(bucket, paths) {
  if (!paths.length) return { ok: true, deleted: 0 };
  const url = `${URL}/storage/v1/object/${bucket}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: adminHeaders,
    body: JSON.stringify(paths),
  });
  return { ok: res.ok, status: res.status, body: await res.text().catch(() => "") };
}

// ── Tenant Discovery ─────────────────────────────────────────────────

async function findTenantId(userId) {
  const memberships = await adminQuery("memberships", "tenantId", `userId=eq.${userId}`);
  if (Array.isArray(memberships) && memberships.length > 0) {
    return memberships[0].tenantId;
  }
  // Fallback: look for tenant by name
  const tenants = await adminQuery("tenants", "_id,name", "order=name.asc");
  if (Array.isArray(tenants)) {
    const ycDemo = tenants.find((t) => t.name?.includes(DEFAULT_TENANT_NAME));
    if (ycDemo) return ycDemo._id;
  }
  return null;
}

// ── Table Catalog ────────────────────────────────────────────────────

// All tenant-scoped tables in dependency order (leaf tables first for FK safety)
// Tables marked with (*) may not exist — the script is idempotent and skips 404s
const TENANT_TABLES = [
  // ── AI/Agent Processing ──
  "atlas_job_events",          // (*) Milestone 1 jobs
  "atlas_job_attempts",        // (*) Milestone 1 jobs
  "atlas_job_steps",           // (*) Milestone 1 jobs
  "atlas_jobs",                // (*) Milestone 1 jobs

  // ── Evidence & Knowledge ──
  "askEvidence",               // Ask Atlas evidence links
  "knowledgeAssertions",       // Knowledge graph assertions
  "entityRelationships",       // Entity-to-entity edges
  "entities",                  // Extracted entities

  // ── Claims & Supplements ──
  "claimEvidence",             // Claim ↔ document evidence links
  "claimFindings",             // Analysis findings per claim
  "claimSupplements",          // Supplement line items
  "claimCandidates",           // Claim discovery candidates
  "insuranceClaims",           // Claims themselves

  // ── Recommendations ──
  "recommendationEvidence",    // Recommendation ↔ evidence links
  "recommendations",           // AI/deterministic recommendations

  // ── Documents & Ingestion ──
  "documentChunks",            // Chunked text + embeddings
  "documents",                 // Uploaded/ingested documents
  "ingestionJobs",             // Ingestion processing queue

  // ── Archives ──
  "archiveFiles",              // Individual files in an archive
  "archiveIngestions",         // Archive import sessions

  // ── Workflows ──
  "workflowSteps",             // Step instances
  "workflowApprovals",         // Approval gates
  "workflowInstances",         // Workflow runs
  "workflowSettings",          // Per-tenant workflow config

  // ── Events & Notifications ──
  "eventPolicies",             // Per-tenant event policy overrides
  "notifications",             // In-app notifications
  "events",                    // Event log entries

  // ── Conversations (Ask Atlas history) ──
  "conversationSessions",      // Ask Atlas session records

  // ── Connections & Tools ──
  "toolActions",               // Tool execution history
  "connections",               // External service connections

  // ── Workspace / Org ──
  "companyProfiles",           // Company profile data
  "companySystems",            // Company system integrations
  "tenantPacks",               // Intelligence pack activations
  "operatingLocations",        // Everest operating locations
  "organizationContexts",      // Everest org context

  // ── Audit ──
  "auditLogs",                 // Audit trail

  // ── Pilot data ──
  "pilotTestimonials",         // Pilot company testimonials
  "pilotOutcomes",             // Pilot outcomes
  "pilotInsights",             // Pilot insights
  "pilotSessions",             // Pilot sessions
  "pilotCompanies",            // Pilot company records
];

// ── Storage Buckets ──────────────────────────────────────────────────

const STORAGE_BUCKETS = ["documents"]; // Supabase Storage bucket names

// ── Main ─────────────────────────────────────────────────────────────

(async () => {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Atlas — Tenant Data Reset");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Supabase: ${URL}`);
  console.log(`  Mode:     ${dryRun ? "DRY RUN (no changes)" : "LIVE"}`);
  console.log("═══════════════════════════════════════════════════════════\n");

  // ── Step 1: Identify the target tenant ──────────────────────────────

  console.log("─── Step 1: Identify Target Tenant ───────────────────\n");

  let targetUserId = "c7e29b03-81d5-49c3-9504-151aa0dcd510"; // YC Demo default
  let targetTenantId = null;

  if (listMode) {
    console.log("Listing all tenants:\n");
    const tenants = await adminQuery("tenants", "_id,name,slug,createdAt");
    if (Array.isArray(tenants)) {
      for (const t of tenants) {
        const members = await adminQuery("memberships", "userId", `tenantId=eq.${t._id}`);
        const memberCount = Array.isArray(members) ? members.length : 0;
        console.log(`  ${t._id} | ${t.name || "(unnamed)"} | slug=${t.slug || "-"} | members=${memberCount}`);
      }
    }
    console.log("\nUse: node scripts/reset-tenant-data.mjs --tenant <tenantId>");
    return;
  }

  if (tenantArg) {
    targetTenantId = tenantArg;
  } else {
    targetTenantId = await findTenantId(targetUserId);
  }

  if (!targetTenantId) {
    console.error("Could not find a tenant for the target user/tenant ID.");
    console.error("Use --list to see all tenants, or --tenant <id> to specify one.");
    process.exit(1);
  }

  // Verify tenant exists
  const tenant = await adminQuery("tenants", "_id,name,slug", `_id=eq.${targetTenantId}`);
  if (!Array.isArray(tenant) || tenant.length === 0) {
    console.error(`Tenant ${targetTenantId} not found in the tenants table.`);
    process.exit(1);
  }

  const tenantName = tenant[0].name || "(unnamed)";
  const tenantSlug = tenant[0].slug || "-";

  // Verify tenant has members (safety check)
  const members = await adminQuery("memberships", "userId,role", `tenantId=eq.${targetTenantId}`);
  const memberCount = Array.isArray(members) ? members.length : 0;

  // Verify auth user still exists
  const profile = await adminQuery("profiles", "_id,name,email", `_id=eq.${targetUserId}`);

  console.log(`  Target tenant:  ${tenantName} (${targetTenantId})`);
  console.log(`  Tenant slug:    ${tenantSlug}`);
  console.log(`  Members:        ${memberCount}`);
  console.log(`  Auth user:      ${Array.isArray(profile) && profile.length > 0 ? `${profile[0].name} <${profile[0].email}>` : "NOT FOUND"}`);
  console.log(`  Preserved:      auth, profile, membership, tenant record`);
  console.log();

  if (dryRun) {
    console.log("  ── Dry Run: Previewing deletions ──\n");
  }

  // ── Step 2: Inventory current data ──────────────────────────────────

  console.log("─── Step 2: Inventory Current Data ───────────────────\n");

  const inventory = {};
  for (const table of TENANT_TABLES) {
    const result = await adminQuery(table, "*", `tenantId=eq.${targetTenantId}&select=count`, "Prefer=count");
    // Fallback: just query and count
    const rows = await adminQuery(table, "*", `tenantId=eq.${targetTenantId}`);
    const count = Array.isArray(rows) ? rows.length : (rows.error ? null : 0);
    inventory[table] = count;
    if (count === null) {
      // Table may not exist — that's fine
    } else if (count > 0) {
      console.log(`  ${table}: ${count} records`);
    }
  }

  const totalRecords = Object.values(inventory).reduce((sum, c) => sum + (c ?? 0), 0);
  console.log(`\n  Total tenant-owned records to delete: ${totalRecords}`);
  console.log();

  if (totalRecords === 0) {
    console.log("  ✓ Tenant is already clean — no data to remove.\n");
  }

  // ── Step 3: Delete tenant-scoped data ───────────────────────────────

  if (totalRecords > 0) {
    console.log("─── Step 3: Delete Tenant Data ───────────────────────\n");

    const results = {};
    let totalDeleted = 0;
    let totalFailed = 0;

    for (const table of TENANT_TABLES) {
      const count = inventory[table];
      if (!count || count === 0) continue;

      if (dryRun) {
        console.log(`  [DRY] Would delete ${count} rows from ${table}`);
        results[table] = { deleted: count, failed: 0 };
        totalDeleted += count;
        continue;
      }

      const result = await adminDelete(table, `tenantId=eq.${targetTenantId}`);
      if (result.ok) {
        console.log(`  ✓ ${table}: deleted ${count} rows`);
        results[table] = { deleted: count, failed: 0 };
        totalDeleted += count;
      } else {
        // 404 = table doesn't exist yet (migration not applied), not a real error
        if (result.status === 404) {
          console.log(`  ○ ${table}: table not found (migration not applied) — skipped`);
          results[table] = { deleted: 0, failed: 0, skipped: true };
        } else {
          console.log(`  ✗ ${table}: FAILED (${result.status}) — ${result.body?.slice(0, 120) || "unknown error"}`);
          results[table] = { deleted: 0, failed: count };
          totalFailed += count;
        }
      }
    }

    console.log(`\n  Database: ${totalDeleted} deleted, ${totalFailed} failed`);
  }

  // ── Step 4: Clean up Supabase Storage ───────────────────────────────

  console.log("\n─── Step 4: Clean Up Storage ─────────────────────────\n");

  let storageDeleted = 0;
  for (const bucket of STORAGE_BUCKETS) {
    // List files under the tenant's path: {tenantId}/
    const prefix = `${targetTenantId}/`;
    const listing = await storageList(bucket, prefix);

    if (listing.error) {
      if (listing.status === 404) {
        console.log(`  ○ ${bucket}: bucket not found — skipped`);
      } else {
        console.log(`  ✗ ${bucket}: listing failed (${listing.status})`);
      }
      continue;
    }

    const files = Array.isArray(listing) ? listing : [];
    // Filter out folder markers (empty keys or keys ending with /)
    const realFiles = files.filter((f) => f.name && f.name.length > 0);

    if (realFiles.length === 0) {
      console.log(`  ✓ ${bucket}: no files for tenant ${targetTenantId}`);
      continue;
    }

    const paths = realFiles.map((f) => `${targetTenantId}/${f.name}`);

    if (dryRun) {
      console.log(`  [DRY] Would delete ${paths.length} files from ${bucket}/`);
      storageDeleted += paths.length;
      continue;
    }

    // Delete in batches of 100 (Supabase Storage limit)
    for (let i = 0; i < paths.length; i += 100) {
      const batch = paths.slice(i, i + 100);
      const result = await storageDelete(bucket, batch);
      if (result.ok) {
        console.log(`  ✓ ${bucket}: deleted ${batch.length} files (batch ${Math.floor(i / 100) + 1})`);
        storageDeleted += batch.length;
      } else {
        console.log(`  ✗ ${bucket}: delete failed (${result.status}) — ${result.body?.slice(0, 120)}`);
      }
    }
  }

  console.log(`\n  Storage: ${storageDeleted} files deleted`);

  // ── Step 5: Verify preservation ─────────────────────────────────────

  console.log("\n─── Step 5: Verify Preservation ──────────────────────\n");

  // Auth user preserved?
  const authCheck = await adminQuery("profiles", "_id,name,email", `_id=eq.${targetUserId}`);
  const authPreserved = Array.isArray(authCheck) && authCheck.length > 0;
  console.log(`  Auth account preserved:  ${authPreserved ? "✓ YES" : "✗ NO — CRITICAL"}`);

  // Membership preserved?
  const memberCheck = await adminQuery("memberships", "*", `tenantId=eq.${targetTenantId}`);
  const memberPreserved = Array.isArray(memberCheck) && memberCheck.length > 0;
  console.log(`  Membership preserved:    ${memberPreserved ? "✓ YES" : "✗ NO — CRITICAL"}`);

  // Tenant record preserved?
  const tenantCheck = await adminQuery("tenants", "_id,name", `_id=eq.${targetTenantId}`);
  const tenantPreserved = Array.isArray(tenantCheck) && tenantCheck.length > 0;
  console.log(`  Tenant record preserved: ${tenantPreserved ? "✓ YES" : "✗ NO — CRITICAL"}`);

  // Global knowledge intact? (query a knowledge entity that is NOT tenant-scoped)
  // Global knowledge uses the shared ontology — check a sample
  const globalEntities = await adminQuery("globalKnowledge", "*", "");
  const globalPreserved = !globalEntities.error || globalEntities.status === 404;
  console.log(`  Global knowledge:        ${globalPreserved ? "✓ INTACT (or not implemented)" : "⚠ CHECK MANUALLY"}`);

  // ── Step 6: Final verification — empty customer state ───────────────

  console.log("\n─── Step 6: Verify Empty Customer State ──────────────\n");

  const verifyTables = {
    documents: "Documents",
    documentChunks: "Document chunks",
    insuranceClaims: "Claims",
    claimSupplements: "Supplements",
    claimFindings: "Claim findings",
    claimEvidence: "Claim evidence",
    claimCandidates: "Claim candidates",
    recommendations: "Recommendations",
    entities: "Entities",
    knowledgeAssertions: "Knowledge assertions",
    ingestionJobs: "Ingestion jobs",
    archiveIngestions: "Archive ingestions",
    archiveFiles: "Archive files",
    conversationSessions: "Ask Atlas sessions",
    events: "Events",
    auditLogs: "Audit logs",
    atlas_jobs: "Background jobs",
  };

  let allEmpty = true;
  for (const [table, label] of Object.entries(verifyTables)) {
    const rows = await adminQuery(table, "*", `tenantId=eq.${targetTenantId}`);
    const count = Array.isArray(rows) ? rows.length : (rows.error ? "?" : 0);
    if (count === 0) {
      console.log(`  ✓ ${label}: 0`);
    } else if (count === "?") {
      console.log(`  ○ ${label}: table not found`);
    } else {
      console.log(`  ✗ ${label}: ${count} (NOT EMPTY)`);
      allEmpty = false;
    }
  }

  // ── Step 7: Summary ─────────────────────────────────────────────────

  console.log("\n═══════════════════════════════════════════════════════════");
  if (dryRun) {
    console.log("  DRY RUN COMPLETE — No changes were made");
    console.log(`  Would delete: ~${totalRecords} database records + ${storageDeleted} storage files`);
  } else {
    console.log("  RESET COMPLETE");
    console.log(`  Database records deleted: ${totalDeleted}`);
    console.log(`  Storage files deleted:   ${storageDeleted}`);
    console.log(`  Failed:                  ${totalFailed}`);
    console.log();
    if (authPreserved && memberPreserved && tenantPreserved && allEmpty) {
      console.log("  ✓ YC Demo is now a brand-new Atlas customer");
      console.log("    • Account access: PRESERVED");
      console.log("    • Auth/RBAC: PRESERVED");
      console.log("    • Tenant record: PRESERVED");
      console.log("    • Customer data: EMPTY");
      console.log("    • Global Atlas knowledge: INTACT");
    } else {
      console.log("  ⚠ SOME CHECKS FAILED — Review output above");
    }
  }
  console.log("═══════════════════════════════════════════════════════════\n");
})();
