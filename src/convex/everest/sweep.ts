"use node";

// ---------------------------------------------------------------------------
// Everest — Authority Sweep (node action)
//
// Separate module so it can call the check engine without the generated
// namespace forming a self-referential type cycle. Runs on a schedule:
// check every enabled source, then honestly mark knowledge stale outside the
// freshness window. Health is derived from real check records — a source is
// never reported healthy merely because it exists in the registry.
// ---------------------------------------------------------------------------

import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { freshnessState, isCheckable, sourceHealth } from "./ingest";

/** Sweep: check all enabled, implemented sources; mark stale knowledge
 *  honestly. Runs on a schedule. */
type SweepResult = {
  results: Array<{ sourceId: string; status: string }>;
  health: Array<{ sourceId: string; health: string }>;
};

export const runAuthoritySweep = internalAction({
  args: {},
  handler: async (ctx): Promise<SweepResult> => {
    const sources = await ctx.runQuery(internal.everest.syncDb.listSources);
    const now = Date.now();
    const results: Array<{ sourceId: string; status: string }> = [];
    for (const s of sources) {
      if (!s.enabled) {
        results.push({ sourceId: s.sourceId, status: "disabled" });
        continue;
      }
      if (isCheckable(s)) {
        const res = await ctx.runAction(internal.everest.sync.runAuthorityCheck, {
          sourceId: s.sourceId,
        });
        results.push({ sourceId: s.sourceId, status: res.status });
      } else {
        results.push({ sourceId: s.sourceId, status: "not_checkable" });
      }
      // Mark stale knowledge for sources that fall outside the freshness window.
      const knowledge = await ctx.runQuery(internal.everest.syncDb.listKnowledgeBySource, {
        sourceId: s.sourceId,
      });
      for (const k of knowledge) {
        const fresh = freshnessState(k.lastCheckedAt, s.updateFrequency, now, k.status);
        if (fresh !== k.freshness) {
          await ctx.runMutation(internal.everest.syncDb.patchKnowledgeFreshness, {
            knowledgeId: k.knowledgeId,
            freshness: fresh,
          });
        }
      }
    }
    return {
      results,
      health: sources.map((s) => ({
        sourceId: s.sourceId,
        health: sourceHealth(s, now),
      })),
    };
  },
});
