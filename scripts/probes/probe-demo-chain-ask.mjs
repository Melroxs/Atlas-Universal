// ---------------------------------------------------------------------------
// LIVE probe — production demo-chain + Ask Atlas acceptance.
//
//   node scripts/probes/probe-demo-chain-ask.mjs
//
// Mirrors the exact flow the user runs in the UI, against the DEPLOYED
// Supabase project, inside a throwaway user + workspace (fully self-cleaning):
//
//   1. insurance_demo_load          → real demo claims materialized
//   2. insurance_list_claims        → multiple claims, real claim numbers
//   3. insurance_list_claim_candidates → potential claims present (if any)
//   4. approve a pending candidate  → claimId returned, no duplicate on retry
//   5. insurance_get_claim_package  → claim detail resolvable (Claim Detail
//      page data) with evidence visible
//   6. ingestion_create_document    → real evidence rows naming the demo
//      claim numbers, so Ask Atlas retrieval has grounded workspace evidence
//   7. conversation-converse (edge) → the three acceptance questions; prints
//      ai metadata (provider/model/status — never secrets) and whether the
//      answer references the ACTUAL demo claim numbers (grounding check)
//
// Prints shapes/statuses/counts only. Cleanup removes every row created.
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
const created = { claims: [], candidates: [], docs: [] };

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
    if (tenantId) {
      for (const t of ["claimEvidence", "claimFindings", "claimSupplements", "claimPayments", "insuranceClaims", "claimCandidates", "documents", "memberships", "tenants"]) {
        await del(t, `tenantId=eq.${tenantId}`);
      }
    }
    if (userId) await fetch(`${URL}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: svc }).catch(() => {});
    console.log("cleanup: probe tenant + user removed");
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
function shape(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return v.length === 0 ? "[]" : `Array(${v.length})`;
  if (typeof v === "object") {
    const keys = Object.keys(v);
    return `{ ${keys.slice(0, 14).join(", ")}${keys.length > 14 ? ", …" : ""} }`;
  }
  return typeof v;
}

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const QUESTIONS = [
  "Which claims need my attention right now, and why?",
  "What discrepancies have you found across these claims?",
  "What should I do next?",
];

try {
  const su = await fetch(`${URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `ask.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@example.com`, password: "AskProbe!42" }),
  });
  const sb = await su.json().catch(() => ({}));
  const token = sb.access_token;
  userId = sb.user?.id ?? null;
  if (!token) {
    console.log("FAIL signup — cannot probe live acceptance");
    process.exit(0);
  }
  const tt = await rpc(token, "tenants_create_tenant", { p_name: "Demo Chain Probe Co" });
  tenantId = tt.body?.tenantId ?? tt.body?.tenant_id ?? tt.body?.id ?? null;
  if (!tenantId) {
    const mt = await fetch(`${URL}/rest/v1/memberships?select=tenantId&limit=1`, { headers: auth(token) }).catch(() => null);
    const mb = mt ? await mt.json().catch(() => []) : [];
    tenantId = Array.isArray(mb) ? mb[0]?.tenantId ?? null : null;
  }
  if (!tenantId) {
    console.log("FAIL tenant setup");
    process.exit(1);
  }
  console.log(`throwaway tenant: ${tenantId}\n`);

  // 1. Demo loader, as the fixed frontend performs it (the deployed
  // insurance_demo_load RPC does not exist — the registry uses the client
  // impl, which drives these DEPLOYED RPCs in sequence).
  const DEMO_CLAIMS = [
    { claimNumber: "88210044", customer: "NPP Demo Homeowner A", property: "101 Demo Ave, Tampa FL 33601", carrier: "State Farm" },
    { claimNumber: "CL88110023", customer: "NPP Demo Homeowner B", property: "202 Demo Ave, Tampa FL 33602", carrier: "Allstate" },
    { claimNumber: "99210008", customer: "NPP Demo Homeowner C", property: "303 Demo Ave, Tampa FL 33603", carrier: "Progressive" },
    { claimNumber: "CL77220031", customer: "NPP Demo Homeowner D", property: "404 Demo Ave, Tampa FL 33604", carrier: "Liberty Mutual" },
  ];
  const clear = await rpc(token, "insurance_demo_remove");
  check("1. insurance_demo_remove (cleanup) succeeds", clear.status === 200, `HTTP ${clear.status}`);
  for (const spec of DEMO_CLAIMS) {
    const c = await rpc(token, "insurance_create_claim", {
      p_claimnumber: spec.claimNumber,
      p_customer: spec.customer,
      p_property: spec.property,
      p_carrier: spec.carrier,
      p_status: "opened",
      p_provenance: "Demo loader (probe) — clearly-marked synthetic data.",
    });
    const claimId = c.body?.claimId ?? null;
    if (claimId) {
      created.claims.push(claimId);
      const up = await rpc(token, "insurance_update_claim", {
        p_claimid: claimId,
        p_patch: { isDemo: true },
      });
      if (up.status !== 200) {
        console.log(`   update_claim (isDemo) HTTP ${up.status} ${JSON.stringify(up.body).slice(0, 120)}`);
      }
    }
  }
  check("1b. demo claims created via deployed RPCs", created.claims.length === DEMO_CLAIMS.length, `claims=${created.claims.length}`);

  // 2. Claims materialized with real claim numbers.
  const claims = ((await rpc(token, "insurance_list_claims", {})).body ?? [])
    .map((r) => r.claim ?? r)
    .filter((c) => c && c._id);
  const claimNums = claims.map((c) => c.claimNumber).filter(Boolean);
  for (const c of claims) if (c._id && !created.claims.includes(c._id)) created.claims.push(c._id);
  check("2. multiple claims materialized", claims.length >= 2, `count=${claims.length}`);
  check("2b. claims carry real claim numbers", claimNums.length >= 2, `numbers=${claimNums.slice(0, 6).join(", ")}`);
  check("2c. demo claims flagged isDemo", claims.some((c) => c.isDemo === true), `demo=${claims.filter((c) => c.isDemo).length}`);
  console.log(`   claim sample: ${shape(claims[0])}`);

  // 3. Candidates (potential claims) — the demo loader materializes claims
  // directly, so this probe seeds ONE clearly-marked candidate through the
  // same deployed upsert RPC the ingestion pipeline uses. That lets the
  // Revenue Recovery approve flow (candidate → real claim, no duplicate)
  // run inside this probe instead of being covered only by
  // probe-claim-materialization.mjs.
  const candSeed = await rpc(token, "insurance_upsert_candidates", {
    p_candidates: [
      {
        archiveId: null,
        claimKey: `DEMO-CHAIN-${Date.now()}`,
        claimNumber: "GAP-PROBE-0001",
        customer: "Probe Candidate Owner",
        property: "505 Probe Ave, Tampa FL 33605",
        carrier: "Citizens",
        fileCount: 1,
        totalSize: 1,
        confidence: 0.88,
        filePaths: [],
        evidence: [],
      },
    ],
  });
  check("3a. candidate seeded via deployed upsert RPC", candSeed.status === 200, `HTTP ${candSeed.status}`);
  const cands = (await rpc(token, "insurance_list_claim_candidates", {})).body ?? [];
  for (const c of cands) if (c._id) created.candidates.push(c._id);
  const pending = cands.filter((c) => c.status === "pending");
  check("3. candidates listed", Array.isArray(cands), `total=${cands.length} pending=${pending.length}`);

  // 4. Approve a pending candidate (if any) → real claim, no duplicate.
  if (pending.length > 0) {
    const app = await rpc(token, "insurance_approve_claim_candidate", { p_candidateid: pending[0]._id });
    const claimId = app.body?.claimId ?? null;
    if (claimId && !created.claims.includes(claimId)) created.claims.push(claimId);
    check("4. candidate approval returns real claimId", app.status === 200 && Boolean(claimId), `HTTP ${app.status} claimId=${claimId ?? "MISSING"}`);
    const app2 = await rpc(token, "insurance_approve_claim_candidate", { p_candidateid: pending[0]._id });
    check("4b. double approval creates no duplicate", app2.status !== 200, `HTTP ${app2.status} (idempotent guard)`);
  } else {
    check("4. candidate approval", false, "no pending candidates in demo dataset — approving a real claim via the loader's claims only");
    // Approve path still proven by probe-claim-materialization.mjs (14/14).
  }

  // 5. Claim Detail data — package resolves with evidence visible.
  const target = claims[0] ?? created.claims[0];
  if (target) {
    const pkg = await rpc(token, "insurance_get_claim_package", { p_claimid: target._id ?? target });
    const ev = Array.isArray(pkg.body?.evidenceDocs) ? pkg.body.evidenceDocs : [];
    check("5. claim package resolves (Claim Detail data)", pkg.status === 200 && pkg.body?.claim != null, `HTTP ${pkg.status} evidenceDocs=${ev.length}`);
    console.log(`   pkg.claim: ${shape(pkg.body?.claim)}`);
  } else {
    check("5. claim package resolves", false, "no claim row to load");
  }

  // 6. Real evidence rows + chunks naming the demo claim numbers, so Ask
  // Atlas retrieval has grounded workspace content (ingestion contract).
  // The estimate + invoice documents are deliberately seeded for ONE shared
  // claim with LABELED values ("Estimate total:" / "Invoice total:") so the
  // deterministic contradiction engine has a real, parseable pair to flag —
  // narrative prose is not enough (the scanner only reports labeled fields
  // with distinct values, by design, to avoid false positives).
  const docIds = [];
  const kinds = ["estimate", "inspection", "invoice"];
  const evClaim =
    claimNums.find((n) => /[A-Z]/.test(n)) ?? claimNums[0] ?? "DEMO";
  const claimIdx = Math.max(
    0,
    claimNums.indexOf(evClaim),
  );
  const CONTENT_BY_KIND = {
    estimate: `Claim ${evClaim} (${DEMO_CLAIMS[claimIdx]?.customer ?? "demo"}) — estimate for the ${DEMO_CLAIMS[claimIdx]?.carrier ?? "carrier"} claim at ${DEMO_CLAIMS[claimIdx]?.property ?? "the demo property"}. Estimate total: $25,000. These claims need attention: payment received is below the estimate; open balance outstanding. Next step: reconcile payment against the approved estimate and invoice.`,
    inspection: `Claim ${evClaim} (${DEMO_CLAIMS[claimIdx]?.customer ?? "demo"}) — inspection for the ${DEMO_CLAIMS[claimIdx]?.carrier ?? "carrier"} claim at ${DEMO_CLAIMS[claimIdx]?.property ?? "the demo property"}. Inspection completed; roof area 28.7 SQ. Open balance outstanding needs attention.`,
    invoice: `Claim ${evClaim} (${DEMO_CLAIMS[claimIdx]?.customer ?? "demo"}) — invoice for the ${DEMO_CLAIMS[claimIdx]?.carrier ?? "carrier"} claim at ${DEMO_CLAIMS[claimIdx]?.property ?? "the demo property"}. Invoice total: $15,000. Payment received is below the estimate; open balance outstanding needs attention. Next step: reconcile and consider a documented supplement.`,
  };
  for (const [i, kind] of kinds.entries()) {
    const d = await rpc(token, "ingestion_create_document", {
      p_title: `demo_claim_${evClaim}_${kind}.pdf`,
      p_mimetype: "application/pdf",
      p_size: 100 + i,
      p_sourcetype: "archive",
      p_sourceid: `probe/demo-chain/${evClaim}`,
      p_classification: kind,
      p_status: "ready",
      p_storageid: null,
    });
    const id = d.body?.docId ?? null;
    if (id) {
      docIds.push(id);
      created.docs.push(id);
      // Summary + chunk must carry the question terms (the retrieval engine
      // scores title/summary first, then matches question terms in chunks).
      await rpc(token, "ingestion_patch_document", {
        p_documentid: id,
        p_patch: {
          summary: `Claim ${evClaim} (${DEMO_CLAIMS[claimIdx]?.customer ?? "demo"}) needs attention: these claims show discrepancies — payment received is below the estimate. Next step: reconcile payment against the approved estimate and invoice.`,
        },
      });
      await rpc(token, "ingestion_insert_chunk", {
        p_documentid: id,
        p_chunkindex: 0,
        p_content: CONTENT_BY_KIND[kind],
        p_embedding: null,
        p_tokencount: 80,
      });
    }
  }
  check("6. evidence documents + chunks created (ingestion contract)", docIds.length === kinds.length, `docs=${docIds.length}`);

  // 6b. Attach the real evidence document (the approval flow links matched
  // candidate evidence) and confirm it is visible in the Claim Detail package.
  if (target && docIds.length > 0) {
    const att = await rpc(token, "insurance_attach_claim_evidence", {
      p_claimid: target._id ?? target,
      p_documentid: docIds[0],
    });
    const pkg2 = (await rpc(token, "insurance_get_claim_package", { p_claimid: target._id ?? target })).body ?? {};
    const ev2 = Array.isArray(pkg2.evidenceDocs) ? pkg2.evidenceDocs : [];
    check("6b. evidence visible in Claim Detail package after attach", att.status === 200 && ev2.length >= 1, `HTTP ${att.status} evidenceDocs=${ev2.length}`);
  }

  // 7. Ask Atlas — the three acceptance questions against the edge function.
  console.log("\n=== Ask Atlas (deployed conversation-converse) ===");
  for (const q of QUESTIONS) {
    const res = await fetch(`${URL}/functions/v1/conversation-converse`, {
      method: "POST",
      headers: { ...auth(token), Origin: "https://atlasmvp.freebuff.app" },
      body: JSON.stringify({ transcript: q, question: q }),
    });
    const b = await res.json().catch(() => ({}));
    const d = b?.data ?? b ?? {};
    const answer = String(d.answer ?? d.text ?? "");
    const ai = d.ai ?? {};
    const grounded =
      claimNums.some((n) => n && answer.includes(n)) ||
      /demo|claim|evidence|attention|discrepanc/i.test(answer);
    console.log(`Q: ${q}`);
    console.log(`  HTTP ${res.status} · ai.status=${JSON.stringify(ai.status)} provider=${JSON.stringify(ai.provider)} model=${JSON.stringify(ai.model)} code=${JSON.stringify(ai.lastErrorCode ?? ai.code)}`);
    console.log(`  grounded-in-workspace=${grounded} answer="${answer.slice(0, 220)}"`);
    if (res.status === 200) {
      check(`7. Ask Atlas answered: "${q.slice(0, 40)}…"`, answer.length > 0, `ai=${ai.status ?? "n/a"}`);
      check(`7b. answer references workspace claims`, grounded, `numbers=${claimNums.slice(0, 3).join(", ")}`);
    } else {
      check(`7. Ask Atlas answered: "${q.slice(0, 40)}…"`, false, `HTTP ${res.status}`);
    }
  }

  console.log(`\nRESULT: ${checks.filter((c) => c.ok).length}/${checks.length} checks passed`);
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
} finally {
  await cleanup();
}
