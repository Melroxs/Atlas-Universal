// ---------------------------------------------------------------------------
// Regression tests for the shared edge-function CORS contract.
//
// Defects being guarded:
//   1. The browser preflight for connections-run-due-syncs hit a 404
//      (function never deployed / bundle broken by an import escaping the
//      function package) and a 404 is not a valid CORS preflight response, so
//      the app logged "Response to preflight request doesn't pass access
//      control check". Every edge function must answer OPTIONS with 2xx + the
//      required headers and carry the same headers on the real response.
//   2. Drift: the deployable local copy (source/cors.ts) must stay identical
//      to the canonical implementation (_shared/cors.ts), and the entry
//      (source/index.ts) must not import anything that escapes the function
//      package directory.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  atlasCorsHeaders,
  atlasJson,
  handleAtlasPreflight,
  ATLAS_ALLOWED_ORIGINS,
} from "./cors";

const PROD_ORIGIN = "https://atlas-ai-os.com";
const HEREDOC = `${dirname(fileURLToPath(import.meta.url))}`;

function readRelative(rel: string): string {
  return readFileSync(resolve(HEREDOC, rel), "utf8");
}

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

  it("allows the canonical production origin and nothing else", () => {
    expect(ATLAS_ALLOWED_ORIGINS).toContain(PROD_ORIGIN);
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
    for (const origin of [
      "https://evil.example.com",
      "https://atlasuniversal.freebuff.app",
      "null",
    ]) {
      const headers = atlasCorsHeaders(
        new Request("https://project.supabase.co/functions/v1/test", {
          headers: { Origin: origin },
        }),
      );
      expect(headers.get("access-control-allow-origin")).toBeNull();
    }
  });

  it("never returns a wildcard allow-origin", () => {
    const req = new Request("https://project.supabase.co/functions/v1/test", {
      headers: { Origin: PROD_ORIGIN },
    });
    const headers = atlasCorsHeaders(req);
    expect(headers.get("access-control-allow-origin")).not.toBe("*");
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

  it("keeps the local deployable CORS copy identical to the canonical copy (no drift)", () => {
    const canonical = readRelative("../_shared/cors.ts");
    const local = readRelative("../source/cors.ts");
    // Compare CODE only — each file carries its own role-specific header
    // comment, but the exports and logic must never diverge.
    const normalize = (s: string) =>
      s
        .replace(/\r\n/g, "\n")
        .split(/\n/)
        .map((l) => l.replace(/\/\/.*$/, "").replace(/[ \t]+$/g, ""))
        .filter((l) => l.trim() !== "")
        .join("\n")
        .trim();
    expect(normalize(local), "source/cors.ts drifted from _shared/cors.ts").toBe(
      normalize(canonical),
    );
  });

  it("keeps the deployable entry self-contained (no imports escaping the package)", () => {
    const entry = readRelative("../source/index.ts");
    // The entry may only import from "./cors.ts" (the local package copy) and
    // remote https URLs — never ../ paths that escape the function directory.
    for (const line of entry.split(/\r?\n/)) {
      const m = line.match(/^\s*import\s+.*?from\s+["']([^"']+)["']/);
      if (!m) continue;
      const spec = m[1];
      if (spec.startsWith("http")) continue;
      expect(
        spec === "./cors.ts" || spec.startsWith("./"),
        `source/index.ts must not import outside the package: ${spec}`,
      ).toBe(true);
    }
  });
});
