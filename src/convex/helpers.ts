import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getCurrentUser } from "./users";

/** Resolve the active tenant for a user directly from the DB (mutations/queries). */
export const getUserTenantId = async (
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Id<"tenants"> | null> => {
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .filter((q) => q.eq(q.field("status"), "active"))
    .first();
  return membership?.tenantId ?? null;
};

/** Require a signed-in user; throws otherwise. */
export const requireUser = async (
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"users">> => {
  const user = await getCurrentUser(ctx);
  if (!user) {
    throw new Error("You must be signed in.");
  }
  return user._id;
};

/** Require an active membership; throws otherwise. */
export const requireTenant = async (
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Id<"tenants">> => {
  const tenantId = await getUserTenantId(ctx, userId);
  if (!tenantId) {
    throw new Error("You don't belong to a workspace yet.");
  }
  return tenantId;
};

export const MANAGER_ROLES = ["owner", "admin", "manager"] as const;

/** Operations managers & above can act on recommendations/members. */
export const isManager = async (
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  tenantId: Id<"tenants">,
): Promise<boolean> => {
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_tenant_user", (q) =>
      q.eq("tenantId", tenantId).eq("userId", userId),
    )
    .first();
  return membership
    ? (MANAGER_ROLES as readonly string[]).includes(membership.role)
    : false;
};

export const EDITOR_ROLES = ["owner", "admin", "manager", "analyst"] as const;

/** Analysts and above can upload documents and run syncs; viewers are read-only. */
export const isEditor = async (
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  tenantId: Id<"tenants">,
): Promise<boolean> => {
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_tenant_user", (q) =>
      q.eq("tenantId", tenantId).eq("userId", userId),
    )
    .first();
  return membership
    ? (EDITOR_ROLES as readonly string[]).includes(membership.role)
    : false;
};

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "workspace";
