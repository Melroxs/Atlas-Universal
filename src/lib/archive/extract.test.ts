/**
 * Phase 13 — extraction tests (real ZIP bytes, no mocks).
 *
 * These tests build actual ZIP archives (minimal STORE-method builder +
 * JSZip for DEFLATE) and drive extractArchive() through the real extraction
 * path: nested archives, corruption, encryption, empty archives, bomb ratios
 * and per-file caps. RAR extraction needs the WASM engine and a real RAR
 * fixture — not available in this environment — so RAR support is covered at
 * the format-sniffing level in security.test.ts and honestly not claimed
 * beyond that.
 */
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  ArchiveCorruptError,
  ArchivePasswordError,
  extractArchive,
} from "./extract";
import {
  DEFAULT_ARCHIVE_LIMITS,
  type ArchiveLimits,
} from "./limits";

// ---------------------------------------------------------------------------
// Minimal ZIP builder (STORE method) so tests control exact bytes.
// ---------------------------------------------------------------------------

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let k = 0; k < 8; k++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function makeZip(entries: Array<{ name: string; data: Uint8Array; flags?: number }>): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const flags = e.flags ?? 0;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, flags, true);
    lh.setUint16(8, 0, true); // STORE
    lh.setUint16(10, 0, true);
    lh.setUint16(12, 0, true);
    lh.setUint32(14, crc32(e.data), true);
    lh.setUint32(18, e.data.length, true);
    lh.setUint32(22, e.data.length, true);
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), nameBytes, e.data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, flags, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, 0, true);
    ch.setUint16(14, 0, true);
    ch.setUint32(16, crc32(e.data), true);
    ch.setUint32(20, e.data.length, true);
    ch.setUint32(24, e.data.length, true);
    ch.setUint16(28, nameBytes.length, true);
    ch.setUint16(30, 0, true);
    ch.setUint16(32, 0, true);
    ch.setUint16(34, 0, true);
    ch.setUint32(38, 0, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nameBytes);
    offset += 30 + nameBytes.length + e.data.length;
  }
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(4, 0, true);
  eocd.setUint16(6, 0, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  const cdSize = central.reduce((s, u) => s + u.length, 0);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, offset, true);
  eocd.setUint16(20, 0, true);
  return concatBytes([...parts, ...central, new Uint8Array(eocd.buffer)]);
}

const enc = new TextEncoder();

describe("extractArchive — valid archives", () => {
  it("extracts a valid STORE zip with multiple files", async () => {
    const zip = makeZip([
      { name: "Clients/ABC/estimate.pdf", data: enc.encode("ESTIMATE v2") },
      { name: "Clients/ABC/invoice.csv", data: enc.encode("invoice,amount") },
    ]);
    const out = await extractArchive({
      bytes: zip,
      format: "zip",
      limits: DEFAULT_ARCHIVE_LIMITS,
      compressedSize: zip.byteLength,
    });
    expect(out.stoppedEarly).toBe(false);
    expect(out.files).toHaveLength(2);
    expect(out.files.map((f) => f.rawPath).sort()).toEqual([
      "Clients/ABC/estimate.pdf",
      "Clients/ABC/invoice.csv",
    ]);
    expect(new TextDecoder().decode(out.files[0].bytes)).toBe("ESTIMATE v2");
  });

  it("extracts a JSZip DEFLATE zip", async () => {
    const jz = new JSZip();
    jz.file("estimate.pdf", "Roof estimate $42,000");
    const zip = new Uint8Array(
      await jz.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
    );
    const out = await extractArchive({
      bytes: zip,
      format: "zip",
      limits: DEFAULT_ARCHIVE_LIMITS,
      compressedSize: zip.byteLength,
    });
    expect(out.files).toHaveLength(1);
    expect(new TextDecoder().decode(out.files[0].bytes)).toContain("Roof estimate");
  });
});

describe("extractArchive — nested archives (bounded)", () => {
  it("unpacks a nested zip within the depth limit", async () => {
    const inner = makeZip([
      { name: "old_invoice.pdf", data: enc.encode("old invoice") },
    ]);
    const outer = makeZip([
      { name: "backup/old-data.zip", data: inner },
    ]);
    const out = await extractArchive({
      bytes: outer,
      format: "zip",
      limits: DEFAULT_ARCHIVE_LIMITS,
      compressedSize: outer.byteLength,
    });
    const nested = out.files.find((f) => f.rawPath === "old_invoice.pdf");
    expect(nested).toBeDefined();
    expect(nested!.depth).toBe(1);
  });

  it("skips nested archives beyond maxDepth with a warning", async () => {
    const inner = makeZip([{ name: "secret.pdf", data: enc.encode("x") }]);
    const outer = makeZip([{ name: "nested.zip", data: inner }]);
    const limits: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, maxDepth: 0 };
    const out = await extractArchive({
      bytes: outer,
      format: "zip",
      limits,
      compressedSize: outer.byteLength,
    });
    expect(out.files).toHaveLength(0);
    expect(out.warnings.some((w) => w.code === "nested_archive")).toBe(true);
    expect(out.warnings[0].message).toMatch(/maximum extraction depth/);
  });

  it("records a warning for unsupported nested formats (.tar)", async () => {
    const outer = makeZip([{ name: "bundle.tar", data: enc.encode("not a real tar") }]);
    const out = await extractArchive({
      bytes: outer,
      format: "zip",
      limits: DEFAULT_ARCHIVE_LIMITS,
      compressedSize: outer.byteLength,
    });
    expect(out.warnings.some((w) => w.code === "nested_archive")).toBe(true);
  });
});

describe("extractArchive — corrupt & encrypted archives", () => {
  it("throws ArchiveCorruptError for garbage bytes", async () => {
    await expect(
      extractArchive({
        bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
        format: "zip",
        limits: DEFAULT_ARCHIVE_LIMITS,
        compressedSize: 9,
      }),
    ).rejects.toBeInstanceOf(ArchiveCorruptError);
  });

  it("throws ArchivePasswordError for encrypted entries", async () => {
    const zip = makeZip([
      { name: "secret.pdf", data: new Uint8Array(0), flags: 0x0001 },
    ]);
    await expect(
      extractArchive({
        bytes: zip,
        format: "zip",
        limits: DEFAULT_ARCHIVE_LIMITS,
        compressedSize: zip.byteLength,
      }),
    ).rejects.toBeInstanceOf(ArchivePasswordError);
  });
});

describe("extractArchive — empty archives & limits", () => {
  it("returns zero files for an empty zip (no fabricated metrics)", async () => {
    const zip = makeZip([]);
    const out = await extractArchive({
      bytes: zip,
      format: "zip",
      limits: DEFAULT_ARCHIVE_LIMITS,
      compressedSize: zip.byteLength,
    });
    expect(out.files).toHaveLength(0);
    expect(out.stoppedEarly).toBe(false);
  });

  it("stops safely when a file exceeds the per-file extraction cap", async () => {
    const big = new Uint8Array(10_000).fill(65);
    const zip = makeZip([{ name: "big.bin", data: big }]);
    const limits: ArchiveLimits = {
      ...DEFAULT_ARCHIVE_LIMITS,
      maxExtractedFileSize: 100,
    };
    const out = await extractArchive({
      bytes: zip,
      format: "zip",
      limits,
      compressedSize: zip.byteLength,
    });
    expect(out.files).toHaveLength(0);
    expect(out.warnings.some((w) => w.code === "limit_exceeded")).toBe(true);
  });

  it("detects decompression-bomb ratios and stops", async () => {
    const jz = new JSZip();
    jz.file("blob.txt", "a".repeat(50_000));
    const zip = new Uint8Array(
      await jz.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
    );
    const out = await extractArchive({
      bytes: zip,
      format: "zip",
      limits: DEFAULT_ARCHIVE_LIMITS,
      compressedSize: zip.byteLength,
    });
    expect(out.stoppedEarly).toBe(true);
    expect(out.warnings.some((w) => /bomb/i.test(w.message))).toBe(true);
  });
});
