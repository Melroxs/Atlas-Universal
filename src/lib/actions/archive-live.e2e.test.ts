// ---------------------------------------------------------------------------
// LIVE end-to-end test — disabled by default.
//
//   RUN_LIVE_E2E=1 bun vitest run src/lib/actions/archive-live.e2e.test.ts
//
// Exercises the ENTIRE archive pipeline against the real deployed Supabase
// project with a brand-new throwaway user and a realistic restoration-company
// ZIP: analyzeArchive (real engine) → tenant-scoped storage uploads →
// archive_begin → archive_submit_inventory_batch → beginProcessingClient (the
// real client code that previously crashed with PGRST202) → archive_get_detail
// → insurance_list_claim_candidates. No mocks, no fake state.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { getSupabaseClient } from "@/lib/supabase";
import { rpcCall } from "./rpc";
import { analyzeArchive, buildUploadPlan } from "@/lib/archive/engine";
import { uploadToStorage } from "./upload";
import { beginProcessingClient } from "./archive";

const RUN = process.env.RUN_LIVE_E2E === "1";

interface DocSpec {
  path: string;
  content: string;
}

/** A deliberately realistic restoration-company claim package. */
function buildRestorationZip(): DocSpec[] {
  const specs: DocSpec[] = [
    {
      path: "00_FNOL/Claim-8842001_FNOL_report.txt",
      content: `FIRST NOTICE OF LOSS — Claim 8842001
Insured: Maria Gonzalez
Property: 1420 Cedar Lane, Austin TX 78701
Date of loss: 2026-03-10
Cause of loss: Wind and hail
Initial report: Roof shingles displaced, gutter damage, water entry in the kitchen.
Carrier: Lone Star Mutual Insurance
Adjuster assigned: D. Reyes
Status: Open`,
    },
    {
      path: "Claims/Claim-8842001/estimate.txt",
      content: `XACTIMATE-STYLE ESTIMATE — Claim 8842001
Line items:
- Tear off and replace asphalt shingles, 2400 sq ft
- Replace roof decking, 14 sheets
- Replace gutters and downspouts, 120 linear ft
- Interior water mitigation, kitchen
Total estimate: $24,500.00
Deductible noted: $2,500.00`,
    },
    {
      path: "Claims/Claim-8842001/invoice.txt",
      content: `INVOICE — Claim 8842001
Restoration contractor: Atlas Restoration Services
Invoice #10042
Line items:
- Roof replacement labor and materials
- Gutters and downspouts
- Kitchen water mitigation and drywall repair
Invoice total: $28,400.00
Terms: Net 30`,
    },
    {
      path: "Claims/Claim-8842001/payment.txt",
      content: `CARRIER PAYMENT — Claim 8842001
Payer: Lone Star Mutual Insurance
Payment reference: PAY-551209
Payment date: 2026-04-02
Payment amount: $15,000.00
Check note: First payment, depreciation withheld`,
    },
    {
      path: "Claims/Claim-8842001/supplement_request.txt",
      content: `SUPPLEMENT REQUEST — Claim 8842001
Supplement #1 — Submitted 2026-04-10
Omitted scope discovered during demolition:
- Additional roof decking replacement, 6 sheets
- Fascia and soffit repair
- Attic insulation replacement
Requested additional amount: $6,750.00`,
    },
    {
      path: "Claims/Claim-8842001/carrier_correspondence.txt",
      content: `CARRIER CORRESPONDENCE — Claim 8842001
2026-04-15 Email from Lone Star Mutual:
"We are reviewing supplement #1. Please provide the signed authorization and
the inspection photos before we can issue a decision."
2026-04-22 Email:
"Supplement #1 is denied pending re-inspection. The additional decking was not
documented in the initial scope."`,
    },
    {
      path: "Inspection/Claim-8842001_inspection_report.txt",
      content: `INSPECTION REPORT — Claim 8842001
Inspector: Atlas Restoration field team
Date: 2026-03-18
Findings:
- Hail damage confirmed on south-facing slope
- Decking water stain in 6 sheets
- Missing drip edge on garage section
- Photos attached: IMG_001 through IMG_014`,
    },
    {
      path: "Scope/scope_of_work.txt",
      content: `SCOPE OF WORK — Claim 8842001
Documented scope:
1. Roof shingle replacement (2400 sq ft)
2. Roof decking replacement (14 sheets + 6 sheets supplement)
3. Gutters and downspouts (120 linear ft)
4. Kitchen water mitigation
5. Fascia and soffit repair (supplement)
6. Attic insulation replacement (supplement)
Total documented scope: $31,250.00`,
    },
    {
      path: "Policy/policy_document.txt",
      content: `POLICY — Lone Star Mutual
Policy number: HOM-8842001
Named insured: Maria Gonzalez
Property: 1420 Cedar Lane, Austin TX 78701
Dwelling limit: $350,000.00
Deductible: $2,500.00
Wind/hail endorsement: Replacement cost`,
    },
    {
      path: "Customer/customer_info.txt",
      content: `CUSTOMER RECORD
Name: Maria Gonzalez
Phone: (512) 555-0184
Email: mgonzalez@example.com
Preferred contact: phone after 5pm
Signature on file: 2026-03-12`,
    },
    {
      path: "Photos/photo_log.txt",
      content: `PHOTO LOG — Claim 8842001
IMG_001 — south roof slope, hail impact
IMG_002 — displaced shingles, garage
IMG_005 — kitchen ceiling water stain
IMG_009 — decking rot, bedroom two
IMG_012 — gutter separation, rear`,
    },
    {
      path: "Xactimate/xactimate_summary.txt",
      content: `XACTIMATE SUMMARY — Claim 8842001
Roofing: $18,400.00
Exterior: $3,100.00
Interior mitigation: $3,000.00
Subtotal: $24,500.00
Sales tax: $0.00
Total: $24,500.00`,
    },
    {
      path: "Claims/Claim-8842001/notes_partial.txt",
      content: `FIELD NOTES — partial
Talked to the homeowner about the kitchen. Adjuster still needs to come back.
Homeowner mentioned the attic was not checked.`,
    },
    {
      path: "Claims/Claim-8842001/invoice_revised.txt",
      content: `REVISED INVOICE — Claim 8842001
Invoice #10042-R
Reason: corrected line items after supplement review
Revised total: $24,900.00
Original invoiced total: $28,400.00`,
    },
  ];
  return specs;
}

describe.skipIf(!RUN)("live archive pipeline E2E (real project)", () => {
  it(
    "runs a real ZIP through the real engine + real client processing end to end",
    async () => {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase is not configured.");

      // 1. Build a real ZIP in memory with jszip.
      const zip = new JSZip();
      for (const spec of buildRestorationZip()) {
        zip.file(spec.path, spec.content);
      }
      const zipBytes = await zip.generateAsync({
        type: "uint8array",
        compression: "DEFLATE",
      });

      // 2. Real client-side analysis (the same engine the UI runs).
      const analysis = await analyzeArchive({
        name: "restoration-pack.zip",
        size: zipBytes.byteLength,
        arrayBuffer: async () => zipBytes.buffer as ArrayBuffer,
      });
      expect(analysis.fileType).toBe("zip");
      expect(analysis.entries.length).toBeGreaterThanOrEqual(10);
      const plan = buildUploadPlan(analysis);
      expect(plan.ingest.length).toBeGreaterThanOrEqual(10);

      // 3. Fresh throwaway user on the real project.
      const email = `archive-e2e-${Date.now()}@example.com`;
      const password = "ArchiveE2e!42";
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: "Archive E2E Tester" } },
      });
      expect(signUpError).toBeNull();
      const session =
        signUpData?.session ??
        (await supabase.auth.signInWithPassword({ email, password })).data.session;
      expect(session, "expected an active session after signup").toBeTruthy();
      if (session) await supabase.auth.setSession(session);

      // 4. Provision the workspace (owner membership) — same RPC the signup flow uses.
      await rpcCall(supabase, "tenants_create_tenant", {
        name: "Archive E2E Restoration Co",
      });

      // 5. Retain the raw archive (it is small) + upload every vetted file.
      const rawStorageId = await uploadToStorage({
        bucket: "archives",
        bytes: zipBytes,
        mimeType: "application/zip",
      });
      const storageIds = new Map<string, string>();
      for (const entry of plan.ingest) {
        if (!entry.bytes) continue;
        const { storageId } = await uploadToStorage({
          bucket: "documents",
          bytes: entry.bytes,
          mimeType: entry.mimeType,
        });
        storageIds.set(entry.path, storageId);
      }

      // 6. Create the archive record (real RPC contract).
      const created = (await rpcCall(supabase, "archive_begin", {
        filename: analysis.filename,
        fileType: analysis.fileType === "unknown" ? "zip" : analysis.fileType,
        size: analysis.compressedSize,
        checksum: analysis.checksum,
        rawStorageId: rawStorageId.storageId,
        clientWarnings: analysis.warnings.map((w) => w.message),
      })) as { archiveId: string };
      expect(created.archiveId).toBeTruthy();

      // 7. Submit the FULL inventory in batches (real RPC contract) — every
      //    entry including client-detected duplicates carries its
      //    duplicateOfPath/versionGroup provenance, exactly like the archive
      //    upload UI does. Only plan.ingest files were uploaded to storage.
      const BATCH = 100;
      for (let i = 0; i < analysis.entries.length; i += BATCH) {
        const batch = analysis.entries.slice(i, i + BATCH);
        await rpcCall(supabase, "archive_submit_inventory_batch", {
          archiveId: created.archiveId,
          clientWarnings: analysis.warnings.map((w) => w.message),
          files: batch.map((e) => ({
            path: e.path,
            filename: e.filename,
            extension: e.extension,
            mimeType: e.mimeType,
            size: e.size,
            checksum: e.checksum,
            depth: e.depth,
            supported: e.supported,
            classification: e.classification,
            classificationBasis: e.classificationBasis,
            classificationConfidence: e.classificationConfidence,
            status: e.status,
            note: e.note,
            duplicateOfPath: e.duplicateOfPath,
            versionGroup: e.versionGroup,
            isSuperseded: e.isLatestVersion === false,
            supersedesPath: undefined,
            claimHints: e.claimHints,
            storageId: storageIds.get(e.path),
            blocked: e.status === "blocked",
            blockReason: e.status === "blocked" ? e.note : undefined,
          })),
        });
      }

      // 8. Run the REAL client processing (the code that previously crashed
      //    with "Could not find the function public.archive_get_detail(...)").
      const result = await beginProcessingClient({ archiveId: created.archiveId });
      expect(result.ingested).toBeGreaterThanOrEqual(10);
      expect(result.failed).toBe(0);
      expect(result.candidates).toBeGreaterThanOrEqual(1);

      // 9. Read the REAL persisted state back through the UI's own RPC.
      const detail = (await rpcCall(supabase, "archive_get_detail", {
        archiveId: created.archiveId,
      })) as {
        archive: { status: string; progress: number; stats?: Record<string, unknown> };
        files: Array<{ ingestStatus: string; documentId?: string | null }>;
        docs: Record<string, unknown>;
        candidates: Array<{ claimKey: string; status: string; evidence?: unknown }>;
      };
      expect(detail).toBeTruthy();
      expect(detail.archive.status).toBe("completed");
      expect(detail.archive.progress).toBe(100);
      expect(detail.files.every((f) => f.ingestStatus === "ingested")).toBe(true);
      expect(detail.files.filter((f) => f.documentId).length).toBeGreaterThanOrEqual(10);
      expect(Object.keys(detail.docs).length).toBeGreaterThanOrEqual(10);
      expect(detail.candidates.length).toBeGreaterThanOrEqual(1);
      const claimCandidate = detail.candidates.find(
        (c) => c.claimKey === "8842001",
      );
      expect(claimCandidate).toBeTruthy();
      expect(claimCandidate?.status).toBe("pending");

      // 10. The candidate is visible through Revenue Recovery's own query.
      const candidates = (await rpcCall(
        supabase,
        "insurance_list_claim_candidates",
      )) as Array<{ claimKey: string; status: string; archiveId?: string | null }>;
      const visible = candidates.find((c) => c.claimKey === "8842001");
      expect(visible).toBeTruthy();
      expect(visible?.archiveId).toBe(created.archiveId);

      // Cleanup note: the throwaway user + workspace remain in the project for
      // inspection; delete the auth user in the Supabase dashboard when done.
      // eslint-disable-next-line no-console
      console.log(
        `[live-e2e] PASS user=${email} archive=${created.archiveId} ` +
          `ingested=${result.ingested} docs=${Object.keys(detail.docs).length} ` +
          `candidates=${detail.candidates.length} (${detail.candidates
            .map((c) => c.claimKey)
            .join(", ")})`,
      );
    },
    300_000,
  );
});
