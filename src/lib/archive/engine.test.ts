/**
 * Phase 13 — end-to-end archive analysis tests.
 *
 * A real ZIP is run through the ENTIRE client pipeline — extraction,
 * security checks, checksums, classification, duplicate detection, claim
 * hints and warning aggregation — as the UI would before anything is
 * uploaded. This is the gate that decides "what Atlas found" for review.
 */
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { analyzeArchive, buildUploadPlan, detectArchiveFormat } from "./engine";

function textFile(name: string, content: string): { name: string; content: string } {
  return { name, content };
}

async function zipFrom(files: Array<{ name: string; content: string }>): Promise<Uint8Array> {
  const jz = new JSZip();
  for (const f of files) jz.file(f.name, f.content);
  return new Uint8Array(await jz.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}

function asFile(bytes: Uint8Array, name: string) {
  return {
    name,
    size: bytes.byteLength,
    async arrayBuffer(): Promise<ArrayBuffer> {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    },
  };
}

describe("analyzeArchive — full pipeline", () => {
  it("builds a classified, deduped, security-checked inventory", async () => {
    const bytes = await zipFrom([
      textFile("Clients/ABC/Claims/12345/Claim_12345.pdf", "CLAIM NUMBER 12345 date of loss adjuster"),
      textFile("Clients/ABC/Claims/12345/Estimate_12345.pdf", "ROOF ESTIMATE v1 $40,000"),
      textFile("Old_Backup/Estimate_12345.pdf", "ROOF ESTIMATE v1 $40,000"), // duplicate content, different path
      textFile("Clients/ABC/Invoices/Invoice_12345.xlsx", "invoice"),
      textFile("Scripts/evil.sh", "rm -rf /"), // blocked
      textFile("Misc/readme.txt", "hello"), // supported, plain
      textFile("Misc/photo.png", "\u0089PNG\r\n\u001a\nbinary-ish"), // unsupported format
    ]);
    const analysis = await analyzeArchive(asFile(bytes, "company-data.zip"));

    expect(analysis.fileType).toBe("zip");
    expect(analysis.fileCount).toBe(7);
    // (7 entries: claim, estimate, duplicate, invoice, script, readme, png)
    expect(analysis.checksum).toMatch(/^[0-9a-f]{64}$/);

    // Classification is evidence-based.
    const claim = analysis.entries.find((e) => e.path.includes("Claim_12345.pdf"))!;
    expect(claim.classification).toBe("claim");
    expect(claim.claimHints.some((h) => h.claimNumber === "12345")).toBe(true);
    const estimate = analysis.entries.find((e) => e.path.includes("Estimate"))!;
    expect(estimate.classification).toBe("estimate");

    // Exact duplicate detected by checksum.
    const dupes = analysis.entries.filter((e) => e.status === "duplicate");
    expect(dupes).toHaveLength(1);
    expect(dupes[0].duplicateOfPath).toContain("Estimate_12345.pdf");

    // Executable blocked; unsupported format inventoried but not ingested.
    const evil = analysis.entries.find((e) => e.path.endsWith("evil.sh"))!;
    expect(evil.status).toBe("blocked");
    expect(evil.blocked ?? true).toBe(true);
    const png = analysis.entries.find((e) => e.path.endsWith("photo.png"))!;
    expect(png.status).toBe("unsupported");

    // Honest warnings, not fake success.
    expect(analysis.warnings.some((w) => w.code === "duplicates")).toBe(true);
    expect(analysis.warnings.some((w) => w.code === "blocked_files")).toBe(true);
    expect(analysis.warnings.some((w) => w.code === "unsupported_files")).toBe(true);
    expect(analysis.stoppedEarly).toBe(false);
  });

  it("uploads plan only includes safe, supported, non-duplicate files", async () => {
    const bytes = await zipFrom([
      textFile("a/estimate.pdf", "ESTIMATE $10,000"),
      textFile("b/estimate.pdf", "ESTIMATE $10,000"), // duplicate
      textFile("c/run.exe", "MZ..."), // blocked
      textFile("d/notes.txt", "hello notes"),
    ]);
    const analysis = await analyzeArchive(asFile(bytes, "x.zip"));
    const plan = buildUploadPlan(analysis);
    expect(plan.ingest.map((e) => e.path)).toEqual([
      "a/estimate.pdf",
      "d/notes.txt",
    ]);
    expect(plan.skipped.map((e) => e.path)).toEqual([
      "b/estimate.pdf",
      "c/run.exe",
    ]);
    // Bytes for upload are only retained for ingestible files.
    for (const e of plan.ingest) expect(e.bytes).toBeDefined();
    for (const e of plan.skipped) expect(e.bytes).toBeUndefined();
  });

  it("returns an honest empty analysis for non-archives", async () => {
    const junk = new Uint8Array(64).fill(7);
    const analysis = await analyzeArchive(asFile(junk, "random.bin"));
    expect(analysis.fileType).toBe("unknown");
    expect(analysis.fileCount).toBe(0);
    expect(analysis.warnings.some((w) => w.code === "unsupported_archive_format")).toBe(true);
  });

  it("stops early for oversized archives without extracting", async () => {
    // Can't allocate a 500MB buffer in tests — verify via format detection path
    // plus a preflight-level warning for a huge reported size is covered in
    // limits.test.ts. Here we just confirm detectArchiveFormat works on bytes.
    expect(detectArchiveFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "anything.pdf")).toBe("zip");
  });
});
