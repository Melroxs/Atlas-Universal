/**
 * Phase 13 — Public API for Compressed Company Data Ingestion.
 *
 * Tenant-scoped throughout. Uploaded archives are UNTRUSTED: every path and
 * every size is re-validated here even though the client already checked it.
 * Processing runs as a durable scheduled job (see archive/process.ts) so the
 * user can leave the page while large archives are ingested.
 */

import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { action, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { isEditor, isManager, requireTenant, requireUser } from "./helpers";
import {
  SERVER_ARCHIVE_LIMITS,
  serverCheckFileSize,
  formatBytesServer,
} from "./archive/limits";
import { serverCheckFileSecurity, serverValidatePath } from "./archive/security";
import { scheduleProcessBatch } from "./archive/schedule";

const ACCEPTED_FILETYPES = new Set(["zip", "rar"]);
const HEX64 = /^[0-9a-f]{64}$/i;

const FILE_INPUT = v.object({
  path: v.string(),
  filename: v.string(),
  extension: v.string(),
  mimeType: v.optional(v.string()),
  size: v.number(),
  checksum: v.string(),
  depth: v.number(),
  supported: v.boolean(),
  classification: v.string(),
  classificationBasis: v.optional(v.string()),
  classificationConfidence: v.number(),
  /** Client-side status: ok | blocked | unsupported | too_large | duplicate | skipped_nested */
  status: v.string(),
  note: v.optional(v.string()),
  duplicateOfPath: v.optional(v.string()),
  versionGroup: v.optional(v.string()),
  isSuperseded: v.optional(v.boolean()),
  supersedesPath: v.optional(v.string()),
  claimHints: v.optional(v.any()),
  storageId: v.optional(v.id("_storage")),
  blocked: v.optional(v.boolean()),
  blockReason: v.optional(v.string()),
});

const TERMINAL = new Set([
  "completed",
  "completed_with_warnings",
  "failed",
  "cancelled",
]);

export const beginArchive = mutation({
  args: {
    filename: v.string(),
    fileType: v.string(),
    size: v.number(),
    checksum: v.string(),
    rawStorageId: v.optional(v.id("_storage")),
    clientWarnings: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    if (!(await isEditor(ctx, userId, tenantId))) {
      throw new Error("Viewers can read the knowledge base but not import company data.");
    }
    const ext = args.filename.split(".").pop()?.toLowerCase() ?? "";
    if (!ACCEPTED_FILETYPES.has(ext) && !ACCEPTED_FILETYPES.has(args.fileType)) {
      throw new Error("Only .zip and .rar company data packages are supported.");
    }
    if (args.size > SERVER_ARCHIVE_LIMITS.maxCompressedSize) {
      throw new Error(
        `Archive is ${formatBytesServer(args.size)}; the maximum compressed archive size is ${formatBytesServer(SERVER_ARCHIVE_LIMITS.maxCompressedSize)}.`,
      );
    }
    if (!HEX64.test(args.checksum)) {
      throw new Error("Archive checksum is missing or malformed.");
    }
    if (args.rawStorageId !== undefined && args.size > SERVER_ARCHIVE_LIMITS.rawRetainLimit) {
      throw new Error("Raw archive retention is capped at 8 MB; the archive is too large to retain.");
    }

    const now = Date.now();
    const archiveId = await ctx.db.insert("archiveIngestions", {
      tenantId,
      filename: args.filename,
      fileType: ACCEPTED_FILETYPES.has(ext) ? ext : args.fileType,
      compressedSize: args.size,
      extractedSize: 0,
      fileCount: 0,
      status: "uploaded",
      progress: 0,
      checksum: args.checksum,
      rawRetained: args.rawStorageId !== undefined,
      rawStorageId: args.rawStorageId ?? undefined,
      uploadedBy: userId,
      limits: SERVER_ARCHIVE_LIMITS,
      stats: undefined,
      warnings: args.clientWarnings ?? [],
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: "archive_uploaded",
      targetType: "archiveIngestions",
      targetId: String(archiveId),
      metadata: { filename: args.filename, size: args.size, fileType: args.fileType },
    });
    await ctx.runMutation(internal.archive.internal.emitEvent, {
      tenantId,
      eventType: "archive_uploaded",
      sourceResourceId: String(archiveId),
      payload: { filename: args.filename, size: args.size, fileType: args.fileType },
      actorId: userId,
    });

    return { archiveId };
  },
});

/** Submit one bounded batch of the inventory (client sends several batches). */
export const submitInventoryBatch = mutation({
  args: {
    archiveId: v.id("archiveIngestions"),
    files: v.array(FILE_INPUT),
    clientWarnings: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { archiveId, files, clientWarnings }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    if (!(await isEditor(ctx, userId, tenantId))) {
      throw new Error("Viewers cannot import company data.");
    }
    const archive = await ctx.db.get(archiveId);
    if (!archive || archive.tenantId !== tenantId) {
      throw new Error("Archive not found.");
    }
    if (TERMINAL.has(archive.status)) {
      throw new Error("This archive has already finished processing.");
    }
    if (files.length === 0) {
      throw new Error("Inventory batch is empty.");
    }
    if (files.length > SERVER_ARCHIVE_LIMITS.maxBatchFiles) {
      throw new Error(
        `Inventory batch too large (${files.length}); submit at most ${SERVER_ARCHIVE_LIMITS.maxBatchFiles} files per batch.`,
      );
    }
    const projected = archive.fileCount + files.length;
    if (projected > SERVER_ARCHIVE_LIMITS.maxFiles) {
      throw new Error(
        `Archive would contain ${projected.toLocaleString()} files, exceeding the ${SERVER_ARCHIVE_LIMITS.maxFiles.toLocaleString()} file limit. Atlas stopped before ingesting anything.`,
      );
    }
    const addedSize = files.reduce((s, f) => s + f.size, 0);
    if (archive.extractedSize + addedSize > SERVER_ARCHIVE_LIMITS.maxExtractedSize) {
      throw new Error(
        `Extracted content would exceed the ${formatBytesServer(SERVER_ARCHIVE_LIMITS.maxExtractedSize)} limit. Atlas stopped before ingesting anything.`,
      );
    }

    let ingestedDupes = 0;
    for (const f of files) {
      const pathCheck = serverValidatePath(f.path);
      if (!pathCheck.ok) {
        await ctx.db.insert("archiveFiles", {
          tenantId,
          archiveId,
          path: f.path,
          filename: f.filename,
          extension: f.extension,
          mimeType: f.mimeType,
          size: f.size,
          checksum: f.checksum,
          depth: f.depth,
          isDuplicate: false,
          supported: false,
          classification: "unknown",
          classificationBasis: "security",
          classificationConfidence: 1,
          blocked: true,
          blockReason: pathCheck.reason,
          ingestStatus: "blocked",
          retryCount: 0,
        });
        continue;
      }
      const sec = serverCheckFileSecurity(pathCheck.path);
      if (sec.blocked) {
        await ctx.db.insert("archiveFiles", {
          tenantId,
          archiveId,
          path: pathCheck.path,
          filename: f.filename,
          extension: f.extension,
          mimeType: f.mimeType,
          size: f.size,
          checksum: f.checksum,
          depth: f.depth,
          isDuplicate: false,
          supported: false,
          classification: "unknown",
          classificationBasis: "security",
          classificationConfidence: 1,
          blocked: true,
          blockReason: sec.reason,
          ingestStatus: "blocked",
          retryCount: 0,
        });
        continue;
      }

      // Client status → server ingest status (server is authoritative).
      let ingestStatus: string;
      let note: string | undefined = f.note;
      let storageId: Id<"_storage"> | undefined = f.storageId;
      switch (f.status) {
        case "ok": {
          const sizeCheck = serverCheckFileSize(f.size);
          if (!sizeCheck.ingestOk) {
            ingestStatus = "too_large";
            note = sizeCheck.reason;
            storageId = undefined;
          } else if (!storageId) {
            ingestStatus = "failed";
            note = "File was not uploaded before the inventory was submitted.";
          } else {
            ingestStatus = "queued";
          }
          break;
        }
        case "blocked":
          ingestStatus = "blocked";
          storageId = undefined;
          break;
        case "unsupported":
          ingestStatus = "unsupported";
          storageId = undefined;
          break;
        case "too_large":
          ingestStatus = "too_large";
          storageId = undefined;
          break;
        case "duplicate":
          ingestStatus = "duplicate";
          storageId = undefined;
          break;
        case "skipped_nested":
          ingestStatus = "skipped";
          storageId = undefined;
          break;
        default:
          ingestStatus = "skipped";
          storageId = undefined;
          note = "Unknown inventory status.";
      }

      // Cross-archive duplicate guard: identical checksum already ingested?
      let isDuplicate = ingestStatus === "duplicate";
      let duplicateOfPath = f.duplicateOfPath;
      if (ingestStatus === "queued" && HEX64.test(f.checksum)) {
        const prior = await ctx.db
          .query("archiveFiles")
          .withIndex("by_tenant_checksum", (q) =>
            q.eq("tenantId", tenantId).eq("checksum", f.checksum),
          )
          .filter((q) => q.eq(q.field("ingestStatus"), "ingested"))
          .first();
        if (prior) {
          isDuplicate = true;
          duplicateOfPath = prior.path;
          ingestStatus = "duplicate";
          storageId = undefined;
          ingestedDupes++;
        }
      }

      await ctx.db.insert("archiveFiles", {
        tenantId,
        archiveId,
        path: pathCheck.path,
        filename: f.filename,
        extension: f.extension,
        mimeType: f.mimeType,
        size: f.size,
        checksum: f.checksum,
        depth: f.depth,
        isDuplicate,
        duplicateOfPath,
        versionGroup: f.versionGroup,
        isSuperseded: f.isSuperseded,
        supersedesPath: f.supersedesPath,
        supported: f.supported,
        classification: f.classification,
        classificationBasis: f.classificationBasis,
        classificationConfidence: f.classificationConfidence,
        claimHints: f.claimHints,
        blocked: ingestStatus === "blocked",
        blockReason: ingestStatus === "blocked" ? f.blockReason ?? note : undefined,
        ingestStatus: ingestStatus as never,
        storageId,
        error: ingestStatus === "failed" ? note : undefined,
        retryCount: 0,
      });
    }

    // Accumulate real counters on the archive record.
    const warnings = clientWarnings ? [...clientWarnings] : archive.warnings;
    await ctx.db.patch(archiveId, {
      fileCount: archive.fileCount + files.length,
      extractedSize: archive.extractedSize + addedSize,
      status: "inventorying",
      warnings,
      updatedAt: Date.now(),
    });

    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: "archive_inventory_submitted",
      targetType: "archiveIngestions",
      targetId: String(archiveId),
      metadata: { batchFiles: files.length, totalFiles: archive.fileCount + files.length },
    });

    return { archiveId, batchFiles: files.length, totalFiles: archive.fileCount + files.length, ingestedDupes };
  },
});

/** Kick off the durable ingestion job for a fully-submitted archive. */
export const beginProcessing = action({
  args: { archiveId: v.id("archiveIngestions") },
  handler: async (
    ctx,
    { archiveId },
  ): Promise<{ started: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("You must be signed in.");
    const membership = await ctx.runQuery(internal.internal.getMembershipByUser, {
      userId,
    });
    if (!membership) throw new Error("You don't belong to a workspace yet.");
    const tenantId = membership.tenantId;
    const member = await ctx.runQuery(internal.internal.getMembershipByUserTenant, {
      userId,
      tenantId,
    });
    if (!member || !((["owner", "admin", "manager", "analyst"] as string[]).includes(member.role))) {
      throw new Error("Viewers cannot start archive ingestion.");
    }

    const archive = await ctx.runQuery(internal.archive.internal.getArchiveRecord, { archiveId });
    if (!archive || archive.tenantId !== tenantId) {
      throw new Error("Archive not found.");
    }
    if (TERMINAL.has(archive.status)) {
      throw new Error("This archive has already finished processing.");
    }
    if (archive.fileCount === 0) {
      throw new Error("The archive has no inventory yet — submit the file inventory first.");
    }

    await ctx.runMutation(internal.archive.internal.patchArchiveRecord, {
      id: archiveId,
      patch: { status: "ingesting", progress: 0, updatedAt: Date.now() },
    });
    await ctx.runMutation(internal.archive.internal.emitEvent, {
      tenantId,
      eventType: "archive_processing_started",
      sourceResourceId: String(archiveId),
      payload: { filename: archive.filename, fileCount: archive.fileCount },
      actorId: userId,
    });
    scheduleProcessBatch(ctx, archiveId);
    return { started: true };
  },
});

/** Cancel a large ingestion — stops future processing, keeps finished work. */
export const cancelArchive = mutation({
  args: { archiveId: v.id("archiveIngestions") },
  handler: async (ctx, { archiveId }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    if (!(await isEditor(ctx, userId, tenantId))) {
      throw new Error("Only editors can cancel an import.");
    }
    const archive = await ctx.db.get(archiveId);
    if (!archive || archive.tenantId !== tenantId) throw new Error("Archive not found.");
    if (TERMINAL.has(archive.status)) {
      throw new Error("This archive has already finished processing.");
    }
    await ctx.db.patch(archiveId, {
      status: "cancelled",
      updatedAt: Date.now(),
      failureReason: "Cancelled by a user.",
    });
    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: "archive_cancelled",
      targetType: "archiveIngestions",
      targetId: String(archiveId),
      metadata: { filename: archive.filename },
    });
    await ctx.runMutation(internal.archive.internal.emitEvent, {
      tenantId,
      eventType: "archive_cancelled",
      sourceResourceId: String(archiveId),
      payload: { filename: archive.filename },
      actorId: userId,
    });
  },
});

/** Retry failed files (optionally a subset) without re-uploading the archive. */
export const retryFiles = action({
  args: {
    archiveId: v.id("archiveIngestions"),
    fileIds: v.optional(v.array(v.id("archiveFiles"))),
  },
  handler: async (
    ctx,
    { archiveId, fileIds },
  ): Promise<{ requeued: number }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("You must be signed in.");
    const membership = await ctx.runQuery(internal.internal.getMembershipByUser, {
      userId,
    });
    if (!membership) throw new Error("You don't belong to a workspace yet.");
    const tenantId = membership.tenantId;
    const member = await ctx.runQuery(internal.internal.getMembershipByUserTenant, {
      userId,
      tenantId,
    });
    if (!member || !((["owner", "admin", "manager", "analyst"] as string[]).includes(member.role))) {
      throw new Error("Viewers cannot retry archive files.");
    }
    const archive = await ctx.runQuery(internal.archive.internal.getArchiveRecord, { archiveId });
    if (!archive || archive.tenantId !== tenantId) throw new Error("Archive not found.");

    const result = await ctx.runAction(internal.archive.process.requeueFiles, {
      archiveId,
      fileIds,
    });
    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: "archive_files_retried",
      targetType: "archiveIngestions",
      targetId: String(archiveId),
      metadata: { requeued: result.requeued },
    });
    return result;
  },
});

/** Manager+ only: remove the archive record + inventory (documents stay). */
export const deleteArchive = mutation({
  args: { archiveId: v.id("archiveIngestions") },
  handler: async (ctx, { archiveId }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    if (!(await isManager(ctx, userId, tenantId))) {
      throw new Error("Only managers and above can delete an import.");
    }
    const archive = await ctx.db.get(archiveId);
    if (!archive || archive.tenantId !== tenantId) throw new Error("Archive not found.");

    const files = await ctx.db
      .query("archiveFiles")
      .withIndex("by_archive", (q) => q.eq("archiveId", archiveId))
      .collect();
    for (const f of files) await ctx.db.delete(f._id);
    if (archive.rawStorageId) await ctx.storage.delete(archive.rawStorageId);
    await ctx.db.delete(archiveId);
    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: "archive_deleted",
      targetType: "archiveIngestions",
      targetId: String(archiveId),
      metadata: { filename: archive.filename },
    });
  },
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const listArchives = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    return await ctx.db
      .query("archiveIngestions")
      .withIndex("by_tenant_created", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(40);
  },
});

export const getArchiveDetail = query({
  args: { archiveId: v.id("archiveIngestions") },
  handler: async (ctx, { archiveId }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const archive = await ctx.db.get(archiveId);
    if (!archive || archive.tenantId !== tenantId) return null;
    const files = await ctx.db
      .query("archiveFiles")
      .withIndex("by_archive", (q) => q.eq("archiveId", archiveId))
      .order("asc")
      .take(2000);
    // Link ingested documents for provenance (only this tenant's records).
    const docIds = files
      .map((f) => f.documentId)
      .filter((d): d is NonNullable<typeof d> => Boolean(d));
    const docs = new Map<
      string,
      { _id: string; title: string; classification: string; status: string }
    >();
    for (const id of docIds.slice(0, 300)) {
      const doc = await ctx.db.get(id);
      if (doc && doc.tenantId === tenantId) {
        docs.set(String(id), {
          _id: String(id),
          title: doc.title,
          classification: doc.classification,
          status: doc.status,
        });
      }
    }
    return { archive, files, docs: Object.fromEntries(docs) };
  },
});

export const archiveStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const archives = await ctx.db
      .query("archiveIngestions")
      .withIndex("by_tenant_created", (q) => q.eq("tenantId", tenantId))
      .take(200);
    let filesIngested = 0;
    let potentialClaims = 0;
    for (const a of archives) {
      filesIngested += a.stats?.ingested ?? 0;
      potentialClaims += (a.stats?.potentialClaims ?? []).length;
    }
    return {
      total: archives.length,
      completed: archives.filter((a) => a.status === "completed").length,
      completedWithWarnings: archives.filter((a) => a.status === "completed_with_warnings").length,
      failed: archives.filter((a) => a.status === "failed").length,
      inProgress: archives.filter((a) => !["completed", "completed_with_warnings", "failed", "cancelled"].includes(a.status)).length,
      filesIngested,
      potentialClaims,
    };
  },
});
