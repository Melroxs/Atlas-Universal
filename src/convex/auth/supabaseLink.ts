/**
 * Supabase → Convex account linking (V8, typed database access).
 *
 * The ConvexCredentials authorize callback runs inside an action, and actions
 * in this Convex version have NO direct database access (ctx.db is not
 * available). All account lookups/creates therefore happen here, in an
 * internal mutation, invoked via ctx.runMutation from supabaseProvider.ts.
 *
 * Internal (not public): only the auth sign-in flow may call this. Public
 * clients can never fabricate accounts — the Supabase identity passed in is
 * always verified by the service-role action before this mutation runs.
 */

import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { createAccount } from "@convex-dev/auth/server";

export const supabaseEnsureUser = internalMutation({
  args: {
    uid: v.string(),
    email: v.optional(v.string()),
    emailVerified: v.boolean(),
    name: v.optional(v.string()),
    picture: v.optional(v.string()),
  },
  handler: async (ctx, { uid, email, emailVerified, name, picture }) => {
    if (!uid) {
      throw new Error("Invalid Supabase session.");
    }

    // Existing Supabase account -> sign the matching Convex user in,
    // refreshing profile fields when Supabase reports newer values.
    const existing = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "supabase").eq("providerAccountId", uid),
      )
      .first();

    if (existing) {
      const user = await ctx.db.get(existing.userId);
      if (!user) {
        throw new Error("Supabase account is not linked to a valid user.");
      }
      const patch: Record<string, unknown> = {};
      if (email && user.email !== email) patch.email = email;
      if (name && user.name !== name) patch.name = name;
      if (picture && user.image !== picture) patch.image = picture;
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(user._id, patch);
      }
      return user._id;
    }

    // First time this Supabase identity is seen -> create the Convex user.
    // Email linking is only allowed when Supabase has actually confirmed the
    // address, so an unconfirmed account can never claim an existing user's
    // email. createAccount is typed for an action ctx but only uses ctx.db,
    // which a mutation provides in full — the library's own Password provider
    // takes the same liberties with `as any` casts.
    const { user } = await createAccount(ctx as any, {
      provider: "supabase",
      account: { id: uid },
      profile: {
        email: email ?? undefined,
        name: name ?? undefined,
        image: picture ?? undefined,
        emailVerificationTime: emailVerified ? Date.now() : undefined,
        isAnonymous: false,
      } as any,
      shouldLinkViaEmail: emailVerified === true && Boolean(email),
      shouldLinkViaPhone: false,
    });
    return user._id;
  },
});
