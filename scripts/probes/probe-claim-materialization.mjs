// ---------------------------------------------------------------------------
// LIVE probe — claim materialization end-to-end.
//
//   node scripts/probes/probe-claim-materialization.mjs
//
// Traces the exact acceptance chain against the deployed Supabase project:
//   document → candidate → approve → claim row → list claims → claim package
//   → timeline → evidence linkage → reject (no claim) → double-approve
//   (no duplicate) → cross-workspace isolation.
//
// Uses a throwaway user + workspace, prints only shapes/statuses (no secrets),
// and cleans up every row it creates (documents, candidates, claims, evidence
// links, findings, supplements, memberships, tenant, user).
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

let userA = null;
let tenantA = null;
let userB = null;
let tenantB = null;
const created = { docs: [], candidates: [], claims: [], evidenceLinks: [] };
const STAMP = `MAT-${Date.now()}`;

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
      await del("claimPayments", `claimId=eq.${id}`);
      await del("insuranceClaims", `_id=eq.${id}`);
    }
    for (const id of created.candidates) await del("claimCandidates", `_id=eq.${id}`);
    for (const id of created.docs) await del("documents", `_id=eq.${id}`);
    for (const t of [tenantA, tenantB].filter(Boolean)) {
      await del("claimEvidence", `tenantId=eq.${t}`);
      await del("claimFindings", `tenantId=eq.${t}`);
      await del("claimSupplements", `tenantId=eq.${t}`);
      await del("claimPayments", `tenantId=eq.${t}`);
      await del("insuranceClaims", `tenantId=eq.${t}`);
      await del("claimCandidates", `tenantId=eq.${t}`);
      await del("documents", `tenantId=eq.${t}`);
      await del("memberships", `tenantId=eq.${t}`);
      await del("tenants", `_id=eq.${t}`);
    }
    for (const u of [userA, userB].filter(Boolean)) {
      await fetch(`${URL}/auth/v1/admin/users/${u}`, { method: "DELETE", headers: svc }).catch(() => {});
    }
    console.log("cleanup: probe tenants + users removed");
  } catch (e) {
    console.error("cleanup error:", String(e).slice(0, 200));
  }
}

function shape(v, depth = 0) {
  if (v === null) return "null";
  if (Array.isArray(v)) return v.length === 0 ? "[]" : `Array(${v.length})`;
  if (typeof v === "object") {
    const keys = Object.keys(v);
    return `{ ${keys.slice(0, 18).join(", ")}${keys.length > 18 ? ", …" : ""} }`;
  }
  return typeof v;
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

async function signup() {
  const su = await fetch(`${URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `mat.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@example.com`, password: "MatProbe!42", data: { full_name: "Materialization Probe" } }),
  });
  const sb = await su.json().catch(() => ({}));
  const token = sb.access_token;
  const userId = sb.user?.id ?? null;
  if (!token) return { token: null, userId: null, tenantId: null };
  const tt = await rpc(token, "tenants_create_tenant", { p_name: "Materialization Probe Co" });
  const tenantId = tt.body?.tenantId ?? tt.body?.tenant_id ?? tt.body?.id ?? null;
  return { token, userId, tenantId };
}

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

try {
  // ---- Tenant A ----
  const A = await signup();
  userA = A.userId;
  tenantA = A.tenantId;
  if (!A.token || !tenantA) {
    console.log("FAIL tenant A setup; aborting.");
    process.exit(1);
  }
  console.log(`tenant A: ${tenantA}\n`);

  // 1. Document row (as the ingestion pipeline would create it).
  const docRes = await rpc(A.token, "ingestion_create_document", {
    p_title: `${STAMP}_carrier_estimate.pdf`,
    p_mimetype: "application/pdf",
    p_size: 42,
    p_sourcetype: "archive",
    p_sourceid: `archive/probe/${STAMP}`,
    p_classification: "carrier_estimate",
    p_status: "ready",
    p_storageid: null,
  });
  const docId = docRes.body?.docId ?? docRes.body?.documentId ?? null;
  if (docId) created.docs.push(docId);
  check("1. document row created", Boolean(docId), `docId=${docId ?? docRes.status}`);

  // 2. Upsert one candidate (the claim-discovery engine's contract).
  const candBody = {
    p_candidates: [
      {
        archiveId: null,
        claimKey: `${STAMP}-GAP-99-0001`,
        claimNumber: "GAP-99-0001",
        customer: "Mat Probe Homeowner",
        property: "101 Probe Ave, Tampa FL 33601",
        carrier: "State Farm",
        fileCount: 2,
        totalSize: 42,
        confidence: 0.9,
        filePaths: [`${STAMP}_carrier_estimate.pdf`, `${STAMP}_inspection.pdf`],
        evidence: [`${STAMP}_carrier_estimate.pdf`],
      },
      {
        archiveId: null,
        claimKey: `${STAMP}-GAP-99-0002`,
        claimNumber: "GAP-99-0002",
        customer: "Mat Probe Homeowner",
        property: "202 Probe Ave, Tampa FL 33601",
        carrier: "Allstate",
        fileCount: 1,
        totalSize: 21,
        confidence: 0.8,
        filePaths: [`${STAMP}_reject_me.pdf`],
        evidence: [`${STAMP}_reject_me.pdf`],
      },
    ],
  };
  const up = await rpc(A.token, "insurance_upsert_candidates", candBody);
  check("2. candidates upserted", up.status === 200, `HTTP ${up.status}`);

  const cands = (await rpc(A.token, "insurance_list_claim_candidates", {})).body ?? [];
  const mine = cands.filter((c) => String(c.claimKey ?? "").includes(STAMP));
  created.candidates.push(...mine.map((c) => c._id).filter(Boolean));
  const cand1 = mine.find((c) => c.claimNumber === "GAP-99-0001");
  const cand2 = mine.find((c) => c.claimNumber === "GAP-99-0002");
  check("3. candidates listed (2 pending)", mine.length === 2 && cand1 && cand2, `found=${mine.length}`);
  console.log(`   candidate shape: ${shape(cand1)}`);

  // 4. Approve candidate 1.
  const app = await rpc(A.token, "insurance_approve_claim_candidate", { p_candidateid: cand1._id });
  const claimId = app.body?.claimId ?? app.body?.claim_id ?? null;
  if (claimId) created.claims.push(claimId);
  check("4. approval returns claimId", app.status === 200 && Boolean(claimId), `HTTP ${app.status} claimId=${claimId ?? "MISSING"} resp=${shape(app.body)}`);

  // 5. Claim row exists in insurance_list_claims with real fields.
  const claims = (await rpc(A.token, "insurance_list_claims", { p_status: null })).body ?? [];
  const mineClaims = claims.filter((r) => String(r?.claim?.claimNumber ?? r?.claimNumber ?? "").includes("GAP-99-0001") || String(r?._id ?? "") === String(claimId ?? ""));
  const claimRow = mineClaims[0] ?? null;
  check("5. claim appears in list", mineClaims.length === 1 && Boolean(claimRow), `count=${mineClaims.length}`);
  if (claimRow) {
    const c = claimRow.claim ?? claimRow;
    console.log(`   claim row shape: ${shape(claimRow)}`);
    console.log(`   claim fields: number=${JSON.stringify(c.claimNumber)} customer=${JSON.stringify(c.customer)} property=${JSON.stringify(c.property)} carrier=${JSON.stringify(c.carrier)} status=${JSON.stringify(c.status)} sourceCandidateId=${JSON.stringify(c.sourceCandidateId ?? c.sourceCandidateID ?? null)}`);
  }

  // 6. Claim package retrievable immediately after creation.
  const pkg = await rpc(A.token, "insurance_get_claim_package", { p_claimid: claimId });
  check("6. claim package resolves", pkg.status === 200 && pkg.body?.claim != null, `HTTP ${pkg.status} pkg=${shape(pkg.body)}`);
  if (pkg.status === 200 && pkg.body?.claim) {
    console.log(`   pkg.claim keys: ${shape(pkg.body.claim)}`);
    console.log(`   evidenceDocs: ${shape(pkg.body.evidenceDocs)} supplements: ${shape(pkg.body.supplements)} findings: ${shape(pkg.body.findings)}`);
  }

  // 7. Timeline retrievable.
  const tl = await rpc(A.token, "insurance_get_claim_timeline", { p_claimid: claimId });
  check("7. claim timeline resolves", tl.status === 200, `HTTP ${tl.status} shape=${shape(tl.body)}`);

  // 8. Evidence linkage — claim → evidence (attach the document explicitly and verify).
  const att = await rpc(A.token, "insurance_attach_claim_evidence", { p_claimid: claimId, p_documentid: docId });
  check("8. evidence attach succeeds", att.status === 200, `HTTP ${att.status}`);
  const pkg2 = (await rpc(A.token, "insurance_get_claim_package", { p_claimid: claimId })).body ?? {};
  const ev = Array.isArray(pkg2.evidenceDocs) ? pkg2.evidenceDocs : [];
  check("8b. evidence visible in package", ev.length >= 1, `evidenceDocs=${ev.length}`);

  // 9. Reject candidate 2 → NO claim created.
  const rej = await rpc(A.token, "insurance_reject_claim_candidate", { p_candidateid: cand2._id });
  check("9. rejection succeeds", rej.status === 200, `HTTP ${rej.status}`);
  const claimsAfterRej = (await rpc(A.token, "insurance_list_claims", { p_status: null })).body ?? [];
  const rejClaims = claimsAfterRej.filter((r) => String(r?.claim?.claimNumber ?? r?.claimNumber ?? "").includes("GAP-99-0002"));
  check("9b. rejected candidate created NO claim", rejClaims.length === 0, `count=${rejClaims.length}`);

  // 10. Double approval → no duplicate claim.
  const app2 = await rpc(A.token, "insurance_approve_claim_candidate", { p_candidateid: cand1._id });
  const claimsAfter2 = (await rpc(A.token, "insurance_list_claims", { p_status: null })).body ?? [];
  const dup = claimsAfter2.filter((r) => String(r?.claim?.claimNumber ?? r?.claimNumber ?? "").includes("GAP-99-0001"));
  check("10. double approval does not duplicate", app2.status !== 200 || dup.length === 1, `HTTP ${app2.status} count=${dup.length}`);

  // 11. Cross-workspace isolation: tenant B cannot see tenant A's claim.
  const B = await signup();
  userB = B.userId;
  tenantB = B.tenantId;
  if (B.token && tenantB) {
    const cross = await rpc(B.token, "insurance_get_claim_package", { p_claimid: claimId });
    check("11. cross-workspace package access fails", cross.status !== 200 || cross.body?.claim == null, `HTTP ${cross.status} claim=${cross.body?.claim != null}`);
    const crossList = (await rpc(B.token, "insurance_list_claims", { p_status: null })).body ?? [];
    const crossMine = crossList.filter((r) => String(r?._id ?? "") === String(claimId));
    check("11b. cross-workspace list hides claim", crossMine.length === 0, `visible=${crossMine.length}`);
  } else {
    check("11. cross-workspace probe skipped (tenant B unavailable)", false, "tenant B setup failed");
  }

  console.log(`\nRESULT: ${checks.filter((c) => c.ok).length}/${checks.length} checks passed`);
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
} finally {
  await cleanup();
}
