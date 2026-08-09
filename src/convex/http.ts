import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

const GOOGLE_OAUTH_TOKEN = "https://oauth2.googleapis.com/token";

/**
 * Google Drive OAuth callback. Google redirects the user's browser here after
 * authorization. The code is exchanged server-side (client secret never leaves
 * the backend), tokens are stored on the tenant's google_drive connection, and
 * the browser is sent back to the app with ?oauth=success|denied|error=…
 *
 * The connection is located via the `state` parameter that beginGoogleDriveOAuth
 * stored, so no session/auth is required on this public route.
 */
http.route({
  path: "/google/oauth/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") ?? "";
    const oauthError = url.searchParams.get("error");
    const origin = url.origin;

    const conns = await ctx.runQuery(internal.internal.listAllConnections, {});
    const conn = conns.find((c) => c.settings?.pendingState === state);
    const returnTo = conn?.settings?.oauthReturnTo;
    const go = (params: string) =>
      Response.redirect(`${returnTo ?? `${origin}/`}${params}`, 302);

    if (!conn || !state) {
      return go("?oauth=error=unknown");
    }
    if (oauthError) {
      await ctx.runMutation(internal.internal.patchConnection, {
        id: conn._id,
        patch: { settings: { ...conn.settings, pendingState: undefined } },
      });
      return go("?oauth=denied");
    }
    if (!code) {
      return go("?oauth=error=missing_code");
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return go("?oauth=error=not_configured");
    }

    const redirectUri = `${origin}/google/oauth/callback`;
    const res = await fetch(GOOGLE_OAUTH_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!res.ok || !data.access_token) {
      await ctx.runMutation(internal.internal.patchConnection, {
        id: conn._id,
        patch: { settings: { ...conn.settings, pendingState: undefined } },
      });
      return go("?oauth=error=exchange_failed");
    }

    await ctx.runMutation(internal.internal.patchConnection, {
      id: conn._id,
      patch: {
        status: "connected",
        lastSyncAt: undefined,
        lastError: undefined,
        scopes: (data.scope ?? "").split(" ").filter(Boolean),
        settings: {
          kind: "oauth2",
          tokens: {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            tokenExpiresAt:
              Date.now() + (Number(data.expires_in) || 3600) * 1000,
          },
        },
      },
    });

    return go("?oauth=success");
  }),
});

export default http;
