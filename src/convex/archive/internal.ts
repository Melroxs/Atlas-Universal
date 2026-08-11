/**
 * Phase 13 — internal archive mutations/queries (V8, no node).
 *
 * These live in a NON-node file because Convex only allows actions in
 * Node.js files. The durable actions in archive/process.ts ("use node")
 * drive ingestion through these small primitives.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { deterministicEventId } from "../events/contract";

export const getArchiveRecord = internalQuery({
  args: { archiveId: v.id("archiveIngestions") },
  handler: async (ctx, { archiveId }) => {
    return await ctx.db.get(archiveId);
  },
});

/** Recent archives for a tenant (Ask Atlas / summaries). */
export const listArchivesByTenant = internalQuery({
  args: { tenantId: v.id("tenants"), limit: v.number() },
  handler: async (ctx, { tenantId, limit }) => {
    return await ctx.db
      .query("archiveIngestions")
      .withIndex("by_tenant_created", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(limit);
  },
});

export const listFilesByArchive = internalQuery({
  args: { archiveId: v.id("archiveIngestions") },
  handler: async (ctx, { archiveId }) => {
    return await ctx.db
      .query("archiveFiles")
      .withIndex("by_archive", (q) => q.eq("archiveId", archiveId))
      .collect();
  },
});

export const listPendingFiles = internalQuery({
  args: { archiveId: v.id("archiveIngestions"), limit: v.number() },
  handler: async (ctx, { archiveId, limit }) => {
    return await ctx.db
      .query("archiveFiles")
      .withIndex("by_archive_status", (q) =>
        q.eq("archiveId", archiveId).eq("ingestStatus", "queued"),
      )
      .order("asc")
      .take(limit);
  },
});

export const patchArchiveRecord = internalMutation({
  args: { id: v.id("archiveIngestions"), patch: v.any() },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});

export const patchArchiveFile = internalMutation({
  args: { id: v.id("archiveFiles"), patch: v.any() },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});

/** Emit a tenant-scoped archive event with deterministic idempotency. */
export const emitEvent = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    eventType: v.string(),
    sourceResourceId: v.string(),
    payload: v.any(),
    actorId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const idempotencyKey = `archive:${args.sourceResourceId}:${args.eventType}:${args.actorId ?? "system"}`;
    const dedupeKey = idempotencyKey;
    const existing = await ctx.db
      .query("events")
      .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("events", {
      tenantId: args.tenantId,
      eventId: deterministicEventId(idempotencyKey),
      eventType: args.eventType,
      provider: "archive",
      connectorId: undefined,
      connectionId: undefined,
      sourceResourceId: args.sourceResourceId,
      occurredAt: now,
      receivedAt: now,
      payload: args.payload,
      payloadVersion: "1",
      idempotencyKey,
      dedupeKey,
      status: "processed",
      attempts: 1,
      maxAttempts: 1,
      processedAt: now,
      processingMs: 0,
      sourceMechanism: "manual",
      createdBy: "archive-ingestion",
      createdAt: now,
    });
  },
});
