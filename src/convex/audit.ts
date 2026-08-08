import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireTenant, requireUser } from "./helpers";

export const listAuditLogs = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const logs = await ctx.db
      .query("auditLogs")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(limit ?? 60);
    const enriched = await Promise.all(
      logs.map(async (log) => {
        let actorName: string | null = null;
        if (log.actorId) {
          const actor = await ctx.db.get(log.actorId);
          actorName = actor?.name ?? actor?.email ?? null;
        }
        return { ...log, actorName };
      }),
    );
    return enriched;
  },
});
