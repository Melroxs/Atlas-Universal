import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
} from "./_generated/server";

// ---------------------------------------------------------------------------
// Internal queries — used by actions (which cannot touch the DB directly)
// ---------------------------------------------------------------------------

export const getMembershipByUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();
  },
});

export const getMembershipByUserTenant = internalQuery({
  args: { userId: v.id("users"), tenantId: v.id("tenants") },
  handler: async (ctx, { userId, tenantId }) => {
    return await ctx.db
      .query("memberships")
      .withIndex("by_tenant_user", (q) =>
        q.eq("tenantId", tenantId).eq("userId", userId),
      )
      .first();
  },
});

export const getTenantById = internalQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, { tenantId }) => {
    return await ctx.db.get(tenantId);
  },
});

export const getProfileByTenant = internalQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, { tenantId }) => {
    return await ctx.db
      .query("companyProfiles")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .first();
  },
});

export const listDocsByTenant = internalQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, { tenantId }) => {
    return await ctx.db
      .query("documents")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const getDocById = internalQuery({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    return await ctx.db.get(documentId);
  },
});

export const listChunksByTenant = internalQuery({
  args: { tenantId: v.id("tenants"), limit: v.number() },
  handler: async (ctx, { tenantId, limit }) => {
    return await ctx.db
      .query("documentChunks")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(limit);
  },
});

export const listChunksByDocument = internalQuery({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    return await ctx.db
      .query("documentChunks")
      .withIndex("by_document", (q) => q.eq("documentId", documentId))
      .collect();
  },
});

export const searchChunksByTenant = internalQuery({
  args: {
    tenantId: v.id("tenants"),
    query: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, { tenantId, query, limit }) => {
    return await ctx.db
      .query("documentChunks")
      .withSearchIndex("search_content", (q) => q.search("content", query))
      .filter((q) => q.eq(q.field("tenantId"), tenantId))
      .take(limit);
  },
});

export const listEntitiesByTenant = internalQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, { tenantId }) => {
    return await ctx.db
      .query("entities")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const listRelationshipsByTenant = internalQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, { tenantId }) => {
    return await ctx.db
      .query("entityRelationships")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const listAssertionsByTenant = internalQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, { tenantId }) => {
    return await ctx.db
      .query("knowledgeAssertions")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(60);
  },
});

export const listOpenRecsByDetector = internalQuery({
  args: {
    tenantId: v.id("tenants"),
    detectorKey: v.string(),
  },
  handler: async (ctx, { tenantId, detectorKey }) => {
    return await ctx.db
      .query("recommendations")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .filter((q) =>
        q.and(
          q.eq(q.field("detectorKey"), detectorKey),
          q.neq(q.field("status"), "dismissed"),
        ),
      )
      .collect();
  },
});

export const listOpenRecsByTenant = internalQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, { tenantId }) => {
    return await ctx.db
      .query("recommendations")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .filter((q) => q.eq(q.field("status"), "open"))
      .collect();
  },
});

export const listPacks = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("intelligencePacks").collect();
  },
});

export const listTenantPacks = internalQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, { tenantId }) => {
    return await ctx.db
      .query("tenantPacks")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const listPackItems = internalQuery({
  args: { packKey: v.string() },
  handler: async (ctx, { packKey }) => {
    return await ctx.db
      .query("intelligenceItems")
      .withIndex("by_pack", (q) => q.eq("packKey", packKey))
      .collect();
  },
});

export const listSystemsByTenant = internalQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, { tenantId }) => {
    return await ctx.db
      .query("companySystems")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

// ---------------------------------------------------------------------------
// Internal mutations — actions write to the DB through these
// ---------------------------------------------------------------------------

export const logAudit = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    actorType: v.string(),
    actorId: v.optional(v.id("users")),
    actionType: v.string(),
    targetType: v.optional(v.string()),
    targetId: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLogs", args);
  },
});

export const createDoc = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    userId: v.id("users"),
    title: v.string(),
    mimeType: v.string(),
    size: v.number(),
    sourceType: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("documents", {
      tenantId: args.tenantId,
      title: args.title,
      mimeType: args.mimeType,
      size: args.size,
      sourceType: args.sourceType,
      storageId: args.storageId,
      uploadedBy: args.userId,
      classification: "Unknown",
      status: "processing",
    });
  },
});

export const patchDoc = internalMutation({
  args: { id: v.id("documents"), patch: v.any() },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});

export const deleteDoc = internalMutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    const chunks = await ctx.db
      .query("documentChunks")
      .withIndex("by_document", (q) => q.eq("documentId", documentId))
      .collect();
    for (const c of chunks) {
      await ctx.db.delete(c._id);
    }
    await ctx.db.delete(documentId);
  },
});

export const insertChunk = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    documentId: v.id("documents"),
    chunkIndex: v.number(),
    content: v.string(),
    embedding: v.optional(v.array(v.number())),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("documentChunks", {
      tenantId: args.tenantId,
      documentId: args.documentId,
      chunkIndex: args.chunkIndex,
      content: args.content,
      embedding: args.embedding,
    });
  },
});

export const deleteChunksByDoc = internalMutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    const chunks = await ctx.db
      .query("documentChunks")
      .withIndex("by_document", (q) => q.eq("documentId", documentId))
      .collect();
    for (const c of chunks) {
      await ctx.db.delete(c._id);
    }
  },
});

export const createJob = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    documentId: v.optional(v.id("documents")),
    jobType: v.string(),
  },
  handler: async (ctx, { tenantId, documentId, jobType }) => {
    await ctx.db.insert("ingestionJobs", {
      tenantId,
      documentId,
      jobType,
      status: "running",
      retryCount: 0,
      startedAt: Date.now(),
    });
  },
});

export const patchJob = internalMutation({
  args: { id: v.id("ingestionJobs"), patch: v.any() },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});

export const insertEntity = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    entityTypeKey: v.string(),
    name: v.string(),
    summary: v.optional(v.string()),
    confidence: v.number(),
    attributes: v.optional(v.any()),
    sourceDocumentId: v.optional(v.id("documents")),
    firstObservedAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("entities", {
      tenantId: args.tenantId,
      entityTypeKey: args.entityTypeKey,
      name: args.name,
      summary: args.summary,
      status: "proposed",
      confidence: args.confidence,
      attributes: args.attributes,
      sourceDocumentId: args.sourceDocumentId,
      firstObservedAt: args.firstObservedAt,
      lastObservedAt: args.firstObservedAt,
    });
  },
});

export const patchEntity = internalMutation({
  args: { id: v.id("entities"), patch: v.any() },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});

export const insertRelationship = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    subjectEntityId: v.id("entities"),
    relationshipTypeKey: v.string(),
    objectEntityId: v.id("entities"),
    confidence: v.number(),
    sourceDocumentId: v.optional(v.id("documents")),
    evidence: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("entityRelationships", args);
  },
});

export const insertAssertion = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    classification: v.union(
      v.literal("FACT"),
      v.literal("RULE"),
      v.literal("OBSERVATION"),
      v.literal("INFERENCE"),
      v.literal("RECOMMENDATION"),
    ),
    statement: v.string(),
    confidence: v.number(),
    sourceDocumentId: v.optional(v.id("documents")),
    entityId: v.optional(v.id("entities")),
    evidence: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("knowledgeAssertions", {
      ...args,
      status: "proposed",
    });
  },
});

export const createRecommendation = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    title: v.string(),
    summary: v.string(),
    reason: v.string(),
    classification: v.union(
      v.literal("FACT"),
      v.literal("RULE"),
      v.literal("OBSERVATION"),
      v.literal("INFERENCE"),
      v.literal("RECOMMENDATION"),
    ),
    detectorKey: v.string(),
    priority: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    confidence: v.number(),
    expectedImpact: v.optional(v.string()),
    risk: v.optional(v.string()),
    requiredApprovalMode: v.union(
      v.literal("SUGGEST"),
      v.literal("APPROVE"),
      v.literal("AUTO"),
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("recommendations", {
      ...args,
      status: "open",
    });
  },
});

export const patchRecommendation = internalMutation({
  args: { id: v.id("recommendations"), patch: v.any() },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});

export const insertRecommendationEvidence = internalMutation({
  args: {
    recommendationId: v.id("recommendations"),
    kind: v.string(),
    documentId: v.optional(v.id("documents")),
    chunkId: v.optional(v.id("documentChunks")),
    entityId: v.optional(v.id("entities")),
    title: v.optional(v.string()),
    snippet: v.optional(v.string()),
    relevance: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("recommendationEvidence", args);
  },
});

export const deleteRecEvidence = internalMutation({
  args: { recommendationId: v.id("recommendations") },
  handler: async (ctx, { recommendationId }) => {
    const evs = await ctx.db
      .query("recommendationEvidence")
      .withIndex("by_recommendation", (q) =>
        q.eq("recommendationId", recommendationId),
      )
      .collect();
    for (const e of evs) {
      await ctx.db.delete(e._id);
    }
  },
});

export const insertAskSession = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    userId: v.id("users"),
    question: v.string(),
    answer: v.string(),
    classification: v.union(
      v.literal("FACT"),
      v.literal("RULE"),
      v.literal("OBSERVATION"),
      v.literal("INFERENCE"),
      v.literal("RECOMMENDATION"),
    ),
    confidence: v.number(),
    mode: v.union(v.literal("ai"), v.literal("local")),
    suggestedActions: v.optional(v.array(v.string())),
    limitations: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("askSessions", args);
  },
});

export const insertAskEvidence = internalMutation({
  args: {
    sessionId: v.id("askSessions"),
    kind: v.string(),
    documentId: v.optional(v.id("documents")),
    chunkId: v.optional(v.id("documentChunks")),
    entityId: v.optional(v.id("entities")),
    documentTitle: v.optional(v.string()),
    title: v.optional(v.string()),
    snippet: v.optional(v.string()),
    relevance: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("askEvidence", args);
  },
});

export const activateTenantPack = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    packKey: v.string(),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, { tenantId, packKey, userId }) => {
    const existing = await ctx.db
      .query("tenantPacks")
      .withIndex("by_tenant_pack", (q) =>
        q.eq("tenantId", tenantId).eq("packKey", packKey),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "active",
        activatedAt: Date.now(),
        activatedBy: userId,
      });
    } else {
      await ctx.db.insert("tenantPacks", {
        tenantId,
        packKey,
        activatedAt: Date.now(),
        activatedBy: userId,
        status: "active",
      });
    }
  },
});

export const dismissTenantPack = internalMutation({
  args: { tenantId: v.id("tenants"), packKey: v.string() },
  handler: async (ctx, { tenantId, packKey }) => {
    const existing = await ctx.db
      .query("tenantPacks")
      .withIndex("by_tenant_pack", (q) =>
        q.eq("tenantId", tenantId).eq("packKey", packKey),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { status: "dismissed" });
    }
  },
});

export const insertSystem = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    name: v.string(),
    category: v.optional(v.string()),
    vendor: v.optional(v.string()),
    notes: v.optional(v.string()),
    status: v.union(
      v.literal("active"),
      v.literal("planned"),
      v.literal("none"),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("companySystems", args);
  },
});

export const deleteSystem = internalMutation({
  args: { id: v.id("companySystems") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
