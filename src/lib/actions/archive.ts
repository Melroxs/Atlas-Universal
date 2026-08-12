// ---------------------------------------------------------------------------
// Client-side archive processing — the durable job the old Convex backend ran
// server-side now runs in the browser against Supabase Storage + Postgres RPCs.
//
//   beginProcessing(archiveId) — ingest every queued file (parse → chunks →
//     entities → assertions), marking each file as it goes, then flip the
//     archive to its final state. Safe to re-run: files already ingested are
//     skipped and per-file failures are recorded instead of aborting.
// ---------------------------------------------------------------------------

import { getSupabaseClient } from "@/lib/supabase";
import { ingestTextClient } from "@/lib/actions/ingestion";
import { parseFile } from "@/lib/ingest/parsers";

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

async function rpc(
  supabase: NonNullable<ReturnType<typeof getSupabaseClient>>,
  fn: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

interface ArchiveFileRow {
  _id: string;
  path: string;
  filename: string;
  mimeType?: string | null;
  size?: number | null;
  storageId?: string | null;
  ingestStatus?: string;
  documentId?: string | null;
}

interface ArchiveDetail {
  archive: Record<string, any>;
  files: ArchiveFileRow[];
  docs: Record<string, any>;
  candidates: Record<string, any>[];
}

/** Ingest every queued file of an archive and advance its lifecycle. */
export async function beginProcessingClient(args: {
  archiveId: string;
}): Promise<{ ok: boolean; ingested: number; failed: number }> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const detail = (await rpc(supabase, "archive_get_detail", {
    p_archive_id: args.archiveId,
  })) as ArchiveDetail | null;
  if (!detail) throw new Error("Archive not found.");

  await rpc(supabase, "archive_patch", {
    p_archive_id: args.archiveId,
    p_patch: { status: "processing", startedAt: Date.now(), progress: 0 },
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
      await rpc(supabase, "archive_patch_file", {
        p_file_id: file._id,
        p_patch: {
          ingestStatus: "failed",
          error: e instanceof Error ? e.message.slice(0, 2000) : String(e),
        },
      }).catch(() => undefined);
    }
    await rpc(supabase, "archive_patch", {
      p_archive_id: args.archiveId,
      p_patch: {
        progress: Math.round((ingested + failed) / Math.max(queue.length, 1) * 100),
      },
    }).catch(() => undefined);
  }

  const remaining = detail.files.filter(
    (f) => !f.documentId && f.storageId && f.ingestStatus === "queued",
  ).length;
  const status = failed > 0 && ingested === 0
    ? "failed"
    : failed > 0
      ? "completed_with_warnings"
      : remaining > 0
        ? "completed_with_warnings"
        : "completed";

  await rpc(supabase, "archive_patch", {
    p_archive_id: args.archiveId,
    p_patch: {
      status,
      progress: 100,
      failureReason: status === "failed" ? `${failed} files failed to ingest.` : null,
      stats: {
        ingested,
        failed,
        total: detail.files.length,
        completedAt: Date.now(),
      },
    },
  });

  return { ok: true, ingested, failed };
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
  const { text } = await parseFile(mimeType, file.filename, bytes);
  if (!text.trim()) throw new Error("No readable text found in this file.");

  const created = (await rpc(supabase, "ingestion_create_document", {
    p_title: file.filename,
    p_mimeType: mimeType,
    p_size: file.size ?? 0,
    p_sourceType: "archive",
    p_sourceId: `${archiveId}/${file.path}`,
    p_classification: "Unknown",
    p_status: "processing",
    p_storageId: storagePath,
  })) as { docId: string };

  const result = await ingestTextClient(supabase, {
    title: file.filename,
    mimeType,
    size: file.size ?? 0,
    sourceType: "archive",
    sourceId: `${archiveId}/${file.path}`,
    text,
    existingDocId: created.docId,
  });

  await rpc(supabase, "ingestion_patch_document", {
    p_document_id: created.docId,
    p_patch: {
      status: "ready",
      classification: result.classification,
      chunkCount: result.chunks,
      entityCount: result.entities,
      processedAt: Date.now(),
      error: null,
    },
  });

  await rpc(supabase, "archive_patch_file", {
    p_file_id: file._id,
    p_patch: { ingestStatus: "ingested", documentId: created.docId },
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
    await rpc(supabase, "archive_patch_file", {
      p_file_id: fileId,
      p_patch: { ingestStatus: "queued", error: null, documentId: null },
    }).catch(() => undefined);
  }

  await beginProcessingClient({ archiveId: args.archiveId });
  return { ok: true, requeued: args.fileIds.length };
}
