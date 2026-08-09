// ---------------------------------------------------------------------------
// Drive client — sanitized errors and authenticated transport.
// Provider bodies (which can echo request details) must never surface.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { driveFetch, sanitizeDriveError, ToolError } from "./driveClient";

describe("sanitizeDriveError", () => {
  it("maps 404 to file-not-found with a safe message", () => {
    const err = sanitizeDriveError(404, JSON.stringify({ error: { code: 404 } }));
    expect(err).toBeInstanceOf(ToolError);
    expect(err.code).toBe("drive_file_not_found");
    expect(err.message).not.toContain("404");
  });

  it("maps PERMISSION_DENIED and 401/429 to known codes", () => {
    expect(
      sanitizeDriveError(403, JSON.stringify({ error: { status: "PERMISSION_DENIED" } })).code,
    ).toBe("drive_permission_denied");
    expect(sanitizeDriveError(401, JSON.stringify({ error: { code: 401 } })).code).toBe(
      "drive_reauth_required",
    );
    expect(sanitizeDriveError(429, JSON.stringify({ error: { code: 429 } })).code).toBe(
      "drive_rate_limited",
    );
  });

  it("falls back to a status-only message for unknown failures", () => {
    const err = sanitizeDriveError(500, "server exploded");
    expect(err.code).toBe("drive_api_500");
    expect(err.message).toBe("Google Drive API error 500");
  });

  it("never leaks raw provider bodies or credentials", () => {
    const body = JSON.stringify({
      error: {
        code: 500,
        message: "invalid_grant refresh_token=1//SECRETTOKEN client_secret=supersecret",
      },
    });
    const err = sanitizeDriveError(500, body);
    expect(err.message).not.toContain("SECRETTOKEN");
    expect(err.message).not.toContain("supersecret");
    expect(err.message).not.toContain("invalid_grant");
  });
});

describe("driveFetch", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the bearer token and returns the response on success", async () => {
    fetchMock.mockResolvedValue(new Response('{"id":"1"}', { status: 200 }));
    const res = await driveFetch("tok123", "https://www.googleapis.com/drive/v3/files");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("drive/v3/files");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok123");
    expect(await res.json()).toEqual({ id: "1" });
  });

  it("throws a sanitized ToolError on non-OK responses", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 404 } }), { status: 404 }),
    );
    await expect(driveFetch("tok", "https://x")).rejects.toMatchObject({
      code: "drive_file_not_found",
    });
  });
});
