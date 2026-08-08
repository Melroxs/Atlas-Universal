import { query } from "./_generated/server";
import { requireTenant, requireUser } from "./helpers";

/** Recent Ask Atlas sessions with their evidence. */
export const listAskSessions = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const sessions = await ctx.db
      .query("askSessions")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(30);
    const withEvidence = await Promise.all(
      sessions.map(async (s) => {
        const evidence = await ctx.db
          .query("askEvidence")
          .withIndex("by_session", (q) => q.eq("sessionId", s._id))
          .collect();
        return { ...s, evidence };
      }),
    );
    return withEvidence;
  },
});

/** Consolidated "recent activity" feed for Atlas Home. */
export const recentActivity = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const logs = await ctx.db
      .query("auditLogs")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(30);
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
