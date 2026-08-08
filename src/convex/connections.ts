import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { isManager, requireTenant, requireUser } from "./helpers";
import { CONNECTOR_REGISTRY } from "./connectors/registry";

// ---------------------------------------------------------------------------
// Connection Engine — V1
//
// Honest states only. A connector is never shown as "connected" unless a real
// OAuth connection exists with stored tokens. Google Drive is the first real
// connector: OAuth code flow, token refresh, file discovery with change
// detection + dedupe, feeding the same ingestion pipeline as manual uploads.
// The heavy lifting (token refresh, Drive API, ingestion) lives in
// connections-sync.ts (node runtime). Other providers are catalog entries
// ("coming soon") — there are no simulated syncs.
// ---------------------------------------------------------------------------

const GOOGLE_OAUTH_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_SCOPES = "https://www.googleapis.com/auth/drive.readonly";

function makeState(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    const uuid = c?.randomUUID?.();
    if (uuid) return uuid;
  } catch {
    // fall through
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}${Math.random()
    .toString(36)
    .slice(2)}`;
}

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

// ---------------------------------------------------------------------------
// Google Drive OAuth
// ---------------------------------------------------------------------------

export const beginGoogleDriveOAuth = mutation({
  args: {
    redirectBase: v.string(),
    returnTo: v.string(),
  },
  handler: async (
    ctx,
    { redirectBase, returnTo },
  ): Promise<
    | { ok: true; authUrl: string }
    | { ok: false; code: "not_configured"; reason: string }
  > => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    if (!(await isManager(ctx, userId, tenantId))) {
      throw new Error("Only managers and above can connect sources.");
    }
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return {
        ok: false,
        code: "not_configured",
        reason:
          "Google OAuth isn't configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your project's Keys, then reconnect.",
      };
    }

    const existing = await ctx.db
      .query("connections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .filter((q) => q.eq(q.field("provider"), "google_drive"))
      .first();
    const connId =
      existing?._id ??
      (await ctx.db.insert("connections", {
        tenantId,
        name: "Google Drive",
        provider: "google_drive",
        category: "document_storage",
        status: "disconnected",
        notes: "OAuth connector — syncs documents into the knowledge base.",
        settings: { kind: "oauth2" },
      }));

    const state = makeState();
    await ctx.db.patch(connId, {
      status: "disconnected",
      lastError: undefined,
      settings: {
        kind: "oauth2",
        pendingState: state,
        oauthReturnTo: returnTo,
        oauthStartedAt: Date.now(),
      },
    });

    const redirectUri = `${redirectBase.replace(/\/+$/, "")}/google/oauth/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GOOGLE_SCOPES,
      access_type: "offline",
      prompt: "consent",
      state,
    });

    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: "google_drive_oauth_started",
      targetType: "connection",
      targetId: String(connId),
      metadata: { redirectUri },
    });

    return { ok: true, authUrl: `${GOOGLE_OAUTH_AUTH}?${params.toString()}` };
  },
});

export const disconnectGoogleDrive = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    if (!(await isManager(ctx, userId, tenantId))) {
      throw new Error("Only managers and above can disconnect sources.");
    }
    const conn = await ctx.db
      .query("connections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .filter((q) => q.eq(q.field("provider"), "google_drive"))
      .first();
    if (!conn) return;
    await ctx.db.patch(conn._id, {
      status: "disconnected",
      lastError: undefined,
      settings: { kind: "oauth2" },
    });
    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: "google_drive_disconnected",
      targetType: "connection",
      targetId: String(conn._id),
    });
  },
});

export const deleteConnection = mutation({
  args: { connectionId: v.id("connections") },
  handler: async (ctx, { connectionId }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    if (!(await isManager(ctx, userId, tenantId))) {
      throw new Error("Only managers and above can remove connections.");
    }
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

// ---------------------------------------------------------------------------
// Universal catalog — honest status derivation
// ---------------------------------------------------------------------------

/**
 * Strip a connection row for the client. `settings` carries OAuth tokens and
 * pending state and must NEVER leave the backend.
 */
function sanitizeConnection(conn: {
  _id: Id<"connections">;
  name: string;
  provider: string;
  category: string;
  status: string;
  lastSyncAt?: number;
  lastError?: string;
  healthStatus?: string;
  lastTestedAt?: number;
  accountName?: string;
  accountEmail?: string;
}) {
  return {
    _id: conn._id,
    name: conn.name,
    provider: conn.provider,
    category: conn.category,
    status: conn.status,
    lastSyncAt: conn.lastSyncAt ?? undefined,
    lastError: conn.lastError ?? undefined,
    healthStatus: conn.healthStatus ?? undefined,
    lastTestedAt: conn.lastTestedAt ?? undefined,
    accountName: conn.accountName ?? undefined,
    accountEmail: conn.accountEmail ?? undefined,
  };
}

/**
 * The connector catalog: every registry entry enriched with the tenant's
 * actual state. Status is DERIVED — never stored or faked:
 *
 *  roadmap                — client not built yet (honest "coming soon")
 *  not_configured         — server env vars missing, cannot authorize
 *  authorization_required — env configured but no live connection
 *  connected / healthy    — only when a real OAuth connection exists
 *  syncing / error        — live connection state
 *  available              — no authorization needed (uploads)
 */
export const listConnectorCatalog = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const conns = await ctx.db
      .query("connections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const byProvider = new Map(conns.map((c) => [c.provider, c]));

    return CONNECTOR_REGISTRY.map((def) => {
      const conn = byProvider.get(def.id);
      const configured = def.requiredEnvVars.every((env) => !!process.env[env]);
      const missingEnvVars = def.requiredEnvVars.filter((env) => !process.env[env]);

      let displayStatus: string;
      if (def.implementationStatus === "planned") {
        displayStatus = "roadmap";
      } else if (def.authType !== "none" && !configured) {
        displayStatus = "not_configured";
      } else if (!conn) {
        displayStatus = def.authType === "none" ? "available" : "authorization_required";
      } else if (conn.status === "error") {
        displayStatus = "error";
      } else if (conn.status === "syncing") {
        displayStatus = "syncing";
      } else if (conn.status === "disconnected") {
        displayStatus = "authorization_required";
      } else if (conn.status === "connected") {
        displayStatus =
          conn.healthStatus && conn.healthStatus !== "untested"
            ? conn.healthStatus
            : "connected";
      } else {
        displayStatus = "authorization_required";
      }

      return {
        id: def.id,
        name: def.name,
        description: def.description,
        category: def.category,
        authType: def.authType,
        capabilities: def.capabilities,
        requiredEnvVars: def.requiredEnvVars,
        oauthScopes: def.oauthScopes ?? [],
        configured,
        missingEnvVars,
        displayStatus,
        setupInstructions: def.setupInstructions,
        docsUrl: def.docsUrl ?? null,
        connection: conn ? sanitizeConnection(conn) : null,
      };
    });
  },
});
