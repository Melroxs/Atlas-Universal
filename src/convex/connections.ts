import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { isManager, requireTenant, requireUser } from "./helpers";

export const listConnections = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    return await ctx.db
      .query("connections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const createConnection = mutation({
  args: {
    name: v.string(),
    provider: v.string(),
    category: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { name, provider, category, notes }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    if (!(await isManager(ctx, userId, tenantId))) {
      throw new Error("Only managers and above can add connections.");
    }
    const id = await ctx.db.insert("connections", {
      tenantId,
      name,
      provider,
      category,
      status: "connected",
      notes,
      settings: { kind: provider },
    });
    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: "connection_created",
      targetType: "connection",
      targetId: String(id),
      metadata: { name, provider, category },
    });
    return id;
  },
});

/** Simulated sync touch — real connectors arrive in the Connection Engine phase. */
export const syncConnection = mutation({
  args: { connectionId: v.id("connections") },
  handler: async (ctx, { connectionId }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const conn = await ctx.db.get(connectionId);
    if (!conn || conn.tenantId !== tenantId) {
      throw new Error("Connection not found.");
    }
    await ctx.db.patch(conn._id, {
      status: "syncing",
      lastSyncAt: Date.now(),
      lastError: undefined,
    });
    // Sync completes on next poll; simulate immediate completion.
    await ctx.db.patch(conn._id, {
      status: "connected",
      lastSyncAt: Date.now(),
    });
    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: "connection_synced",
      targetType: "connection",
      targetId: String(connectionId),
      metadata: { name: conn.name },
    });
  },
});

export const deleteConnection = mutation({
  args: { connectionId: v.id("connections") },
  handler: async (ctx, { connectionId }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const conn = await ctx.db.get(connectionId);
    if (!conn || conn.tenantId !== tenantId) {
      throw new Error("Connection not found.");
    }
    await ctx.db.delete(connectionId);
    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: "connection_deleted",
      targetType: "connection",
      targetId: String(connectionId),
      metadata: { name: conn.name },
    });
  },
});
