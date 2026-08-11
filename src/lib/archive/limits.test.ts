/**
 * Phase 13 — configurable resource-limit tests.
 *
 * When an archive exceeds a limit, the pipeline STOPS SAFELY and reports
 * exactly which limit was hit. These tests pin that behavior.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ARCHIVE_LIMITS,
  checkArchivePreflight,
  checkExtractionProgress,
  checkFileSize,
} from "./limits";

describe("checkArchivePreflight — compressed size cap", () => {
  it("accepts archives within the compressed-size cap", () => {
    const r = checkArchivePreflight(DEFAULT_ARCHIVE_LIMITS, {
      compressedSize: 10 * 1024 * 1024,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects archives above the cap with a clear message", () => {
    const r = checkArchivePreflight(DEFAULT_ARCHIVE_LIMITS, {
      compressedSize: DEFAULT_ARCHIVE_LIMITS.maxCompressedSize + 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.limit).toBe("maxCompressedSize");
      expect(r.message).toMatch(/maximum compressed archive size/);
    }
  });
});

describe("checkExtractionProgress — cumulative bomb guards", () => {
  it("stops when extracted size exceeds the cap", () => {
    const r = checkExtractionProgress(DEFAULT_ARCHIVE_LIMITS, {
      extractedSize: DEFAULT_ARCHIVE_LIMITS.maxExtractedSize + 1,
      fileCount: 5,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.limit).toBe("maxExtractedSize");
  });

  it("stops when the file count exceeds the cap", () => {
    const r = checkExtractionProgress(DEFAULT_ARCHIVE_LIMITS, {
      extractedSize: 1000,
      fileCount: DEFAULT_ARCHIVE_LIMITS.maxFiles + 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.limit).toBe("maxFiles");
  });

  it("allows normal progress", () => {
    const r = checkExtractionProgress(DEFAULT_ARCHIVE_LIMITS, {
      extractedSize: 1000,
      fileCount: 10,
    });
    expect(r.ok).toBe(true);
  });
});

describe("checkFileSize — per-file caps", () => {
  it("accepts normal files", () => {
    const r = checkFileSize(DEFAULT_ARCHIVE_LIMITS, 1024 * 1024);
    expect(r.extractedOk).toBe(true);
    expect(r.ingestOk).toBe(true);
  });

  it("inventories but does not ingest files above the ingest cap", () => {
    const r = checkFileSize(DEFAULT_ARCHIVE_LIMITS, DEFAULT_ARCHIVE_LIMITS.maxIngestFileSize + 1);
    expect(r.extractedOk).toBe(true);
    expect(r.ingestOk).toBe(false);
    expect(r.reason).toMatch(/ingestion cap/);
  });

  it("rejects files above the extraction cap entirely", () => {
    const r = checkFileSize(DEFAULT_ARCHIVE_LIMITS, DEFAULT_ARCHIVE_LIMITS.maxExtractedFileSize + 1);
    expect(r.extractedOk).toBe(false);
    expect(r.ingestOk).toBe(false);
  });
});
