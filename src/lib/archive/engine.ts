/**
 * Phase 13 — archive analysis engine.
 *
 * analyzeArchive() turns an untrusted uploaded file into a fully classified,
 * security-checked, deduplicated inventory — BEFORE anything reaches Atlas.
 * The result is what the UI shows the user ("here's what I found") and what
 * gets submitted (after human review) as the ingestion manifest.
 */
import type {
  ArchiveAnalysis,
  ArchiveFileEntry,
  ArchiveLimits,
  ArchiveUploadPlan,
  ArchiveWarning,
} from "./types";
import {
  DEFAULT_ARCHIVE_LIMITS,
  checkArchivePreflight,
  checkFileSize,
  formatBytes,
} from "./limits";
import {
  checkFileSecurity,
  sniffArchiveFormat,
  sniffMimeType,
  validateArchivePath,
} from "./security";
import { classifyFile, isSupportedForIngestion } from "./classify";
import { analyzeVersions } from "./version";
import { extractClaimHints } from "./claims";
import { extractArchive, sha256Hex, ArchiveCorruptError, ArchivePasswordError } from "./extract";

export interface AnalyzeOptions {
  limits?: ArchiveLimits;
  onProgress?: (phase: string, done: number, total: number) => void;
}

/** Detect the archive format from magic bytes (content decides, not the name). */
export function detectArchiveFormat(
  bytes: Uint8Array,
  filename: string,
): "zip" | "rar" | "unknown" {
  return sniffArchiveFormat(bytes, filename).detected;
}

/** Decode a small UTF-8 sample for content-based classification. */
function contentSample(bytes: Uint8Array): string | undefined {
  const head = bytes.slice(0, 2048);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  try {
    const text = decoder.decode(head);
    // Garbage guard: require a plausible ratio of printable chars.
    let printable = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c > 0xa0) printable++;
    }
    return printable / Math.max(1, text.length) > 0.7 ? text : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Analyze an uploaded archive file end-to-end. Throws ArchivePasswordError /
 * ArchiveCorruptError for archives that cannot be processed at all; returns a
 * full ArchiveAnalysis otherwise (including archives that stopped early).
 */
export async function analyzeArchive(
  file: File | { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> },
  options: AnalyzeOptions = {},
): Promise<ArchiveAnalysis> {
  const limits = options.limits ?? DEFAULT_ARCHIVE_LIMITS;
  const warnings: ArchiveWarning[] = [];
  const bytes = new Uint8Array(await file.arrayBuffer());
  const checksum = await sha256Hex(bytes);
  const fileType = detectArchiveFormat(bytes, file.name);

  options.onProgress?.("Reading", 0, 1);

  if (fileType === "unknown") {
    warnings.push({
      code: "unsupported_archive_format",
      message: `“${file.name}” isn't a recognized ZIP or RAR archive. Atlas can only ingest ZIP and RAR company data packages.`,
    });
    return {
      filename: file.name,
      fileType,
      compressedSize: bytes.byteLength,
      extractedSize: 0,
      fileCount: 0,
      checksum,
      entries: [],
      warnings,
      limits,
      stoppedEarly: false,
    };
  }

  const preflight = checkArchivePreflight(limits, { compressedSize: bytes.byteLength });
  if (!preflight.ok) {
    warnings.push({ code: "oversized_archive", message: preflight.message });
    return {
      filename: file.name,
      fileType,
      compressedSize: bytes.byteLength,
      extractedSize: 0,
      fileCount: 0,
      checksum,
      entries: [],
      warnings,
      limits,
      stoppedEarly: true,
    };
  }

  const outcome = await extractArchive({
    bytes,
    format: fileType,
    limits,
    compressedSize: bytes.byteLength,
    onProgress: (p) => {
      options.onProgress?.("Extracting", p.fileCount, Math.max(p.fileCount, 1));
    },
  });
  warnings.push(...outcome.warnings);

  // Second pass: security, checksums, classification, claim hints.
  const entries: ArchiveFileEntry[] = [];
  let processed = 0;
  for (const raw of outcome.files) {
    processed++;
    options.onProgress?.("Inspecting", processed, Math.max(outcome.files.length, 1));

    const pathCheck = validateArchivePath(raw.rawPath);
    if (!pathCheck.ok) {
      entries.push({
        path: raw.rawPath,
        filename: raw.rawPath.split("/").pop() ?? raw.rawPath,
        extension: raw.rawPath.split(".").pop() ?? "",
        mimeType: "application/octet-stream",
        size: raw.size,
        checksum: "",
        depth: raw.depth,
        status: "blocked",
        note: pathCheck.reason,
        supported: false,
        classification: "unknown",
        classificationBasis: "security",
        classificationConfidence: 1,
        claimHints: [],
      });
      continue;
    }

    const security = checkFileSecurity(pathCheck.path);
    const sizeCheck = checkFileSize(limits, raw.size);
    const checksumHex = await sha256Hex(raw.bytes);
    const ext = pathCheck.path.split(".").pop()?.toLowerCase() ?? "";
    const mime = sniffMimeType(pathCheck.path, raw.bytes);
    const supported = isSupportedForIngestion(ext);
    const cls = classifyFile(pathCheck.path, raw.size, contentSample(raw.bytes));
    const { hints } = extractClaimHints(pathCheck.path);

    let status: ArchiveFileEntry["status"] = "ok";
    let note: string | undefined;
    let keptBytes: Uint8Array | undefined = raw.bytes;

    if (security.blocked) {
      status = "blocked";
      note = security.reason;
      keptBytes = undefined;
    } else if (!sizeCheck.ingestOk) {
      status = "too_large";
      note = sizeCheck.reason;
      keptBytes = undefined;
    } else if (!supported) {
      status = "unsupported";
      note = `No text-extraction parser is available for “.${ext}” files in this environment. The file is inventoried but not ingested.`;
      keptBytes = undefined;
    }

    entries.push({
      path: pathCheck.path,
      filename: pathCheck.path.split("/").pop() ?? pathCheck.path,
      extension: ext,
      mimeType: mime,
      size: raw.size,
      checksum: checksumHex,
      depth: raw.depth,
      modifiedAt: raw.modifiedAt,
      status,
      note,
      supported: supported && !security.blocked,
      classification: cls.classification,
      classificationBasis: cls.basis,
      classificationConfidence: cls.confidence,
      claimHints: hints,
      bytes: keptBytes,
    });
  }

  // Third pass: exact-duplicate + version detection.
  const versioned = analyzeVersions(entries);

  // Aggregate honest warnings from the inventory.
  const duplicates = entries.filter((e) => e.status === "duplicate");
  const blocked = entries.filter((e) => e.status === "blocked");
  const unsupported = entries.filter((e) => e.status === "unsupported");
  const tooLarge = entries.filter((e) => e.status === "too_large");
  if (duplicates.length > 0) {
    warnings.push({
      code: "duplicates",
      message: `${duplicates.length} exact duplicate${duplicates.length === 1 ? "" : "s"} found (identical checksums) — each is ingested once.`,
    });
  }
  if (blocked.length > 0) {
    warnings.push({
      code: "blocked_files",
      message: `${blocked.length} file${blocked.length === 1 ? "" : "s"} blocked for security (executables, scripts or credential-like files are never ingested from archives).`,
    });
  }
  if (unsupported.length > 0) {
    warnings.push({
      code: "unsupported_files",
      message: `${unsupported.length} file${unsupported.length === 1 ? "" : "s"} use formats Atlas can't parse here — they're inventoried but not ingested.`,
    });
  }
  if (tooLarge.length > 0) {
    warnings.push({
      code: "too_large_files",
      message: `${tooLarge.length} file${tooLarge.length === 1 ? "" : "s"} exceed${tooLarge.length === 1 ? "s" : ""} the ${formatBytes(limits.maxIngestFileSize)} ingestion cap — inventoried but not ingested.`,
    });
  }
  if (entries.length === 0 && outcome.files.length === 0 && !outcome.stoppedEarly) {
    warnings.push({
      code: "empty_archive",
      message: "The archive contains no files Atlas could inventory.",
    });
  }

  const extractedSize = entries.reduce((s, e) => s + e.size, 0);
  return {
    filename: file.name,
    fileType,
    compressedSize: bytes.byteLength,
    extractedSize,
    fileCount: entries.length,
    checksum,
    entries: versioned.entries,
    warnings,
    limits,
    stoppedEarly: outcome.stoppedEarly,
  };
}

/** What should actually be uploaded + ingested vs. recorded-and-skipped. */
export function buildUploadPlan(analysis: ArchiveAnalysis): ArchiveUploadPlan {
  const ingest = analysis.entries.filter(
    (e) => e.status === "ok" && e.bytes && e.supported,
  );
  const skipped = analysis.entries.filter(
    (e) => e.status !== "ok" || !e.supported,
  );
  return { ingest, skipped };
}

export function isRarSupported(): boolean {
  return typeof fetch === "function";
}
