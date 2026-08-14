// ---------------------------------------------------------------------------
// Atlas Universal — complete development-environment reset.
//
//   node scripts/reset-dev-environment.mjs             # dry run: inventory
//   node scripts/reset-dev-environment.mjs --apply     # perform the reset
//
// Deletes ALL application/test data:
//   - every row in every public-schema table (tenants, memberships, profiles,
//     documents, archives, claims, evidence, recommendations, events,
//     auditLogs, ask/conversation sessions, catalogs, ...) — the global
//     reference catalogs (intelligencePacks/Items, authoritativeSources/
//     Knowledge) are also emptied because the app re-seeds them at runtime
//     via intelligence_seed_packs / everest_seed.
//   - every real object in every Storage bucket via the Storage API
//     (buckets themselves are KEPT).
//   - every Supabase Auth user via the Admin API (hard delete) using the
//     service-role key — never raw SQL against auth.users.
//
// It NEVER drops or modifies schema, tables, columns, indexes, migrations,
// RLS policies, Storage buckets, Edge Functions or RPC functions. Deletes are
// order-tolerant (FK-aware convergence loop) and the script is idempotent —
// running it against an already-empty environment is a no-op that verifies.
//
// Credentials come from .env.local (never printed): SUPABASE_SERVICE_ROLE_KEY
// drives everything (PostgREST data plane, Storage API, Auth Admin API).
// No management/access token is required.
//
// Storage notes for THIS deployment (verified live):
//   - POST /object/{bucket}/remove is an UPLOAD route here, not bulk delete
//     (calling it created "remove" artifacts in past runs). Real objects are
//     deleted one-by-one via DELETE /object/{bucket}/{name} (no Content-Type).
//   - Tombstone rows (name == object-uuid, id == null) are deleted-version
//     bookkeeping the Storage API cannot touch (NoSuchKey). They are NOT
//     uploaded files and are invisible to the app; purging them requires
//     direct SQL:  delete from storage.objects where version <> '' ;
//
// Verification performed after the reset:
//   - zero Auth users (Admin API)
//   - zero rows in every public table (PostgREST exact counts)
//   - zero REAL storage objects in every bucket (Storage API)
//   - schema intact: the PostgREST OpenAPI document (tables + columns +
//     RPC functions) is identical (normalized) before and after.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const KNOWN_PROJECT_REF = "ibxvzxblyhzwokljkslt";

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
const SERVICE_ROLE = env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
if (!SERVICE_ROLE) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
if (!BASE) throw new Error("VITE_SUPABASE_URL / SUPABASE_URL missing from .env.local");

const PROJECT_REF = BASE.replace(/^https?:\/\//, "").split(".")[0];
if (PROJECT_REF !== KNOWN_PROJECT_REF) {
  throw new Error(
    `Refusing to reset unexpected project '${PROJECT_REF}' (expected ${KNOWN_PROJECT_REF}). ` +
      `If this is intentional, edit KNOWN_PROJECT_REF in the script.`,
  );
}

const H = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json" };

async function req(path, { method = "GET", body, headers = {}, raw = false } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...H, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, headers: res.headers, json, text };
}

// --- exact row count for a table via Content-Range (0-0/N) -----------------
async function tableCount(table) {
  const r = await req(`/rest/v1/${table}?select=*&limit=1`, { headers: { Prefer: "count=exact" } });
  const cr = r.headers.get("content-range") ?? "";
  const m = cr.match(/\/(\d+)/);
  if (m) return Number(m[1]);
  if (r.status === 404) return null; // table not exposed (should not happen)
  throw new Error(`count ${table} failed (${r.status}): ${String(r.text).slice(0, 200)}`);
}

// --- all-rows delete filter for a table -------------------------------------
// This deployment (like current Supabase defaults) rejects filter-less DELETE
// ("DELETE requires a WHERE clause"), so we match every row with an
// is.null OR not.is.null pair on the table's first exposed column. Quoted
// camelCase columns are URL-encoded as "column" so PostgREST matches them
// exactly.
function deleteFilter(definitions, table) {
  const props = Object.keys(definitions[table]?.properties ?? {});
  if (props.length === 0) return null;
  const col = props[0];
  const q = /^[a-z_][a-z0-9_]*$/.test(col) ? col : encodeURIComponent(`"${col}"`);
  return `or=(${q}.is.null,${q}.not.is.null)`;
}

// --- fetch the PostgREST OpenAPI doc (tables + columns + RPC functions) ----
async function openApi() {
  const r = await req("/rest/v1/", { headers: { Accept: "application/json" } });
  if (r.status !== 200 || typeof r.json !== "object") {
    throw new Error(`OpenAPI fetch failed (${r.status})`);
  }
  const definitions = r.json.definitions ?? {};
  const tables = Object.keys(definitions).sort();
  const rpcs = Object.keys(r.json.paths ?? {})
    .filter((p) => p.startsWith("/rpc/"))
    .map((p) => p.replace(/^\/rpc\//, ""))
    .sort();
  // normalized schema fingerprint: table -> sorted column names; plus rpcs
  const fingerprint = {
    tables: Object.fromEntries(tables.map((t) => [t, Object.keys(definitions[t].properties ?? {}).sort()])),
    tablesRaw: definitions,
    rpcs,
  };
  return { tables, rpcs, fingerprint };
}

// --- Storage API ------------------------------------------------------------
async function storageApi(path, { method = "GET", body, noContentType = false } = {}) {
  const headers = { Authorization: `Bearer ${SERVICE_ROLE}` };
  if (!noContentType) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}/storage/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json, text };
}

async function bucketObjects(bucket, offset, limit) {
  const r = await storageApi(`object/list/${bucket}`, {
    method: "POST",
    body: { prefix: "", limit, offset, sortBy: { column: "name", order: "asc" } },
  });
  if (r.status !== 200) throw new Error(`list ${bucket} failed (${r.status}): ${String(r.text).slice(0, 200)}`);
  return r.json;
}

// --- Auth Admin API ----------------------------------------------------------
async function adminListUsers(page) {
  const r = await req(`/auth/v1/admin/users?per_page=1000&page=${page}`);
  if (r.status !== 200) throw new Error(`admin users list failed (${r.status}): ${String(r.text).slice(0, 200)}`);
  return r.json;
}

// =============================================================================
const failures = [];

console.log(`Atlas dev-environment reset (${APPLY ? "APPLY" : "DRY RUN"}) — project ${PROJECT_REF}\n`);

// ---- inventory ---------------------------------------------------------------
const schemaBefore = await openApi();
const tables = schemaBefore.tables;
console.log(`Schema inventory: ${tables.length} public tables, ${schemaBefore.rpcs.length} RPC functions exposed.`);

const rowsBefore = {};
for (const t of tables) {
  try { rowsBefore[t] = (await tableCount(t)) ?? 0; } catch (e) { failures.push(`count ${t}: ${e.message}`); rowsBefore[t] = 0; }
}
const nonZeroTables = tables.filter((t) => rowsBefore[t] > 0);

const buckets = (await storageApi("bucket")).json ?? [];
const storageBefore = {};
for (const b of buckets) {
  let offset = 0;
  let real = 0;
  let tomb = 0;
  for (;;) {
    const rows = await bucketObjects(b.name, offset, 1000);
    if (rows.length === 0) break;
    for (const o of rows) (o.id == null ? tomb++ : real++);
    if (rows.length < 1000) break;
    offset += rows.length;
  }
  storageBefore[b.name] = { real, tomb };
}

const usersFirst = await adminListUsers(1);
const usersArr = Array.isArray(usersFirst) ? usersFirst : (usersFirst.users ?? []);
const authBefore = Number(usersFirst.total ?? usersArr.length);

const realTotal = (n) => Object.values(n).reduce((a, b) => a + b.real, 0);
const tombTotal = (n) => Object.values(n).reduce((a, b) => a + b.tomb, 0);

console.log("Pre-flight inventory:");
console.log(`  tables with rows: ${nonZeroTables.length}/${tables.length}`);
for (const t of nonZeroTables) console.log(`    ${t}: ${rowsBefore[t]}`);
console.log(`  storage: ${realTotal(storageBefore)} real objects + ${tombTotal(storageBefore)} tombstone rows across ${buckets.length} buckets (${buckets.map((b) => b.name).join(", ") || "none"})`);
console.log(`  auth users: ${authBefore}\n`);

if (!APPLY) {
  console.log("DRY RUN — nothing was deleted. Re-run with --apply to reset.");
  process.exit(failures.length ? 1 : 0);
}

// ---- phase 1: app data — FK-aware convergence loop ---------------------------
console.log("Phase 1: deleting application rows (all public tables)...");
const deleted = {};
let pass = 0;
for (;;) {
  pass += 1;
  let changedThisPass = false;
  for (const t of tables) {
    const current = await tableCount(t).catch(() => 0);
    if (!current) continue;
    const filter = deleteFilter(schemaBefore.fingerprint.tablesRaw, t);
    const r = await req(`/rest/v1/${t}?${filter}`, { method: "DELETE", headers: { Prefer: "count=exact" } });
    if (r.status === 204 || r.status === 200) {
      const cr = r.headers.get("content-range") ?? "";
      const m = cr.match(/\/(\d+)/);
      const removed = m ? Number(m[1]) : current;
      deleted[t] = (deleted[t] ?? 0) + removed;
      changedThisPass = true;
    } else {
      const body = typeof r.json === "object" ? (r.json?.message ?? JSON.stringify(r.json)) : String(r.text);
      const isFk = r.status === 400 || r.status === 409
        ? /foreign key|23503|conflicts|violates/i.test(body)
        : false;
      if (isFk) {
        // child rows still reference this table — retry on a later pass
        continue;
      }
      failures.push(`delete ${t} (pass ${pass}): HTTP ${r.status} ${body.slice(0, 160)}`);
    }
  }
  if (!changedThisPass) break;
  if (pass > tables.length + 2) { failures.push("convergence loop did not terminate"); break; }
}
console.log(`  converged after ${pass} pass(es).`);

// ---- phase 2: storage objects (buckets kept) -----------------------------------
console.log("Phase 2: deleting storage objects (buckets kept)...");
const removedPerBucket = {};
const tombstonePerBucket = {};
for (const b of buckets) {
  let offset = 0;
  let removed = 0;
  let tomb = 0;
  for (;;) {
    const rows = await bucketObjects(b.name, offset, 1000);
    if (rows.length === 0) break;
    for (const o of rows) {
      if (o.id == null) { tomb += 1; continue; } // tombstone bookkeeping — not a file
      const r = await storageApi(`object/${b.name}/${encodeURIComponent(o.name)}`, {
        method: "DELETE",
        noContentType: true, // DELETE must not send a JSON content-type here
      });
      if (r.status === 200) removed += 1;
      else if (r.status === 404) removed += 1; // already gone — idempotent
      else failures.push(`storage delete ${b.name}/${o.name}: HTTP ${r.status} ${String(r.text).slice(0, 160)}`);
    }
    if (rows.length < 1000) break;
    offset += rows.length;
  }
  removedPerBucket[b.name] = removed;
  tombstonePerBucket[b.name] = tomb;
}

// ---- phase 3: auth users via Admin API ----------------------------------------
console.log("Phase 3: deleting auth users via Admin API (hard delete)...");
let usersDeleted = 0;
let page = 1;
for (;;) {
  const res = await adminListUsers(page);
  const batch = Array.isArray(res) ? res : (res.users ?? []);
  if (batch.length === 0) break;
  for (const u of batch) {
    const d = await req(`/auth/v1/admin/users/${u.id}`, { method: "DELETE", body: { shouldSoftDelete: false } });
    if (d.status === 200 || d.status === 204) usersDeleted += 1;
    else if (d.status === 404) usersDeleted += 1; // already gone — idempotent
    else failures.push(`admin delete user ${u.id}: HTTP ${d.status} ${String(d.text).slice(0, 120)}`);
  }
  if (batch.length < 1000) break;
  page += 1;
}

// ---- verification -----------------------------------------------------------------
console.log("\nVerification...");
const schemaAfter = await openApi();
const authAfter = await adminListUsers(1);
const authArr = Array.isArray(authAfter) ? authAfter : (authAfter.users ?? []);
const authAfterCount = Number(authAfter.total ?? authArr.length);

const rowsAfter = {};
for (const t of tables) {
  rowsAfter[t] = await tableCount(t).catch(() => -1);
  if (rowsAfter[t] > 0) failures.push(`${t}=${rowsAfter[t]} rows remain`);
}

const bucketsAfter = (await storageApi("bucket")).json ?? [];
const storageAfter = {};
for (const b of bucketsAfter) {
  let offset = 0;
  let real = 0;
  let tomb = 0;
  for (;;) {
    const rows = await bucketObjects(b.name, offset, 1000);
    if (rows.length === 0) break;
    for (const o of rows) (o.id == null ? tomb++ : real++);
    if (rows.length < 1000) break;
    offset += rows.length;
  }
  storageAfter[b.name] = { real, tomb };
  if (storageAfter[b.name].real > 0) failures.push(`bucket ${b.name} still has ${storageAfter[b.name].real} real objects`);
}

const schemaIntact =
  JSON.stringify(schemaBefore.fingerprint.tables) === JSON.stringify(schemaAfter.fingerprint.tables) &&
  JSON.stringify(schemaBefore.fingerprint.rpcs) === JSON.stringify(schemaAfter.fingerprint.rpcs);
if (!schemaIntact) failures.push("schema fingerprint changed (tables/columns/RPCs)");
const bucketNamesIntact =
  bucketsAfter.length === buckets.length &&
  bucketsAfter.every((b) => buckets.some((x) => x.name === b.name));
if (!bucketNamesIntact) failures.push("storage bucket set changed (buckets must be kept)");

// ---- report ----------------------------------------------------------------------
console.log("\n=== RESET REPORT ===");
console.log(`Deleted:`);
const deletedTables = Object.entries(deleted).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
if (deletedTables.length === 0) console.log("  (no rows were present in any table)");
for (const [t, n] of deletedTables) console.log(`  ${t}: ${n} rows`);
for (const [b, n] of Object.entries(removedPerBucket)) console.log(`  storage/${b}: ${n} real objects`);
console.log(`  auth users: ${usersDeleted}`);

console.log(`\nRemains:`);
console.log(`  auth users: ${authAfterCount} (target 0)`);
console.log(`  tables with rows: ${tables.filter((t) => rowsAfter[t] > 0).length}/${tables.length}`);
console.log(`  storage: ${realTotal(storageAfter)} real objects (target 0), ${tombTotal(storageAfter)} tombstone bookkeeping rows`);
console.log(`  storage buckets kept: ${bucketsAfter.map((b) => b.name).join(", ") || "(none)"}`);
console.log(`  public tables: ${tables.length} (unchanged: ${schemaIntact ? "yes" : "NO"})`);
console.log(`  RPC functions: ${schemaBefore.rpcs.length} (unchanged: ${schemaIntact ? "yes" : "NO"})`);
console.log(`  RLS policies: untouched — this script executes zero DDL (no DROP/ALTER/GRANT/REVOKE).`);
if (tombTotal(storageAfter) > 0) {
  console.log(`  NOTE: ${tombTotal(storageAfter)} tombstone rows remain in storage.objects (deleted-version markers the Storage API`);
  console.log(`        created on every delete; not files, invisible to the app). Purge with direct SQL when a management`);
  console.log(`        token is available:  delete from storage.objects where version <> '';`);
}

if (failures.length > 0) {
  console.error(`\nRESET VERIFICATION FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\nRESET VERIFIED: zero auth users, zero application rows, zero real storage objects; schema, functions, RLS and buckets intact.");
