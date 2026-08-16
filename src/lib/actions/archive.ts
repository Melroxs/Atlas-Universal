// ---------------------------------------------------------------------------
// Client-side archive processing — the durable job the old Convex backend ran
// server-side now runs in the browser against Supabase Storage + Postgres RPCs.
//
//   beginProcessing(archiveId) — ingest every queued file (parse → chunks →
//     entities → assertions), reconstruct POTENTIAL claim candidates, then flip
//     the archive to its final state. Safe to re-run: files already ingested
//     are skipped and per-file failures are recorded instead of aborting.
//
// All Postgres calls go through rpcCall() (src/lib/actions/rpc.ts), which
// sends RPC arguments as `p_` + lowercased key — PostgREST resolves parameter
// names exactly against the folded schema cache (p_archiveId → p_archiveid).
// Sending `p_archive_id` or `p_archiveId` fails with PGRST202.
// ---------------------------------------------------------------------------

import { getSupabaseClient } from "@/lib/supabase";
import { ingestTextClient } from "@/lib/actions/ingestion";
import { parseFile } from "@/lib/ingest/parsers";
import { summarize } from "@/lib/ingest/text";
import { rpcCall } from "@/lib/actions/rpc";
import type { ClaimHint } from "@/lib/archive/types";
import { normalizeArchiveDetailResponse } from "@/lib/archive/normalize";
import {
  buildCandidateFromArchive,
  clusterDocumentsByClaimNumber,
  type CandidateEvidence,
} from "@/lib/insurance/reconstruct";

interface ArchiveFileRow {
  _id: string;
  path: string;
  filename: string;
  mimeType?: string | null;
  size?: number | null;
  storageId?: string | null;
  ingestStatus?: string;
  documentId?: string | null;
  claimHints?: ClaimHint[] | null;
}

interface ArchiveDetail {
  archive: Record<string, any>;
  files: ArchiveFileRow[];
  docs: Record<string, { _id: string; title: string; classification?: string; status?: string }>;
  candidates: Record<string, any>[];
}

/**
 * Fetch + normalize archive_get_detail. Every consumer of the RPC (the page
 * AND this processing loop) reads through here so a missing/null collection
 * can never surface as undefined (the production ArchiveDetail crash:
 * `Cannot read properties of undefined (reading 'length')`). The runtime
 * value is the normalized contract (files/candidates/warnings always arrays,
 * docs/stats always objects); the cast restores the loop's internal types.
 */
async function getArchiveDetailNormalized(
  supabase: NonNullable<ReturnType<typeof getSupabaseClient>>,
  archiveId: string,
): Promise<ArchiveDetail | null> {
  const raw = await rpcCall(supabase, "archive_get_detail", { archiveId });
  return normalizeArchiveDetailResponse(raw) as unknown as ArchiveDetail | null;
}

/**
 * Group per-file claim hints into POTENTIAL claim candidates and persist them
 * (idempotent — the backend dedupes on tenantId + claimKey). Candidates are
 * evidence-backed, never automatically promoted to real claims.
 */
export async function reconstructArchiveCandidates(
  supabase: NonNullable<ReturnType<typeof getSupabaseClient>>,
  archiveId: string,
  files: ArchiveFileRow[],
  docs: ArchiveDetail["docs"],
): Promise<{ candidates: number; scannedFiles: number }> {
  // 1. Archive claim hints (deterministic identifiers from filenames/paths).
  const hints = new Map<string, { claimNumber: string; fileCount: number; confidence: number; samplePaths: string[] }>();
  let scannedFiles = 0;
  for (const f of files) {
    const fileHints = f.claimHints ?? [];
    if (fileHints.length === 0) continue;
    scannedFiles++;
    for (const h of fileHints) {
      const key = h.claimNumber.toUpperCase();
      const agg = hints.get(key) ?? {
        claimNumber: h.claimNumber,
        fileCount: 0,
        confidence: 0,
        samplePaths: [],
      };
      agg.fileCount++;
      agg.confidence = Math.max(agg.confidence, h.confidence);
      if (agg.samplePaths.length < 12) agg.samplePaths.push(f.path);
      hints.set(key, agg);
    }
  }

  const fromHints: CandidateEvidence[] = [...hints.values()].map((h) =>
    buildCandidateFromArchive(h),
  );

  // 2. Document-title clustering for docs this archive ingested.
  const docList = Object.values(docs).filter(
    (d) => d && typeof d.title === "string",
  );
  const fromDocs = clusterDocumentsByClaimNumber(
    docList.map((d) => ({ _id: d._id, title: d.title })),
  );

  // Merge by claimKey (hint-derived clusters win; doc clusters add evidence).
  const merged = new Map<string, CandidateEvidence>();
  for (const c of [...fromHints, ...fromDocs]) {
    const existing = merged.get(c.claimKey);
    if (!existing) {
      merged.set(c.claimKey, c);
      continue;
    }
    merged.set(c.claimKey, {
      ...existing,
      confidence: Math.max(existing.confidence, c.confidence),
      documentIds: [...new Set([...existing.documentIds, ...c.documentIds])],
      archivePaths: [...new Set([...existing.archivePaths, ...c.archivePaths])],
      evidence: [...new Set([...existing.evidence, ...c.evidence])],
    });
  }

  const payload = [...merged.values()].map((c) => ({
    archiveId,
    claimKey: c.claimKey,
    claimNumber: c.claimNumber,
    customer: c.customer ?? null,
    property: c.property ?? null,
    fileCount: Math.max(1, c.documentIds.length + c.archivePaths.length),
    totalSize: null,
    confidence: c.confidence,
    filePaths: c.archivePaths,
    evidence: c.evidence,
  }));

  if (payload.length === 0) return { candidates: 0, scannedFiles };

  await rpcCall(supabase, "insurance_upsert_candidates", { candidates: payload });
  return { candidates: payload.length, scannedFiles };
}

/** Terminal archive/file states — used to decide final archive status. */
const FILE_TERMINAL = new Set([
  "ingested",
  "failed",
  "unsupported",
  "blocked",
  "too_large",
  "duplicate",
  "skipped",
]);
const ARCHIVE_TERMINAL = new Set([
  "completed",
  "completed_with_warnings",
  "failed",
  "cancelled",
]);

/**
 * Ingest every queued file of an archive and advance its lifecycle.
 *
 * Safe to re-run (resume after a dead tab / interrupted run): files in
 * `queued`, `processing` (a previous run died mid-flight) or `failed` are
 * picked up, files already ingested are skipped, and per-file failures are
 * recorded instead of aborting. The FINAL archive status is computed from a
 * fresh post-run snapshot of persisted file states — never from the pre-loop
 * snapshot — and every file is forced to a terminal state (ingested, failed,
 * or the explicit skipped/unsupported/blocked/duplicate classification the
 * inventory already recorded).
 */
export async function beginProcessingClient(args: {
  archiveId: string;
}): Promise<{ ok: boolean; ingested: number; failed: number; candidates: number }> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const detail = await getArchiveDetailNormalized(supabase, args.archiveId);
  if (!detail) throw new Error("Archive not found.");

  // Idempotent: a finished archive is not re-processed.
  if (ARCHIVE_TERMINAL.has(detail.archive?.status)) {
    return { ok: true, ingested: 0, failed: 0, candidates: 0 };
  }

  await rpcCall(supabase, "archive_patch", {
    archiveId: args.archiveId,
    patch: { status: "processing", startedAt: Date.now(), progress: 0 },
  });

  // Recover every file that still needs work: queued, stuck `processing` from
  // an interrupted run, or failed (retry). Files without a storage object or
  // with an existing document are handled in the reconciliation pass below.
  const queue = detail.files.filter(
    (f) =>
      (f.ingestStatus === "queued" ||
        f.ingestStatus === "processing" ||
        f.ingestStatus === "failed") &&
      f.storageId &&
      !f.documentId,
  );

  let ingested = 0;
  let failed = 0;
  for (const file of queue) {
    try {
      await ingestArchiveFile(supabase, file, args.archiveId);
      ingested++;
    } catch (e) {
      failed++;
      await rpcCall(supabase, "archive_patch_file", {
        fileId: file._id,
        patch: {
          ingestStatus: "failed",
          error: e instanceof Error ? e.message.slice(0, 2000) : String(e),
          errorStage: "ingestion",
          retryCount: 1,
        },
      }).catch(() => undefined);
    }
    await rpcCall(supabase, "archive_patch", {
      archiveId: args.archiveId,
      patch: {
        progress: Math.round(((ingested + failed) / Math.max(queue.length, 1)) * 100),
      },
    }).catch(() => undefined);
  }

  // Reconcile from a FRESH snapshot so nothing is left in a non-terminal
  // state after this run:
  //   - queued/processing WITHOUT a storage object can never be ingested —
  //     mark them failed with an explicit reason.
  //   - queued/processing WITH an existing document were ingested by an
  //     earlier run — record the terminal state.
  const fresh = await getArchiveDetailNormalized(supabase, args.archiveId);
  const files = fresh?.files ?? detail.files;
  for (const f of files) {
    if (f.ingestStatus === "queued" || f.ingestStatus === "processing") {
      if (!f.storageId) {
        failed++;
        await rpcCall(supabase, "archive_patch_file", {
          fileId: f._id,
          patch: {
            ingestStatus: "failed",
            error: "Uploaded file is missing from storage — it cannot be ingested.",
            errorStage: "upload",
          },
        }).catch(() => undefined);
      } else if (f.documentId) {
        ingested++;
        await rpcCall(supabase, "archive_patch_file", {
          fileId: f._id,
          patch: { ingestStatus: "ingested", documentId: f.documentId },
        }).catch(() => undefined);
      }
    }
  }

  // Reconstruct POTENTIAL claim candidates from the archive's deterministic
  // claim hints + the documents ingested THIS run (fresh docs, not the
  // pre-loop snapshot). Candidates stay POTENTIAL until human approval.
  let candidates = 0;
  try {
    const res = await reconstructArchiveCandidates(
      supabase,
      args.archiveId,
      files,
      fresh?.docs ?? detail.docs ?? {},
    );
    candidates = res.candidates;
  } catch (e) {
    // Candidate reconstruction is best-effort — never fail the whole archive
    // because claim grouping hit a transient error.
    console.error("[atlas] claim reconstruction failed:", e);
  }

  // Final status from ACTUAL persisted results: refetch once more after the
  // reconciliation writes so the counters reflect what the database holds.
  const finalDetail = await getArchiveDetailNormalized(supabase, args.archiveId);
  const finalFiles = finalDetail?.files ?? files;
  const finalIngested = finalFiles.filter((f) => f.ingestStatus === "ingested").length;
  const finalFailed = finalFiles.filter((f) => f.ingestStatus === "failed").length;
  const nonTerminal = finalFiles.filter(
    (f) => f.ingestStatus && !FILE_TERMINAL.has(f.ingestStatus),
  );
  const status =
    nonTerminal.length > 0
      ? "completed_with_warnings"
      : finalFailed > 0 && finalIngested === 0
        ? "failed"
        : finalFailed > 0
          ? "completed_with_warnings"
          : "completed";

  await rpcCall(supabase, "archive_patch", {
    archiveId: args.archiveId,
    patch: {
      status,
      progress: 100,
      failureReason:
        status === "failed"
          ? `${finalFailed} files failed to ingest.`
          : nonTerminal.length > 0
            ? `${nonTerminal.length} file${nonTerminal.length === 1 ? "" : "s"} did not reach a terminal state.`
            : finalFailed > 0
              ? `${finalFailed} file${finalFailed === 1 ? "" : "s"} failed to ingest.`
              : null,
      stats: {
        ingested: finalIngested,
        failed: finalFailed,
        total: finalFiles.length,
        potentialClaims: candidates,
        completedAt: Date.now(),
      },
    },
  });

  return { ok: true, ingested: finalIngested, failed: finalFailed, candidates };
}

/**
 * Ingest a single archive file into the knowledge base.
 *
 * The document record is created FIRST (status `processing`) and then
 * terminalized: on success it is patched to `ready`; on ANY failure it is
 * patched to `failed` with the real reason BEFORE the error propagates — so
 * the file can never be left pointing at a document stuck in `processing`
 * forever, and a retry never creates a duplicate/orphan document.
 */
async function ingestArchiveFile(
  supabase: NonNullable<ReturnType<typeof getSupabaseClient>>,
  file: ArchiveFileRow,
  archiveId: string,
): Promise<void> {
  const storagePath = file.storageId as string;
  const { data: fileData, error: downloadError } = await supabase.storage
    .from("documents")
    .download(storagePath);
  if (downloadError || !fileData) {
    throw new Error("Uploaded file is missing from storage.");
  }

  const created = (await rpcCall(supabase, "ingestion_create_document", {
    title: file.filename,
    mimeType: file.mimeType || "application/octet-stream",
    size: file.size ?? 0,
    sourceType: "archive",
    sourceId: `${archiveId}/${file.path}`,
    classification: "Unknown",
    status: "processing",
    storageId: storagePath,
  })) as { docId: string };
  const docId = created.docId;

  try {
    const bytes = await fileData.arrayBuffer();
    const mimeType = file.mimeType || "application/octet-stream";
    const parsed = await parseFile(mimeType, file.filename, bytes);

    if (parsed.image) {
      // Images are real evidence but have no extractable text — store them as
      // evidence with an honest extraction state (never fabricate OCR text).
      await rpcCall(supabase, "ingestion_patch_document", {
        documentId: docId,
        patch: {
          status: "ready",
          classification: "Image Evidence",
          summary:
            "Image evidence stored. No text/OCR content extracted — OCR is not configured in this environment.",
          chunkCount: 0,
          entityCount: 0,
          processedAt: Date.now(),
          error: null,
        },
      });
      await rpcCall(supabase, "archive_patch_file", {
        fileId: file._id,
        patch: { ingestStatus: "ingested", documentId: docId },
      });
      return;
    }

    if (!parsed.text.trim()) {
      throw new Error(
        "[extraction] No readable text found in this file (scanned or image-only documents have no text layer; OCR is not configured).",
      );
    }

    const result = await ingestTextClient(supabase, {
      title: file.filename,
      mimeType: parsed.mimeType,
      size: file.size ?? 0,
      sourceType: "archive",
      sourceId: `${archiveId}/${file.path}`,
      text: parsed.text,
      existingDocId: docId,
    });

    await rpcCall(supabase, "ingestion_patch_document", {
      documentId: docId,
      patch: {
        status: "ready",
        classification: result.classification,
        // Same content summary the individual-upload path writes, so claim
        // reconstruction and evidence matching can read document content
        // without a per-document detail fetch.
        summary: summarize(parsed.text),
        chunkCount: result.chunks,
        entityCount: result.entities,
        processedAt: Date.now(),
        error: null,
      },
    });

    await rpcCall(supabase, "archive_patch_file", {
      fileId: file._id,
      patch: { ingestStatus: "ingested", documentId: docId },
    });
  } catch (e) {
    // NEVER leave the created document stuck in `processing`: terminalize it
    // with the real reason, then rethrow so the caller marks the file failed.
    // NOTE: errorStage is deliberately NOT sent here — ingestion_patch_document
    // builds its UPDATE dynamically from patch keys and the errorStage column
    // only exists after migration 0014; sending an unknown key would throw and
    // be swallowed, leaving the document stuck in `processing` (the exact bug
    // this block exists to prevent). The file-level patch (archive_patch_file)
    // carries errorStage, which is inert until 0014 and active afterwards.
    const message = e instanceof Error ? e.message.slice(0, 2000) : String(e);
    await rpcCall(supabase, "ingestion_patch_document", {
      documentId: docId,
      patch: {
        status: "failed",
        error: message,
      },
    }).catch(() => undefined);
    throw e;
  }
}

/** Requeue failed files and re-run processing for them. */
export async function retryFilesClient(args: {
  archiveId: string;
  fileIds: string[];
}): Promise<{ ok: boolean; requeued: number }> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  for (const fileId of args.fileIds) {
    await rpcCall(supabase, "archive_patch_file", {
      fileId,
      patch: { ingestStatus: "queued", error: null, errorStage: null, documentId: null },
    }).catch(() => undefined);
  }

  await beginProcessingClient({ archiveId: args.archiveId });
  return { ok: true, requeued: args.fileIds.length };
}
