// ---------------------------------------------------------------------------
// Event substrate — Convex surface.
//
//  ingestEvent        — internal-only ingestion: source validation → tenant
//                       resolution (from the connection, never the payload) →
//                       payload validation → dedupe → persist → enqueue
//  pollDriveEvents    — the first REAL event source: Google Drive change
//                       polling (honestly labeled polling, not webhooks)
//  listEvents / getEventDetail / eventStats — tenant-scoped activity surface
//  retryEvent / setEventPolicy / notifications — operations
//
// There is no public "ingest anything" endpoint. Events are accepted only
// from authenticated connections and internal callers.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  internalAction,
  internalMutation,
  mutation,
  query,
  type ActionCtx,
} from "../_generated/server";
import { isManager, requireTenant, requireUser } from "../helpers";
import { getEventDefinition, EVENT_REGISTRY } from "./registry";
import {
  deterministicEventId,
  DEFAULT_MAX_ATTEMPTS,
  sanitizeEventPayload,
  validateEnvelope,
  type EventEnvelope,
} from "./contract";
import { validateEventPayload } from "./schema";
import { validateSourceEvent } from "./ingest";
import {
  classifyDriveChange,
  driveChangeToEnvelope,
  driveKindToEventType,
  type DriveChange,
} from "./drive";
import { sanitizeDriveError } from "../tools/driveClient";
import { TOOL_REGISTRY } from "../tools/registry";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_CHANGE_FIELDS = encodeURIComponent(
  "nextPageToken,newStartPageToken,changes(changeId,type,fileId,time,removed,file(id,name,mimeType,modifiedTime,size,trashed,parents,permissionIds))",
);
const MAX_CHANGE_PAGES = 10;

type DriveTokens = {
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
};

// ---------------------------------------------------------------------------
// Ingestion (internal-only — no public ingress endpoint)
// ---------------------------------------------------------------------------

type IngestResult =
  | { status: "inserted"; eventId: Id<"events"> }
  | { status: "duplicate"; eventId: Id<"events"> }
  | { status: "ignored"; eventId: Id<"events"> };

export const ingestEvent = internalMutation({
  args: {
    envelope: v.any(),
    externalTenantId: v.optional(v.string()),
    createdBy: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { envelope, externalTenantId, createdBy },
  ): Promise<IngestResult> => {
    const validated = validateEnvelope(envelope);
    if (!validated.ok) {
      throw new Error(`Invalid event envelope: ${validated.errors.join("; ")}`);
    }
    const env = validated.envelope;

    // 1. Resolve + authenticate the source connection.
    let connection = null;
    if (env.connectionId) {
      connection = await ctx.db.get(env.connectionId as Id<"connections">);
    }
    const source = validateSourceEvent({
      envelope: env,
      connection,
      externalTenantId,
    });
    if (!source.ok) {
      throw new Error(source.reason);
    }
    const tenantId = source.tenantId as Id<"tenants">;

    // 2. Deterministic identity + dedupe (the same event can never double-apply).
    const idempotencyKey = env.idempotencyKey;
    const eventId = deterministicEventId(idempotencyKey);
    const existing = await ctx.db
      .query("events")
      .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", idempotencyKey))
      .first();
    if (existing) {
      return { status: "duplicate", eventId: existing._id };
    }

    // 3. Payload sanitization + schema validation.
    const def = getEventDefinition(env.eventType);
    const sanitizedPayload = sanitizeEventPayload(env.payload);
    const payloadValidation = validateEventPayload(
      def,
      sanitizedPayload as Record<string, unknown>,
    );
    const payload = payloadValidation.ok
      ? payloadValidation.value
      : { _rejected: payloadValidation.errors.join("; ") };

    // 4. Persist the processing record.
    const now = Date.now();
    const connId = env.connectionId ? (env.connectionId as Id<"connections">) : undefined;
    const docId = await ctx.db.insert("events", {
      tenantId,
      eventId,
      eventType: env.eventType,
      provider: env.provider,
      connectorId: connId,
      connectionId: connId,
      sourceResourceId: env.sourceResourceId,
      occurredAt: env.occurredAt,
      receivedAt: now,
      payload,
      payloadVersion: env.payloadVersion,
      correlationId: env.correlationId ?? undefined,
      idempotencyKey,
      dedupeKey: idempotencyKey,
      status: payloadValidation.ok ? "received" : "ignored",
      attempts: 0,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      sourceMechanism: env.sourceMechanism,
      providerEventId: env.providerEventId ?? undefined,
      createdBy: createdBy ?? undefined,
      createdAt: now,
    });

    if (!payloadValidation.ok) {
      await ctx.db.patch(docId, {
        lastError: `Invalid payload: ${payloadValidation.errors.join("; ")}`,
        processedAt: now,
      });
      return { status: "ignored", eventId: docId };
    }

    // 5. Enqueue processing.
    await ctx.scheduler.runAfter(0, internal.events.process.processEvent, { eventId: docId });
    return { status: "inserted", eventId: docId };
  },
});

// ---------------------------------------------------------------------------
// Google Drive event source — honest polling
// ---------------------------------------------------------------------------

type PollResult = {
  connections: number;
  events: number;
  duplicates: number;
  errors: string[];
};

export const pollDriveEvents = internalAction({
  args: {},
  handler: async (ctx): Promise<PollResult> => {
    const all = await ctx.runQuery(internal.internal.listAllConnections, {});
    const drive = all.filter(
      (c) =>
        c.provider === "google_drive" &&
        c.status === "connected" &&
        !!((c.settings?.tokens ?? {}) as DriveTokens).refreshToken,
    );

    let events = 0;
    let duplicates = 0;
    const errors: string[] = [];

    for (const conn of drive) {
      try {
        const tokens = (conn.settings?.tokens ?? {}) as DriveTokens;
        const { clientId, clientSecret } = {
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        };
        if (!clientId || !clientSecret) {
          errors.push(`Connection ${String(conn._id)}: Google OAuth not configured.`);
          continue;
        }
        const accessToken = await refreshAccessToken(ctx, conn._id, tokens, clientId, clientSecret);

        const pollState = (conn.settings?.eventPoll ?? {}) as {
          changesToken?: string;
          lastPolledAt?: number;
        };

        // First poll ever → establish the baseline cursor (no events claimed).
        if (!pollState.changesToken) {
          const token = await fetchStartPageToken(accessToken);
          if (!token) {
            errors.push(`Connection ${String(conn._id)}: no start page token.`);
            continue;
          }
          await ctx.runMutation(internal.internal.patchConnection, {
            id: conn._id,
            patch: {
              settings: {
                ...conn.settings,
                eventPoll: { changesToken: token, lastPolledAt: Date.now() },
              },
            },
          });
          continue;
        }

        let token = pollState.changesToken;
        let pages = 0;
        while (pages < MAX_CHANGE_PAGES) {
          const url =
            `${DRIVE_API}/changes?pageToken=${encodeURIComponent(token)}` +
            `&pageSize=100&includeRemoved=true&includeItemsFromAllDrives=true` +
            `&spaces=drive&fields=${DRIVE_CHANGE_FIELDS}`;
          let res: Response;
          try {
            res = await fetch(url, {
              headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
            });
          } catch {
            throw new Error("Drive changes fetch failed (network).");
          }
          if (res.status === 410) {
            // Cursor expired — reset honestly, never replay stale changes.
            const fresh = await fetchStartPageToken(accessToken);
            await ctx.runMutation(internal.internal.patchConnection, {
              id: conn._id,
              patch: {
                settings: {
                  ...conn.settings,
                  eventPoll: {
                    changesToken: fresh ?? token,
                    lastPolledAt: Date.now(),
                  },
                },
              },
            });
            break;
          }
          if (!res.ok) {
            throw sanitizeDriveError(res.status, await res.text().catch(() => ""));
          }
          const data = (await res.json()) as {
            changes?: Array<Record<string, unknown>>;
            nextPageToken?: string;
            newStartPageToken?: string;
          };
          for (const rawChange of data.changes ?? []) {
            const change = rawChange as DriveChange;
            const fileId =
              typeof change.fileId === "string"
                ? change.fileId
                : (change.file?.id as string | undefined);
            if (!fileId) continue;

            // Prior state for accurate classification (created vs moved vs updated).
            const doc = await ctx.runQuery(internal.internal.getDocBySource, {
              tenantId: conn.tenantId,
              sourceId: fileId,
            });
            const prior: {
              exists: boolean;
              parents?: string[];
              permissionIds?: string[];
            } = {
              exists: !!doc,
              parents: doc?.externalParents,
              permissionIds: doc?.externalPermissionIds,
            };
            const changeKind = classifyDriveChange(change, prior);
            const eventType = driveKindToEventType(changeKind);
            const def = eventType ? getEventDefinition(eventType) : undefined;
            if (!def) continue;
            const envelope = driveChangeToEnvelope({
              connectionId: String(conn._id),
              tenantId: conn.tenantId,
              change,
              kind: changeKind,
              prior,
              def,
            });
            if (!envelope) continue;

            const result = await ctx.runMutation(internal.events.api.ingestEvent, {
              envelope,
              createdBy: "drive-changes-poll",
            });
            if (result.status === "inserted") events++;
            else duplicates++;
          }

          const next = data.newStartPageToken ?? data.nextPageToken;
          if (!next) break;
          token = next;
          pages++;
        }

        await ctx.runMutation(internal.internal.patchConnection, {
          id: conn._id,
          patch: {
            settings: {
              ...conn.settings,
              eventPoll: { changesToken: token, lastPolledAt: Date.now() },
            },
          },
        });
      } catch (e) {
        errors.push(
          `Connection ${String(conn._id)}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    return { connections: drive.length, events, duplicates, errors };
  },
});

async function fetchStartPageToken(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${DRIVE_API}/changes/startPageToken`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { startPageToken?: string };
    return data.startPageToken ?? null;
  } catch {
    return null;
  }
}

async function refreshAccessToken(
  ctx: ActionCtx,
  connId: Id<"connections">,
  tokens: DriveTokens,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  if (tokens.accessToken && tokens.tokenExpiresAt && tokens.tokenExpiresAt > Date.now() + 60_000) {
    return tokens.accessToken;
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refreshToken ?? "",
      grant_type: "refresh_token",
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!res.ok || !data.access_token) {
    await ctx.runMutation(internal.internal.patchConnection, {
      id: connId,
      patch: {
        status: "disconnected",
        healthStatus: "error",
        lastError: "Google rejected the saved connection — reconnect it.",
      },
    });
    throw new Error("Google rejected the saved connection — reconnect it.");
  }
  await ctx.runMutation(internal.internal.patchConnection, {
    id: connId,
    patch: {
      settings: {
        ...(await ctx.runQuery(internal.internal.getConnectionById, { connectionId: connId }))
          ?.settings,
        tokens: {
          accessToken: data.access_token,
          refreshToken: tokens.refreshToken,
          tokenExpiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
        },
      },
    },
  });
  return data.access_token;
}

// ---------------------------------------------------------------------------
// Public surface — event activity (tenant-scoped)
// ---------------------------------------------------------------------------

export const listEvents = query({
  args: {
    limit: v.optional(v.number()),
    status: v.optional(v.string()),
    eventType: v.optional(v.string()),
  },
  handler: async (ctx, { limit, status, eventType }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    let rows = await ctx.db
      .query("events")
      .withIndex("by_tenant_received", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(limit ?? 60);
    if (status) rows = rows.filter((r) => r.status === status);
    if (eventType) rows = rows.filter((r) => r.eventType === eventType);

    return Promise.all(
      rows.map(async (r) => {
        const conn = r.connectionId ? await ctx.db.get(r.connectionId) : null;
        const def = getEventDefinition(r.eventType);
        const payload = (r.payload ?? {}) as Record<string, unknown>;
        return {
          ...r,
          connectorName: conn?.name ?? null,
          eventName: def?.connector ?? r.provider,
          resourceName:
            typeof payload.name === "string" ? payload.name : (payload.fileId as string) ?? r.sourceResourceId,
          summary:
            r.intelligence && typeof r.intelligence === "object"
              ? (r.intelligence as { summary?: string }).summary ?? null
              : null,
        };
      }),
    );
  },
});

export const getEventDetail = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const evt = await ctx.db.get(eventId);
    if (!evt || evt.tenantId !== tenantId) throw new Error("Event not found.");

    const conn = evt.connectionId ? await ctx.db.get(evt.connectionId) : null;
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_tenant_created", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(30);
    const relatedNotifications = notifications.filter(
      (n) => n.sourceEventId === eventId,
    );
    let action = null;
    if (evt.actionId) {
      const record = await ctx.db.get(evt.actionId);
      const tool = record ? TOOL_REGISTRY.find((t) => t.id === record.toolId) : null;
      action = record
        ? {
            ...record,
            toolName: tool?.name ?? record.toolId,
          }
        : null;
    }
    return { event: evt, connection: conn, notifications: relatedNotifications, action };
  },
});

export const eventStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const all = await ctx.db
      .query("events")
      .withIndex("by_tenant_received", (q) => q.eq("tenantId", tenantId))
      .collect();

    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};
    let duplicates = 0;
    let actionsTriggered = 0;
    let retried = 0;
    let processedMsTotal = 0;
    let processedMsCount = 0;
    for (const e of all) {
      byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
      byType[e.eventType] = (byType[e.eventType] ?? 0) + 1;
      if (e.duplicateOf) duplicates++;
      if (e.actionId) actionsTriggered++;
      if (e.attempts > 1) retried++;
      if (typeof e.processingMs === "number") {
        processedMsTotal += e.processingMs;
        processedMsCount++;
      }
    }
    return {
      total: all.length,
      byStatus,
      byType,
      duplicates,
      actionsTriggered,
      retried,
      avgProcessingMs:
        processedMsCount > 0 ? Math.round(processedMsTotal / processedMsCount) : null,
      sourceMechanisms: Array.from(
        new Set(all.map((e) => e.sourceMechanism)),
      ),
    };
  },
});

export const listEventPolicies = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const rows = await ctx.db
      .query("eventPolicies")
      .withIndex("by_tenant_type", (q) => q.eq("tenantId", tenantId))
      .collect();
    const byType = new Map(rows.map((r) => [r.eventType, r]));
    return EVENT_REGISTRY.filter((d) => d.implementationStatus === "implemented").map(
      (def) => ({
        eventType: def.type,
        name: def.connector,
        description: def.description,
        sourceMechanism: def.sourceMechanism,
        handlerId: def.handlerId,
        policy: byType.get(def.type) ?? null,
      }),
    );
  },
});

export const listNotifications = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const items = await ctx.db
      .query("notifications")
      .withIndex("by_tenant_created", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(limit ?? 25);
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_tenant_unread", (q) => q.eq("tenantId", tenantId).eq("read", false))
      .collect();
    return { items, unreadCount: unread.length };
  },
});

// ---------------------------------------------------------------------------
// Public mutations
// ---------------------------------------------------------------------------

export const retryEvent = mutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }): Promise<{ ok: boolean; reason?: string }> => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const evt = await ctx.db.get(eventId);
    if (!evt || evt.tenantId !== tenantId) throw new Error("Event not found.");
    if (evt.status !== "failed" && evt.status !== "retrying") {
      return { ok: false, reason: `Only failed or retrying events can be retried (this one is ${evt.status}).` };
    }
    await ctx.db.patch(eventId, {
      status: "received",
      attempts: 0,
      lastError: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.events.process.processEvent, { eventId });
    return { ok: true };
  },
});

export const setEventPolicy = mutation({
  args: {
    eventType: v.string(),
    enabled: v.boolean(),
    autoLowRiskWrite: v.optional(v.boolean()),
    allowedTools: v.optional(v.array(v.string())),
    blockedTools: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    if (!(await isManager(ctx, userId, tenantId))) {
      throw new Error("Only managers and above can change event policies.");
    }
    const def = getEventDefinition(args.eventType);
    if (!def || def.implementationStatus !== "implemented") {
      return { ok: false, reason: "This event type is not implemented." };
    }
    const existing = await ctx.db
      .query("eventPolicies")
      .withIndex("by_tenant_type", (q) =>
        q.eq("tenantId", tenantId).eq("eventType", args.eventType),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: args.enabled,
        autoLowRiskWrite: args.autoLowRiskWrite ?? existing.autoLowRiskWrite,
        allowedTools: args.allowedTools,
        blockedTools: args.blockedTools,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("eventPolicies", {
        tenantId,
        eventType: args.eventType,
        enabled: args.enabled,
        autoLowRiskWrite: args.autoLowRiskWrite ?? false,
        allowedTools: args.allowedTools,
        blockedTools: args.blockedTools,
        updatedAt: Date.now(),
      });
    }
    return { ok: true };
  },
});

export const deleteEventPolicy = mutation({
  args: { eventType: v.string() },
  handler: async (ctx, { eventType }): Promise<{ ok: boolean }> => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    if (!(await isManager(ctx, userId, tenantId))) {
      throw new Error("Only managers and above can change event policies.");
    }
    const existing = await ctx.db
      .query("eventPolicies")
      .withIndex("by_tenant_type", (q) =>
        q.eq("tenantId", tenantId).eq("eventType", eventType),
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return { ok: true };
  },
});

export const markNotificationRead = mutation({
  args: { id: v.id("notifications") },
  handler: async (ctx, { id }): Promise<{ ok: boolean }> => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const notif = await ctx.db.get(id);
    if (!notif || notif.tenantId !== tenantId) throw new Error("Notification not found.");
    if (!notif.read) await ctx.db.patch(id, { read: true });
    return { ok: true };
  },
});

export type { EventEnvelope };
