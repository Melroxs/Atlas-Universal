// ---------------------------------------------------------------------------
// Regression tests — conversation-converse CORS + packaging contract.
//
// Defects being guarded:
//   1. The browser preflight for conversation-converse hit a 404 (the
//      function was never deployed), and a 404 is not a valid CORS preflight
//      response — so every voice/Ask Atlas request was blocked with
//      "Response to preflight request does not have HTTP ok status" and the
//      assistant reported "I hit a problem responding to that". The handler
//      must answer OPTIONS with 2xx + the required headers BEFORE auth.
//   2. Drift: the deployable local copy (source/cors.ts) must stay identical
//      to the canonical implementation (_shared/cors.ts), and the entry
//      (source/index.ts) must not import anything that escapes the function
//      package directory (Freebuff bundles only the function's own directory).
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

const PROD_ORIGIN = "https://atlasmvp.freebuff.app";
const ALIAS_ORIGIN = "https://atlasuniversalos.freebuff.app";
const HEREDOC = `${dirname(fileURLToPath(import.meta.url))}`;

function readRelative(rel: string): string {
  return readFileSync(resolve(HEREDOC, rel), "utf8");
}

describe("conversation-converse CORS contract", () => {
  it("answers OPTIONS preflight with 2xx and the required headers (the 404 defect)", () => {
    const req = new Request("https://project.supabase.co/functions/v1/conversation-converse", {
      method: "OPTIONS",
      headers: {
        Origin: PROD_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type,apikey,x-client-info",
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
    expect(res!.headers.get("access-control-allow-headers")).toMatch(/apikey/i);
    expect(res!.headers.get("access-control-allow-headers")).toMatch(/x-client-info/i);
    expect(res!.headers.get("vary")).toContain("Origin");
  });

  it("allows the authorized production origins and nothing else", () => {
    expect(ATLAS_ALLOWED_ORIGINS).toEqual([PROD_ORIGIN, ALIAS_ORIGIN]);
    for (const origin of ATLAS_ALLOWED_ORIGINS) {
      const headers = atlasCorsHeaders(
        new Request("https://project.supabase.co/functions/v1/conversation-converse", {
          headers: { Origin: origin },
        }),
      );
      expect(headers.get("access-control-allow-origin")).toBe(origin);
    }
  });

  it("omits allow-origin for unknown origins so the browser blocks them", () => {
    for (const origin of [
      "https://evil.example.com",
      "https://atlasmvp.evil.com",
      "null",
    ]) {
      const headers = atlasCorsHeaders(
        new Request("https://project.supabase.co/functions/v1/conversation-converse", {
          headers: { Origin: origin },
        }),
      );
      expect(headers.get("access-control-allow-origin")).toBeNull();
    }
  });

  it("never returns a wildcard allow-origin", () => {
    const headers = atlasCorsHeaders(
      new Request("https://project.supabase.co/functions/v1/conversation-converse", {
        headers: { Origin: PROD_ORIGIN },
      }),
    );
    expect(headers.get("access-control-allow-origin")).not.toBe("*");
  });

  it("carries CORS headers on successful AND error JSON responses", () => {
    for (const [body, status] of [
      [{ ok: true, data: { answer: "x" } }, 200],
      [{ ok: false, error: "Unauthorized" }, 401],
      [{ ok: false, error: "No transcript" }, 400],
      [{ ok: false, error: "Internal error" }, 500],
    ] as const) {
      const res = atlasJson(
        body,
        status,
        atlasCorsHeaders(new Request("https://x/", { headers: { Origin: PROD_ORIGIN } })),
      );
      expect(res.status).toBe(status);
      expect(res.headers.get("access-control-allow-origin")).toBe(PROD_ORIGIN);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(res.headers.get("access-control-allow-methods")).toBeTruthy();
    }
  });

  it("keeps non-preflight requests flowing to the handler", () => {
    expect(handleAtlasPreflight(new Request("https://x/", { method: "POST" }))).toBeNull();
    expect(handleAtlasPreflight(new Request("https://x/", { method: "GET" }))).toBeNull();
  });

  it("keeps the local deployable CORS copy identical to the canonical copy (no drift)", () => {
    const canonical = readRelative("../_shared/cors.ts");
    const local = readRelative("../source/cors.ts");
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

  it("keeps the CORS copies in sync across BOTH edge functions (one shared contract)", () => {
    const here = resolve(HEREDOC, "..");
    const other = resolve(here, "../connections-run-due-syncs/source/cors.ts");
    // Strip both line and block comments so only the CODE is compared — the
    // two functions may word their documentation comments differently.
    const normalize = (s: string) =>
      s
        .replace(/\r\n/g, "\n")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split(/\n/)
        .map((l) => l.replace(/\/\/.*$/, "").replace(/[ \t]+$/g, ""))
        .filter((l) => l.trim() !== "")
        .join("\n")
        .trim();
    expect(normalize(readFileSync(other, "utf8")), "cross-function CORS drift").toBe(
      normalize(readFileSync(resolve(here, "source/cors.ts"), "utf8")),
    );
  });
});
