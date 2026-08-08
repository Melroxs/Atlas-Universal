import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { isEditor, isManager, requireTenant, requireUser } from "./helpers";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    if (!(await isEditor(ctx, userId, tenantId))) {
      throw new Error("Viewers can read the knowledge base but not upload files.");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

export const listDocuments = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(80);
    return docs;
  },
});

export const documentStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const chunks = await ctx.db
      .query("documentChunks")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    return {
      total: docs.length,
      ready: docs.filter((d) => d.status === "ready").length,
      processing: docs.filter((d) => d.status === "processing").length,
      failed: docs.filter((d) => d.status === "failed").length,
      chunks: chunks.length,
    };
  },
});

export const getDocument = query({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const doc = await ctx.db.get(documentId);
    if (!doc || doc.tenantId !== tenantId) return null;
    return doc;
  },
});

export const getDocumentDetail = query({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const doc = await ctx.db.get(documentId);
    if (!doc || doc.tenantId !== tenantId) return null;

    const [chunks, entities, assertions] = await Promise.all([
      ctx.db
        .query("documentChunks")
        .withIndex("by_document", (q) => q.eq("documentId", documentId))
        .collect(),
      ctx.db
        .query("entities")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .filter((q) => q.eq(q.field("sourceDocumentId"), documentId))
        .collect(),
      ctx.db
        .query("knowledgeAssertions")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .filter((q) => q.eq(q.field("sourceDocumentId"), documentId))
        .take(40),
    ]);

    return { doc, chunks, entities, assertions };
  },
});

export const deleteDocument = mutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    if (!(await isManager(ctx, userId, tenantId))) {
      throw new Error("Only managers and above can delete documents.");
    }
    const doc = await ctx.db.get(documentId);
    if (!doc || doc.tenantId !== tenantId) {
      throw new Error("Document not found.");
    }
    await ctx.runMutation(internal.internal.deleteDoc, { documentId });
    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: "document_deleted",
      targetType: "document",
      targetId: String(documentId),
      metadata: { title: doc.title },
    });
  },
});
