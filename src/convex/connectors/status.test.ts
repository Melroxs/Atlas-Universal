// ---------------------------------------------------------------------------
// Honest status derivation — a connector never claims connected/healthy
// without a real connection and a real API check. Plus connection sanitization
// (tokens and settings must never reach the client).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { CONNECTOR_BY_ID } from "./registry";
import { deriveConnectorStatus, sanitizeConnection } from "./status";

const drive = CONNECTOR_BY_ID["google_drive"];
const uploads = CONNECTOR_BY_ID["manual_upload"];

describe("deriveConnectorStatus", () => {
  it("reports planned connectors as roadmap before anything else", () => {
    const gmail = CONNECTOR_BY_ID["google_gmail"];
    expect(deriveConnectorStatus(gmail, null, true)).toBe("roadmap");
    expect(deriveConnectorStatus(gmail, { status: "connected" }, true)).toBe("roadmap");
  });

  it("reports not_configured when required env vars are missing", () => {
    expect(deriveConnectorStatus(drive, null, false)).toBe("not_configured");
  });

  it("reports authorization_required when configured but not connected", () => {
    expect(deriveConnectorStatus(drive, null, true)).toBe("authorization_required");
    expect(deriveConnectorStatus(drive, { status: "disconnected" }, true)).toBe(
      "authorization_required",
    );
  });

  it("reports available for auth-free connectors with no connection", () => {
    expect(deriveConnectorStatus(uploads, null, true)).toBe("available");
  });

  it("propagates error and syncing states", () => {
    expect(deriveConnectorStatus(drive, { status: "error" }, true)).toBe("error");
    expect(deriveConnectorStatus(drive, { status: "syncing" }, true)).toBe("syncing");
  });

  it("reports connected only for a real connection, but never healthy untested", () => {
    expect(deriveConnectorStatus(drive, { status: "connected" }, true)).toBe("connected");
    expect(
      deriveConnectorStatus(drive, { status: "connected", healthStatus: "untested" }, true),
    ).toBe("connected");
  });

  it("reports healthy only after a live test says so", () => {
    expect(
      deriveConnectorStatus(drive, { status: "connected", healthStatus: "healthy" }, true),
    ).toBe("healthy");
    expect(
      deriveConnectorStatus(drive, { status: "connected", healthStatus: "degraded" }, true),
    ).toBe("degraded");
    expect(
      deriveConnectorStatus(drive, { status: "connected", healthStatus: "error" }, true),
    ).toBe("error");
  });
});

describe("sanitizeConnection", () => {
  it("strips settings (OAuth tokens) and pending state from client rows", () => {
    const raw = {
      _id: "conn123" as never,
      name: "Acme Drive",
      provider: "google_drive",
      category: "document_storage",
      status: "connected",
      settings: { tokens: { accessToken: "ya29.SECRET", refreshToken: "1//SECRET" } },
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
      lastSyncAt: 123,
      healthStatus: "healthy",
      lastTestedAt: 456,
      accountEmail: "ops@acme.com",
    };
    const out = sanitizeConnection(raw as never);
    expect(out).not.toHaveProperty("settings");
    expect(out).not.toHaveProperty("scopes");
    expect(out).not.toHaveProperty("tokens");
    expect(JSON.stringify(out)).not.toContain("SECRET");
    expect(out.accountEmail).toBe("ops@acme.com");
    expect(out.healthStatus).toBe("healthy");
    expect(out.lastTestedAt).toBe(456);
  });

  it("preserves only the safe status surface", () => {
    const out = sanitizeConnection({
      _id: "c1" as never,
      name: "x",
      provider: "y",
      category: "z",
      status: "disconnected",
      lastError: "oauth expired",
    });
    expect(Object.keys(out).sort()).toEqual(
      [
        "_id",
        "name",
        "provider",
        "category",
        "status",
        "lastError",
        "healthStatus",
        "lastTestedAt",
        "lastTestSuccessAt",
        "lastTestFailureAt",
        "lastTestLatencyMs",
        "accountName",
        "accountEmail",
        "lastSyncAt",
      ].sort(),
    );
  });
});
