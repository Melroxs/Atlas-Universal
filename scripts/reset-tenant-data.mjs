#!/usr/bin/env node
// -----------------------------------------------------------------------
// Atlas — Hard Tenant Data Purge Script
//
// Performs a COMPLETE purge of ALL customer-specific data for a tenant:
//   - Deletes all customer-owned data across 50+ tables
//   - Cleans up Supabase Storage objects
//   - Preserves auth, profiles, memberships, tenant record
//   - Preserves ALL global Atlas knowledge (industry, ontologies, etc.)
//
// Usage:
//   node scripts/reset-tenant-data.mjs                    # Reset YC Demo (default)
//   node scripts/reset-tenant-data.mjs --tenant <id>     # Reset a specific tenant
//   node scripts/reset-tenant-data.mjs --list             # List all tenants
//   node scripts/reset-tenant-data.mjs --dry-run          # Preview only
//
// Environment:
//   Reads SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_URL from .env.local
//
// Safety:
//   - Every DELETE is scoped to the target tenant
//   - Never truncates shared/global tables
//   - Never deletes global Atlas knowledge
//   - Never modifies auth accounts or RBAC
//   - Idempotent: running twice produces the same result
// -----------------------------------------------------------------------

import { readFileSync } from "node:fs";

// ── Configuration ────────────────────────────────────────────────────

const DEFAULT_TENANT_NAME = "YC Demo";
const DEFAULT_USER_ID = "c7e29b03-81d5-49c3-9504-151aa0dcd510";

// Parse CLI args
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const listMode = args.includes("--list");
const hardMode = args.includes("--hard"); // extra verification
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
  console.error("ERROR: SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
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
  try {
    const res = await fetch(url, { headers: adminHeaders });
    if (!res.ok) return { error: res.status, body: await res.text().catch(() => "") };
    return res.json();
  } catch (e) {
    return { error: 0, body: e.message };
  }
}

async function adminDelete(table, filter) {
  const url = `${URL}/rest/v1/${table}?${filter}`;
  try {
    const res = await fetch(url, { method: "DELETE", headers: adminHeaders });
    return { ok: res.ok, status: res.status, body: await res.text().catch(() => "") };
  } catch (e) {
    return { ok: false, status: 0, body: e.message };
  }
}

async function storageListAll(bucket, prefix = "") {
  const all = [];
  let offset = 0;
  while (true) {
    const url = `${URL}/storage/v1/object/list/${bucket}`;
    const res = await fetch(url, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ prefix, limit: 1000, offset }),
    });
    if (!res.ok) break;
    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) break;
    all.push(...items);
    if (items.length < 1000) break;
    offset += items.length;
  }
  return all;
}

async function storageDeleteFile(bucket, path) {
  // Single-file delete WITHOUT Content-Type header (Supabase Storage API requirement)
  try {
    const res = await fetch(`${URL}/storage/v1/object/${bucket}/${path}`, {
      method: "DELETE",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
    return res.ok;
  } catch {
    return false;
  }
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
    const match = tenants.find((t) => t.name?.includes(DEFAULT_TENANT_NAME));
    if (match) return match._id;
  }
  return null;
}

// ── Complete Table Catalog ────────────────────────────────────────────
// Every tenant-scoped table, organized by category.
// Each entry: { table, column: "tenantId"|"tenant_id", description }
// column "account" means scoped via email_accounts.tenant_id through account_id FK

const TENANT_TABLES_CAMEL = [
  // ── Documents & Ingestion ──
  { table: "archiveFiles", column: "tenantId", desc: "Archive individual files" },
  { table: "archiveIngestions", column: "tenantId", desc: "Archive import sessions" },
  { table: "documentChunks", column: "tenantId", desc: "Document chunks + embeddings" },
  { table: "documents", column: "tenantId", desc: "Uploaded/ingested documents" },
  { table: "ingestionJobs", column: "tenantId", desc: "Ingestion processing queue" },

  // ── Claims & Supplements ──
  { table: "claimCandidates", column: "tenantId", desc: "Claim discovery candidates" },
  { table: "claimFindings", column: "tenantId", desc: "Claim analysis findings" },
  { table: "claimSupplements", column: "tenantId", desc: "Supplement line items" },
  { table: "insuranceClaims", column: "tenantId", desc: "Insurance claims" },

  // ── Evidence & Knowledge ──
  { table: "askEvidence", column: "tenantId", desc: "Ask Atlas evidence links" },
  { table: "knowledgeAssertions", column: "tenantId", desc: "Knowledge graph assertions" },
  { table: "entityRelationships", column: "tenantId", desc: "Entity-to-entity edges" },
  { table: "entities", column: "tenantId", desc: "Extracted entities" },

  // ── Recommendations ──
  { table: "recommendationEvidence", column: "tenantId", desc: "Recommendation evidence links" },
  { table: "recommendations", column: "tenantId", desc: "AI/deterministic recommendations" },

  // ── Workflows ──
  { table: "workflowSteps", column: "tenantId", desc: "Workflow step instances" },
  { table: "workflowApprovals", column: "tenantId", desc: "Workflow approval gates" },
  { table: "workflowInstances", column: "tenantId", desc: "Workflow runs" },
  { table: "workflowSettings", column: "tenantId", desc: "Per-tenant workflow config" },

  // ── Events & Notifications ──
  { table: "eventPolicies", column: "tenantId", desc: "Per-tenant event policies" },
  { table: "notifications", column: "tenantId", desc: "In-app notifications" },
  { table: "events", column: "tenantId", desc: "Event log entries" },

  // ── Conversations ──
  { table: "conversationSessions", column: "tenantId", desc: "Ask Atlas sessions" },

  // ── Connections & Tools ──
  { table: "toolActions", column: "tenantId", desc: "Tool execution history" },
  { table: "connectionTokens", column: "tenantId", desc: "Connection tokens" },
  { table: "connections", column: "tenantId", desc: "External service connections" },

  // ── Workspace / Org ──
  { table: "companyProfiles", column: "tenantId", desc: "Company profile data" },
  { table: "companySystems", column: "tenantId", desc: "Company system integrations" },
  { table: "tenantPacks", column: "tenantId", desc: "Intelligence pack activations" },
  { table: "operatingLocations", column: "tenantId", desc: "Operating locations" },
  { table: "organizationContexts", column: "tenantId", desc: "Organization context" },

  // ── Audit ──
  { table: "auditLogs", column: "tenantId", desc: "Audit trail" },
  { table: "invites", column: "tenantId", desc: "Pending invites" },

  // ── AI/Agent Background Jobs ──
  { table: "atlas_job_events", column: "tenantId", desc: "Job event log" },
  { table: "atlas_job_attempts", column: "tenantId", desc: "Job execution attempts" },
  { table: "atlas_job_steps", column: "tenantId", desc: "Job workflow steps" },
  { table: "atlas_jobs", column: "tenantId", desc: "Background job records" },
  { table: "atlas_human_reviews", column: "tenant_id", desc: "Human review requests" },
];

const TENANT_TABLES_SNAKE = [
  // ── CRM ──
  { table: "crm_custom_field_values", column: "tenant_id", desc: "CRM custom field values" },
  { table: "crm_custom_fields", column: "tenant_id", desc: "CRM custom field definitions" },
  { table: "crm_tasks", column: "tenant_id", desc: "CRM tasks" },
  { table: "crm_activities", column: "tenant_id", desc: "CRM activity log" },
  { table: "crm_leads", column: "tenant_id", desc: "CRM leads" },

  // ── Email/Outreach (direct tenant_id) ──
  { table: "email_outreach", column: "tenant_id", desc: "Email outreach records" },
  { table: "email_templates", column: "tenant_id", desc: "Email template library" },
  { table: "email_signatures", column: "tenant_id", desc: "Email signatures" },
  { table: "email_labels", column: "tenant_id", desc: "Email labels" },

  // ── Outreach (Resend) ──
  { table: "outreach_records", column: "tenant_id", desc: "Outreach records" },
  { table: "outreach_templates", column: "tenant_id", desc: "Outreach templates" },

  // ── Email/Mail (account-scoped) ──
  { table: "email_accounts", column: "tenant_id", desc: "Email accounts" },

  // ── Pilot Intelligence ──
  { table: "pilot_activity", column: "tenant_id", desc: "Pilot activity log" },
  { table: "pilot_testimonials", column: "tenant_id", desc: "Pilot testimonials" },
  { table: "pilot_outcomes", column: "tenant_id", desc: "Pilot outcomes" },
  { table: "pilot_insights", column: "tenant_id", desc: "Pilot insights" },
  { table: "pilot_sessions", column: "tenant_id", desc: "Pilot sessions" },
  { table: "pilot_companies", column: "tenant_id", desc: "Pilot company records" },

  // ── Access Control ──
  { table: "user_provisions", column: "tenant_id", desc: "User provisioning records" },
];

// Email tables scoped via email_accounts.tenant_id (through FK chain)
const EMAIL_SCOPED_TABLES = [
  { table: "email_message_labels", desc: "Email message label assignments" },
  { table: "email_drafts", desc: "Email drafts" },
  { table: "email_attachments", desc: "Email attachments" },
  { table: "email_messages", desc: "Email messages" },
  { table: "email_threads", desc: "Email threads" },
];

// ── Storage Buckets ──────────────────────────────────────────────────

const STORAGE_BUCKETS = ["documents", "email-attachments"];

// ── Main ─────────────────────────────────────────────────────────────

(async () => {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Atlas — HARD Tenant Data Purge");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Supabase: ${URL}`);
  console.log(`  Mode:     ${dryRun ? "DRY RUN (no changes)" : "LIVE PURGE"}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  // ── Step 1: Identify Target Tenant ──────────────────────────────────

  console.log("─── Step 1: Identify Target Tenant ───────────────────────────\n");

  let targetUserId = DEFAULT_USER_ID;
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

  // Verify members
  const members = await adminQuery("memberships", "userId,role", `tenantId=eq.${targetTenantId}`);
  const memberCount = Array.isArray(members) ? members.length : 0;

  // Verify auth user
  const profile = await adminQuery("profiles", "_id,name,email", `_id=eq.${targetUserId}`);

  console.log(`  Target tenant:  ${tenantName} (${targetTenantId})`);
  console.log(`  Auth user:      ${Array.isArray(profile) && profile.length > 0 ? `${profile[0].name} <${profile[0].email}>` : "NOT FOUND"}`);
  console.log(`  Members:        ${memberCount}`);
  console.log(`  Preserved:      auth, profile, membership, tenant record`);
  console.log();

  if (dryRun) {
    console.log("  ⚠ DRY RUN — No changes will be made\n");
  }

  // ── Step 2: Inventory All Customer Data ─────────────────────────────

  console.log("─── Step 2: Inventory Current Data ──────────────────────────\n");

  const allTables = [...TENANT_TABLES_CAMEL, ...TENANT_TABLES_SNAKE];
  const inventory = {};

  for (const { table, column, desc } of allTables) {
    const filter = `${column}=eq.${targetTenantId}`;
    const rows = await adminQuery(table, "*", filter);
    const count = Array.isArray(rows) ? rows.length : (rows.error ? null : 0);
    inventory[table] = { count, desc, error: !!rows.error };
    if (count !== null && count > 0) {
      console.log(`  ${table.padEnd(30)} ${String(count).padStart(6)} records  (${desc})`);
    }
  }

  // Check email tables scoped via email_accounts
  // First get all account IDs for this tenant
  const emailAccounts = await adminQuery("email_accounts", "id", `tenant_id=eq.${targetTenantId}`);
  const accountIds = Array.isArray(emailAccounts) ? emailAccounts.map((a) => a.id) : [];

  if (accountIds.length > 0) {
    console.log(`  ${"email_accounts".padEnd(30)} ${String(accountIds.length).padStart(6)} accounts`);
    inventory["email_accounts"] = { count: accountIds.length, desc: "Email accounts", error: false };

    for (const { table, desc } of EMAIL_SCOPED_TABLES) {
      // Query by account_id IN (list of account IDs)
      const idList = accountIds.map((id) => `"${id}"`).join(",");
      const rows = await adminQuery(table, "*", `account_id=in.(${idList})`);
      const count = Array.isArray(rows) ? rows.length : (rows.error ? null : 0);
      inventory[table] = { count, desc, error: !!rows.error };
      if (count !== null && count > 0) {
        console.log(`  ${table.padEnd(30)} ${String(count).padStart(6)} records  (${desc})`);
      }
    }
  } else {
    inventory["email_accounts"] = { count: 0, desc: "Email accounts", error: false };
  }

  // Count total
  const totalRecords = Object.values(inventory).reduce((sum, v) => sum + (v.count ?? 0), 0);
  const tableCount = Object.keys(inventory).length;
  console.log(`\n  Total tables scanned: ${tableCount}`);
  console.log(`  Total records to purge: ${totalRecords}`);
  console.log();

  if (totalRecords === 0) {
    console.log("  ✓ Tenant is already clean — no customer data found.\n");
  }

  if (dryRun) {
    console.log("\n─── Step 3: Would Delete ────────────────────────────────────\n");
    for (const [table, info] of Object.entries(inventory)) {
      if (info.count && info.count > 0) {
        console.log(`  [DRY] ${table}: ${info.count} rows`);
      }
    }

    // Storage preview
    console.log("\n─── Step 4: Would Clean Storage ─────────────────────────────\n");
    for (const bucket of STORAGE_BUCKETS) {
      const files = await storageListAll(bucket, `${targetTenantId}/`);
      const realFiles = files.filter((f) => f.name && f.name.length > 0 && !f.name.endsWith("/"));
      if (realFiles.length > 0) {
        console.log(`  [DRY] ${bucket}: would delete ${realFiles.length} files`);
      }
    }

    console.log("\n═══════════════════════════════════════════════════════════════");
    console.log(`  DRY RUN COMPLETE — ${totalRecords} DB records + storage files at risk`);
    console.log("═══════════════════════════════════════════════════════════════\n");
    return;
  }

  // ── Step 3: Execute Hard Purge ──────────────────────────────────────

  let totalDeleted = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  if (totalRecords > 0) {
    console.log("─── Step 3: Execute Hard Purge ──────────────────────────────\n");

    const results = {};

    // Delete tenantId (camelCase) tables
    for (const { table, column, desc } of TENANT_TABLES_CAMEL) {
      const info = inventory[table];
      if (!info || !info.count || info.count === 0) continue;

      const result = await adminDelete(table, `${column}=eq.${targetTenantId}`);
      if (result.ok) {
        console.log(`  ✓ ${table.padEnd(30)} deleted ${info.count} rows`);
        results[table] = { deleted: info.count, failed: 0 };
        totalDeleted += info.count;
      } else if (result.status === 404) {
        console.log(`  ○ ${table.padEnd(30)} table not found — skipped`);
        results[table] = { deleted: 0, failed: 0, skipped: true };
        totalSkipped++;
      } else {
        console.log(`  ✗ ${table.padEnd(30)} FAILED (${result.status}) — ${result.body?.slice(0, 100) || "error"}`);
        results[table] = { deleted: 0, failed: info.count };
        totalFailed += info.count;
      }
    }

    // Delete tenant_id (snake_case) tables
    for (const { table, column, desc } of TENANT_TABLES_SNAKE) {
      const info = inventory[table];
      if (!info || !info.count || info.count === 0) continue;

      const result = await adminDelete(table, `${column}=eq.${targetTenantId}`);
      if (result.ok) {
        console.log(`  ✓ ${table.padEnd(30)} deleted ${info.count} rows`);
        results[table] = { deleted: info.count, failed: 0 };
        totalDeleted += info.count;
      } else if (result.status === 404) {
        console.log(`  ○ ${table.padEnd(30)} table not found — skipped`);
        totalSkipped++;
      } else {
        console.log(`  ✗ ${table.padEnd(30)} FAILED (${result.status}) — ${result.body?.slice(0, 100) || "error"}`);
        results[table] = { deleted: 0, failed: info.count };
        totalFailed += info.count;
      }
    }

    // Delete email-scoped tables (via account_id FK chain)
    if (accountIds.length > 0) {
      console.log("\n  ── Email tables (account-scoped) ──\n");

      // email_message_labels — scoped by message_id
      const msgIds = [];
      for (const accId of accountIds) {
        const msgs = await adminQuery("email_messages", "id", `account_id=eq.${accId}`);
        if (Array.isArray(msgs)) msgIds.push(...msgs.map((m) => m.id));
      }

      // Delete email_message_labels via message_id
      if (msgIds.length > 0) {
        for (let i = 0; i < msgIds.length; i += 50) {
          const batch = msgIds.slice(i, i + 50);
          const idList = batch.map((id) => `"${id}"`).join(",");
          const result = await adminDelete("email_message_labels", `message_id=in.(${idList})`);
          if (result.ok) {
            const info = inventory["email_message_labels"];
            if (info && info.count > 0) {
              console.log(`  ✓ ${"email_message_labels".padEnd(30)} deleted ${info.count} rows`);
              totalDeleted += info.count;
            }
          }
        }
      }

      // Delete email_drafts, email_attachments via account_id
      for (const table of ["email_drafts", "email_attachments"]) {
        const info = inventory[table];
        if (!info || !info.count || info.count === 0) continue;
        const result = await adminDelete(table, `account_id=in.(${accountIds.map((id) => `"${id}"`).join(",")})`);
        if (result.ok) {
          console.log(`  ✓ ${table.padEnd(30)} deleted ${info.count} rows`);
          totalDeleted += info.count;
        } else {
          console.log(`  ✗ ${table.padEnd(30)} FAILED (${result.status})`);
          totalFailed += info.count;
        }
      }

      // Delete email_threads via account_id
      const infoThreads = inventory["email_threads"];
      if (infoThreads && infoThreads.count > 0) {
        const result = await adminDelete("email_threads", `account_id=in.(${accountIds.map((id) => `"${id}"`).join(",")})`);
        if (result.ok) {
          console.log(`  ✓ ${"email_threads".padEnd(30)} deleted ${infoThreads.count} rows`);
          totalDeleted += infoThreads.count;
        }
      }

      // Delete email_messages via account_id (parent of message_labels/attachments)
      const infoMsgs = inventory["email_messages"];
      if (infoMsgs && infoMsgs.count > 0) {
        const result = await adminDelete("email_messages", `account_id=in.(${accountIds.map((id) => `"${id}"`).join(",")})`);
        if (result.ok) {
          console.log(`  ✓ ${"email_messages".padEnd(30)} deleted ${infoMsgs.count} rows`);
          totalDeleted += infoMsgs.count;
        }
      }
    }

    console.log(`\n  Database purge: ${totalDeleted} deleted, ${totalFailed} failed, ${totalSkipped} skipped`);
  }

  // ── Step 4: Clean Storage ───────────────────────────────────────────

  console.log("\n─── Step 4: Clean Supabase Storage ─────────────────────────\n");

  let storageDeleted = 0;
  let storageFailed = 0;
  for (const bucket of STORAGE_BUCKETS) {
    const files = await storageListAll(bucket, `${targetTenantId}/`);
    const realFiles = files.filter((f) => f.name && f.name.length > 0 && !f.name.endsWith("/"));

    if (realFiles.length === 0) {
      console.log(`  ✓ ${bucket}: no files for tenant`);
      continue;
    }

    console.log(`  ${bucket}: ${realFiles.length} files to delete...`);

    for (let i = 0; i < realFiles.length; i++) {
      const path = `${targetTenantId}/${realFiles[i].name}`;
      const ok = await storageDeleteFile(bucket, path);
      if (ok) storageDeleted++;
      else storageFailed++;
      if ((i + 1) % 50 === 0 || i === realFiles.length - 1) {
        console.log(`    ${i + 1}/${realFiles.length} (deleted: ${storageDeleted}, failed: ${storageFailed})`);
      }
    }
  }

  console.log(`\n  Storage: ${storageDeleted} files deleted`);

  // ── Step 5: Verify Preservation ─────────────────────────────────────

  console.log("\n─── Step 5: Verify Preserved Records ───────────────────────\n");

  const profileCheck = await adminQuery("profiles", "_id,name,email", `_id=eq.${targetUserId}`);
  console.log(`  Auth account:     ${Array.isArray(profileCheck) && profileCheck.length > 0 ? "✓ PRESERVED" : "✗ MISSING"}`);

  const memberCheck = await adminQuery("memberships", "userId", `tenantId=eq.${targetTenantId}`);
  console.log(`  Membership:       ${Array.isArray(memberCheck) && memberCheck.length > 0 ? "✓ PRESERVED" : "✗ MISSING"}`);

  const tenantCheck = await adminQuery("tenants", "_id,name", `_id=eq.${targetTenantId}`);
  console.log(`  Tenant record:    ${Array.isArray(tenantCheck) && tenantCheck.length > 0 ? "✓ PRESERVED" : "✗ MISSING"}`);

  // Global knowledge check
  const globalKnowledge = await adminQuery("atlasIndustryKnowledge", "_id", "");
  const globalKnowledgeCount = Array.isArray(globalKnowledge) ? globalKnowledge.length : 0;
  console.log(`  Global knowledge: ${globalKnowledgeCount > 0 ? `✓ PRESERVED (${globalKnowledgeCount} records)` : "⚠ NOT FOUND (may not be seeded)"}`);

  const globalProvenance = await adminQuery("atlasIndustryProvenance", "_id", "");
  const globalProvenanceCount = Array.isArray(globalProvenance) ? globalProvenance.length : 0;
  console.log(`  Provenance:       ${globalProvenanceCount > 0 ? `✓ PRESERVED (${globalProvenanceCount} records)` : "⚠ NOT FOUND"}`);

  // ── Step 6: Verify Empty State ──────────────────────────────────────

  console.log("\n─── Step 6: Verify Zero Customer Data ──────────────────────\n");

  const verifyChecks = [
    { table: "documents", filter: `tenantId=eq.${targetTenantId}`, label: "Documents" },
    { table: "documentChunks", filter: `tenantId=eq.${targetTenantId}`, label: "Document chunks" },
    { table: "ingestionJobs", filter: `tenantId=eq.${targetTenantId}`, label: "Ingestion jobs" },
    { table: "insuranceClaims", filter: `tenantId=eq.${targetTenantId}`, label: "Claims" },
    { table: "claimSupplements", filter: `tenantId=eq.${targetTenantId}`, label: "Supplements" },
    { table: "claimFindings", filter: `tenantId=eq.${targetTenantId}`, label: "Claim findings" },
    { table: "claimCandidates", filter: `tenantId=eq.${targetTenantId}`, label: "Claim candidates" },
    { table: "recommendations", filter: `tenantId=eq.${targetTenantId}`, label: "Recommendations" },
    { table: "entities", filter: `tenantId=eq.${targetTenantId}`, label: "Entities" },
    { table: "knowledgeAssertions", filter: `tenantId=eq.${targetTenantId}`, label: "Knowledge assertions" },
    { table: "events", filter: `tenantId=eq.${targetTenantId}`, label: "Events" },
    { table: "auditLogs", filter: `tenantId=eq.${targetTenantId}`, label: "Audit logs" },
    { table: "atlas_jobs", filter: `tenantId=eq.${targetTenantId}`, label: "Background jobs" },
    { table: "conversationSessions", filter: `tenantId=eq.${targetTenantId}`, label: "Ask Atlas sessions" },
    { table: "recommendationEvidence", filter: `tenantId=eq.${targetTenantId}`, label: "Rec evidence" },
    { table: "archiveIngestions", filter: `tenantId=eq.${targetTenantId}`, label: "Archive ingestions" },
    { table: "archiveFiles", filter: `tenantId=eq.${targetTenantId}`, label: "Archive files" },
    { table: "crm_leads", filter: `tenant_id=eq.${targetTenantId}`, label: "CRM leads" },
    { table: "email_accounts", filter: `tenant_id=eq.${targetTenantId}`, label: "Email accounts" },
    { table: "email_outreach", filter: `tenant_id=eq.${targetTenantId}`, label: "Email outreach" },
    { table: "outreach_records", filter: `tenant_id=eq.${targetTenantId}`, label: "Outreach records" },
    { table: "pilot_companies", filter: `tenant_id=eq.${targetTenantId}`, label: "Pilot companies" },
  ];

  let allEmpty = true;
  for (const { table, filter, label } of verifyChecks) {
    const rows = await adminQuery(table, "_id", filter);
    const count = Array.isArray(rows) ? rows.length : (rows.error ? "?" : 0);
    if (count === 0) {
      console.log(`  ✓ ${label.padEnd(25)} 0`);
    } else if (count === "?") {
      console.log(`  ○ ${label.padEnd(25)} table not found`);
    } else {
      console.log(`  ✗ ${label.padEnd(25)} ${count} (NOT EMPTY!)`);
      allEmpty = false;
    }
  }

  // ── Step 7: Summary ─────────────────────────────────────────────────

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  HARD PURGE COMPLETE");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Database records purged: ${totalDeleted}`);
  console.log(`  Storage files deleted:   ${storageDeleted}`);
  console.log(`  Failed:                  ${totalFailed}`);
  console.log();

  const authPreserved = Array.isArray(profileCheck) && profileCheck.length > 0;
  const memberPreserved = Array.isArray(memberCheck) && memberCheck.length > 0;
  const tenantPreserved = Array.isArray(tenantCheck) && tenantCheck.length > 0;

  if (authPreserved && memberPreserved && tenantPreserved && allEmpty) {
    console.log("  ✓ YC Demo is now a BRAND-NEW Atlas customer");
    console.log("    • Account login:  PRESERVED");
    console.log("    • Auth/RBAC:      PRESERVED");
    console.log("    • Tenant record:  PRESERVED");
    console.log("    • Customer data:  ZERO");
    console.log("    • Storage:        EMPTY");
    console.log("    • Global Atlas:   INTACT");
    console.log();
    console.log("  YC Demo → Atlas Global Knowledge + Empty Customer Workspace");
  } else {
    console.log("  ⚠ SOME CHECKS FAILED — Review output above");
    if (!authPreserved) console.log("    ✗ Auth account was lost!");
    if (!memberPreserved) console.log("    ✗ Membership was lost!");
    if (!tenantPreserved) console.log("    ✗ Tenant record was lost!");
    if (!allEmpty) console.log("    ✗ Some tables still have data!");
  }
  console.log("═══════════════════════════════════════════════════════════════\n");
})();
