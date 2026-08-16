// ---------------------------------------------------------------------------
// LIVE behavioral probe — claim-discovery idempotency / race protection.
//
//   node scripts/probe-claim-idempotency.mjs
//
// The deployed Postgres functions are NOT in this repository (migrations live
// on the Supabase project), so the only way to verify whether the DB layer
// protects against duplicate claims/candidates/evidence links is to call the
// real RPCs twice and observe the persisted counts. This probe:
//
//   1. signs up a throwaway user + workspace (never touches real tenants),
//   2. calls insurance_create_claim TWICE with the same claim number,
//      insurance_upsert_candidates TWICE with the same claimKey, and
//      insurance_attach_claim_evidence TWICE with the same (claim, doc) pair,
//   3. reports the persisted counts (1 => the layer dedupes; 2 => duplicates
//      are possible under concurrency),
//   4. cleans up every row it created (claims, candidates, evidence links,
//      documents, memberships, tenant, user).
//
// Prints no secrets. Exit code 0 (diagnostic; the report is in the output).
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
const created = { claims: [], candidates: [], documents: [], evidenceLinks: [] };

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

async function delTable(table, filter) {
  try {
    await fetch(`${URL}/rest/v1/${table}?${filter}`, { method: "DELETE", headers: svc });
  } catch {}
}

async function cleanup() {
  try {
    for (const id of created.claims) {
      await delTable("claimEvidence", `claimId=eq.${id}`);
      await delTable("claimFindings", `claimId=eq.${id}`);
      await delTable("claimSupplements", `claimId=eq.${id}`);
      await delTable("claimPayments", `claimId=eq.${id}`);
      await delTable("insuranceClaims", `_id=eq.${id}`);
    }
    for (const id of created.candidates) {
      await delTable("claimCandidates", `_id=eq.${id}`);
    }
    for (const id of created.documents) {
      await delTable("documents", `_id=eq.${id}`);
    }
    if (tenantId) {
      await delTable("claimEvidence", `tenantId=eq.${tenantId}`);
      await delTable("claimFindings", `tenantId=eq.${tenantId}`);
      await delTable("claimSupplements", `tenantId=eq.${tenantId}`);
      await delTable("claimPayments", `tenantId=eq.${tenantId}`);
      await delTable("insuranceClaims", `tenantId=eq.${tenantId}`);
      await delTable("claimCandidates", `tenantId=eq.${tenantId}`);
      await delTable("documents", `tenantId=eq.${tenantId}`);
      await delTable("memberships", `tenantId=eq.${tenantId}`);
      await delTable("tenants", `_id=eq.${tenantId}`);
    }
    if (userId) {
      await fetch(`${URL}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: svc }).catch(() => {});
    }
    console.log("cleanup: probe tenant + user removed");
  } catch (e) {
    console.error("cleanup error:", String(e).slice(0, 200));
  }
}

try {
  // 1. Throwaway user + workspace.
  const su = await fetch(`${URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `idem.${Date.now()}@example.com`, password: "IdemProbe!42", data: { full_name: "Idempotency Probe" } }),
  });
  const sb = await su.json().catch(() => ({}));
  const token = sb.access_token;
  userId = sb.user?.id ?? null;
  if (!token) {
    console.log(`FAIL signup HTTP ${su.status} — ${JSON.stringify(sb).slice(0, 160)}`);
    process.exit(1);
  }
  const tt = await rpc(token, "tenants_create_tenant", { p_name: "Idempotency Probe Co" });
  tenantId = tt.body?.tenantId ?? tt.body?.tenant_id ?? tt.body?.id ?? null;
  if (!tenantId) {
    const mt = await fetch(`${URL}/rest/v1/memberships?select=tenantId&limit=1`, { headers: auth(token) }).catch(() => null);
    const mb = mt ? await mt.json().catch(() => []) : [];
    tenantId = Array.isArray(mb) ? mb[0]?.tenantId ?? null : null;
  }
  console.log(`probe user created, tenant: ${tenantId ? "yes" : "NO"}\n`);
  if (!tenantId) process.exit(1);

  // 2. Create a document row to attach as evidence.
  const docRes = await rpc(token, "ingestion_create_document", {
    p_title: "probe_evidence.pdf",
    p_mimetype: "application/pdf",
    p_size: 12,
    p_sourcetype: "probe",
    p_sourceid: `probe/${Date.now()}`,
    p_classification: "Unknown",
    p_status: "ready",
    p_storageid: null,
  });
  const docId = docRes.body?.docId ?? docRes.body?.documentId ?? null;
  if (docId) created.documents.push(docId);
  console.log(`document row: ${docId ? "created" : `FAILED (${docRes.status} ${JSON.stringify(docRes.body).slice(0, 140)})`}`);

  // 3. insurance_create_claim TWICE with the same claim number.
  const claimBody = {
    p_claimnumber: "IDEM-PROBE-26-0001",
    p_customer: "Idempotency Probe Customer",
    p_property: "1 Probe Way, Tampa FL 33601",
    p_carrier: "State Farm",
    p_status: "opened",
    p_provenance: "probe",
  };
  const c1 = await rpc(token, "insurance_create_claim", claimBody);
  const c2 = await rpc(token, "insurance_create_claim", claimBody);
  const claimIds = [c1.body?.claimId, c2.body?.claimId].filter(Boolean);
  created.claims.push(...claimIds);
  console.log(`insurance_create_claim x2 → ${c1.status}/${c2.status}; claimIds: ${JSON.stringify(claimIds)}`);
  const claimsAfter = (await rpc(token, "insurance_list_claims", { p_status: null })).body ?? [];
  const probeClaims = claimsAfter.filter((r) => String(r?.claim?.claimNumber ?? "").includes("IDEM-PROBE-26-0001"));
  console.log(`  claims rows for the same claim number after 2 creates: ${probeClaims.length} ${probeClaims.length > 1 ? "→ DUPLICATES POSSIBLE" : "→ DEDUPED"}`);

  // 4. insurance_upsert_candidates TWICE with the same claimKey.
  const candBody = {
    p_candidates: [
      {
        archiveId: null,
        claimKey: "IDEM-PROBE-26-0001",
        claimNumber: "IDEM-PROBE-26-0001",
        customer: "Idempotency Probe Customer",
        property: "1 Probe Way, Tampa FL 33601",
        fileCount: 2,
        totalSize: null,
        confidence: 0.8,
        filePaths: [],
        evidence: ["probe"],
      },
    ],
  };
  const k1 = await rpc(token, "insurance_upsert_candidates", candBody);
  const k2 = await rpc(token, "insurance_upsert_candidates", candBody);
  console.log(`insurance_upsert_candidates x2 → ${k1.status}/${k2.status}`);
  const candidatesAfter = (await rpc(token, "insurance_list_claim_candidates", {})).body ?? [];
  const probeCands = candidatesAfter.filter((c) => String(c?.claimKey ?? "").includes("IDEM-PROBE-26-0001"));
  created.candidates.push(...probeCands.map((c) => c._id).filter(Boolean));
  console.log(`  candidate rows for the same claimKey after 2 upserts: ${probeCands.length} ${probeCands.length > 1 ? "→ DUPLICATES POSSIBLE" : "→ DEDUPED"}`);

  // 5. insurance_attach_claim_evidence TWICE with the same (claim, doc).
  let evidenceCounts = { before: 0, after: 0, claimId: null };
  const baseClaimId = claimIds[0] ?? probeCands[0]?._id;
  if (baseClaimId && docId) {
    const e1 = await rpc(token, "insurance_attach_claim_evidence", { p_claimid: baseClaimId, p_documentid: docId });
    const e2 = await rpc(token, "insurance_attach_claim_evidence", { p_claimid: baseClaimId, p_documentid: docId });
    console.log(`insurance_attach_claim_evidence x2 → ${e1.status}/${e2.status}`);
    const pkg = (await rpc(token, "insurance_get_claim_package", { p_claimid: baseClaimId })).body ?? {};
    const ev = Array.isArray(pkg.evidenceDocs) ? pkg.evidenceDocs : [];
    evidenceCounts = { before: 0, after: ev.length, claimId: baseClaimId };
    console.log(`  evidence docs on the claim after 2 attaches of the same doc: ${ev.length} ${ev.length > 1 ? "→ DUPLICATES POSSIBLE" : "→ DEDUPED"}`);
  } else {
    console.log("  attach skipped (no claim or document id available)");
  }

  // 6. Approve the same candidate twice (duplicate-approval path).
  const pending = probeCands.find((c) => c.status === "pending");
  if (pending?._id) {
    const a1 = await rpc(token, "insurance_approve_claim_candidate", { p_candidateid: pending._id });
    const a2 = await rpc(token, "insurance_approve_claim_candidate", { p_candidateid: pending._id });
    console.log(`insurance_approve_claim_candidate x2 → ${a1.status}/${a2.status}; claimId=${a1.body?.claimId ?? "none"} / ${a2.body?.claimId ?? "none"}`);
    if (a1.body?.claimId) created.claims.push(a1.body.claimId);
    if (a2.body?.claimId && a2.body.claimId !== a1.body?.claimId) created.claims.push(a2.body.claimId);
    const claimsFinal = (await rpc(token, "insurance_list_claims", { p_status: null })).body ?? [];
    const finalProbe = claimsFinal.filter((r) => String(r?.claim?.claimNumber ?? "").includes("IDEM-PROBE-26-0001"));
    console.log(`  claims rows after double approval: ${finalProbe.length} ${finalProbe.length > 1 ? "→ DUPLICATE CLAIM CREATED BY DOUBLE APPROVAL" : "→ SINGLE CLAIM"}`);
  }

  console.log("\nRESULT: see counts above — 1 = DB layer dedupes, 2 = duplicates possible under concurrent calls.");
} finally {
  await cleanup();
}
