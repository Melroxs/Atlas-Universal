"use node";

// Google Drive sync engine — node runtime (external API calls + ingestion).
// Mutations/queries live in connections.ts (V8 runtime).

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { parseFile } from "./lib/parsers";
import { ingestText } from "./ingestion";

const GOOGLE_OAUTH_TOKEN = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DUE_SYNC_MS = 15 * 60 * 1000;

const MANAGER_ROLES = ["owner", "admin", "manager"] as const;
const EDITOR_ROLES = ["owner", "admin", "manager", "analyst"] as const;

/** Files we can actually parse today (via lib/parsers). */
const SUPPORTED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "text/plain",
  "text/markdown",
  "text/html",
]);

/** Google-native formats exported to a parseable format. */
const GOOGLE_EXPORT: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
};

interface DriveTokens {
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
}

function envCreds(): { clientId?: string; clientSecret?: string } {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  };
}

async function fetchDrive(path: string, token: string): Promise<Response> {
  return await fetch(`${DRIVE_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
}

async function fetchFileBytes(
  path: string,
  token: string,
): Promise<Response> {
  return await fetch(`${DRIVE_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/**
 * Sync a Google Drive connection: refresh the token, list supported files,
 * skip unchanged ones (dedupe by sourceId + modifiedTime), download/export the
 * rest and push them through the same ingestion pipeline as manual uploads.
 */
async function syncDrive(
  ctx: ActionCtx,
  tenantId: Id<"tenants">,
  connId: Id<"connections">,
  actorUserId: Id<"users">,
): Promise<{
  ingested: number;
  unchanged: number;
  skipped: number;
  failed: number;
  errors: string[];
}> {
  const conn = await ctx.runQuery(internal.internal.getConnectionById, {
    connectionId: connId,
  });
  if (!conn || conn.tenantId !== tenantId) {
    throw new Error("Connection not found.");
  }
  if (conn.provider !== "google_drive") {
    throw new Error("This connector doesn't support sync yet.");
  }
  const tokens = (conn.settings?.tokens ?? {}) as DriveTokens;
  if (!tokens.refreshToken) {
    throw new Error("Google Drive isn't connected — connect it first.");
  }
  const { clientId, clientSecret } = envCreds();
  if (!clientId || !clientSecret) {
    throw new Error(
      "Google OAuth keys are missing (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).",
    );
  }

  // 1. Ensure a valid access token (refresh when expired or missing).
  let accessToken = tokens.accessToken;
  if (
    !accessToken ||
    !tokens.tokenExpiresAt ||
    tokens.tokenExpiresAt < Date.now() + 60_000
  ) {
    const res = await fetch(GOOGLE_OAUTH_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokens.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!res.ok || !data.access_token) {
      await ctx.runMutation(internal.internal.patchConnection, {
        id: connId,
        patch: {
          status: "disconnected",
          lastError: "Google rejected the saved connection — reconnect it.",
        },
      });
      throw new Error("Google Drive connection expired — reconnect it.");
    }
    accessToken = data.access_token;
    const nextTokens: DriveTokens = {
      accessToken,
      refreshToken: data.refresh_token ?? tokens.refreshToken,
      tokenExpiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    };
    await ctx.runMutation(internal.internal.patchConnection, {
      id: connId,
      patch: { settings: { ...conn.settings, tokens: nextTokens } },
    });
  }

  // 2. List files (trashed excluded, most recently modified first).
  const q = "trashed = false";
  const listUrl =
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}` +
    `&pageSize=50&orderBy=${encodeURIComponent("modifiedTime desc")}` +
    `&supportsAllDrives=true` +
    `&fields=${encodeURIComponent("nextPageToken,files(id,name,mimeType,modifiedTime,size)")}`;
  const listRes = await fetchDrive(listUrl, accessToken);
  if (!listRes.ok) {
    const msg = `Google Drive API error ${listRes.status}`;
    await ctx.runMutation(internal.internal.patchConnection, {
      id: connId,
      patch: { status: "error", lastError: msg },
    });
    throw new Error(msg);
  }
  const listData = (await listRes.json()) as {
    files?: Array<{
      id: string;
      name: string;
      mimeType: string;
      modifiedTime?: string;
      size?: number;
    }>;
  };
  const files = listData.files ?? [];

  // 3. Per-file: dedupe + change detection + ingest.
  let ingested = 0;
  let unchanged = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const file of files) {
    try {
      const exportMime = GOOGLE_EXPORT[file.mimeType];
      if (!exportMime && !SUPPORTED_MIME.has(file.mimeType)) {
        skipped++;
        continue;
      }
      const existing = await ctx.runQuery(internal.internal.getDocBySource, {
        tenantId,
        sourceId: file.id,
      });
      const modifiedMs = file.modifiedTime ? Date.parse(file.modifiedTime) : NaN;
      if (
        existing &&
        !Number.isNaN(modifiedMs) &&
        (existing.sourceModifiedAt ?? 0) >= modifiedMs
      ) {
        unchanged++;
        continue;
      }

      // Fetch content: export for Google-native formats, else download.
      let bytes: ArrayBuffer;
      let effectiveMime: string;
      if (exportMime) {
        const res = await fetchFileBytes(
          `/files/${encodeURIComponent(file.id)}/export?mimeType=${encodeURIComponent(exportMime)}`,
          accessToken,
        );
        if (!res.ok) throw new Error(`export failed (${res.status})`);
        bytes = await res.arrayBuffer();
        effectiveMime = exportMime;
      } else {
        const res = await fetchFileBytes(
          `/files/${encodeURIComponent(file.id)}?alt=media`,
          accessToken,
        );
        if (!res.ok) throw new Error(`download failed (${res.status})`);
        bytes = await res.arrayBuffer();
        effectiveMime = file.mimeType;
      }

      const { text } = await parseFile(effectiveMime, file.name, bytes);
      if (!text.trim()) {
        skipped++;
        continue;
      }

      const title = file.name;
      if (existing) {
        await ctx.runMutation(internal.internal.deleteChunksByDoc, {
          documentId: existing._id,
        });
        await ctx.runMutation(internal.internal.patchDoc, {
          id: existing._id,
          patch: { status: "processing", error: undefined },
        });
        await ingestText(ctx, tenantId, {
          title,
          mimeType: effectiveMime,
          size: file.size,
          sourceType: "drive",
          sourceId: file.id,
          sourceModifiedAt: modifiedMs,
          text,
          existingDocId: existing._id,
        });
      } else {
        const docId = await ctx.runMutation(internal.internal.createDoc, {
          tenantId,
          userId: actorUserId,
          title,
          mimeType: effectiveMime,
          size: file.size ?? bytes.byteLength,
          sourceType: "drive",
          sourceId: file.id,
          sourceModifiedAt: modifiedMs,
          storageId: undefined,
        });
        await ingestText(ctx, tenantId, {
          title,
          mimeType: effectiveMime,
          size: file.size,
          sourceType: "drive",
          sourceId: file.id,
          sourceModifiedAt: modifiedMs,
          text,
          existingDocId: docId,
        });
      }
      ingested++;
    } catch (e) {
      failed++;
      errors.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 4. Record outcome honestly.
  await ctx.runMutation(internal.internal.patchConnection, {
    id: connId,
    patch: {
      status: failed > 0 && ingested === 0 ? "error" : "connected",
      lastSyncAt: Date.now(),
      lastError: errors.length > 0 ? errors.slice(0, 3).join(" · ") : undefined,
    },
  });
  await ctx.runMutation(internal.internal.createJob, {
    tenantId,
    jobType: "connector_sync",
  });
  await ctx.runMutation(internal.internal.logAudit, {
    tenantId,
    actorType: "user",
    actorId: actorUserId,
    actionType: "connection_synced",
    targetType: "connection",
    targetId: String(connId),
    metadata: { provider: conn.provider, ingested, unchanged, skipped, failed },
  });

  return { ingested, unchanged, skipped, failed, errors };
}

export const syncGoogleDrive = action({
  args: { connectionId: v.id("connections") },
  handler: async (
    ctx,
    { connectionId },
  ): Promise<{
    ingested: number;
    unchanged: number;
    skipped: number;
    failed: number;
    errors: string[];
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("You must be signed in.");
    const membership = await ctx.runQuery(internal.internal.getMembershipByUser, {
      userId,
    });
    if (!membership) throw new Error("You don't belong to a workspace yet.");
    const member = await ctx.runQuery(
      internal.internal.getMembershipByUserTenant,
      { userId, tenantId: membership.tenantId },
    );
    if (!member || !(MANAGER_ROLES as readonly string[]).includes(member.role)) {
      throw new Error("Only managers and above can sync connections.");
    }
    return await syncDrive(ctx, membership.tenantId, connectionId, userId);
  },
});

/**
 * Lightweight background sync: any connected Google Drive source whose last
 * sync is older than the due interval is refreshed. Triggered on app load and
 * after a successful OAuth connect — no manual action required per sync.
 * (A Convex cron can replace this trigger when the deployment enables crons.)
 */
export const runDueSyncs = action({
  args: {},
  handler: async (ctx): Promise<{ ran: number }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("You must be signed in.");
    const membership = await ctx.runQuery(internal.internal.getMembershipByUser, {
      userId,
    });
    if (!membership) return { ran: 0 };
    const tenantId = membership.tenantId;
    const member = await ctx.runQuery(
      internal.internal.getMembershipByUserTenant,
      { userId, tenantId },
    );
    if (!member || !(EDITOR_ROLES as readonly string[]).includes(member.role)) {
      return { ran: 0 };
    }
    const conns = await ctx.runQuery(internal.internal.listConnectionsByTenant, {
      tenantId,
    });
    const due = conns.filter(
      (c) =>
        c.provider === "google_drive" &&
        c.status === "connected" &&
        (c.lastSyncAt ?? 0) < Date.now() - DUE_SYNC_MS,
    );
    let ran = 0;
    for (const conn of due) {
      try {
        await syncDrive(ctx, tenantId, conn._id, userId);
        ran++;
      } catch {
        // individual connection failures don't block the sweep
      }
    }
    return { ran };
  },
});

/**
 * Verify a connection against the provider's REAL API. Stored state is never
 * trusted on its own: the connection is only marked healthy when the live
 * call succeeds. Secrets never leave the backend; errors are sanitized.
 */
export const testConnection = action({
  args: { connectionId: v.id("connections") },
  handler: async (
    ctx,
    { connectionId },
  ): Promise<
    | { ok: true; provider: string; accountName?: string; accountEmail?: string }
    | { ok: false; provider: string; reason: string }
  > => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { ok: false, provider: "unknown", reason: "You must be signed in." };
    }
    const membership = await ctx.runQuery(internal.internal.getMembershipByUser, {
      userId,
    });
    if (!membership) {
      return {
        ok: false,
        provider: "unknown",
        reason: "You don't belong to a workspace yet.",
      };
    }
    const member = await ctx.runQuery(internal.internal.getMembershipByUserTenant, {
      userId,
      tenantId: membership.tenantId,
    });
    if (!member || !(MANAGER_ROLES as readonly string[]).includes(member.role)) {
      return {
        ok: false,
        provider: "unknown",
        reason: "Only managers and above can test connections.",
      };
    }
    const conn = await ctx.runQuery(internal.internal.getConnectionById, {
      connectionId,
    });
    if (!conn || conn.tenantId !== membership.tenantId) {
      return { ok: false, provider: "unknown", reason: "Connection not found." };
    }
    const provider = conn.provider;

    if (provider === "google_drive") {
      const testStartedAt = Date.now();
      const tokens = (conn.settings?.tokens ?? {}) as DriveTokens;
      if (!tokens.refreshToken) {
        await ctx.runMutation(internal.internal.patchConnection, {
          id: conn._id,
          patch: {
            status: "disconnected",
            healthStatus: "error",
            lastTestedAt: Date.now(),
            lastTestFailureAt: Date.now(),
          },
        });
        return {
          ok: false,
          provider,
          reason: "No stored credentials — reconnect Google Drive.",
        };
      }
      const { clientId, clientSecret } = envCreds();
      if (!clientId || !clientSecret) {
        return {
          ok: false,
          provider,
          reason: "Google OAuth keys are missing (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).",
        };
      }

      // Refresh the access token when missing/expired (same flow as syncDrive).
      let accessToken = tokens.accessToken;
      if (
        !accessToken ||
        !tokens.tokenExpiresAt ||
        tokens.tokenExpiresAt < Date.now() + 60_000
      ) {
        const res = await fetch(GOOGLE_OAUTH_TOKEN, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: tokens.refreshToken,
            grant_type: "refresh_token",
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          access_token?: string;
          expires_in?: number;
        };
        if (!res.ok || !data.access_token) {
          await ctx.runMutation(internal.internal.patchConnection, {
            id: conn._id,
            patch: {
              status: "disconnected",
              healthStatus: "error",
              lastTestedAt: Date.now(),
              lastTestFailureAt: Date.now(),
              lastTestLatencyMs: Date.now() - testStartedAt,
              lastError: "Google rejected the saved connection — reconnect it.",
            },
          });
          return {
            ok: false,
            provider,
            reason: "Google rejected the saved connection — reconnect it.",
          };
        }
        accessToken = data.access_token;
        await ctx.runMutation(internal.internal.patchConnection, {
          id: conn._id,
          patch: {
            settings: {
              ...conn.settings,
              tokens: {
                accessToken,
                refreshToken: tokens.refreshToken,
                tokenExpiresAt:
                  Date.now() + (Number(data.expires_in) || 3600) * 1000,
              },
            },
          },
        });
      }

      // The live API call — the only thing that can mark a connection healthy.
      const res = await fetch(
        `${DRIVE_API}/about?fields=${encodeURIComponent("user(displayName,emailAddress)")}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const data = (await res.json().catch(() => ({}))) as {
        user?: { displayName?: string; emailAddress?: string };
      };
      if (!res.ok) {
        await ctx.runMutation(internal.internal.patchConnection, {
          id: conn._id,
          patch: {
            healthStatus: "error",
            lastTestedAt: Date.now(),
            lastTestFailureAt: Date.now(),
            lastTestLatencyMs: Date.now() - testStartedAt,
            lastError: `Google Drive API error ${res.status}`,
          },
        });
        return { ok: false, provider, reason: `Google Drive API error ${res.status}` };
      }

      await ctx.runMutation(internal.internal.patchConnection, {
        id: conn._id,
        patch: {
          status: "connected",
          healthStatus: "healthy",
          lastTestedAt: Date.now(),
          lastTestSuccessAt: Date.now(),
          lastTestLatencyMs: Date.now() - testStartedAt,
          lastError: undefined,
          accountName: data.user?.displayName,
          accountEmail: data.user?.emailAddress,
        },
      });
      await ctx.runMutation(internal.internal.logAudit, {
        tenantId: membership.tenantId,
        actorType: "user",
        actorId: userId,
        actionType: "connection_tested",
        targetType: "connection",
        targetId: String(conn._id),
        metadata: { provider, result: "healthy" },
      });
      return {
        ok: true,
        provider,
        accountName: data.user?.displayName,
        accountEmail: data.user?.emailAddress,
      };
    }

    return {
      ok: false,
      provider,
      reason: "Connection testing isn't implemented for this provider yet.",
    };
  },
});

/**
 * System health sweep (internal — cron-driven). Tests every connected Drive
 * source across all tenants with a live API call and records latency + last
 * test outcome. Never marks a connection healthy without a real check.
 */
export const runHealthSweep = internalAction({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.runQuery(internal.internal.listAllConnections, {});
    const drive = all.filter(
      (c) => c.provider === "google_drive" && c.status === "connected",
    );
    const results: Array<{
      connectionId: string;
      ok: boolean;
      latencyMs?: number;
      reason?: string;
    }> = [];
    for (const conn of drive) {
      const t0 = Date.now();
      try {
        const tokens = (conn.settings?.tokens ?? {}) as DriveTokens;
        if (!tokens.refreshToken) throw new Error("no tokens");
        const { clientId, clientSecret } = envCreds();
        if (!clientId || !clientSecret) throw new Error("not configured");
        let accessToken = tokens.accessToken;
        if (
          !accessToken ||
          !tokens.tokenExpiresAt ||
          tokens.tokenExpiresAt < Date.now() + 60_000
        ) {
          const res = await fetch(GOOGLE_OAUTH_TOKEN, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: clientId,
              client_secret: clientSecret,
              refresh_token: tokens.refreshToken,
              grant_type: "refresh_token",
            }),
          });
          const data = (await res.json().catch(() => ({}))) as {
            access_token?: string;
            expires_in?: number;
          };
          if (!res.ok || !data.access_token) throw new Error("reauth");
          accessToken = data.access_token;
          await ctx.runMutation(internal.internal.patchConnection, {
            id: conn._id,
            patch: {
              settings: {
                ...conn.settings,
                tokens: {
                  accessToken,
                  refreshToken: tokens.refreshToken,
                  tokenExpiresAt:
                    Date.now() + (Number(data.expires_in) || 3600) * 1000,
                },
              },
            },
          });
        }
        const res = await fetch(
          `${DRIVE_API}/about?fields=${encodeURIComponent("user(displayName,emailAddress)")}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (!res.ok) throw new Error(`api ${res.status}`);
        const latencyMs = Date.now() - t0;
        const data = (await res.json()) as {
          user?: { displayName?: string; emailAddress?: string };
        };
        await ctx.runMutation(internal.internal.patchConnection, {
          id: conn._id,
          patch: {
            healthStatus: "healthy",
            lastTestedAt: Date.now(),
            lastTestSuccessAt: Date.now(),
            lastTestLatencyMs: latencyMs,
            lastError: undefined,
            accountName: data.user?.displayName,
            accountEmail: data.user?.emailAddress,
          },
        });
        results.push({ connectionId: String(conn._id), ok: true, latencyMs });
      } catch (e) {
        const message =
          e instanceof Error && e.message.startsWith("api ")
            ? `Google Drive API error ${e.message.slice(4)}`
            : "Health check failed.";
        await ctx.runMutation(internal.internal.patchConnection, {
          id: conn._id,
          patch: {
            healthStatus: "error",
            lastTestedAt: Date.now(),
            lastTestFailureAt: Date.now(),
            lastError: message,
          },
        });
        results.push({ connectionId: String(conn._id), ok: false, reason: message });
      }
    }
    return { tested: results.length, results };
  },
});
