/**
 * Phase 13 — duplicate & version detection tests.
 *
 * - EXACT duplicates are caught by deterministic checksum: the first path
 *   wins, later copies are flagged with provenance, never ingested twice.
 * - VERSIONS (Estimate_v1 / Estimate_v2) are grouped by stem so the newest
 *   can be marked current while older copies stay as history — they are not
 *   silently turned into two unrelated facts.
 */
import { describe, expect, it } from "vitest";
import type { ArchiveFileEntry } from "./types";
import { analyzeVersions, parseVersion } from "./version";

function entry(overrides: Partial<ArchiveFileEntry> & { path: string; checksum: string }): ArchiveFileEntry {
  return {
    filename: overrides.path.split("/").pop() ?? overrides.path,
    extension: (overrides.path.split(".").pop() ?? "").toLowerCase(),
    mimeType: "application/pdf",
    size: 100,
    depth: 0,
    status: "ok",
    supported: true,
    classification: "estimate",
    classificationBasis: "filename",
    classificationConfidence: 0.8,
    claimHints: [],
    ...overrides,
  };
}

describe("parseVersion", () => {
  it("parses numbered and paren versions", () => {
    expect(parseVersion("Estimate_v2.pdf").version).toBe(2);
    expect(parseVersion("Estimate_v1.pdf").version).toBe(1);
    expect(parseVersion("Report (3).docx").version).toBe(3);
    expect(parseVersion("Scope VER2.pdf").version).toBe(2);
  });

  it("parses final/draft markers", () => {
    expect(parseVersion("Scope_final.pdf").kind).toBe("final");
    expect(parseVersion("Scope_draft.pdf").kind).toBe("draft");
    expect(parseVersion("PlainName.pdf").kind).toBe("plain");
  });

  it("extracts a stable stem", () => {
    expect(parseVersion("Estimate_v2.pdf").stem).toBe("Estimate");
    expect(parseVersion("Report (3).docx").stem).toBe("Report");
  });
});

describe("analyzeVersions — exact duplicates", () => {
  it("marks later copies as duplicates with provenance", () => {
    const a = entry({ path: "Claims/12345/estimate.pdf", checksum: "aaa" });
    const b = entry({ path: "Old_Backup/estimate.pdf", checksum: "aaa" });
    const { entries } = analyzeVersions([a, b]);
    expect(entries[0].status).toBe("ok");
    expect(entries[1].status).toBe("duplicate");
    expect(entries[1].duplicateOfPath).toBe("Claims/12345/estimate.pdf");
  });

  it("does not flag different content as duplicates", () => {
    const a = entry({ path: "a/estimate.pdf", checksum: "aaa" });
    const b = entry({ path: "b/estimate.pdf", checksum: "bbb" });
    const { entries } = analyzeVersions([a, b]);
    expect(entries.every((e) => e.status === "ok")).toBe(true);
  });

  it("skips blocked/unsupported files in duplicate detection", () => {
    const blocked = entry({ path: "x/run.sh", checksum: "ccc", status: "blocked" });
    const same = entry({ path: "y/run.sh", checksum: "ccc", status: "ok" });
    const { entries } = analyzeVersions([blocked, same]);
    // Different checksum paths — blocked file is never a duplicate source.
    expect(entries[1].status).toBe("ok");
  });
});

describe("analyzeVersions — version groups & supersession", () => {
  it("ranks versions so the newest is current", () => {
    const v1 = entry({ path: "Claims/12345/Estimate_v1.pdf", checksum: "aaa" });
    const v2 = entry({ path: "Claims/12345/Estimate_v2.pdf", checksum: "bbb" });
    const { entries, groups } = analyzeVersions([v1, v2]);
    const v1e = entries.find((e) => e.path.includes("v1"))!;
    const v2e = entries.find((e) => e.path.includes("v2"))!;
    expect(v2e.isLatestVersion).toBe(true);
    expect(v1e.isLatestVersion).toBe(false);
    expect(groups).toHaveLength(1);
    expect(groups[0].stem).toBe("estimate");
  });

  it("uses mtime to break version ties", () => {
    const old = entry({ path: "a/report.pdf", checksum: "aaa", modifiedAt: 1000 });
    const newer = entry({ path: "b/report.pdf", checksum: "bbb", modifiedAt: 2000 });
    const { entries } = analyzeVersions([old, newer]);
    expect(entries.find((e) => e.checksum === "bbb")!.isLatestVersion).toBe(true);
  });

  it("keeps unrelated same-stem files separate when versions are equal", () => {
    const x = entry({ path: "a/notes.pdf", checksum: "aaa" });
    const y = entry({ path: "b/notes.pdf", checksum: "bbb" });
    const { groups } = analyzeVersions([x, y]);
    // Same stem, no version markers → newest by mtime wins, group recorded.
    expect(groups).toHaveLength(1);
  });
});
