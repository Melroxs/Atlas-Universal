// ---------------------------------------------------------------------------
// Risk & confirmation engine — centralized policy, not UI hardcoding.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { TOOL_BY_ID } from "./registry";
import { buildConfirmation, evaluateRisk } from "./policy";

describe("evaluateRisk", () => {
  it("never requires confirmation for read tools", () => {
    for (const id of [
      "drive.search_files",
      "drive.get_file",
      "drive.get_file_metadata",
      "drive.list_files",
    ]) {
      const r = evaluateRisk(TOOL_BY_ID[id], {});
      expect(r.riskLevel, id).toBe("READ");
      expect(r.confirmationRequired, id).toBe(false);
    }
  });

  it("auto-executes low-risk writes", () => {
    const r = evaluateRisk(TOOL_BY_ID["drive.create_file"], { name: "a.txt" });
    expect(r.riskLevel).toBe("LOW_WRITE");
    expect(r.confirmationRequired).toBe(false);
  });

  it("escalates content overwrites to high risk (confirmation required)", () => {
    const metadataOnly = evaluateRisk(TOOL_BY_ID["drive.update_file"], { name: "a.txt" });
    expect(metadataOnly.riskLevel).toBe("LOW_WRITE");
    expect(metadataOnly.confirmationRequired).toBe(false);

    const overwrite = evaluateRisk(TOOL_BY_ID["drive.update_file"], {
      fileId: "abc",
      content: "new content",
    });
    expect(overwrite.riskLevel).toBe("HIGH_WRITE");
    expect(overwrite.confirmationRequired).toBe(true);
  });

  it("requires confirmation for moves", () => {
    const r = evaluateRisk(TOOL_BY_ID["drive.move_file"], {});
    expect(r.riskLevel).toBe("HIGH_WRITE");
    expect(r.confirmationRequired).toBe(true);
  });

  it("always requires confirmation for delete regardless of input", () => {
    const r = evaluateRisk(TOOL_BY_ID["drive.delete_file"], { fileId: "abc" });
    expect(r.confirmationRequired).toBe(true);
    expect(r.policyReason).toContain("always");
  });
});

describe("buildConfirmation", () => {
  const account = "ops@acme.com";

  it("describes exactly what will happen, the system and the account", () => {
    const c = buildConfirmation(
      TOOL_BY_ID["drive.move_file"],
      { fileId: "file123", destinationFolderId: "folder9" },
      account,
    );
    expect(c.message).toContain(account);
    expect(c.message).toContain("Google Drive");
    expect(c.system).toBe("Google Drive");
    expect(c.account).toBe(account);
    expect(c.what).toContain("file123");
    expect(c.consequences.length).toBeGreaterThan(0);
  });

  it("never asks a vague 'are you sure'", () => {
    const c = buildConfirmation(
      TOOL_BY_ID["drive.delete_file"],
      { fileId: "file123" },
      undefined,
    );
    expect(c.message.toLowerCase()).not.toContain("are you sure");
    expect(c.resource).toContain("trash");
  });

  it("flags irreversibility honestly", () => {
    const update = buildConfirmation(
      TOOL_BY_ID["drive.update_file"],
      { fileId: "f1", name: "x", content: "y" },
      undefined,
    );
    expect(update.reversible).toBe(false);

    const move = buildConfirmation(
      TOOL_BY_ID["drive.move_file"],
      { fileId: "f1", destinationFolderId: "d1" },
      undefined,
    );
    expect(move.reversible).toBe(true);
  });

  it("falls back to the connected account label when unknown", () => {
    const c = buildConfirmation(TOOL_BY_ID["drive.create_file"], { name: "a.txt" }, undefined);
    expect(c.account).toBe("the connected account");
  });
});
