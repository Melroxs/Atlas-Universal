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

/** Ingest every queued file of an archive and advance its lifecycle. */
export async function beginProcessingClient(args: {
  archiveId: string;
}): Promise<{ ok: boolean; ingested: number; failed: number; candidates: number }> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const detail = (await rpcCall(supabase, "archive_get_detail", {
    archiveId: args.archiveId,
  })) as ArchiveDetail | null;
  if (!detail) throw new Error("Archive not found.");

  await rpcCall(supabase, "archive_patch", {
    archiveId: args.archiveId,
    patch: { status: "processing", startedAt: Date.now(), progress: 0 },
  });

  const queue = detail.files.filter(
    (f) =>
      (f.ingestStatus === "queued" || f.ingestStatus === "failed") &&
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

  // Reconstruct POTENTIAL claim candidates from the archive's deterministic
  // claim hints + ingested document titles (Phase 14 — human approval required).
  let candidates = 0;
  try {
    const res = await reconstructArchiveCandidates(
      supabase,
      args.archiveId,
      detail.files,
      detail.docs ?? {},
    );
    candidates = res.candidates;
  } catch (e) {
    // Candidate reconstruction is best-effort — never fail the whole archive
    // because claim grouping hit a transient error.
    console.error("[atlas] claim reconstruction failed:", e);
  }

  // Files that were queued but NOT in the processed queue (they lacked a
  // storageId) remain queued — everything in `queue` is now ingested or
  // failed, so the pre-loop snapshot must not be used to count them.
  const queueIds = new Set(queue.map((f) => f._id));
  const stillQueued = detail.files.filter(
    (f) => f.ingestStatus === "queued" && !queueIds.has(f._id),
  ).length;
  const status =
    failed > 0 && ingested === 0
      ? "failed"
      : failed > 0
        ? "completed_with_warnings"
        : stillQueued > 0
          ? "completed_with_warnings"
          : "completed";

  await rpcCall(supabase, "archive_patch", {
    archiveId: args.archiveId,
    patch: {
      status,
      progress: 100,
      failureReason: status === "failed" ? `${failed} files failed to ingest.` : null,
      stats: {
        ingested,
        failed,
        total: detail.files.length,
        potentialClaims: candidates,
        completedAt: Date.now(),
      },
    },
  });

  return { ok: true, ingested, failed, candidates };
}

/** Ingest a single archive file into the knowledge base. */
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

  const bytes = await fileData.arrayBuffer();
  const mimeType = file.mimeType || "application/octet-stream";
  const parsed = await parseFile(mimeType, file.filename, bytes);

  const created = (await rpcCall(supabase, "ingestion_create_document", {
    title: file.filename,
    mimeType: parsed.mimeType,
    size: file.size ?? 0,
    sourceType: "archive",
    sourceId: `${archiveId}/${file.path}`,
    classification: "Unknown",
    status: "processing",
    storageId: storagePath,
  })) as { docId: string };

  if (parsed.image) {
    // Images are real evidence but have no extractable text — store them as
    // evidence with an honest extraction state (never fabricate OCR text).
    await rpcCall(supabase, "ingestion_patch_document", {
      documentId: created.docId,
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
      patch: { ingestStatus: "ingested", documentId: created.docId },
    });
    return;
  }

  if (!parsed.text.trim()) throw new Error("No readable text found in this file.");

  const result = await ingestTextClient(supabase, {
    title: file.filename,
    mimeType: parsed.mimeType,
    size: file.size ?? 0,
    sourceType: "archive",
    sourceId: `${archiveId}/${file.path}`,
    text: parsed.text,
    existingDocId: created.docId,
  });

  await rpcCall(supabase, "ingestion_patch_document", {
    documentId: created.docId,
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
    patch: { ingestStatus: "ingested", documentId: created.docId },
  });
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
      patch: { ingestStatus: "queued", error: null, documentId: null },
    }).catch(() => undefined);
  }

  await beginProcessingClient({ archiveId: args.archiveId });
  return { ok: true, requeued: args.fileIds.length };
}
