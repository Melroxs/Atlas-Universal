"use node";

// ---------------------------------------------------------------------------
// Google Drive client — shared by the tool runtime.
//
// Tokens are read from the stored connection (server-side only) and never
// returned to the client. Errors are sanitized: status codes and whitelisted
// Google reason codes only — raw provider bodies (which can echo request
// details) never reach logs or responses.
// ---------------------------------------------------------------------------

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";

const GOOGLE_OAUTH_TOKEN = "https://oauth2.googleapis.com/token";

export class ToolError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ToolError";
  }
}

interface DriveTokens {
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
}

type ConnectionLike = {
  _id: Id<"connections">;
  settings?: Record<string, unknown> | null;
};

/**
 * Return a valid access token for a connection, refreshing (and persisting)
 * it when missing or expired. Throws a sanitized ToolError on any failure.
 */
export async function ensureDriveAccessToken(
  ctx: ActionCtx,
  conn: ConnectionLike,
): Promise<string> {
  const tokens = (conn.settings?.tokens ?? {}) as DriveTokens;
  if (!tokens.refreshToken) {
    throw new ToolError(
      "drive_not_connected",
      "The Google Drive connection has no stored credentials — reconnect it.",
    );
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new ToolError(
      "drive_not_configured",
      "Google OAuth keys are missing (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).",
    );
  }
  if (
    tokens.accessToken &&
    tokens.tokenExpiresAt &&
    tokens.tokenExpiresAt > Date.now() + 60_000
  ) {
    return tokens.accessToken;
  }

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
        lastError: "Google rejected the saved connection — reconnect it.",
      },
    });
    throw new ToolError(
      "drive_reauth_required",
      "Google rejected the saved connection — reconnect it.",
    );
  }

  const next: DriveTokens = {
    accessToken: data.access_token,
    refreshToken: tokens.refreshToken,
    tokenExpiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
  await ctx.runMutation(internal.internal.patchConnection, {
    id: conn._id,
    patch: { settings: { ...conn.settings, tokens: next } },
  });
  return data.access_token;
}

/** Map a Drive API failure to a sanitized ToolError (never the raw body). */
export function sanitizeDriveError(status: number, bodyText: string): ToolError {
  let code = `drive_api_${status}`;
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { code?: number; status?: string };
    };
    if (parsed?.error?.code === 404) code = "drive_file_not_found";
    else if (parsed?.error?.status === "PERMISSION_DENIED") code = "drive_permission_denied";
    else if (parsed?.error?.code === 401) code = "drive_reauth_required";
    else if (parsed?.error?.code === 429) code = "drive_rate_limited";
  } catch {
    // non-JSON body — fall through to the status-only message
  }
  const message =
    code === "drive_file_not_found"
      ? "The requested file was not found (it may have been moved or deleted)."
      : code === "drive_permission_denied"
        ? "Permission denied — the connected account can't access this file."
        : code === "drive_rate_limited"
          ? "Google Drive rate limit reached — try again shortly."
          : code === "drive_reauth_required"
            ? "Google rejected the saved connection — reconnect it."
            : `Google Drive API error ${status}`;
  return new ToolError(code, message);
}

/** Authenticated GET/POST/PATCH against the Drive API with sanitized errors. */
export async function driveFetch(
  token: string,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw sanitizeDriveError(res.status, await res.text().catch(() => ""));
  }
  return res;
}
