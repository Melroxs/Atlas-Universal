// ---------------------------------------------------------------------------
// Shared CORS contract for every Atlas Supabase Edge Function — CANONICAL
// COPY (repo reference).
//
// The deployable function must be self-contained: the Freebuff bundler treats
// source/index.ts as the entry point and only packages files inside the
// function package directory, so the LOCAL deployable copy lives at
// source/cors.ts. This file is the canonical implementation; the drift test in
// this directory (cors.test.ts) fails if the two copies ever diverge. When
// changing CORS behavior, edit this file, regenerate/copy it to source/cors.ts
// and keep the tests green.
//
// Every edge function must handle browser preflight (OPTIONS) with a 2xx
// response carrying the required CORS headers, and must include the same
// headers on the actual response (including error responses).
//
// Notes:
// - Auth is enforced independently by each handler (JWT verification). CORS
//   never bypasses authentication: unknown origins get NO Access-Control-
//   Allow-Origin header, so the browser blocks them even though the server
//   still authorizes the request on its own merits.
// - Access-Control-Allow-Origin is restricted to the authorized production
//   origins ONLY (no wildcard).
// - This module is intentionally free of `Deno` imports so it can be unit
//   tested by the project's vitest suite.
// ---------------------------------------------------------------------------

/** Origins the Atlas web app runs from. atlasmvp.freebuff.app is the
 *  canonical Freebuff-hosted deployment (current production origin);
 *  atlasuniversalos.freebuff.app is the Vercel-hosted alias of the same app.
 *  Both are intentionally authorized — nothing else. */
export const ATLAS_ALLOWED_ORIGINS: string[] = [
  "https://atlasmvp.freebuff.app",
  "https://atlasuniversalos.freebuff.app",
];

export const ATLAS_CORS_METHODS = "GET, POST, OPTIONS";
export const ATLAS_CORS_HEADERS = "authorization, x-client-info, apikey, content-type";
export const ATLAS_CORS_MAX_AGE = "86400";

/**
 * CORS headers for a request. The Allow-Origin header is only emitted when
 * the request origin is on the allowlist; otherwise it is omitted entirely so
 * the browser rejects the cross-origin read.
 */
export function atlasCorsHeaders(request: Request): Headers {
  const headers = new Headers();
  headers.set("Access-Control-Allow-Methods", ATLAS_CORS_METHODS);
  headers.set("Access-Control-Allow-Headers", ATLAS_CORS_HEADERS);
  headers.set("Access-Control-Max-Age", ATLAS_CORS_MAX_AGE);
  headers.set("Vary", "Origin");
  const origin = request.headers.get("origin") ?? "";
  if (ATLAS_ALLOWED_ORIGINS.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

/**
 * Handle the browser OPTIONS preflight. Returns a 204 response with the CORS
 * headers when the request is a preflight, or null to continue with normal
 * handling. Called BEFORE authentication/business logic so a valid preflight
 * always succeeds.
 */
export function handleAtlasPreflight(request: Request): Response | null {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: atlasCorsHeaders(request) });
  }
  return null;
}

/** JSON response that always carries the CORS headers. */
export function atlasJson(
  body: unknown,
  status = 200,
  headers?: Headers,
): Response {
  const merged = headers ?? new Headers();
  if (!merged.has("Content-Type")) {
    merged.set("Content-Type", "application/json");
  }
  return new Response(JSON.stringify(body), { status, headers: merged });
}
