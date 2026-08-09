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
    /** Optional — event/system ingestion has no human actor. */
    userId: v.optional(v.id("users")),
    title: v.string(),
    mimeType: v.string(),
    size: v.number(),
    sourceType: v.string(),
    storageId: v.optional(v.id("_storage")),
    sourceId: v.optional(v.string()),
    sourceModifiedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("documents", {
      tenantId: args.tenantId,
      title: args.title,
      mimeType: args.mimeType,
      size: args.size,
      sourceType: args.sourceType,
      storageId: args.storageId,
      sourceId: args.sourceId,
      sourceModifiedAt: args.sourceModifiedAt,
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
    toolPlan: v.optional(v.any()),
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
    evidenceType: v.optional(v.string()),
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

export const getDocBySource = internalQuery({
  args: { tenantId: v.id("tenants"), sourceId: v.string() },
  handler: async (ctx, { tenantId, sourceId }) => {
    return await ctx.db
      .query("documents")
      .withIndex("by_tenant_source", (q) =>
        q.eq("tenantId", tenantId).eq("sourceId", sourceId),
      )
      .first();
  },
});

export const listConnectionsByTenant = internalQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, { tenantId }) => {
    return await ctx.db
      .query("connections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const listAllConnections = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("connections").collect();
  },
});

export const getConnectionById = internalQuery({
  args: { connectionId: v.id("connections") },
  handler: async (ctx, { connectionId }) => {
    return await ctx.db.get(connectionId);
  },
});

export const patchConnection = internalMutation({
  args: { id: v.id("connections"), patch: v.any() },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});

// ---------------------------------------------------------------------------
// Tool & Action runtime internals
// ---------------------------------------------------------------------------

export const insertToolAction = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    /** Optional — event/system-triggered actions have no human actor. */
    actorId: v.optional(v.id("users")),
    trigger: v.optional(
      v.union(v.literal("user"), v.literal("event"), v.literal("system")),
    ),
    sourceEventId: v.optional(v.id("events")),
    toolId: v.string(),
    connectorId: v.optional(v.id("connections")),
    status: v.union(
      v.literal("proposed"),
      v.literal("awaiting_confirmation"),
      v.literal("approved"),
      v.literal("executing"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("verified"),
      v.literal("verification_failed"),
      v.literal("cancelled"),
    ),
    input: v.any(),
    confirmationRequired: v.optional(v.boolean()),
    confirmationMessage: v.optional(v.string()),
    evidence: v.optional(v.any()),
    requestText: v.optional(v.string()),
    startedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("toolActions", args);
  },
});

export const patchToolAction = internalMutation({
  args: { id: v.id("toolActions"), patch: v.any() },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});

export const getToolActionById = internalQuery({
  args: { actionId: v.id("toolActions") },
  handler: async (ctx, { actionId }) => {
    return await ctx.db.get(actionId);
  },
});

export const listToolActionsByTenant = internalQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, { tenantId }) => {
    return await ctx.db
      .query("toolActions")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(80);
  },
});

// ---------------------------------------------------------------------------
// Event substrate internals
// ---------------------------------------------------------------------------

export const insertEvent = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    eventId: v.string(),
    eventType: v.string(),
    provider: v.string(),
    connectorId: v.optional(v.id("connections")),
    connectionId: v.optional(v.id("connections")),
    sourceResourceId: v.string(),
    occurredAt: v.number(),
    receivedAt: v.number(),
    payload: v.any(),
    payloadVersion: v.string(),
    correlationId: v.optional(v.string()),
    idempotencyKey: v.string(),
    dedupeKey: v.string(),
    status: v.union(
      v.literal("received"),
      v.literal("processing"),
      v.literal("processed"),
      v.literal("ignored"),
      v.literal("failed"),
      v.literal("retrying"),
    ),
    attempts: v.number(),
    maxAttempts: v.number(),
    sourceMechanism: v.string(),
    providerEventId: v.optional(v.string()),
    createdBy: v.optional(v.string()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("events", args);
  },
});

export const patchEvent = internalMutation({
  args: { id: v.id("events"), patch: v.any() },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});

export const getEventById = internalQuery({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    return await ctx.db.get(eventId);
  },
});

export const getEventByDedupeKey = internalQuery({
  args: { dedupeKey: v.string() },
  handler: async (ctx, { dedupeKey }) => {
    return await ctx.db
      .query("events")
      .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
      .first();
  },
});

export const insertNotification = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    recipientId: v.optional(v.id("users")),
    severity: v.union(
      v.literal("info"),
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical"),
    ),
    title: v.string(),
    description: v.optional(v.string()),
    sourceEventId: v.optional(v.id("events")),
    actionId: v.optional(v.id("toolActions")),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("notifications", { ...args, read: false });
  },
});

export const patchNotification = internalMutation({
  args: { id: v.id("notifications"), patch: v.any() },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});

export const listNotificationsByTenant = internalQuery({
  args: { tenantId: v.id("tenants"), limit: v.number() },
  handler: async (ctx, { tenantId, limit }) => {
    return await ctx.db
      .query("notifications")
      .withIndex("by_tenant_created", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(limit);
  },
});

export const getEventPoliciesByTenant = internalQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, { tenantId }) => {
    return await ctx.db
      .query("eventPolicies")
      .withIndex("by_tenant_type", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});
