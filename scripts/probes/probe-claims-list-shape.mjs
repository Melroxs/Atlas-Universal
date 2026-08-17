// Print the EXACT raw rows the frontend receives from insurance_list_claims
// (called the same way the page calls it: empty body). Prints keys + types,
// never values. Cleans up after itself.
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
const auth = (t) => ({ apikey: ANON, "Content-Type": "application/json", Authorization: `Bearer ${t}` });
const svc = { apikey: SERVICE, "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` };

let userId = null;
let tenantId = null;
const created = { claims: [], candidates: [], docs: [] };
const STAMP = `LST-${Date.now()}`;

async function del(table, filter) {
  try {
    await fetch(`${URL}/rest/v1/${table}?${filter}`, { method: "DELETE", headers: svc });
  } catch {}
}
async function cleanup() {
  try {
    for (const id of created.claims) {
      await del("claimEvidence", `claimId=eq.${id}`);
      await del("claimFindings", `claimId=eq.${id}`);
      await del("claimSupplements", `claimId=eq.${id}`);
      await del("insuranceClaims", `_id=eq.${id}`);
    }
    for (const id of created.candidates) await del("claimCandidates", `_id=eq.${id}`);
    for (const id of created.docs) await del("documents", `_id=eq.${id}`);
    if (tenantId) {
      await del("claimEvidence", `tenantId=eq.${tenantId}`);
      await del("claimFindings", `tenantId=eq.${tenantId}`);
      await del("claimSupplements", `tenantId=eq.${tenantId}`);
      await del("insuranceClaims", `tenantId=eq.${tenantId}`);
      await del("claimCandidates", `tenantId=eq.${tenantId}`);
      await del("documents", `tenantId=eq.${tenantId}`);
      await del("memberships", `tenantId=eq.${tenantId}`);
      await del("tenants", `_id=eq.${tenantId}`);
    }
    if (userId) await fetch(`${URL}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: svc }).catch(() => {});
  } catch {}
}
async function rpc(token, name, body = {}) {
  const res = await fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify(body),
  });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {}
  return { status: res.status, body: parsed };
}
function keysOf(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v) : [];
}

try {
  const su = await fetch(`${URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `lst.${Date.now()}@example.com`, password: "LstProbe!42" }),
  });
  const sb = await su.json().catch(() => ({}));
  const token = sb.access_token;
  userId = sb.user?.id ?? null;
  const tt = await rpc(token, "tenants_create_tenant", { p_name: "List Shape Probe Co" });
  tenantId = tt.body?.tenantId ?? null;
  if (!token || !tenantId) {
    console.log("setup failed");
    process.exit(1);
  }

  const docRes = await rpc(token, "ingestion_create_document", {
    p_title: `${STAMP}_estimate.pdf`, p_mimetype: "application/pdf", p_size: 1,
    p_sourcetype: "archive", p_sourceid: `probe/${STAMP}`, p_classification: "estimate", p_status: "ready", p_storageid: null,
  });
  const docId = docRes.body?.docId ?? null;
  if (docId) created.docs.push(docId);

  await rpc(token, "insurance_upsert_candidates", {
    p_candidates: [{
      archiveId: null, claimKey: `${STAMP}-GAP-88-0001`, claimNumber: "GAP-88-0001",
      customer: "List Shape Owner", property: "1 List Ave", carrier: "Progressive",
      fileCount: 1, totalSize: 1, confidence: 0.9, filePaths: [`${STAMP}_estimate.pdf`], evidence: [`${STAMP}_estimate.pdf`],
    }],
  });
  const cands = (await rpc(token, "insurance_list_claim_candidates", {})).body ?? [];
  const cand = cands.find((c) => String(c.claimKey ?? "").includes(STAMP));
  if (cand?._id) created.candidates.push(cand._id);
  const app = await rpc(token, "insurance_approve_claim_candidate", { p_candidateid: cand._id });
  const claimId = app.body?.claimId ?? null;
  if (claimId) created.claims.push(claimId);

  // EXACT call the frontend makes: empty body.
  const list = await rpc(token, "insurance_list_claims", {});
  console.log(`insurance_list_claims {} → HTTP ${list.status}; isArray=${Array.isArray(list.body)}`);
  if (Array.isArray(list.body) && list.body.length > 0) {
    const row = list.body[0];
    console.log(`row top-level keys: ${JSON.stringify(keysOf(row))}`);
    console.log(`row._id: ${JSON.stringify(row?._id)}`);
    console.log(`row.customer: ${JSON.stringify(row?.customer)}`);
    console.log(`row.claim._id: ${JSON.stringify(row?.claim?._id)}`);
    console.log(`row.claim.customer: ${JSON.stringify(row?.claim?.customer)}`);
    console.log(`row.claim.claimNumber: ${JSON.stringify(row?.claim?.claimNumber)}`);
    console.log(`row.claim.status: ${JSON.stringify(row?.claim?.status)}`);
    console.log(`row.claim.isDemo: ${JSON.stringify(row?.claim?.isDemo)}`);
    console.log(`row.completeness: ${JSON.stringify(row?.completeness)}`);
    console.log(`row.openFindings: ${JSON.stringify(row?.openFindings)}`);
    console.log(`row.outstanding: ${JSON.stringify(row?.outstanding)}`);
    console.log(`row.claim keys (all): ${JSON.stringify(keysOf(row?.claim))}`);
  } else {
    console.log(`response: ${JSON.stringify(list.body).slice(0, 200)}`);
  }
} finally {
  await cleanup();
}
