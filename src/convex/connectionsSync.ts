"use node";

// Google Drive sync engine — node runtime (external API calls + ingestion).
// Mutations/queries live in connections.ts (V8 runtime).

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, type ActionCtx } from "./_generated/server";
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
