// Probe: does insurance_approve_claim_candidate auto-link the candidate's
// evidence documents to the created claim? What does the candidate row record
// after approval (claimId? status?)? Cleanup included.
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
const STAMP = `EV-${Date.now()}`;

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
      for (const t of ["claimEvidence", "claimFindings", "claimSupplements", "insuranceClaims", "claimCandidates", "documents", "memberships", "tenants"]) await del(t, `tenantId=eq.${tenantId}`);
    }
    if (userId) await fetch(`${URL}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: svc }).catch(() => {});
    console.log("cleanup done");
  } catch (e) {
    console.error("cleanup error:", String(e).slice(0, 200));
  }
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
async function list(token, table, filter = "") {
  const res = await fetch(`${URL}/rest/v1/${table}?select=*${filter ? `&${filter}` : ""}`, { headers: auth(token) });
  return res.ok ? await res.json().catch(() => []) : [];
}

try {
  const su = await fetch(`${URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `ev.${Date.now()}@example.com`, password: "EvProbe!42" }),
  });
  const sb = await su.json().catch(() => ({}));
  const token = sb.access_token;
  userId = sb.user?.id ?? null;
  const tt = await rpc(token, "tenants_create_tenant", { p_name: "Evidence Probe Co" });
  tenantId = tt.body?.tenantId ?? null;
  if (!token || !tenantId) process.exit(1);

  // Create two documents whose titles match the candidate evidence paths.
  const docIds = [];
  for (const name of [`${STAMP}_estimate.pdf`, `${STAMP}_inspection.pdf`]) {
    const d = await rpc(token, "ingestion_create_document", {
      p_title: name, p_mimetype: "application/pdf", p_size: 1,
      p_sourcetype: "archive", p_sourceid: `probe/${STAMP}`, p_classification: "estimate", p_status: "ready", p_storageid: null,
    });
    const id = d.body?.docId ?? null;
    if (id) { docIds.push(id); created.docs.push(id); }
  }
  console.log(`documents: ${docIds.length}`);

  // Candidate whose evidence/filePaths reference those exact titles.
  await rpc(token, "insurance_upsert_candidates", {
    p_candidates: [{
      archiveId: null, claimKey: `${STAMP}-GAP-77-0001`, claimNumber: "GAP-77-0001",
      customer: "Ev Owner", property: "1 Ev Ave", carrier: "Liberty",
      fileCount: 2, totalSize: 2, confidence: 0.9,
      filePaths: [`${STAMP}_estimate.pdf`, `${STAMP}_inspection.pdf`],
      evidence: [`${STAMP}_estimate.pdf`, `${STAMP}_inspection.pdf`],
    }],
  });
  const candRows = (await rpc(token, "insurance_list_claim_candidates", {})).body ?? [];
  const cand = candRows.find((c) => String(c.claimKey ?? "").includes(STAMP));
  if (cand?._id) created.candidates.push(cand._id);
  console.log(`candidate: ${cand?._id}`);

  const app = await rpc(token, "insurance_approve_claim_candidate", { p_candidateid: cand._id });
  const claimId = app.body?.claimId ?? null;
  if (claimId) created.claims.push(claimId);
  console.log(`approve → HTTP ${app.status}, claimId=${claimId}`);

  // Evidence links actually persisted?
  const links = await list(token, "claimEvidence", `claimId=eq.${claimId}`);
  console.log(`claimEvidence rows after approval (no manual attach): ${links.length}`);

  // Candidate row after approval: status? claimId recorded?
  const candRowsAfter = (await rpc(token, "insurance_list_claim_candidates", {})).body ?? [];
  const candAfter = candRowsAfter.find((c) => String(c._id ?? "") === String(cand._id));
  console.log(`candidate post-approval keys: ${JSON.stringify(candAfter ? Object.keys(candAfter) : [])}`);
  console.log(`candidate post-approval status=${JSON.stringify(candAfter?.status)} claimId=${JSON.stringify(candAfter?.claimId ?? candAfter?.approvedClaimId ?? null)}`);

  // Package evidence after approval (without manual attach).
  const pkg = (await rpc(token, "insurance_get_claim_package", { p_claimid: claimId })).body ?? {};
  console.log(`package evidenceDocs after approval: ${Array.isArray(pkg.evidenceDocs) ? pkg.evidenceDocs.length : "N/A"}`);
} finally {
  await cleanup();
}
