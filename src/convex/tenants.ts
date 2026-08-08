import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import {
  getUserTenantId,
  isManager,
  requireTenant,
  requireUser,
  slugify,
} from "./helpers";
import { getCurrentUser } from "./users";

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

/** Create a company workspace. The creator becomes its owner. */
export const createTenant = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in.");

    const existing = await getUserTenantId(ctx, user._id);
    if (existing) {
      throw new Error("You already belong to a workspace.");
    }

    const slug = `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`;
    const tenantId = await ctx.db.insert("tenants", {
      name,
      slug,
      status: "active",
    });
    await ctx.db.insert("memberships", {
      tenantId,
      userId: user._id,
      role: "owner",
      status: "active",
      invitedBy: undefined,
      joinedAt: Date.now(),
    });
    await ctx.db.insert("companyProfiles", {
      tenantId,
      companyName: name,
      onboardingStep: 0,
      onboardingComplete: false,
    });
    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId: user._id,
      actionType: "tenant_created",
      targetType: "tenant",
      targetId: tenantId,
      metadata: { name },
    });
    return tenantId;
  },
});

/** Current user's workspace: tenant + profile + membership + systems + packs. */
export const getMyWorkspace = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const tenantId = await getUserTenantId(ctx, user._id);
    if (!tenantId) return null;

    const [tenant, profile, membership, systems, packs, members, invites] =
      await Promise.all([
        ctx.db.get(tenantId),
        ctx.db
          .query("companyProfiles")
          .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
          .first(),
        ctx.db
          .query("memberships")
          .withIndex("by_tenant_user", (q) =>
            q.eq("tenantId", tenantId).eq("userId", user._id),
          )
          .first(),
        ctx.db
          .query("companySystems")
          .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
          .collect(),
        ctx.db
          .query("tenantPacks")
          .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
          .collect(),
        ctx.db
          .query("memberships")
          .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
          .collect(),
        ctx.db
          .query("invites")
          .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
          .collect(),
      ]);

    const memberUsers = await Promise.all(
      members.map(async (m) => {
        const u = await ctx.db.get(m.userId);
        return {
          ...m,
          user: u
            ? { name: u.name, email: u.email, image: u.image, _id: u._id }
            : null,
        };
      }),
    );

    return {
      tenant,
      profile,
      membership,
      systems,
      packs,
      members: memberUsers,
      invites,
    };
  },
});

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

export const inviteMember = mutation({
  args: { email: v.string(), role: v.union(v.literal("owner"), v.literal("admin"), v.literal("manager"), v.literal("analyst"), v.literal("viewer")) },
  handler: async (ctx, { email, role }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    if (!(await isManager(ctx, userId, tenantId))) {
      throw new Error("Only managers and above can invite members.");
    }
    const normalized = email.trim().toLowerCase();
    const existing = await ctx.db
      .query("invites")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .filter((q) => q.eq(q.field("email"), normalized))
      .first();
    if (existing) throw new Error("That person was already invited.");

    // If the user already exists with this email, add them directly.
    const existingUser = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", normalized))
      .first();
    let membershipCreated = false;
    if (existingUser) {
      const dup = await ctx.db
        .query("memberships")
        .withIndex("by_tenant_user", (q) =>
          q.eq("tenantId", tenantId).eq("userId", existingUser._id),
        )
        .first();
      if (!dup) {
        await ctx.db.insert("memberships", {
          tenantId,
          userId: existingUser._id,
          role,
          status: "active",
          invitedBy: userId,
          joinedAt: Date.now(),
        });
        membershipCreated = true;
      }
    }
    if (!membershipCreated) {
      await ctx.db.insert("invites", {
        tenantId,
        email: normalized,
        role,
        invitedBy: userId,
        status: "pending",
      });
    }
    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: membershipCreated ? "member_added" : "member_invited",
      targetType: "user",
      metadata: { email: normalized, role },
    });
    return { membershipCreated };
  },
});

/** When a signed-in user's email matches a pending invite, join that workspace. */
export const claimInvites = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { claimed: 0 };
    const email = (user.email ?? "").trim().toLowerCase();
    if (!email) return { claimed: 0 };

    const pending = await ctx.db
      .query("invites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();

    let claimed = 0;
    for (const invite of pending) {
      const dup = await ctx.db
        .query("memberships")
        .withIndex("by_tenant_user", (q) =>
          q.eq("tenantId", invite.tenantId).eq("userId", user._id),
        )
        .first();
      if (dup) continue;
      await ctx.db.insert("memberships", {
        tenantId: invite.tenantId,
        userId: user._id,
        role: invite.role,
        status: "active",
        invitedBy: invite.invitedBy,
        joinedAt: Date.now(),
      });
      await ctx.db.patch(invite._id, { status: "accepted" });
      await ctx.runMutation(internal.internal.logAudit, {
        tenantId: invite.tenantId,
        actorType: "user",
        actorId: user._id,
        actionType: "member_joined",
        targetType: "membership",
        metadata: { email },
      });
      claimed++;
    }
    return { claimed };
  },
});

export const updateMemberRole = mutation({
  args: {
    userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("admin"), v.literal("manager"), v.literal("analyst"), v.literal("viewer")),
  },
  handler: async (ctx, { userId, role }) => {
    const actorId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, actorId);
    if (!(await isManager(ctx, actorId, tenantId))) {
      throw new Error("Only managers and above can change roles.");
    }
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_tenant_user", (q) =>
        q.eq("tenantId", tenantId).eq("userId", userId),
      )
      .first();
    if (!membership) throw new Error("Member not found.");
    if (membership.role === "owner" && role !== "owner") {
      const owners = await ctx.db
        .query("memberships")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .filter((q) => q.eq(q.field("role"), "owner"))
        .collect();
      if (owners.length <= 1) {
        throw new Error("A workspace must keep at least one owner.");
      }
    }
    await ctx.db.patch(membership._id, { role });
    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId,
      actionType: "member_role_changed",
      targetType: "user",
      targetId: userId,
      metadata: { from: membership.role, to: role },
    });
  },
});

export const removeMember = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const actorId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, actorId);
    if (!(await isManager(ctx, actorId, tenantId))) {
      throw new Error("Only managers and above can remove members.");
    }
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_tenant_user", (q) =>
        q.eq("tenantId", tenantId).eq("userId", userId),
      )
      .first();
    if (!membership) throw new Error("Member not found.");
    if (membership.role === "owner") {
      throw new Error("Owners cannot be removed.");
    }
    await ctx.db.delete(membership._id);
    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId,
      actionType: "member_removed",
      targetType: "user",
      targetId: userId,
    });
  },
});
