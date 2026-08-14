// ---------------------------------------------------------------------------
// Atlas live contract verification — functional probes with a throwaway user.
//
//   node scripts/verify-contracts.mjs
//
// Uses only the anon key (no management token): creates a throwaway user +
// tenant and drives the REAL deployed RPCs exactly as the frontend does:
//
//   1. recommendations_decide with ONLY p_recommendationid — the exact broken
//      call the frontend makes today (expect PGRST202 = "Action failed").
//   2. recommendations_decide with p_recommendationid + p_status — expect ok.
//   3. claim candidate approve/reject.
//   4. archive_begin → archive_submit_inventory_batch → archive_get_detail,
//      reproducing the "queued forever" state and proving the RPC contract.
//
// No secrets are printed. The throwaway tenant is left for follow-up queries.
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
  } catch {
    /* missing */
  }
  return out;
}

const env = parseEnvFile(".env.local");
const ANON = env.VITE_SUPABASE_ANON_KEY;
const URL = env.VITE_SUPABASE_URL ?? "https://ibxvzxblyhzwokljkslt.supabase.co";
if (!ANON) throw new Error("VITE_SUPABASE_ANON_KEY missing from .env.local");

const email = `verify.contracts.${Date.now()}@example.com`;
const H = { apikey: ANON, "Content-Type": "application/json" };
const signup = await fetch(`${URL}/auth/v1/signup`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({ email, password: "VerifyContracts!42", data: { full_name: "Verify" } }),
});
const sb = await signup.json().catch(() => ({}));
const token = sb.access_token;
if (!token) {
  console.log("signup failed — cannot probe live contracts");
  process.exit(0);
}
const auth = { ...H, Authorization: `Bearer ${token}` };

const rpc = async (fn, body) => {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: auth, body: JSON.stringify(body ?? {}) });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return {
    status: res.status,
    body: parsed,
    code: parsed?.code ?? null,
    message: parsed?.message ?? parsed?.hint ?? (typeof parsed === "string" ? parsed : JSON.stringify(parsed)),
  };
};

await rpc("tenants_create_tenant", { p_name: "Verify Contracts" });

console.log("=== recommendations_decide: reproduce the production call ===");
const createdRec = await rpc("recommendations_create", {
  p_title: "Contract probe recommendation",
  p_summary: "Live contract verification",
  p_reason: "Probe",
  p_detectorkey: "contract_probe",
  p_priority: "medium",
  p_confidence: 0.5,
});
const recId = createdRec.body?.recommendationId;
console.log(`  recommendations_create -> HTTP ${createdRec.status} recId=${recId ?? "(none)"}`);
if (recId) {
  // a) The exact broken call the frontend makes today (only recommendationId).
  const broken = await rpc("recommendations_decide", { p_recommendationid: recId });
  console.log(`  decide(only p_recommendationid) -> HTTP ${broken.status} code=${broken.code ?? "(none)"} msg=${String(broken.message).slice(0, 110)}`);
  // b) The corrected call (id + status).
  const fixed = await rpc("recommendations_decide", { p_recommendationid: recId, p_status: "approved" });
  console.log(`  decide(p_recommendationid + p_status) -> HTTP ${fixed.status} body=${String(fixed.message).slice(0, 110)}`);
  const after = await rpc("recommendations_list", {});
  const row = (after.body ?? []).find((r) => r._id === recId);
  console.log(`  list after approve -> status=${row?.status ?? "(not found)"}`);
}

console.log("\n=== claim candidate approve/reject contract ===");
const cand = await rpc("insurance_upsert_candidates", {
  p_candidates: [
    {
      archiveId: null,
      claimKey: "CONTRACT-PROBE-1",
      claimNumber: "CONTRACT-PROBE-1",
      customer: "Probe Co",
      property: null,
      fileCount: 1,
      totalSize: null,
      confidence: 0.7,
      filePaths: [],
      evidence: [],
    },
  ],
});
console.log(`  insurance_upsert_candidates -> HTTP ${cand.status} msg=${String(cand.message).slice(0, 110)}`);
const listed = await rpc("insurance_list_claim_candidates", {});
const probe = (listed.body ?? []).find((c) => c.claimKey === "CONTRACT-PROBE-1");
console.log(`  list candidates -> found=${!!probe} status=${probe?.status ?? "?"}`);
if (probe) {
  const appr = await rpc("insurance_approve_claim_candidate", { p_candidateid: probe._id });
  console.log(`  approve candidate -> HTTP ${appr.status} msg=${String(appr.message).slice(0, 110)}`);
  const rej2 = await rpc("insurance_reject_claim_candidate", { p_candidateid: probe._id });
  console.log(`  reject candidate (after approve) -> HTTP ${rej2.status} msg=${String(rej2.message).slice(0, 110)}`);
}

console.log("\n=== archive pipeline contract (begin → inventory → detail) ===");
const begun = await rpc("archive_begin", {
  p_filename: "contract-probe.zip",
  p_filetype: "zip",
  p_size: 1024,
  p_checksum: "a".repeat(64),
});
const archiveId = begun.body?.archiveId;
console.log(`  archive_begin -> HTTP ${begun.status} archiveId=${archiveId ?? "(none)"} msg=${String(begun.message).slice(0, 110)}`);
if (archiveId) {
  const inv = await rpc("archive_submit_inventory_batch", {
    p_archiveid: archiveId,
    p_files: [
      { path: "Claims/Claim-1/invoice.pdf", filename: "invoice.pdf", extension: "pdf", mimeType: "application/pdf", size: 512, checksum: "c1", depth: 2, supported: true, classification: "Invoice", classificationBasis: "filename", classificationConfidence: 0.8, status: "ok", note: null, duplicateOfPath: null, versionGroup: null, isSuperseded: false, supersedesPath: null, claimHints: [{ claimNumber: "Claim-1", confidence: 0.8, reasons: ["filename"] }], storageId: null, blocked: false, blockReason: null },
      { path: "Misc/notes.txt", filename: "notes.txt", extension: "txt", mimeType: "text/plain", size: 100, checksum: "c2", depth: 1, supported: true, classification: "Other", classificationBasis: "extension", classificationConfidence: 0.6, status: "ok", note: null, duplicateOfPath: null, versionGroup: null, isSuperseded: false, supersedesPath: null, claimHints: [], storageId: null, blocked: false, blockReason: null },
      { path: "Old/legacy.doc", filename: "legacy.doc", extension: "doc", mimeType: "application/msword", size: 300, checksum: "c3", depth: 2, supported: false, classification: "Unsupported", classificationBasis: "extension", classificationConfidence: 0.9, status: "unsupported", note: "Legacy .doc is not supported", duplicateOfPath: null, versionGroup: null, isSuperseded: false, supersedesPath: null, claimHints: [], storageId: null, blocked: false, blockReason: null },
    ],
    p_clientwarnings: [],
  });
  console.log(`  archive_submit_inventory_batch -> HTTP ${inv.status} msg=${String(inv.message).slice(0, 110)}`);
  const detail = await rpc("archive_get_detail", { p_archiveid: archiveId });
  const d = detail.body;
  if (d?.archive) {
    const byStatus = {};
    for (const f of d.files ?? []) byStatus[f.ingestStatus] = (byStatus[f.ingestStatus] ?? 0) + 1;
    console.log(`  archive_get_detail -> HTTP ${detail.status} archiveStatus=${d.archive.status} fileStates=${JSON.stringify(byStatus)}`);
    console.log(`  NOTE: queued files with storageId=null can never be ingested by the client loop -> stuck 'queued' (the reported bug)`);
  } else {
    console.log(`  archive_get_detail -> HTTP ${detail.status} msg=${String(detail.message).slice(0, 110)}`);
  }
}

console.log("\nDone. Throwaway tenant left in place (reset with reset-demo-data.mjs).");
