import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireTenant, requireUser } from "./helpers";

export const listEntities = query({
  args: { type: v.optional(v.string()) },
  handler: async (ctx, { type }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    if (type) {
      return await ctx.db
        .query("entities")
        .withIndex("by_tenant_type", (q) =>
          q.eq("tenantId", tenantId).eq("entityTypeKey", type),
        )
        .take(200);
    }
    return await ctx.db
      .query("entities")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(200);
  },
});

export const getEntity = query({
  args: { entityId: v.id("entities") },
  handler: async (ctx, { entityId }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const entity = await ctx.db.get(entityId);
    if (!entity || entity.tenantId !== tenantId) return null;
    const [relationships, assertions] = await Promise.all([
      ctx.db
        .query("entityRelationships")
        .withIndex("by_subject", (q) => q.eq("subjectEntityId", entityId))
        .collect(),
      ctx.db
        .query("knowledgeAssertions")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .filter((q) => q.eq(q.field("entityId"), entityId))
        .take(20),
    ]);
    const related = await Promise.all(
      relationships.map(async (r) => {
        const obj = await ctx.db.get(r.objectEntityId);
        return {
          ...r,
          object: obj
            ? { _id: obj._id, name: obj.name, entityTypeKey: obj.entityTypeKey }
            : null,
        };
      }),
    );
    return { entity, relationships: related, assertions };
  },
});

export const listAssertions = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    return await ctx.db
      .query("knowledgeAssertions")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(60);
  },
});

export const entityStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const [entities, relationships, assertions] = await Promise.all([
      ctx.db
        .query("entities")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .collect(),
      ctx.db
        .query("entityRelationships")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .collect(),
      ctx.db
        .query("knowledgeAssertions")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .collect(),
    ]);
    const typeCounts: Record<string, number> = {};
    for (const e of entities) {
      typeCounts[e.entityTypeKey] = (typeCounts[e.entityTypeKey] ?? 0) + 1;
    }
    return {
      entities: entities.length,
      relationships: relationships.length,
      assertions: assertions.length,
      typeCounts,
    };
  },
});

/** Node/edge snapshot for graph visualization. */
export const graphSnapshot = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const [entities, relationships] = await Promise.all([
      ctx.db
        .query("entities")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(80),
      ctx.db
        .query("entityRelationships")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(200),
    ]);
    const nodes = entities.map((e) => ({
      id: String(e._id),
      label: e.name,
      type: e.entityTypeKey,
      confidence: e.confidence,
    }));
    const edges = relationships
      .filter(
        (r) =>
          nodes.some((n) => n.id === String(r.subjectEntityId)) &&
          nodes.some((n) => n.id === String(r.objectEntityId)),
      )
      .map((r) => ({
        id: String(r._id),
        source: String(r.subjectEntityId),
        target: String(r.objectEntityId),
        type: r.relationshipTypeKey,
      }));
    return { nodes, edges };
  },
});

/** Confirm an entity (promotes proposed → confirmed). */
export const confirmEntity = mutation({
  args: { entityId: v.id("entities") },
  handler: async (ctx, { entityId }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const entity = await ctx.db.get(entityId);
    if (!entity || entity.tenantId !== tenantId) {
      throw new Error("Entity not found.");
    }
    await ctx.db.patch(entity._id, {
      status: "confirmed",
      confidence: Math.max(entity.confidence, 0.9),
    });
  },
});
