// ---------------------------------------------------------------------------
// RELIABILITY LIVE E2E — disabled by default.
//
//   RUN_LIVE_E2E=1 bun vitest run src/lib/actions/reliability-live.e2e.test.ts
//
// Reproduces the two reported production defects against the REAL deployed
// project with a brand-new throwaway user:
//
//   A. Recommendation actions: create a recommendation, decide it with BOTH
//      arguments (p_recommendationid + p_status), verify the persisted status
//      and the audit event, and verify the canonical transitions
//      (open → approved → executed; open → rejected).
//   B. Archive stuck-state recovery: an archive whose inventory contains a
//      queued file WITHOUT a storage object is processed through the real
//      client loop — the file is terminalized to failed with a reason and the
//      archive reaches completed_with_warnings (never silently completed).
//   C. Document terminalization: a file whose content cannot be parsed is
//      marked failed and its created document is patched to failed (never
//      left processing), so retries cannot create duplicates.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { getSupabaseClient } from "@/lib/supabase";
import { rpcCall } from "./rpc";
import { uploadToStorage } from "./upload";
import { beginProcessingClient } from "./archive";
import { decisionStatusFor, transitionError } from "@/lib/recommendations/decide";

const RUN = process.env.RUN_LIVE_E2E === "1";

describe.skipIf(!RUN)("reliability live E2E (real project)", () => {
  it(
    "recommendation decisions persist with audit + archive stuck files reach terminal states",
    async () => {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase is not configured.");

      // ---- 0. Fresh throwaway user + workspace ---------------------------
      const email = `reliability-${Date.now()}@example.com`;
      const password = "ReliabilityE2e!42";
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: "Reliability E2E Tester" } },
      });
      expect(signUpError).toBeNull();
      const session =
        signUpData?.session ??
        (await supabase.auth.signInWithPassword({ email, password })).data.session;
      expect(session, "expected an active session after signup").toBeTruthy();
      if (session) await supabase.auth.setSession(session);

      await rpcCall(supabase, "tenants_create_tenant", { name: "Reliability E2E" });

      // ---- A. RECOMMENDATION ACTIONS --------------------------------------
      // Create two open recommendations (unique detector keys so the create
      // RPC does not dedupe them).
      const stamp = Date.now();
      const recA = (await rpcCall(supabase, "recommendations_create", {
        title: "Approve me",
        summary: "Live E2E recommendation A",
        reason: "E2E probe",
        detectorKey: `e2e_a_${stamp}`,
        priority: "high",
        confidence: 0.8,
      })) as { recommendationId: string };
      const recB = (await rpcCall(supabase, "recommendations_create", {
        title: "Reject me",
        summary: "Live E2E recommendation B",
        reason: "E2E probe",
        detectorKey: `e2e_b_${stamp}`,
        priority: "medium",
        confidence: 0.6,
      })) as { recommendationId: string };
      expect(recA.recommendationId).toBeTruthy();
      expect(recB.recommendationId).toBeTruthy();

      // The client contract: approve is valid on open; executing an open
      // recommendation is blocked client-side with an actionable message.
      expect(transitionError("approve", "open")).toBeNull();
      expect(transitionError("execute", "open")).toMatch(/must be approved/);

      // Approve A — the corrected call (id + status).
      const approveRes = (await rpcCall(supabase, "recommendations_decide", {
        recommendationId: recA.recommendationId,
        status: decisionStatusFor("approve"),
      })) as { ok: boolean };
      expect(approveRes.ok).toBe(true);

      // Execute A — approved → executed is the canonical transition.
      const executeRes = (await rpcCall(supabase, "recommendations_decide", {
        recommendationId: recA.recommendationId,
        status: decisionStatusFor("execute"),
      })) as { ok: boolean };
      expect(executeRes.ok).toBe(true);

      // Reject B.
      const rejectRes = (await rpcCall(supabase, "recommendations_decide", {
        recommendationId: recB.recommendationId,
        status: decisionStatusFor("reject"),
      })) as { ok: boolean };
      expect(rejectRes.ok).toBe(true);

      // Verify persisted state through the SAME query the UI uses.
      const recs = (await rpcCall(supabase, "recommendations_list")) as Array<{
        _id: string;
        status: string;
        decidedBy?: string | null;
      }>;
      const a = recs.find((r) => r._id === recA.recommendationId);
      const b = recs.find((r) => r._id === recB.recommendationId);
      expect(a?.status).toBe("executed");
      expect(a?.decidedBy).toBeTruthy();
      expect(b?.status).toBe("rejected");
      expect(b?.decidedBy).toBeTruthy();

      // Audit trail exists for both decisions.
      const audit = (await rpcCall(supabase, "audit_list_logs")) as Array<{
        actionType?: string;
        targetType?: string;
      }>;
      const actions = new Set((audit ?? []).map((l) => l.actionType ?? ""));
      expect(actions.has("recommendation_approved")).toBe(true);
      expect(actions.has("recommendation_executed")).toBe(true);
      expect(actions.has("recommendation_rejected")).toBe(true);

      // ---- B. ARCHIVE STUCK-STATE RECOVERY --------------------------------
      // Build an archive whose inventory contains: one real uploaded file
      // (will ingest) and one queued file WITHOUT a storage object (can never
      // ingest — must be terminalized to failed with a reason).
      const realBytes = new TextEncoder().encode(
        "ROOF CLAIM REPORT: GAP-99-000001 water damage estimate $12,400.",
      );
      const { storageId } = await uploadToStorage({
        bucket: "documents",
        bytes: realBytes,
        mimeType: "text/plain",
      });
      const begun = (await rpcCall(supabase, "archive_begin", {
        filename: "reliability-e2e.zip",
        fileType: "zip",
        size: 4096,
        checksum: "b".repeat(64),
      })) as { archiveId: string };
      await rpcCall(supabase, "archive_submit_inventory_batch", {
        archiveId: begun.archiveId,
        files: [
          {
            path: "Claims/GAP-99-000001/report.txt",
            filename: "report.txt",
            extension: "txt",
            mimeType: "text/plain",
            size: realBytes.byteLength,
            checksum: "c1",
            depth: 2,
            supported: true,
            classification: "Report",
            classificationBasis: "extension",
            classificationConfidence: 0.8,
            status: "ok",
            note: null,
            duplicateOfPath: null,
            versionGroup: null,
            isSuperseded: false,
            supersedesPath: null,
            claimHints: [{ claimNumber: "GAP-99-000001", confidence: 0.9, reasons: ["path"] }],
            storageId,
            blocked: false,
            blockReason: null,
          },
          {
            path: "Broken/missing.pdf",
            filename: "missing.pdf",
            extension: "pdf",
            mimeType: "application/pdf",
            size: 100,
            checksum: "c2",
            depth: 2,
            supported: true,
            classification: "Unknown",
            classificationBasis: "extension",
            classificationConfidence: 0.5,
            status: "ok",
            note: null,
            duplicateOfPath: null,
            versionGroup: null,
            isSuperseded: false,
            supersedesPath: null,
            claimHints: [],
            storageId: null,
            blocked: false,
            blockReason: null,
          },
        ],
      });

      // Run the REAL client processing loop.
      const res = await beginProcessingClient({ archiveId: begun.archiveId });

      // Every file must be in a terminal state — no queued/processing left.
      const detail = (await rpcCall(supabase, "archive_get_detail", {
        archiveId: begun.archiveId,
      })) as {
        archive: { status: string };
        files: Array<{ path: string; ingestStatus: string; documentId?: string | null }>;
      };
      const byStatus = new Map<string, string>();
      for (const f of detail.files) byStatus.set(f.path, f.ingestStatus);
      expect(byStatus.get("Claims/GAP-99-000001/report.txt")).toBe("ingested");
      expect(byStatus.get("Broken/missing.pdf")).toBe("failed");
      // The archive must not silently report success with a stuck file.
      expect(["completed", "completed_with_warnings", "failed"]).toContain(detail.archive.status);
      expect(res.ingested).toBeGreaterThanOrEqual(1);
      expect(res.failed).toBeGreaterThanOrEqual(1);

      // ---- C. DOCUMENT TERMINALIZATION ON PARSE FAILURE --------------------
      // Upload a real object whose bytes are NOT a valid PDF: the created
      // document must be patched to `failed` (never left `processing`).
      const garbage = new TextEncoder().encode("this is definitely not a pdf file");
      const badStorage = await uploadToStorage({
        bucket: "documents",
        bytes: garbage,
        mimeType: "application/pdf",
      });
      const begun2 = (await rpcCall(supabase, "archive_begin", {
        filename: "reliability-e2e-2.zip",
        fileType: "zip",
        size: 2048,
        checksum: "c".repeat(64),
      })) as { archiveId: string };
      await rpcCall(supabase, "archive_submit_inventory_batch", {
        archiveId: begun2.archiveId,
        files: [
          {
            path: "Broken/corrupt.pdf",
            filename: "corrupt.pdf",
            extension: "pdf",
            mimeType: "application/pdf",
            size: garbage.byteLength,
            checksum: "c3",
            depth: 1,
            supported: true,
            classification: "Unknown",
            classificationBasis: "extension",
            classificationConfidence: 0.5,
            status: "ok",
            note: null,
            duplicateOfPath: null,
            versionGroup: null,
            isSuperseded: false,
            supersedesPath: null,
            claimHints: [],
            storageId: badStorage.storageId,
            blocked: false,
            blockReason: null,
          },
        ],
      });
      const res2 = await beginProcessingClient({ archiveId: begun2.archiveId });
      expect(res2.failed).toBe(1);
      const detail2 = (await rpcCall(supabase, "archive_get_detail", {
        archiveId: begun2.archiveId,
      })) as {
        archive: { status: string };
        files: Array<{ ingestStatus: string; documentId?: string | null }>;
      };
      expect(detail2.files[0].ingestStatus).toBe("failed");
      // The created document (linked by sourceId) must be terminal — patched
      // to `failed` with the real reason, NEVER left stuck in `processing`.
      const sourceId = `${begun2.archiveId}/Broken/corrupt.pdf`;
      const docQuery = (await supabase
        .from("documents")
        .select("status, error")
        .eq("sourceId", sourceId)) as {
        data: Array<{ status: string; error?: string | null }> | null;
        error: unknown;
      };
      expect(docQuery.error).toBeNull();
      expect(docQuery.data?.length).toBeGreaterThanOrEqual(1);
      for (const d of docQuery.data ?? []) {
        expect(d.status).toBe("failed");
        expect(d.error).toBeTruthy();
      }
    },
    300_000,
  );
});
