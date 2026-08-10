"use node";

import { internal } from "./_generated/api";
import { action } from "./_generated/server";

export const probe = action({
  args: {},
  handler: async (ctx) => {
    // Reveal the resolved type of the reference itself.
    const srcRef = internal.internal.listAuthoritativeSources;
    const revealRef: string = srcRef;
    // Reveal the resolved type of the runQuery result.
    const r = await ctx.runQuery(internal.internal.listAuthoritativeSources, {});
    const revealResult: string = r;
    void revealRef;
    void revealResult;
    return { ok: true };
  },
});
