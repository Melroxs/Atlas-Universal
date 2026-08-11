/**
 * Shared types for Phase 13 — Compressed Company Data Ingestion.
 *
 * These types are the contract between the client-side analysis pipeline
 * (extract → classify → dedupe → manifest) and the Convex backend. The
 * backend re-validates everything before anything becomes knowledge, so this
 * module is PURE — no DOM, no Convex, no node imports.
 */

export type ArchiveFormat = "zip" | "rar" | "unknown";

export type ArchiveFileStatus =
  | "ok"
  | "blocked"
  | "unsupported"
  | "too_large"
  | "duplicate"
  | "skipped_nested";

/** One discovered file inside an archive, after security + classification. */
export interface ArchiveFileEntry {
  /** Normalized relative path, always forward-slash, never ../, never absolute. */
  path: string;
  filename: string;
  extension: string;
  mimeType: string;
  size: number;
  /** SHA-256 hex of the file bytes (deterministic duplicate detection). */
  checksum: string;
  /** Nesting depth inside the archive (0 = top level). */
  depth: number;
  /** Modified time when the archive provides one (ms). */
  modifiedAt?: number;
  status: ArchiveFileStatus;
  /** Why status !== "ok" (blocked reason / duplicate source / …). */
  note?: string;
  /** Exact-duplicate relationship: path of the first occurrence. */
  duplicateOfPath?: string;
  /** Stem grouping for version detection (e.g. "Estimate"). */
  versionGroup?: string;
  /** Version number parsed from the filename (v1, (2), _final …). */
  versionNumber?: number;
  /** True when this file is the newest in its version group. */
  isLatestVersion?: boolean;
  supported: boolean;
  classification: string;
  classificationBasis: string;
  classificationConfidence: number;
  /** Evidence-based claim hints derived from filename + folder context. */
  claimHints: ClaimHint[];
  /** Raw bytes for ingestion (only present after extraction). */
  bytes?: Uint8Array;
}

export interface ClaimHint {
  claimNumber: string;
  confidence: number;
  reasons: string[];
}

/** Configurable, archive-wide resource limits (client AND server enforced). */
export interface ArchiveLimits {
  /** Maximum compressed archive size accepted (bytes). */
  maxCompressedSize: number;
  /** Maximum total extracted size (bytes) — the decompression bomb guard. */
  maxExtractedSize: number;
  /** Maximum number of files extracted from one archive. */
  maxFiles: number;
  /** Maximum extracted size of a single file (bytes). */
  maxExtractedFileSize: number;
  /** Files larger than this are inventoried but NOT uploaded/ingested. */
  maxIngestFileSize: number;
  /** Maximum nested archive depth (0 = no nested archives allowed). */
  maxDepth: number;
  /** Maximum time budget for extraction (ms). */
  maxProcessingTimeMs: number;
  /** Compressed:extracted ratio above which the archive is treated as a bomb. */
  maxCompressionRatio: number;
  /** Raw archive blob is retained in storage only up to this size. */
  rawRetainLimit: number;
}

/** A warning surfaced during analysis (user-facing, honest). */
export interface ArchiveWarning {
  code:
    | "password_protected"
    | "corrupt"
    | "unsupported_archive_format"
    | "limit_exceeded"
    | "nested_archive"
    | "duplicates"
    | "blocked_files"
    | "unsupported_files"
    | "too_large_files"
    | "oversized_archive"
    | "empty_archive"
    | "truncated";
  message: string;
}

export interface ArchiveAnalysis {
  filename: string;
  fileType: ArchiveFormat;
  compressedSize: number;
  extractedSize: number;
  fileCount: number;
  checksum: string;
  /** All discovered entries (including blocked/duplicate/unsupported). */
  entries: ArchiveFileEntry[];
  warnings: ArchiveWarning[];
  limits: ArchiveLimits;
  /** True when analysis stopped safely because a hard limit was hit. */
  stoppedEarly: boolean;
}

export interface ArchiveUploadPlan {
  /** Files that will be uploaded + ingested. */
  ingest: ArchiveFileEntry[];
  /** Files that will be recorded but skipped (dup/unsupported/blocked/too large). */
  skipped: ArchiveFileEntry[];
}

export const ARCHIVE_STATUS_LABELS: Record<string, string> = {
  uploaded: "Uploaded",
  validating: "Validating",
  extracting: "Extracting",
  inventorying: "Building inventory",
  classifying: "Classifying",
  ingesting: "Ingesting into knowledge",
  indexing: "Indexing",
  enriching: "Enriching organizational intelligence",
  completed: "Completed",
  completed_with_warnings: "Completed with warnings",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const FILE_INGEST_LABELS: Record<string, string> = {
  pending: "Pending",
  queued: "Queued",
  ingesting: "Ingesting",
  ingested: "Ingested",
  duplicate: "Duplicate",
  unsupported: "Unsupported",
  failed: "Failed",
  skipped: "Skipped",
  blocked: "Blocked",
  too_large: "Too large",
};
