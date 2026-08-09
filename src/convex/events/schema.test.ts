import { describe, expect, it } from "vitest";
import { validateEventPayload } from "./schema";
import { getEventDefinition } from "./registry";

describe("event payload validation", () => {
  it("accepts a valid drive.file_created payload", () => {
    const res = validateEventPayload(getEventDefinition("drive.file_created"), {
      fileId: "f_1",
      name: "report.pdf",
      mimeType: "application/pdf",
      parents: ["root"],
      changeId: "c_1",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.fileId).toBe("f_1");
      expect(res.value.parents).toEqual(["root"]);
    }
  });

  it("rejects a missing required fileId", () => {
    const res = validateEventPayload(getEventDefinition("drive.file_created"), {
      name: "report.pdf",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join()).toContain("fileId");
  });

  it("strips unknown keys — payload is restricted to the schema", () => {
    const res = validateEventPayload(getEventDefinition("drive.file_updated"), {
      fileId: "f_1",
      changeId: "c_1",
      // not declared anywhere in the drive schema:
      accessToken: "LEAK",
      refreshToken: "LEAK2",
      rawProviderBlob: { anything: true },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.accessToken).toBeUndefined();
      expect(res.value.refreshToken).toBeUndefined();
      expect(res.value.rawProviderBlob).toBeUndefined();
    }
  });

  it("rejects invalid types", () => {
    const res = validateEventPayload(getEventDefinition("drive.file_created"), {
      fileId: { nested: true },
      changeId: "c",
    });
    expect(res.ok).toBe(false);
  });

  it("coerces strings to numbers for numeric fields", () => {
    const res = validateEventPayload(getEventDefinition("drive.file_created"), {
      fileId: "f_1",
      changeId: "c_1",
      size: "1024",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.size).toBe(1024);
  });

  it("rejects events with no registered definition", () => {
    const res = validateEventPayload(undefined, { fileId: "x" });
    expect(res.ok).toBe(false);
  });
});
