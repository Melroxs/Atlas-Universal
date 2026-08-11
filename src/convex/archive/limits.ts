/**
 * Phase 13 — SERVER-SIDE archive limits (authoritative).
 *
 * This mirrors src/lib/archive/limits.ts (client copy used for early feedback).
 * The server copy is the source of truth: the backend re-validates every
 * inventory submission against these numbers and STOPS SAFELY when exceeded.
 * Convex cannot import from outside the convex/ directory, hence the mirror.
 */

export const SERVER_ARCHIVE_LIMITS = {
  /** 500 MB compressed archive. */
  maxCompressedSize: 500 * 1024 * 1024,
  /** 2 GB total extracted content. */
  maxExtractedSize: 2 * 1024 * 1024 * 1024,
  /** 10,000 files per archive. */
  maxFiles: 10_000,
  /** 250 MB single extracted file (extraction guard). */
  maxExtractedFileSize: 250 * 1024 * 1024,
  /** Files larger than 8 MB are inventoried but never ingested. */
  maxIngestFileSize: 8 * 1024 * 1024,
  /** Nested archive depth. */
  maxDepth: 2,
  /** Maximum files accepted per submitInventoryBatch call. */
  maxBatchFiles: 400,
  /** Raw archive blob retained in storage only up to this size. */
  rawRetainLimit: 8 * 1024 * 1024,
} as const;

export function serverCheckFileSize(size: number): {
  ingestOk: boolean;
  reason?: string;
} {
  if (size > SERVER_ARCHIVE_LIMITS.maxIngestFileSize) {
    return {
      ingestOk: false,
      reason: `File is ${formatBytesServer(size)} — larger than the ${formatBytesServer(SERVER_ARCHIVE_LIMITS.maxIngestFileSize)} ingestion cap.`,
    };
  }
  return { ingestOk: true };
}

export function formatBytesServer(n: number): string {
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
