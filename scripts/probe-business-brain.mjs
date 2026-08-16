// ---------------------------------------------------------------------------
// LIVE probe: Business Brain data path against the deployed Supabase project.
//
//   node scripts/probe-business-brain.mjs
//
// Signs up a throwaway user, creates a workspace, calls every RPC the Business
// Brain page uses the way the browser calls it (p_<lowercased-camel> via
// PostgREST), prints HTTP status + shape summary, then dumps the full deployed
// function inventory from the OpenAPI schema. Cleans up after itself.
// Prints no secrets. Exit code 0 (diagnostic; report is in the output).
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";

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
const URL = env.VITE_SUPABASE_URL ?? "https://ibxvzxblyhzwokljkslt.supabase.co";
const ANON = env.VITE_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!ANON || !SERVICE) {
  console.error("VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
  process.exit(2);
}

const auth = (t) => ({ apikey: ANON, "Content-Type": "application/json", Authorization: `Bearer ${t}` });
const svc = { apikey: SERVICE, "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` };

let userId = null;
let tenantId = null;

async function cleanup() {
  try {
    if (tenantId) {
      await fetch(`${URL}/rest/v1/operatingLocations?tenantId=eq.${tenantId}`, { method: "DELETE", headers: svc }).catch(() => {});
      await fetch(`${URL}/rest/v1/memberships?tenantId=eq.${tenantId}`, { method: "DELETE", headers: svc }).catch(() => {});
      await fetch(`${URL}/rest/v1/companyProfiles?tenantId=eq.${tenantId}`, { method: "DELETE", headers: svc }).catch(() => {});
      await fetch(`${URL}/rest/v1/tenants?_id=eq.${tenantId}`, { method: "DELETE", headers: svc }).catch(() => {});
    }
    if (userId) await fetch(`${URL}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: svc }).catch(() => {});
    console.log("cleanup: probe user + workspace removed");
  } catch (e) {
    console.error("cleanup error:", String(e).slice(0, 200));
  }
}

function shapeSummary(value) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `array[${value.length}]`;
  if (typeof value === "object") {
    const parts = Object.entries(value).map(([k, v]) => {
      if (Array.isArray(v)) return `${k}: array[${v.length}]`;
      if (v === null) return `${k}: null`;
      if (typeof v === "object") return `${k}: object{${Object.keys(v).length}}`;
      return `${k}: ${typeof v}`;
    });
    return `object{ ${parts.join(", ")} }`;
  }
  return `${typeof value}`;
}

async function rpc(token, name, body = {}) {
  const started = Date.now();
  const res = await fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify(body),
  });
  const ms = Date.now() - started;
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, ms, body: parsed };
}

const PROBES = [
  ["tenants_get_my_workspace", {}],
  ["everest_get_organization_context", { p_usertimezone: "America/Denver" }],
  ["everest_get_organization_context", {}],
  ["everest_get_organization_context", { p_timezone: "America/Denver" }],
  ["everest_get_organization_context", { p_user_timezone: "America/Denver" }],
  ["everest_update_organization_context", {}],
  ["everest_update_organization_context", { p_country: "United States" }],
  ["everest_update_organization_context", { p_context: { country: "United States" } }],
  ["everest_seed", {}],
  ["everest_seed", { p_packs: [] }],
  ["everest_list_authoritative_knowledge", {}],
  ["everest_industry_coverage", {}],
  ["everest_insurance_intelligence", {}],
  ["everest_authority_monitor", {}],
  ["everest_list_knowledge_changes", { p_limit: 5 }],
  ["everest_list_impact_assessments", {}],
  ["everest_industry_excellence", {}],
  ["everest_value_intelligence", { p_packkey: "insurance-restoration" }],
  ["everest_get_organizational_state", {}],
  ["everest_analyze_claim_recovery", { p_expectedscope: [], p_actualscope: [], p_evidencesummary: [] }],
];

try {
  const su = await fetch(`${URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `bb.${Date.now()}@example.com`, password: "BbProbe!42", data: { full_name: "BB Probe" } }),
  });
  const sb = await su.json().catch(() => ({}));
  const token = sb.access_token;
  userId = sb.user?.id ?? null;
  if (!token) {
    console.log(`FAIL signup HTTP ${su.status} — ${JSON.stringify(sb).slice(0, 160)}`);
    process.exit(1);
  }
  const tt = await fetch(`${URL}/rest/v1/rpc/tenants_create_tenant`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({ p_name: "BB Probe Co" }),
  }).catch(() => null);
  const tb = tt ? await tt.json().catch(() => ({})) : {};
  tenantId = tb.tenantId ?? tb.tenant_id ?? tb.id ?? null;
  if (!tenantId) {
    const mt = await fetch(`${URL}/rest/v1/memberships?select=tenantId&limit=1`, { headers: auth(token) }).catch(() => null);
    const mb = mt ? await mt.json().catch(() => []) : [];
    tenantId = Array.isArray(mb) ? mb[0]?.tenantId ?? null : null;
  }
  console.log(`probe user created, workspace: ${tenantId ? "yes (" + tenantId + ")" : "NO"}\n`);

  let anyFail = false;
  for (const [name, args] of PROBES) {
    const r = await rpc(token, name, args);
    const ok = r.status >= 200 && r.status < 300;
    if (!ok) anyFail = true;
    const err = r.body?.message ?? r.body?.error ?? (typeof r.body === "string" ? r.body : null);
    console.log(`[${ok ? "OK " : "ERR"}] ${name} HTTP ${r.status} (${r.ms}ms)`);
    if (r.status === 200) {
      const b = r.body;
      if (b && typeof b === "object" && !Array.isArray(b)) {
        console.log(`      ${shapeSummary(b)}`);
        for (const key of ["sources", "knowledge", "coverage", "locations", "excellence", "changes", "assessments", "systems", "packs", "members"]) {
          if (key in b && !Array.isArray(b[key])) {
            console.log(`      WARN ${key} is NOT an array: ${shapeSummary(b[key])}`);
          }
        }
      } else {
        console.log(`      ${shapeSummary(b)}`);
      }
    } else {
      console.log(`      ${String(err ?? "").slice(0, 220)}`);
    }
    console.log("");
  }
  console.log(anyFail ? "RESULT: some RPCs missing/failed on the deployed project" : "RESULT: all probed RPCs reachable (200) on the deployed project");    // Live org-context response details (the page's core dependency).
    const orgRes = await rpc(token, "everest_get_organization_context", {});
    if (orgRes.status === 200) {
      const b = orgRes.body ?? {};
      console.log(`\norg_context.profile keys: ${Object.keys(b.profile ?? {}).join(", ")}`);
      console.log(`org_context.profile: ${String(JSON.stringify(b.profile ?? null)).slice(0, 400)}`);
      console.log(`org_context.context: ${String(JSON.stringify(b.context ?? null)).slice(0, 400)}`);
    }

    // -------------------------------------------------------------------------
    // Definitive deployed-function inventory (OpenAPI schema)
    // -------------------------------------------------------------------------
  try {
    const specRes = await fetch(`${URL}/rest/v1/`, {
      headers: { ...svc, Accept: "application/openapi+json", Prefer: "count=exact" },
    });
    console.log(`openapi fetch: HTTP ${specRes.status}`);
    const text = await specRes.text();
    let spec = null;
    try {
      spec = JSON.parse(text);
    } catch {
      console.log(`openapi body (first 200): ${text.slice(0, 200)}`);
    }
    if (!spec) throw new Error("unparseable");
    // Profile/tenant shape from the workspace probe.
    const ws = await rpc(token, "tenants_get_my_workspace", {});
    if (ws.status === 200 && ws.body && typeof ws.body === "object") {
      console.log(`\nworkspace.profile keys: ${Object.keys(ws.body.profile ?? {}).join(", ")}`);
      console.log(`workspace.tenant keys: ${Object.keys(ws.body.tenant ?? {}).join(", ")}`);
      console.log(`workspace.membership keys: ${Object.keys(ws.body.membership ?? {}).join(", ")}`);
      console.log(`workspace.systems: ${JSON.stringify(ws.body.systems ?? null).slice(0, 300)}`);
    }
    // Mutations the Business Brain page fires (the NEW fixed contracts).
    for (const [name, args] of [
      ["everest_update_organization_context", { p_patch: { country: "United States", regions: [], cities: [], primaryTimezone: "America/Denver", locale: "en-US", currency: "USD", fiscalYearStart: "01-01", businessDays: [1, 2, 3, 4, 5], businessHours: { start: "09:00", end: "17:00" }, holidays: [] } }],
      ["everest_upsert_operating_location", { p_name: "Denver HQ", p_kind: "branch", p_city: "Denver", p_timezone: "America/Denver" }],
      ["everest_decide_impact_review", { p_assessmentid: "00000000-0000-0000-0000-000000000000", p_decision: "approved" }],
    ]) {
      const m = await rpc(token, name, args);
      console.log(`[${m.status === 200 ? "OK " : "ERR"}] ${name} HTTP ${m.status} — ${String(m.body?.message ?? m.body?.error ?? JSON.stringify(m.body) ?? "").slice(0, 160)}`);
    }
    // Round-trip: the p_patch above must be readable back through the RPC the
    // org tab renders from (zero-arg get; the page never sends params).
    const orgAfterSave = await rpc(token, "everest_get_organization_context", {});
    if (orgAfterSave.status === 200) {
      const b = orgAfterSave.body ?? {};
      console.log(`[OK ] everest_get_organization_context (post-save round-trip) — profile.companyName=${String(b.profile?.companyName ?? "(none)").slice(0, 40)}, context.primaryTimezone=${String(b.context?.primaryTimezone ?? "(none)").slice(0, 40)}`);
    } else {
      console.log(`[ERR] everest_get_organization_context (post-save round-trip) HTTP ${orgAfterSave.status}`);
    }
    console.log("");
    const paths = Object.keys(spec.paths ?? {});
    const rpcs = paths
      .filter((p) => p.includes("/rpc/"))
      .map((p) => p.replace("/rpc/", ""))
      .sort();
    const groups = ["everest_", "onboarding_", "tenants_", "insurance_", "archive_", "documents_", "knowledge_", "recommendations_", "history_", "audit_", "events_", "workflows_", "connections_", "intelligence_", "conversation_"];
    console.log(`\n=== DEPLOYED FUNCTION INVENTORY (${rpcs.length} total) ===`);
    for (const g of groups) {
      const inGroup = rpcs.filter((r) => r.startsWith(g));
      console.log(`\n[${g}*] ${inGroup.length} deployed:`);
      console.log(inGroup.join("\n") || "(none)");
    }
    const other = rpcs.filter((r) => !groups.some((g) => r.startsWith(g)));
    console.log(`\n[other] ${other.length} deployed:`);
    console.log(other.join("\n") || "(none)");

    // PostgREST declares RPC arg schemas in components.schemas as <fn>_args.
    const schemaNames = Object.keys(spec.components?.schemas ?? {});
    const everestSchemas = schemaNames.filter((n) => /everest/.test(n)).sort();
    console.log(`\ncomponents.schemas names matching everest (${everestSchemas.length}):`);
    for (const n of everestSchemas) {
      const s = spec.components.schemas[n];
      const props = Object.keys(s?.properties ?? {});
      const required = s?.required ?? [];
      console.log(`  ${n}${props.length ? `( ${props.map((k) => (required.includes(k) ? `${k}!` : k)).join(", ")} )` : "( no properties )"}`);
    }

    // RAW path objects for the RPCs the Business Brain page depends on.
    const rawKeys = ["everest_get_organization_context", "everest_update_organization_context", "everest_seed", "everest_industry_coverage", "everest_insurance_intelligence", "everest_industry_excellence", "everest_value_intelligence", "everest_analyze_claim_recovery", "everest_upsert_operating_location", "everest_authority_monitor"];
    console.log(`\n=== RAW OPENAPI PATHS (request params) ===`);
    for (const rk of rawKeys) {
      const p = spec.paths?.[`/rpc/${rk}`];
      if (!p) {
        console.log(`\n${rk}: NOT PRESENT in OpenAPI`);
        continue;
      }
      const req = p.post?.requestBody?.content?.["application/json"]?.schema;
      console.log(`\n${rk} request schema: ${String(JSON.stringify(req) ?? "(none)").slice(0, 500)}`);
    }

    // Exact signatures for every everest_* RPC (parameters + response shape).
    console.log(`\n=== EVEREST_* RPC SIGNATURES (from OpenAPI) ===`);
    for (const r of rpcs.filter((r) => r.startsWith("everest_"))) {
      try {
        const p = spec.paths?.[`/rpc/${r}`];
        const post = p?.post ?? {};
        const reqSchema = post.requestBody?.content?.["application/json"]?.schema;
        const respSchema = post.responses?.["200"]?.content?.["application/json"]?.schema;
        const props = Object.keys(reqSchema?.properties ?? {});
        const required = reqSchema?.required ?? [];
        console.log(`\n${r}( ${props.map((k) => (required.includes(k) ? `${k}!` : k)).join(", ")} )`);
        // Resolve the response schema (may be $ref, anyOf, or inline).
        const shown = new Set();
        const describe = (s, depth) => {
          if (!s || depth > 3) return "?";
          if (Array.isArray(s)) return "array";
          if (s.$ref) {
            const nm = s.$ref.split("/").pop();
            if (shown.has(nm)) return nm;
            shown.add(nm);
            const sch = spec.components?.schemas?.[nm] ?? {};
            const inner = sch.properties ?? {};
            const items = Object.entries(inner)
              .map(([k, v]) => `${k}: ${v?.type === "array" ? "array" : v?.type === "object" ? `object{${Object.keys(v.properties ?? {}).length}}` : v?.type ?? "?"}`)
              .join(", ");
            return `${nm}{${items}}`;
          }
          if (s.type === "array") return `array<${describe(s.items, depth + 1)}>`;
          if (s.type === "object") return `object{${Object.keys(s.properties ?? {}).length}}`;
          if (s.anyOf) return s.anyOf.map((a) => describe(a, depth + 1)).join(" | ");
          return s.type ?? JSON.stringify(s).slice(0, 80);
        };
        console.log(`  -> ${describe(respSchema, 0)}`);
      } catch (e) {
        console.log(`  (signature parse failed: ${String(e).slice(0, 120)})`);
      }
    }
  } catch (e) {
    console.log("openapi inventory failed:", String(e).slice(0, 200));
  }
} finally {
  await cleanup();
}
