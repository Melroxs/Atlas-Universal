// ---------------------------------------------------------------------------
// Regression tests for the shared edge-function CORS contract.
//
// Defect being guarded: the browser preflight for connections-run-due-syncs
// hit a 404 (function never deployed) and a 404 is not a valid CORS preflight
// response, so the app logged "Response to preflight request doesn't pass
// access control check". Every edge function must now answer OPTIONS with 2xx
// + the required headers and carry the same headers on the real response.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  atlasCorsHeaders,
  atlasJson,
  handleAtlasPreflight,
  ATLAS_ALLOWED_ORIGINS,
} from "./cors";

const PROD_ORIGIN = "https://atlasuniversalos.freebuff.app";

describe("edge function CORS contract", () => {
  it("answers OPTIONS preflight with 2xx and the required headers", () => {
    const req = new Request("https://project.supabase.co/functions/v1/test", {
      method: "OPTIONS",
      headers: {
        Origin: PROD_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    const res = handleAtlasPreflight(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBeGreaterThanOrEqual(200);
    expect(res!.status).toBeLessThan(300);
    expect(res!.headers.get("access-control-allow-origin")).toBe(PROD_ORIGIN);
    expect(res!.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res!.headers.get("access-control-allow-headers")).toMatch(/authorization/i);
    expect(res!.headers.get("access-control-allow-headers")).toMatch(/content-type/i);
    expect(res!.headers.get("vary")).toContain("Origin");
  });

  it("allows every origin on the allowlist", () => {
    for (const origin of ATLAS_ALLOWED_ORIGINS) {
      const headers = atlasCorsHeaders(
        new Request("https://project.supabase.co/functions/v1/test", {
          headers: { Origin: origin },
        }),
      );
      expect(headers.get("access-control-allow-origin")).toBe(origin);
    }
  });

  it("omits allow-origin for unknown origins so the browser blocks them", () => {
    const headers = atlasCorsHeaders(
      new Request("https://project.supabase.co/functions/v1/test", {
        headers: { Origin: "https://evil.example.com" },
      }),
    );
    expect(headers.get("access-control-allow-origin")).toBeNull();
  });

  it("carries CORS headers on the actual JSON response", () => {
    const res = atlasJson(
      { ok: true },
      200,
      atlasCorsHeaders(new Request("https://x/", { headers: { Origin: PROD_ORIGIN } })),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(PROD_ORIGIN);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("access-control-allow-methods")).toBeTruthy();
  });

  it("keeps non-preflight requests flowing to the handler", () => {
    expect(handleAtlasPreflight(new Request("https://x/", { method: "POST" }))).toBeNull();
    expect(handleAtlasPreflight(new Request("https://x/", { method: "GET" }))).toBeNull();
  });

  it("never returns a redirect/error for preflight of a missing handler (the 404 defect)", () => {
    // The preflight response must be 2xx — a 404 response with CORS headers is
    // still rejected by browsers because it is not an OK status.
    const res = handleAtlasPreflight(
      new Request("https://project.supabase.co/functions/v1/connections-run-due-syncs", {
        method: "OPTIONS",
        headers: { Origin: PROD_ORIGIN, "Access-Control-Request-Method": "POST" },
      }),
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBeGreaterThanOrEqual(200);
    expect(res!.status).toBeLessThan(300);
  });
});
