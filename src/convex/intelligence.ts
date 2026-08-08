import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { PACK_SEEDS } from "./data/packs";
import { requireTenant, requireUser } from "./helpers";

/** Seed the global pack catalog. Idempotent — safe to call repeatedly. */
export const seedIntelligence = mutation({
  args: {},
  handler: async (ctx) => {
    for (const pack of PACK_SEEDS) {
      const existing = await ctx.db
        .query("intelligencePacks")
        .withIndex("by_key", (q) => q.eq("key", pack.key))
        .first();
      if (existing) continue;
      const packId = await ctx.db.insert("intelligencePacks", {
        key: pack.key,
        name: pack.name,
        packType: pack.packType,
        publisher: pack.publisher,
        description: pack.description,
        version: pack.version,
        status: "active",
      });
      for (const item of pack.items) {
        await ctx.db.insert("intelligenceItems", {
          packKey: pack.key,
          itemType: item.itemType,
          key: item.key,
          title: item.title,
          summary: item.summary,
          content: item.content,
          jurisdiction: item.jurisdiction,
          industry: item.industry,
          status: "active",
          confidence: item.confidence,
        });
      }
      void packId;
    }
    return { seeded: PACK_SEEDS.length };
  },
});

/** All packs in the catalog, with item counts. */
export const listPacks = query({
  args: {},
  handler: async (ctx) => {
    const packs = await ctx.db.query("intelligencePacks").collect();
    const items = await ctx.db.query("intelligenceItems").collect();
    return packs.map((p) => ({
      ...p,
      itemCount: items.filter((i) => i.packKey === p.key).length,
    }));
  },
});

/** Active + available packs for the current workspace. */
export const listWorkspacePacks = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const [packs, activated] = await Promise.all([
      ctx.db.query("intelligencePacks").collect(),
      ctx.db
        .query("tenantPacks")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .collect(),
    ]);
    const activatedKeys = new Set(
      activated.filter((a) => a.status === "active").map((a) => a.packKey),
    );
    return packs.map((p) => ({
      ...p,
      activated: activatedKeys.has(p.key),
      activatedAt: activated.find((a) => a.packKey === p.key)?.activatedAt ?? null,
    }));
  },
});

/** Items of a pack (terminology, workflows, entity types...). */
export const listPackItems = query({
  args: { packKey: v.string() },
  handler: async (ctx, { packKey }) => {
    return await ctx.db
      .query("intelligenceItems")
      .withIndex("by_pack", (q) => q.eq("packKey", packKey))
      .collect();
  },
});

/** Activate (or dismiss) a pack for the current workspace. */
export const setPackActivation = mutation({
  args: { packKey: v.string(), active: v.boolean() },
  handler: async (ctx, { packKey, active }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    if (active) {
      await ctx.runMutation(internal.internal.activateTenantPack, {
        tenantId,
        packKey,
        userId,
      });
    } else {
      await ctx.runMutation(internal.internal.dismissTenantPack, {
        tenantId,
        packKey,
      });
    }
    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: active ? "pack_activated" : "pack_dismissed",
      targetType: "intelligence_pack",
      metadata: { packKey },
    });
  },
});
