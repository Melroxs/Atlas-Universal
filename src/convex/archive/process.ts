"use node";

/**
 * Phase 13 — durable archive ingestion actions (Node runtime).
 *
 * The client extracts + inventories the archive, uploads vetted files to
 * storage and submits the manifest. These actions process the archive as a
 * DURABLE JOB: small bounded batches, self-scheduling via the scheduler,
 * tenant-scoped throughout, idempotent retries, honest completion summary.
 *
 * Internal mutations/queries live in archive/internal.ts (V8); only actions
 * are allowed in this Node.js file.
 *
 * Flow: beginArchive → (client uploads) → submitInventoryBatch × N →
 * beginProcessing → processBatch (self-scheduling) → finishArchive
 *
 * Every document created flows through the SAME ingestion core as manual
 * uploads and Drive syncs (ingestText) — there is one Atlas knowledge system.
 */

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, type ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { parseFile } from "../lib/parsers";
import { ingestText } from "../ingestion";
import { scheduleProcessBatch } from "./schedule";

const BATCH_SIZE = 6;
const TERMINAL_INGEST_STATUSES = [
  "ingested",
  "failed",
  "duplicate",
  "unsupported",
  "blocked",
  "too_large",
  "skipped",
] as const;

async function toArrayBuffer(stored: unknown): Promise<ArrayBuffer> {
  if (stored instanceof ArrayBuffer) return stored;
  const blob = stored as Blob;
  if (typeof blob.arrayBuffer === "function") return await blob.arrayBuffer();
  throw new Error("Stored file is not readable.");
}

// ---------------------------------------------------------------------------
// Ingestion of one file
// ---------------------------------------------------------------------------

async function ingestOneFile(
  ctx: ActionCtx,
  archive: {
    _id: Id<"archiveIngestions">;
    tenantId: Id<"tenants">;
    uploadedBy?: Id<"users"> | null;
    filename: string;
  },
  file: {
    _id: Id<"archiveFiles">;
    path: string;
    filename: string;
    mimeType?: string | null;
    size: number;
    storageId?: Id<"_storage"> | null;
    retryCount: number;
    ingestStatus: string;
  },
): Promise<void> {
  const tenantId = archive.tenantId;
  const sourceId = `archive:${archive._id}:${file.path}`;

  await ctx.runMutation(internal.archive.internal.patchArchiveFile, {
    id: file._id,
    patch: { ingestStatus: "ingesting", error: undefined },
  });

  try {
    if (!file.storageId) {
      throw new Error("Extracted file is missing from storage.");
    }
    const stored = await ctx.storage.get(file.storageId);
    if (!stored) {
      throw new Error("Extracted file is missing from storage (was it removed?).");
    }
    const bytes = await toArrayBuffer(stored);

    const { text, mimeType } = await parseFile(
      file.mimeType ?? undefined,
      file.filename,
      bytes,
    );
    if (!text.trim()) {
      throw new Error("No readable text found in this file.");
    }

    // Idempotent retry: reuse the existing document and its source identity.
    const existing = await ctx.runQuery(internal.internal.getDocBySource, {
      tenantId,
      sourceId,
    });

    let docId: Id<"documents">;
    if (existing) {
      docId = existing._id;
      // Re-ingest cleanly: drop old chunks first so retries never duplicate.
      await ctx.runMutation(internal.internal.deleteChunksByDoc, { documentId: docId });
    } else {
      docId = await ctx.runMutation(internal.internal.createDoc, {
        tenantId,
        userId: archive.uploadedBy ?? undefined,
        title: file.path,
        mimeType,
        size: file.size,
        sourceType: "archive",
        storageId: file.storageId,
        sourceId,
      });
      await ctx.runMutation(internal.internal.createJob, {
        tenantId,
        documentId: docId,
        jobType: "archive_document_processing",
      });
    }

    // First ingestion: fresh=true (sourceId omitted) so assertions + entity
    // relationships are created; retries pass sourceId so nothing duplicates.
    await ingestText(ctx, tenantId, {
      title: file.path,
      mimeType,
      size: file.size,
      sourceType: "archive",
      sourceId: existing ? sourceId : undefined,
      text,
      existingDocId: docId,
    });

    await ctx.runMutation(internal.archive.internal.patchArchiveFile, {
      id: file._id,
      patch: {
        ingestStatus: "ingested",
        documentId: docId,
        processedAt: Date.now(),
        error: undefined,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await ctx.runMutation(internal.archive.internal.patchArchiveFile, {
      id: file._id,
      patch: {
        ingestStatus: "failed",
        error: msg.length > 500 ? `${msg.slice(0, 500)}…` : msg,
        retryCount: file.retryCount + 1,
        processedAt: Date.now(),
      },
    });
    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "system",
      actionType: "archive_file_failed",
      targetType: "archiveFiles",
      targetId: String(file._id),
      metadata: { path: file.path, error: msg.slice(0, 300), archiveId: String(archive._id) },
    });
  }
}

// ---------------------------------------------------------------------------
// Completion — derive a REAL summary from processed records
// ---------------------------------------------------------------------------

async function finishArchive(
  ctx: ActionCtx,
  archiveId: Id<"archiveIngestions">,
): Promise<void> {
  const archive = await ctx.runQuery(internal.archive.internal.getArchiveRecord, {
    archiveId,
  });
  if (!archive) return;
  if (archive.status === "cancelled") return;

  const files = await ctx.runQuery(internal.archive.internal.listFilesByArchive, {
    archiveId,
  });
  const byStatus = new Map<string, number>();
  const classifications = new Map<string, number>();
  const claims = new Map<string, { count: number; paths: string[]; maxConfidence: number }>();
  for (const f of files) {
    byStatus.set(f.ingestStatus, (byStatus.get(f.ingestStatus) ?? 0) + 1);
    if (f.ingestStatus === "ingested") {
      classifications.set(f.classification, (classifications.get(f.classification) ?? 0) + 1);
      for (const hint of (f.claimHints ?? []) as Array<{ claimNumber: string; confidence?: number }>) {
        if (!hint.claimNumber) continue;
        const rec = claims.get(hint.claimNumber) ?? { count: 0, paths: [], maxConfidence: 0 };
        rec.count++;
        if (rec.paths.length < 5) rec.paths.push(f.path);
        rec.maxConfidence = Math.max(rec.maxConfidence, hint.confidence ?? 0);
        claims.set(hint.claimNumber, rec);
      }
    }
  }

  const ingested = byStatus.get("ingested") ?? 0;
  const failed = byStatus.get("failed") ?? 0;
  const duplicates = byStatus.get("duplicate") ?? 0;
  const unsupported = byStatus.get("unsupported") ?? 0;
  const tooLarge = byStatus.get("too_large") ?? 0;
  const blocked = byStatus.get("blocked") ?? 0;
  const skipped = byStatus.get("skipped") ?? 0;
  const totalFiles = files.length || archive.fileCount;

  const potentialClaims = [...claims.entries()]
    .map(([claimNumber, r]) => ({
      claimNumber,
      fileCount: r.count,
      confidence: Math.min(0.85, Math.max(0.35, r.maxConfidence + 0.1)),
      samplePaths: r.paths,
    }))
    .sort((a, b) => b.fileCount - a.fileCount);

  const stats = {
    ingested,
    failed,
    duplicates,
    unsupported,
    tooLarge,
    blocked,
    skipped,
    totalFiles,
    classifications: Object.fromEntries(classifications),
    customers: classifications.get("customer") ?? 0,
    vendors: classifications.get("vendor") ?? 0,
    projects: classifications.get("project") ?? 0,
    policies: (classifications.get("policy") ?? 0) + (classifications.get("insurance") ?? 0),
    estimates: classifications.get("estimate") ?? 0,
    invoices: classifications.get("invoice") ?? 0,
    potentialClaims: potentialClaims.slice(0, 25),
  };

  const warnings = [...(archive.warnings ?? [])];
  if (failed > 0) {
    warnings.push(`${failed} file${failed === 1 ? "" : "s"} could not be processed (see inventory).`);
  }
  if (blocked > 0) {
    warnings.push(`${blocked} file${blocked === 1 ? "" : "s"} were blocked for security and not ingested.`);
  }

  // Honest completion: ingested>0 with no warnings → completed; anything
  // partially processed or with only skipped files → completed_with_warnings;
  // outright processing failure (or nothing at all to show) → failed.
  let status: "completed" | "completed_with_warnings" | "failed";
  if (ingested > 0 && failed === 0 && warnings.length === 0) {
    status = "completed";
  } else if (ingested > 0 || failed === 0) {
    status = "completed_with_warnings";
  } else {
    status = "failed";
  }

  const now = Date.now();

  // Controlled memory write (origin: imported) — never inferred as authority.
  const claimLine =
    potentialClaims.length > 0
      ? ` ${potentialClaims.length} potential claim${potentialClaims.length === 1 ? "" : "s"} detected from document identifiers.`
      : "";
  const summaryStatement = `Company data archive “${archive.filename}” was imported: ${totalFiles} files found, ${ingested} ingested into knowledge${duplicates ? `, ${duplicates} duplicates` : ""}${failed ? `, ${failed} failed` : ""}.${claimLine}`;
  await ctx.runMutation(internal.internal.writeMemory, {
    tenantId: archive.tenantId,
    memoryType: "summary",
    origin: "imported",
    statement: summaryStatement,
    provenance: `Imported from archive “${archive.filename}” (checksum ${String(archive.checksum).slice(0, 12)}…). See archive record ${archiveId}.`,
    confidenceScore: 0.7,
    subjectType: "archive",
    subjectId: String(archiveId),
    structuredValue: stats,
    createdBy: archive.uploadedBy ?? undefined,
  });

  // Insights for claims with sufficient evidence (≥ 2 referencing files).
  for (const claim of potentialClaims.filter((c) => c.fileCount >= 2)) {
    await ctx.runMutation(internal.internal.upsertOrganizationalInsight, {
      tenantId: archive.tenantId,
      insightKey: `archive-claim:${archiveId}:${claim.claimNumber}`,
      kind: "opportunity",
      title: `Potential claim ${claim.claimNumber} — ${claim.fileCount} documents`,
      detail: `${claim.fileCount} documents in the imported archive reference claim ${claim.claimNumber} (e.g. ${claim.samplePaths.slice(0, 3).join(", ")}). Atlas has not created a claim record — confirm the connection first.`,
      confidence: claim.confidence,
      priority: 0.5,
      priorityBasis: "evidence_file_count",
      evidence: { kind: "archive", archiveId: String(archiveId), paths: claim.samplePaths },
      recommendedNextStep: "Review the documents and confirm before creating a claim record.",
      approvalRequired: true,
      actionAvailable: false,
      limitation: "Identifiers were matched from filenames and folder context; Atlas never assumes relationships from co-location alone.",
    });
  }
  await ctx.runMutation(internal.internal.upsertOrganizationalInsight, {
    tenantId: archive.tenantId,
    insightKey: `archive-import:${archiveId}`,
    kind: "recommendation",
    title: `Company data imported — ${archive.filename}`,
    detail: summaryStatement,
    confidence: 0.7,
    priority: 0.4,
    priorityBasis: "archive_completion",
    evidence: { kind: "archive", archiveId: String(archiveId) },
    recommendedNextStep: "Review the archive inventory and confirm any potential claims.",
    approvalRequired: false,
    actionAvailable: false,
  });

  await ctx.runMutation(internal.archive.internal.patchArchiveRecord, {
    id: archiveId,
    patch: {
      status,
      progress: 1,
      stats,
      warnings,
      completedAt: now,
      updatedAt: now,
      failureReason: status === "failed" ? (warnings[0] ?? "No files could be ingested.") : undefined,
    },
  });

  await ctx.runMutation(internal.archive.internal.emitEvent, {
    tenantId: archive.tenantId,
    eventType:
      status === "completed"
        ? "archive_processing_completed"
        : status === "completed_with_warnings"
          ? "archive_completed_with_warnings"
          : "archive_failed",
    sourceResourceId: String(archiveId),
    payload: { filename: archive.filename, stats, warnings: warnings.slice(0, 5) },
    actorId: archive.uploadedBy ?? undefined,
  });
  await ctx.runMutation(internal.internal.logAudit, {
    tenantId: archive.tenantId,
    actorType: "system",
    actionType: "archive_completed",
    targetType: "archiveIngestions",
    targetId: String(archiveId),
    metadata: { filename: archive.filename, status, stats },
  });
}

// ---------------------------------------------------------------------------
// The durable batch loop
// ---------------------------------------------------------------------------

export const processBatch = internalAction({
  args: { archiveId: v.id("archiveIngestions") },
  handler: async (
    ctx,
    { archiveId },
  ): Promise<{ done: boolean; reason?: string; progress?: number }> => {
    const archive = await ctx.runQuery(internal.archive.internal.getArchiveRecord, {
      archiveId,
    });
    if (!archive) return { done: true, reason: "missing" };
    if (archive.status === "cancelled") return { done: true, reason: "cancelled" };
    if (
      archive.status === "completed" ||
      archive.status === "completed_with_warnings" ||
      archive.status === "failed"
    ) {
      return { done: true, reason: "terminal" };
    }

    const pending = await ctx.runQuery(internal.archive.internal.listPendingFiles, {
      archiveId,
      limit: BATCH_SIZE,
    });

    if (pending.length === 0) {
      await finishArchive(ctx, archiveId);
      return { done: true };
    }

    await Promise.all(
      pending.map((file) => ingestOneFile(ctx, archive, file as never)),
    );

    // Derive progress from REAL counters (never invented).
    const files = await ctx.runQuery(internal.archive.internal.listFilesByArchive, {
      archiveId,
    });
    const terminal = files.filter((f) =>
      (TERMINAL_INGEST_STATUSES as readonly string[]).includes(f.ingestStatus),
    ).length;
    const total = files.length || archive.fileCount;
    const progress = total > 0 ? Math.min(0.99, terminal / total) : 0;

    await ctx.runMutation(internal.archive.internal.patchArchiveRecord, {
      id: archiveId,
      patch: {
        status: "ingesting",
        progress,
        updatedAt: Date.now(),
      },
    });

    const remaining = await ctx.runQuery(internal.archive.internal.listPendingFiles, {
      archiveId,
      limit: 1,
    });
    if (remaining.length > 0) {
      scheduleProcessBatch(ctx, archiveId);
    } else {
      await finishArchive(ctx, archiveId);
    }
    return { done: false, progress };
  },
});

/** Reset failed files (or a chosen subset) back to queued — idempotent. */
export const requeueFiles = internalAction({
  args: {
    archiveId: v.id("archiveIngestions"),
    fileIds: v.optional(v.array(v.id("archiveFiles"))),
  },
  handler: async (
    ctx,
    { archiveId, fileIds },
  ): Promise<{ requeued: number }> => {
    const archive = await ctx.runQuery(internal.archive.internal.getArchiveRecord, {
      archiveId,
    });
    if (!archive) return { requeued: 0 };
    const files = await ctx.runQuery(internal.archive.internal.listFilesByArchive, {
      archiveId,
    });
    const targets = fileIds
      ? files.filter((f) => fileIds.some((id) => String(id) === String(f._id)))
      : files.filter((f) => f.ingestStatus === "failed");
    for (const f of targets) {
      if (!f.storageId) continue;
      await ctx.runMutation(internal.archive.internal.patchArchiveFile, {
        id: f._id,
        patch: { ingestStatus: "queued", error: undefined, processedAt: undefined },
      });
    }
    if (targets.length > 0) {
      await ctx.runMutation(internal.archive.internal.patchArchiveRecord, {
        id: archiveId,
        patch: { status: "ingesting", updatedAt: Date.now() },
      });
      scheduleProcessBatch(ctx, archiveId);
    }
    return { requeued: targets.length };
  },
});
