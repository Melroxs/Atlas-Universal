// ---------------------------------------------------------------------------
// Atlas demo/test data reset against the live Supabase project.
//
//   node scripts/reset-demo-data.mjs            # dry run: inventory only
//   node scripts/reset-demo-data.mjs --apply    # delete the data
//
// Deletes ONLY data — never schema, tables, RPCs, triggers, indexes, RLS
// policies, storage buckets or Edge Functions. Keeps the global reference
// catalogs (intelligencePacks/items, authoritativeSources/Knowledge) because
// the app re-seeds them at runtime.
//
// Credentials come from .env.local (never printed): SUPABASE_ACCESS_TOKEN
// drives the Management API SQL endpoint (runs as postgres, exactly like the
// SQL editor) and SUPABASE_SERVICE_ROLE_KEY drives the Storage API (direct
// deletes from storage.* are blocked by Supabase; objects must go through the
// Storage API).
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "ibxvzxblyhzwokljkslt";
const BASE = `https://${PROJECT_REF}.supabase.co`;

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
  } catch {
    /* missing */
  }
  return out;
}

const env = parseEnvFile(".env.local");
const TOKEN = env.SUPABASE_ACCESS_TOKEN;
const SERVICE_ROLE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!TOKEN) throw new Error("SUPABASE_ACCESS_TOKEN missing from .env.local");
if (!SERVICE_ROLE) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing from .env.local");

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    throw new Error(`SQL failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
  }
  return res.json();
}

async function storageApi(path, method, body) {
  const res = await fetch(`${BASE}/storage/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Storage API ${path} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// Every tenant-scoped / application table. Global reference catalogs
// (intelligencePacks, intelligenceItems, authoritativeSources,
// authoritativeKnowledge) are intentionally NOT included — the app re-seeds
// them at runtime and they contain no company data.
const APP_TABLES = [
  "profiles", "tenants", "memberships", "invites",
  "companyProfiles", "companySystems", "tenantPacks",
  "documents", "documentChunks", "ingestionJobs",
  "entities", "entityRelationships", "knowledgeAssertions",
  "askSessions", "askEvidence",
  "recommendations", "recommendationEvidence",
  "connections", "connectionTokens",
  "toolActions",
  "events", "notifications", "eventPolicies",
  "workflowSettings", "workflowInstances", "workflowSteps", "workflowApprovals",
  "organizationContexts", "operatingLocations",
  "impactAssessments",
  "auditLogs", "conversationSessions",
  "insuranceClaims", "claimFindings", "claimSupplements", "claimCandidates",
  "archiveIngestions", "archiveFiles",
];

async function counts() {
  const perTable = await sql(
    APP_TABLES.map((t) => `(select '${t}' as tbl, count(*) as n from public.${t})`).join(" union all "),
  );
  const [authUsers, storageObjects, storageBuckets, rlsCount, tableCount] = await Promise.all([
    sql("select count(*) as n from auth.users"),
    // Current objects only — Supabase keeps tombstone rows (version <> '')
    // for deleted versions; those are internal bookkeeping, not uploaded files.
    sql("select count(*) as n from storage.objects where version = '' or version is null"),
    sql("select count(*) as n from storage.buckets"),
    sql("select count(*) as n from pg_tables t where t.schemaname = 'public' and t.rowsecurity"),
    sql("select count(*) as n from pg_tables t where t.schemaname = 'public'"),
  ]);
  return { perTable, authUsers, storageObjects, storageBuckets, rlsCount, tableCount };
}

const n = (c, name) => Number(c.perTable.find((r) => r.tbl === name)?.n ?? 0);

console.log(`Atlas demo-data reset (${APPLY ? "APPLY" : "DRY RUN"}) — project ${PROJECT_REF}\n`);
const before = await counts();

console.log("Pre-flight inventory:");
const nonZero = APP_TABLES.filter((t) => n(before, t) > 0);
console.log(`  app tables with rows: ${nonZero.length}/${APP_TABLES.length}`);
for (const t of nonZero) console.log(`    ${t}: ${n(before, t)}`);
console.log(`  auth.users:      ${before.authUsers[0].n}`);
console.log(`  storage.objects: ${before.storageObjects[0].n} (buckets: ${before.storageBuckets[0].n})`);
console.log(`  public tables:   ${before.tableCount[0].n} (RLS enabled on ${before.rlsCount[0].n})\n`);

if (!APPLY) {
  console.log("DRY RUN — no data was deleted. Re-run with --apply to reset.");
  process.exit(0);
}

const failures = [];

// Phase 1 — application tables (single transaction; rolls back on any error).
await sql(
  `begin;
   truncate table ${APP_TABLES.map((t) => `public.${t}`).join(", ")} cascade;
   commit;`,
);
console.log("Phase 1: app tables truncated.");

// Phase 2 — storage objects via the Storage API (direct storage deletes are
// blocked by Supabase to prevent orphaned objects).
const buckets = await storageApi("bucket", "GET");
let objectsRemoved = 0;
for (const bucket of buckets) {
  let offset = 0;
  for (;;) {
    const objects = await storageApi(`object/list/${bucket.name}`, "POST", {
      prefix: "",
      limit: 1000,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (objects.length === 0) break;
    const names = objects.map((o) => o.name);
    try {
      await storageApi(`object/${bucket.name}/remove`, "POST", { prefixes: names });
      objectsRemoved += names.length;
    } catch (e) {
      // Idempotency: re-running a reset may race tombstones and get
      // KeyAlreadyExists for already-removed objects — treat as removed.
      const msg = String(e);
      if (msg.includes("KeyAlreadyExists")) {
        objectsRemoved += names.length;
      } else {
        throw e;
      }
    }
    if (names.length < 1000) break;
    offset += names.length;
  }
}
console.log(`Phase 2: removed ${objectsRemoved} storage objects across ${buckets.length} buckets (buckets kept).`);

// Phase 3 — auth users (cascades auth.identities/sessions/refresh tokens;
// profiles were truncated in phase 1).
await sql("delete from auth.users;");
console.log("Phase 3: auth users deleted.\n");

// Verification.
const after = await counts();
for (const t of APP_TABLES) {
  const count = n(after, t);
  if (count !== 0) failures.push(`${t}=${count}`);
}
if (after.authUsers[0].n !== 0) failures.push(`auth.users=${after.authUsers[0].n}`);
if (after.storageObjects[0].n !== 0) failures.push(`storage.objects=${after.storageObjects[0].n}`);
if (after.storageBuckets[0].n !== before.storageBuckets[0].n) failures.push("storage buckets removed (should be kept)");
if (after.rlsCount[0].n !== after.tableCount[0].n) failures.push("RLS coverage changed");
if (after.tableCount[0].n !== before.tableCount[0].n) failures.push("table count changed");

console.log("Post-flight verification:");
console.log(`  app tables with rows: ${APP_TABLES.filter((t) => n(after, t) > 0).length}/${APP_TABLES.length}`);
console.log(`  auth.users:      ${after.authUsers[0].n}`);
console.log(`  storage.objects: ${after.storageObjects[0].n} (buckets kept: ${after.storageBuckets[0].n})`);
console.log(`  public tables:   ${after.tableCount[0].n} (RLS on ${after.rlsCount[0].n})`);

if (failures.length > 0) {
  console.error(`\nRESET VERIFICATION FAILED: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nRESET VERIFIED: zero application data remains; schema, RLS, buckets and catalogs intact.");
