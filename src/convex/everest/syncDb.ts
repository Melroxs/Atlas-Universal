// ---------------------------------------------------------------------------
// Everest — Authority Sync DB surface (non-node)
//
// Actions cannot read/write the database directly, so the node-side sync
// engine calls these internal queries/mutations. No external content ever
// reaches this module un-sanitized.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { internalQuery, internalMutation } from "../_generated/server";
import { deterministicEventId } from "../events/contract";
import { EVENT_REGISTRY } from "../events/registry";
import { waitingLabel, deadlineStatus } from "./temporalOps";
import { evaluateApplicability } from "./jurisdiction";

const AUTHORITY_EVENT_TYPES = new Set(
  EVENT_REGISTRY.filter((e) => e.provider === "atlas_authority").map((e) => e.type),
);

// --- Internal queries --------------------------------------------------------

export const getSource = internalQuery({
  args: { sourceId: v.string() },
  handler: async (ctx, { sourceId }) =>
    await ctx.db
      .query("authoritativeSources")
      .withIndex("by_source_id", (q) => q.eq("sourceId", sourceId))
      .first(),
});

export const listSources = internalQuery({
  args: {},
  handler: async (ctx) => await ctx.db.query("authoritativeSources").collect(),
});

export const listKnowledgeBySource = internalQuery({
  args: { sourceId: v.string() },
  handler: async (ctx, { sourceId }) =>
    await ctx.db
      .query("authoritativeKnowledge")
      .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
      .collect(),
});

export const listOrgContexts = internalQuery({
  args: {},
  handler: async (ctx) => await ctx.db.query("organizationContexts").collect(),
});

export const listWorkflowDefs = internalQuery({
  args: {},
  handler: async (ctx) => await ctx.db.query("workflowSettings").collect(),
});

// --- Internal mutations ------------------------------------------------------

/** Publish a source's new content hash after a successful check. */
export const patchSourceHash = internalMutation({
  args: {
    sourceId: v.string(),
    contentHash: v.string(),
    lastChangedAt: v.number(),
    lastChangeType: v.string(),
  },
  handler: async (ctx, args) => {
    const source = await ctx.db
      .query("authoritativeSources")
      .withIndex("by_source_id", (q) => q.eq("sourceId", args.sourceId))
      .first();
    if (!source) return;
    await ctx.db.patch(source._id, {
      contentHash: args.contentHash,
      lastChangedAt: args.lastChangedAt,
      lastChangeType: args.lastChangeType,
    });
  },
});

/** Patch a knowledge row's freshness state (honest, never silently current). */
export const patchKnowledgeFreshness = internalMutation({
  args: { knowledgeId: v.string(), freshness: v.string() },
  handler: async (ctx, { knowledgeId, freshness }) => {
    const k = await ctx.db
      .query("authoritativeKnowledge")
      .withIndex("by_knowledge_id", (q) => q.eq("knowledgeId", knowledgeId))
      .first();
    if (!k) return;
    await ctx.db.patch(k._id, { freshness });
  },
});

/** Record one check attempt + update source health fields. */
export const recordAuthorityCheck = internalMutation({
  args: {
    sourceId: v.string(),
    success: v.boolean(),
    ok: v.boolean(),
    statusCode: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
    contentHash: v.optional(v.string()),
    version: v.optional(v.string()),
    changeType: v.optional(v.string()),
    error: v.optional(v.string()),
    createdVersionIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const checkedAt = Date.now();
    await ctx.db.insert("authorityChecks", { ...args, checkedAt });
    const source = await ctx.db
      .query("authoritativeSources")
      .withIndex("by_source_id", (q) => q.eq("sourceId", args.sourceId))
      .first();
    if (!source) return;
    const failures = args.success ? 0 : (source.consecutiveFailures ?? 0) + 1;
    await ctx.db.patch(source._id, {
      lastCheckedAt: checkedAt,
      lastLatencyMs: args.latencyMs,
      consecutiveFailures: failures,
      lastFetchError: args.success ? undefined : (args.error ?? "Retrieval failed."),
      ...(args.success
        ? {
            lastSuccessfulSyncAt: checkedAt,
            contentHash: args.contentHash ?? source.contentHash,
            lastKnownVersion: args.version ?? source.lastKnownVersion,
            lastChangeType: args.changeType ?? source.lastChangeType,
          }
        : {}),
    });
  },
});

/** Publish an immutable knowledge version + update the current row + chain
 *  supersession. Never overwrites history. */
export const publishKnowledgeVersion = internalMutation({
  args: {
    knowledgeId: v.string(),
    sourceId: v.string(),
    version: v.optional(v.string()),
    contentHash: v.string(),
    sourceContent: v.optional(v.string()),
    normalizedFact: v.string(),
    atlasInterpretation: v.optional(v.string()),
    knowledgeType: v.string(),
    jurisdiction: v.optional(v.string()),
    industry: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    effectiveAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    changeType: v.string(),
    confidence: v.number(),
    reviewStatus: v.optional(v.string()),
    supersedesId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const versionId = `${args.knowledgeId}:${args.contentHash.slice(0, 12)}`;
    const existing = await ctx.db
      .query("knowledgeVersions")
      .withIndex("by_version_id", (q) => q.eq("versionId", versionId))
      .first();
    if (existing) return { versionId, created: false };

    const retrievedAt = Date.now();
    await ctx.db.insert("knowledgeVersions", {
      versionId,
      knowledgeId: args.knowledgeId,
      sourceId: args.sourceId,
      version: args.version,
      contentHash: args.contentHash,
      sourceContent: args.sourceContent,
      normalizedFact: args.normalizedFact,
      atlasInterpretation: args.atlasInterpretation,
      knowledgeType: args.knowledgeType,
      jurisdiction: args.jurisdiction,
      industry: args.industry,
      publishedAt: args.publishedAt,
      effectiveAt: args.effectiveAt,
      expiresAt: args.expiresAt,
      retrievedAt,
      status: "active",
      changeType: args.changeType,
      supersedesId: args.supersedesId,
      supersededById: undefined,
      confidence: args.confidence,
    });

    const knowledge = await ctx.db
      .query("authoritativeKnowledge")
      .withIndex("by_knowledge_id", (q) => q.eq("knowledgeId", args.knowledgeId))
      .first();
    if (knowledge) {
      await ctx.db.patch(knowledge._id, {
        contentHash: args.contentHash,
        normalizedFact: args.normalizedFact,
        version: args.version ?? knowledge.version,
        retrievalDate: retrievedAt,
        effectiveDate: args.effectiveAt ?? knowledge.effectiveDate,
        publicationDate: args.publishedAt ?? knowledge.publicationDate,
        expirationDate: args.expiresAt ?? knowledge.expirationDate,
        lastCheckedAt: retrievedAt,
        lastChangeType: args.changeType,
        freshness: "current",
        reviewStatus: args.reviewStatus ?? knowledge.reviewStatus,
        supersedesId: args.supersedesId ?? knowledge.supersedesId,
        supersededById: args.supersedesId ? versionId : undefined,
      });
      // Mark the superseded prior version row (immutable) as superseded.
      if (args.supersedesId) {
        const supersededId = args.supersedesId;
        const prior = await ctx.db
          .query("knowledgeVersions")
          .withIndex("by_version_id", (q) => q.eq("versionId", supersededId))
          .first();
        if (prior) {
          await ctx.db.patch(prior._id, {
            status: "superseded",
            supersededById: versionId,
          });
        }
      }
    }
    return { versionId, created: true };
  },
});

/** Insert an impact assessment (deduped per source+knowledge+changeType). */
export const insertImpactAssessment = internalMutation({
  args: {
    sourceId: v.string(),
    sourceName: v.string(),
    authorityTier: v.string(),
    knowledgeId: v.string(),
    knowledgeTitle: v.string(),
    changeType: v.string(),
    affectedJurisdictions: v.array(v.string()),
    affectedIndustries: v.array(v.string()),
    affectedTenantIds: v.array(v.id("tenants")),
    affectedWorkflowIds: v.array(v.string()),
    evidence: v.any(),
    confidence: v.number(),
    severity: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    urgency: v.union(v.literal("immediate"), v.literal("soon"), v.literal("scheduled")),
    recommendedAction: v.string(),
    requiresHumanReview: v.boolean(),
  },
  handler: async (ctx, args) => {
    const createdAt = Date.now();
    const existing = await ctx.db
      .query("impactAssessments")
      .withIndex("by_source", (q) => q.eq("sourceId", args.sourceId))
      .filter((q) => q.eq(q.field("knowledgeId"), args.knowledgeId))
      .filter((q) => q.eq(q.field("changeType"), args.changeType))
      .first();
    if (existing && createdAt - existing.createdAt < 24 * 3600_000) {
      return { assessmentId: existing._id, created: false };
    }
    const id = await ctx.db.insert("impactAssessments", {
      ...args,
      affectedPolicyIds: [],
      affectedEntityIds: [],
      status: "pending_review",
      createdAt,
    });
    return { assessmentId: id, created: true };
  },
});

/** Emit an authority event into the existing event substrate (tenant-scoped)
 *  plus an optional in-app notification. Deduped by deterministic id. */
export const recordAuthorityEvent = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    eventType: v.string(),
    sourceResourceId: v.string(),
    occurredAt: v.number(),
    payload: v.any(),
    dedupeKey: v.string(),
    notify: v.optional(
      v.object({
        severity: v.union(v.literal("info"), v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("critical")),
        title: v.string(),
        description: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    if (!AUTHORITY_EVENT_TYPES.has(args.eventType)) return { eventId: null, created: false };
    const eventId = deterministicEventId(args.dedupeKey);
    const existing = await ctx.db
      .query("events")
      .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", args.dedupeKey))
      .first();
    if (existing) return { eventId: existing._id, created: false };
    const receivedAt = Date.now();
    const id = await ctx.db.insert("events", {
      tenantId: args.tenantId,
      eventId,
      eventType: args.eventType,
      provider: "atlas_authority",
      connectorId: undefined,
      connectionId: undefined,
      sourceResourceId: args.sourceResourceId,
      occurredAt: args.occurredAt,
      receivedAt,
      payload: args.payload,
      payloadVersion: "1.0",
      correlationId: undefined,
      idempotencyKey: args.dedupeKey,
      dedupeKey: args.dedupeKey,
      status: "processed",
      attempts: 1,
      maxAttempts: 1,
      lastError: undefined,
      processedAt: receivedAt,
      processingMs: 0,
      duplicateOf: undefined,
      intelligence: undefined,
      actionId: undefined,
      sourceMechanism: "polling",
      providerEventId: undefined,
      createdBy: "authority-ingest",
      createdAt: receivedAt,
    });
    if (args.notify) {
      await ctx.db.insert("notifications", {
        tenantId: args.tenantId,
        recipientId: undefined,
        severity: args.notify.severity,
        title: args.notify.title,
        description: args.notify.description,
        sourceEventId: id,
        actionId: undefined,
        read: false,
        createdAt: receivedAt,
      });
    }
    return { eventId: id, created: true };
  },
});

/** Proactive temporal intelligence — only from REAL data: approvals waiting
 *  beyond business-day thresholds, approval deadlines, and requirements
 *  becoming effective soon (applicability-checked per tenant). */
export const runProactiveTemporalChecks = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const contexts = await ctx.db.query("organizationContexts").collect();
    const dayAgo = now - 24 * 3600_000;
    let notified = 0;

    for (const c of contexts) {
      const cfg = {
        timezone: c.primaryTimezone ?? "UTC",
        businessDays: c.businessDays ?? [1, 2, 3, 4, 5],
        businessHours: c.businessHours ?? { start: "09:00", end: "17:00" },
        holidays: (c.holidays as string[] | undefined) ?? [],
      };

      // Approvals actually waiting — real records.
      const pending = await ctx.db
        .query("workflowApprovals")
        .withIndex("by_tenant_status", (q) => q.eq("tenantId", c.tenantId))
        .filter((q) => q.eq(q.field("status"), "pending"))
        .collect();

      for (const a of pending) {
        const label = waitingLabel(a.createdAt, now, cfg);
        if (!label.startsWith("waiting since")) {
          const recent = await ctx.db
            .query("notifications")
            .withIndex("by_tenant_created", (q) => q.eq("tenantId", c.tenantId).gte("createdAt", dayAgo))
            .filter((q) => q.eq(q.field("title"), `Approval waiting: ${a.title}`))
            .first();
          if (!recent) {
            await ctx.db.insert("notifications", {
              tenantId: c.tenantId,
              recipientId: undefined,
              severity: "medium",
              title: `Approval waiting: ${a.title}`,
              description: `This approval request has been ${label}.`,
              sourceEventId: undefined,
              actionId: undefined,
              read: false,
              createdAt: now,
            });
            notified++;
          }
        }
        if (a.expiresAt) {
          const dl = deadlineStatus(a.expiresAt, now, cfg, 2);
          if (dl.status === "due_soon" || dl.status === "overdue") {
            const recent = await ctx.db
              .query("notifications")
              .withIndex("by_tenant_created", (q) => q.eq("tenantId", c.tenantId).gte("createdAt", dayAgo))
              .filter((q) => q.eq(q.field("title"), `Approval deadline: ${a.title}`))
              .first();
            if (!recent) {
              await ctx.db.insert("notifications", {
                tenantId: c.tenantId,
                recipientId: undefined,
                severity: dl.status === "overdue" ? "high" : "medium",
                title: `Approval deadline: ${a.title}`,
                description: `This approval request is ${dl.label}.`,
                sourceEventId: undefined,
                actionId: undefined,
                read: false,
                createdAt: now,
              });
              notified++;
            }
          }
        }
      }

      // Requirements becoming effective within 7 days — real effective dates,
      // notified only to tenants where applicability actually matches.
      const allVersions = await ctx.db.query("knowledgeVersions").collect();
      for (const k of allVersions) {
        if (k.status !== "active" || !k.effectiveAt) continue;
        if (k.effectiveAt <= now || k.effectiveAt - now > 7 * 24 * 3600_000) continue;
        const applies = evaluateApplicability(
          { jurisdiction: k.jurisdiction, industry: k.industry, effectiveDate: k.effectiveAt },
          {
            country: c.country ?? undefined,
            state: c.regions?.[0] ?? undefined,
            municipality: c.cities?.[0] ?? undefined,
            industry: c.industry ?? undefined,
            asOf: now,
          },
        );
        if (!applies.applicable) continue;
        const title = `Requirement effective soon: ${k.normalizedFact.slice(0, 48)}`;
        const recent = await ctx.db
          .query("notifications")
          .withIndex("by_tenant_created", (q) => q.eq("tenantId", c.tenantId).gte("createdAt", dayAgo))
          .filter((q) => q.eq(q.field("title"), title))
          .first();
        if (!recent) {
          await ctx.db.insert("notifications", {
            tenantId: c.tenantId,
            recipientId: undefined,
            severity: "info",
            title,
            description: `Becomes effective ${new Date(k.effectiveAt).toISOString().slice(0, 10)}`,
            sourceEventId: undefined,
            actionId: undefined,
            read: false,
            createdAt: now,
          });
          notified++;
        }
      }
    }
    return { notified };
  },
});
