// ---------------------------------------------------------------------------
// Tool catalog + action history queries (V8 runtime — UI discovery).
// The UI is generated from these — tool availability is never hardcoded.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { query } from "../_generated/server";
import { requireTenant, requireUser } from "../helpers";
import { RISK_LABELS, TOOL_REGISTRY } from "./registry";
import { evaluateRisk } from "./policy";

const MANAGER_ROLES = ["owner", "admin", "manager"] as const;

export const listTools = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const member = await ctx.db
      .query("memberships")
      .withIndex("by_tenant_user", (q) =>
        q.eq("tenantId", tenantId).eq("userId", userId),
      )
      .first();
    const conns = await ctx.db
      .query("connections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const byProvider = new Map(conns.map((c) => [c.provider, c]));

    return TOOL_REGISTRY.map((tool) => {
      const conn = tool.authRequirements.provider
        ? (byProvider.get(tool.authRequirements.provider) ?? null)
        : null;
      const connected = tool.authRequirements.provider
        ? conn?.status === "connected"
        : true;
      const scopesOk = tool.authRequirements.provider
        ? (conn?.scopes ?? []).length > 0
        : true;
      const { riskLevel, confirmationRequired, policyReason } = evaluateRisk(tool, {});
      const minRoleOk =
        tool.authRequirements.minRole === "manager"
          ? member
            ? (MANAGER_ROLES as readonly string[]).includes(member.role)
            : false
          : true;

      return {
        id: tool.id,
        name: tool.name,
        description: tool.description,
        category: tool.category,
        provider: tool.provider,
        version: tool.version,
        capabilities: tool.capabilities,
        riskLevel,
        riskLabel: RISK_LABELS[riskLevel],
        confirmationRequired,
        policyReason,
        implementationStatus: tool.implementationStatus,
        minRole: tool.authRequirements.minRole,
        inputFields: tool.inputSchema.fields,
        requiredScopes: tool.requiredScopes,
        documentationUrl: tool.documentationUrl ?? null,
        enabled:
          tool.implementationStatus === "implemented" && connected && scopesOk && minRoleOk,
        connected,
        scopesOk,
        canRun: minRoleOk,
      };
    });
  },
});

export const listToolActions = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const records = await ctx.db
      .query("toolActions")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(limit ?? 60);
    const enriched = await Promise.all(
      records.map(async (r) => {
        const actor = await ctx.db.get(r.actorId);
        const confirmedBy = r.confirmedBy ? await ctx.db.get(r.confirmedBy) : null;
        const tool = TOOL_REGISTRY.find((t) => t.id === r.toolId);
        return {
          ...r,
          toolName: tool?.name ?? r.toolId,
          actorName: actor?.name ?? actor?.email ?? "Unknown",
          confirmedByName: confirmedBy
            ? (confirmedBy.name ?? confirmedBy.email ?? "Unknown")
            : null,
        };
      }),
    );
    return enriched;
  },
});
