/**
 * Phase 13 — configurable archive resource limits.
 *
 * Defaults are sane for a first MVP and are re-validated server-side by
 * src/convex/archive/limits.ts (the server copy is authoritative — the client
 * copy is a mirror used for early, honest feedback before anything uploads).
 *
 * Limits are deliberately explicit: if an archive exceeds one, the pipeline
 * STOPS SAFELY and reports which limit was hit. It never claims partial
 * success as full success.
 */
import type { ArchiveLimits } from "./types";

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  /** 500 MB compressed archive. */
  maxCompressedSize: 500 * 1024 * 1024,
  /** 2 GB total extracted content. */
  maxExtractedSize: 2 * 1024 * 1024 * 1024,
  /** 10,000 files. */
  maxFiles: 10_000,
  /** 250 MB single extracted file (extraction guard only). */
  maxExtractedFileSize: 250 * 1024 * 1024,
  /** Files larger than 8 MB are inventoried but not ingested (upload cap). */
  maxIngestFileSize: 8 * 1024 * 1024,
  /** Nested archives up to depth 2 are unpacked (company.zip → old-data.zip → files). */
  maxDepth: 2,
  /** 30 minute extraction budget. */
  maxProcessingTimeMs: 30 * 60 * 1000,
  /** A 200:1 compressed:extracted ratio is treated as a probable bomb. */
  maxCompressionRatio: 200,
  /** Raw archive blob retained in storage only up to 8 MB. */
  rawRetainLimit: 8 * 1024 * 1024,
};

export type LimitCheck =
  | { ok: true }
  | { ok: false; limit: string; message: string };

/**
 * Validate a full archive BEFORE extraction (client-side, mirrored server-side).
 */
export function checkArchivePreflight(
  limits: ArchiveLimits,
  input: { compressedSize: number },
): LimitCheck {
  if (input.compressedSize > limits.maxCompressedSize) {
    return {
      ok: false,
      limit: "maxCompressedSize",
      message: `Archive is ${formatBytes(input.compressedSize)}; the maximum compressed archive size is ${formatBytes(limits.maxCompressedSize)}.`,
    };
  }
  return { ok: true };
}

/**
 * Validate cumulative extraction state as files are unpacked (bomb guard).
 * STOPS SAFELY as soon as any limit is exceeded.
 */
export function checkExtractionProgress(
  limits: ArchiveLimits,
  state: { extractedSize: number; fileCount: number },
): LimitCheck {
  if (state.extractedSize > limits.maxExtractedSize) {
    return {
      ok: false,
      limit: "maxExtractedSize",
      message: `Extracted content reached ${formatBytes(state.extractedSize)}, exceeding the ${formatBytes(limits.maxExtractedSize)} limit. Atlas stopped extracting safely.`,
    };
  }
  if (state.fileCount > limits.maxFiles) {
    return {
      ok: false,
      limit: "maxFiles",
      message: `Archive contains more than ${limits.maxFiles.toLocaleString()} files, which exceeds the file-count limit. Atlas stopped extracting safely.`,
    };
  }
  return { ok: true };
}

/** Per-file checks: extracted size and ingest size caps. */
export function checkFileSize(
  limits: ArchiveLimits,
  size: number,
): { extractedOk: boolean; ingestOk: boolean; reason?: string } {
  if (size > limits.maxExtractedFileSize) {
    return {
      extractedOk: false,
      ingestOk: false,
      reason: `File is ${formatBytes(size)}, exceeding the ${formatBytes(limits.maxExtractedFileSize)} per-file extraction limit.`,
    };
  }
  if (size > limits.maxIngestFileSize) {
    return {
      extractedOk: true,
      ingestOk: false,
      reason: `File is ${formatBytes(size)} — larger than the ${formatBytes(limits.maxIngestFileSize)} ingestion cap. It is inventoried but not ingested.`,
    };
  }
  return { extractedOk: true, ingestOk: true };
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n;
  let u = -1;
  do {
    v /= 1024;
    u++;
  } while (v >= 1024 && u < units.length - 1);
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[u]}`;
}
