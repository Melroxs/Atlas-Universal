// ---------------------------------------------------------------------------
// LIVE Gemini round-trip verification against the DEPLOYED conversation-converse.
//
//   node scripts/verify-gemini-roundtrip.mjs
//
// Creates a throwaway user + tenant, seeds REAL evidence (a claim candidate and
// two documents with conflicting payment amounts), asks the exact questions
// from the acceptance criteria through the deployed edge function, prints the
// mode / ai metadata / answer excerpts, then cleans up every row it created
// (documents cascade chunks; memberships → tenant; user via Admin API).
//
// Prints no secrets. Exits 0 on success, 1 when the deployed function does not
// return a Gemini ("ai") answer for the seeded evidence.
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

const ORIGIN = "https://atlasmvp.freebuff.app";
const email = `rt.${Date.now()}@example.com`;
const pass = "RtCheck!42";
const auth = (t) => ({ apikey: ANON, "Content-Type": "application/json", Authorization: `Bearer ${t}` });
const svc = { apikey: SERVICE, "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` };
const h = (extra) => ({ ...svc, ...extra });

let userId = null;
let tenantId = null;
const createdDocIds = [];
const createdCandidateIds = [];

async function cleanup() {
  try {
    for (const id of createdDocIds) await fetch(`${URL}/rest/v1/documents?_id=eq.${id}`, { method: "DELETE", headers: h() }).catch(() => {});
    for (const id of createdCandidateIds) await fetch(`${URL}/rest/v1/claimCandidates?_id=eq.${id}`, { method: "DELETE", headers: h() }).catch(() => {});
    if (tenantId) await fetch(`${URL}/rest/v1/tenants?_id=eq.${tenantId}`, { method: "DELETE", headers: h() }).catch(() => {});
    if (userId) await fetch(`${URL}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: h() }).catch(() => {});
    console.log("cleanup: probe data removed");
  } catch (e) {
    console.error("cleanup error:", String(e).slice(0, 200));
  }
}

try {
  // 1. Throwaway user + tenant.
  const su = await fetch(`${URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pass, data: { full_name: "RT Probe" } }),
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
    body: JSON.stringify({ p_name: "RT Probe Co" }),
  }).catch(() => null);
  const tb = tt ? await tt.json().catch(() => ({})) : {};
  tenantId = tb.tenantId ?? tb.tenant_id ?? tb.id ?? null;
  if (!tenantId) {
    // Try the alternate response shapes some builds return.
    const mt = await fetch(`${URL}/rest/v1/memberships?select=tenantId&limit=1`, {
      headers: auth(token),
    }).catch(() => null);
    const mb = mt ? await mt.json().catch(() => []) : [];
    tenantId = Array.isArray(mb) ? mb[0]?.tenantId ?? null : null;
  }
  if (!tenantId) {
    console.log("FAIL: no tenantId after tenants_create_tenant");
    process.exit(1);
  }
  console.log(`tenant created: ${tenantId}`);

  // 2. Seed a claim candidate (retrieval evidence for "claims need attention").
  const cand = await fetch(`${URL}/rest/v1/claimCandidates`, {
    method: "POST",
    headers: { ...h(), Prefer: "return=representation" },
    body: JSON.stringify({
      tenantId,
      claimKey: "GAP-26-51847",
      claimNumber: "GAP-26-51847",
      customer: "Mitchell Construction",
      property: "123 Oak Street",
      confidence: 0.92,
      status: "pending",
      fileCount: 4,
      evidence: [{ path: "Claims/GAP-26-51847/FNOL_Report.pdf" }, { path: "Claims/GAP-26-51847/Estimate_Xactimate.pdf" }],
    }),
  });
  const candRows = cand.ok ? await cand.json().catch(() => []) : [];
  if (candRows[0]?._id) createdCandidateIds.push(candRows[0]._id);
  console.log(`claim candidate seeded: ${cand.status} ${candRows[0]?._id ?? "(failed)"}`);

  // 3. Seed two documents with CONFLICTING payment amounts (contradiction evidence).
  const mkDoc = async (title, classification, content) => {
    const d = await fetch(`${URL}/rest/v1/documents`, {
      method: "POST",
      headers: { ...h(), Prefer: "return=representation" },
      body: JSON.stringify({
        tenantId,
        title,
        sourceType: "upload",
        mimeType: "application/pdf",
        classification,
        status: "ready",
        summary: content.slice(0, 120),
        chunkCount: 1,
      }),
    });
    const rows = d.ok ? await d.json().catch(() => []) : [];
    const docId = rows[0]?._id;
    if (!docId) {
      console.log(`document seed failed (${title}): HTTP ${d.status}`);
      return;
    }
    createdDocIds.push(docId);
    await fetch(`${URL}/rest/v1/documentChunks`, {
      method: "POST",
      headers: { ...h(), Prefer: "return=representation" },
      body: JSON.stringify({ tenantId, documentId: docId, chunkIndex: 0, content }),
    }).catch(() => {});
    return docId;
  };
  await mkDoc("Carrier_Payment_60811.pdf", "Payment", "Claim GAP-26-51847. Payment amount: $18,500.00 issued June 2, 2026.");
  await mkDoc("Carrier_Payment_60812.pdf", "Payment", "Claim GAP-26-51847. Payment amount: $22,300.00 issued June 10, 2026.");

  // 4. Ask through the DEPLOYED function.
  const ask = async (transcript, sessionId = null) => {
    const res = await fetch(`${URL}/functions/v1/conversation-converse`, {
      method: "POST",
      headers: { ...auth(token), Origin: ORIGIN },
      body: JSON.stringify({ transcript, ...(sessionId ? { sessionId } : {}) }),
    });
    const b = await res.json().catch(() => ({}));
    const d = b?.data ?? {};
    return {
      http: res.status,
      mode: d.mode ?? "?",
      ai: d.ai ?? null,
      answer: String(d.answer ?? "").slice(0, 220),
      spoken: String(d.spoken ?? "").slice(0, 160),
      evidence: Array.isArray(d.evidence) ? d.evidence.length : 0,
      sessionId: d.sessionId ?? null,
      limitations: String(d.limitations ?? "").slice(0, 140),
    };
  };

  console.log("\n--- Q1: claims need attention ---");
  const q1 = await ask("What claims need my attention?");
  console.log(JSON.stringify(q1, null, 2));

  console.log("\n--- Q2 (follow-up, same session): tell me more ---");
  const q2 = await ask("Tell me more about the first one.", q1.sessionId);
  console.log(JSON.stringify(q2, null, 2));

  console.log("\n--- Q3: discrepancies ---");
  const q3 = await ask("What discrepancies did you find?");
  console.log(JSON.stringify(q3, null, 2));

  // 5. Verdict.
  const all = [q1, q2, q3];
  const aiAnswered = all.filter((r) => r.mode === "ai" && r.ai?.status === "connected");
  const hadEvidence = all.filter((r) => r.evidence > 0);
  console.log("\n=== VERDICT ===");
  console.log(`questions asked: ${all.length}, with retrieved evidence: ${hadEvidence.length}, Gemini (mode=ai + connected): ${aiAnswered.length}`);
  if (aiAnswered.length === 0) {
    console.log("NOT VERIFIED: deployed function did not return a Gemini answer for seeded evidence.");
    process.exitCode = 1;
  } else {
    console.log("VERIFIED: Gemini reasoning is live over tenant-scoped retrieval.");
  }
} finally {
  await cleanup();
}
