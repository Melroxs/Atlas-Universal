/**
 * Phase 13 — archive extraction (client-side, sandboxed).
 *
 * Everything happens in the browser BEFORE anything is uploaded, so every
 * security rule can be enforced on raw bytes:
 *  - path validation (Zip Slip), executable/credential blocking;
 *  - cumulative size + file-count limits (decompression bombs);
 *  - compression-ratio bomb detection;
 *  - bounded nested-archive depth;
 *  - honest errors for corrupt / password-protected / oversized archives.
 *
 * ZIP is handled by JSZip; RAR by node-unrar-js (WASM, loaded from
 * /unrar.wasm). Both run in the browser and in Node (tests).
 */

import JSZip from "jszip";
import { createExtractorFromData } from "node-unrar-js";
import type { ArchiveLimits, ArchiveWarning } from "./types";
import { checkExtractionProgress, checkFileSize } from "./limits";
import { checkBombRatio, sniffArchiveFormat } from "./security";

export class ArchiveCorruptError extends Error {}
export class ArchivePasswordError extends Error {}
export class ArchiveLimitExceededError extends Error {
  limit: string;
  constructor(limit: string, message: string) {
    super(message);
    this.limit = limit;
  }
}

/** A raw extracted file before security/classification (bytes still attached). */
export interface RawExtractedFile {
  rawPath: string;
  bytes: Uint8Array;
  size: number;
  /** Depth inside the archive (0 = top level). */
  depth: number;
  modifiedAt?: number;
}

export interface ExtractOutcome {
  files: RawExtractedFile[];
  warnings: ArchiveWarning[];
  /** True when extraction stopped early because a hard limit was hit. */
  stoppedEarly: boolean;
}

export interface ExtractProgress {
  extractedSize: number;
  fileCount: number;
  currentPath?: string;
}

const NESTED_ARCHIVE_EXT = new Set(["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"]);

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a plain ArrayBuffer — crypto.subtle requires BufferSource backed
  // by ArrayBuffer (TS lib), not SharedArrayBuffer or detached views.
  const buf = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export { sha256Hex };

/** Load (once) the RAR WASM binary from the app's public assets. */
let wasmPromise: Promise<ArrayBuffer> | null = null;
export function loadUnrarWasm(): Promise<ArrayBuffer> {
  if (!wasmPromise) {
    wasmPromise = (async () => {
      const base =
        typeof window !== "undefined" && window.location?.origin
          ? window.location.origin
          : "http://localhost";
      const res = await fetch(`${base}/unrar.wasm`);
      if (!res.ok) {
        throw new Error(
          "RAR support requires the unrar.wasm engine, which could not be loaded. Please retry, or convert the archive to ZIP.",
        );
      }
      return (await res.arrayBuffer()) as ArrayBuffer;
    })();
  }
  return wasmPromise;
}

/** Extract every file from a ZIP (in-memory). Throws on corrupt/encrypted. */
async function extractZipFiles(bytes: Uint8Array): Promise<RawExtractedFile[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/encrypted/i.test(msg)) {
      throw new ArchivePasswordError(
        "This ZIP archive is password-protected. Atlas cannot process it without the correct password, and passwords are never stored.",
      );
    }
    throw new ArchiveCorruptError(
      "This ZIP archive is corrupt or uses an unsupported compression method and could not be opened.",
    );
  }
  const out: RawExtractedFile[] = [];
  const names = Object.keys(zip.files).sort();
  for (const name of names) {
    const entry = zip.files[name];
    if (entry.dir) continue;
    try {
      const data = await entry.async("uint8array");
      out.push({
        rawPath: name,
        bytes: data,
        size: data.byteLength,
        depth: 0,
        modifiedAt: entry.date ? entry.date.getTime() : undefined,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/encrypted/i.test(msg)) {
        throw new ArchivePasswordError(
          "This ZIP archive contains password-protected files. Atlas cannot process it without the correct password.",
        );
      }
      throw new ArchiveCorruptError(
        `A file inside the archive could not be read (${msg}). The archive may be corrupt.`,
      );
    }
  }
  return out;
}

/** Extract every file from a RAR via node-unrar-js (WASM). */
async function extractRarFiles(bytes: Uint8Array): Promise<RawExtractedFile[]> {
  const wasmBinary = await loadUnrarWasm();
  let extractor: Awaited<ReturnType<typeof createExtractorFromData>>;
  try {
    extractor = await createExtractorFromData({
      wasmBinary,
      data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/password|encrypted/i.test(msg)) {
      throw new ArchivePasswordError(
        "This RAR archive is password-protected. Atlas cannot process it without the correct password, and passwords are never stored.",
      );
    }
    throw new ArchiveCorruptError(
      "This RAR archive is corrupt or uses an unsupported compression method and could not be opened.",
    );
  }

  let fileList: { name: string; flags?: { directory?: boolean; encrypted?: boolean } }[];
  try {
    const listing = extractor.getFileList();
    const headers = [...listing.fileHeaders];
    fileList = headers.map((h: { name?: string; flags?: { directory?: boolean; encrypted?: boolean } }) => ({
      name: h?.name ?? "",
      flags: h?.flags ?? {},
    }));
    if (fileList.some((f) => f.flags?.encrypted)) {
      throw new ArchivePasswordError(
        "This RAR archive is password-protected. Atlas cannot process it without the correct password, and passwords are never stored.",
      );
    }
  } catch (e) {
    if (e instanceof ArchivePasswordError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (/password|encrypted/i.test(msg)) {
      throw new ArchivePasswordError(
        "This RAR archive is password-protected. Atlas cannot process it without the correct password, and passwords are never stored.",
      );
    }
    throw new ArchiveCorruptError(
      "This RAR archive is corrupt or uses an unsupported compression method and could not be opened.",
    );
  }

  const out: RawExtractedFile[] = [];
  try {
    const extracted = extractor.extract();
    for (const file of extracted.files) {
      const header = file.fileHeader as {
        name?: string;
        flags?: { directory?: boolean; encrypted?: boolean };
      };
      if (header?.flags?.directory) continue;
      const name = header?.name ?? "";
      if (!name) continue;
      const data = file.extraction as Uint8Array | undefined;
      if (!data) continue;
      out.push({ rawPath: name, bytes: data, size: data.byteLength, depth: 0 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/password|encrypted/i.test(msg)) {
      throw new ArchivePasswordError(
        "This RAR archive is password-protected. Atlas cannot process it without the correct password, and passwords are never stored.",
      );
    }
    throw new ArchiveCorruptError(
      `RAR extraction failed (${msg}). The archive may be corrupt or use an unsupported method.`,
    );
  }
  return out;
}

export interface ExtractArchiveInput {
  bytes: Uint8Array;
  format: "zip" | "rar";
  limits: ArchiveLimits;
  compressedSize: number;
  onProgress?: (p: ExtractProgress) => void;
}

/**
 * Extract an archive with cumulative resource guards and bounded nesting.
 * Stops SAFELY (never partially claims success) when a hard limit is hit.
 */
export async function extractArchive(
  input: ExtractArchiveInput,
): Promise<ExtractOutcome> {
  const { bytes, format, limits, compressedSize, onProgress } = input;
  const warnings: ArchiveWarning[] = [];
  const state = { extractedSize: 0, fileCount: 0 };
  const startedAt = Date.now();
  let stoppedEarly = false;

  const guard = (): boolean => {
    const check = checkExtractionProgress(limits, state);
    if (!check.ok) {
      stoppedEarly = true;
      warnings.push({ code: "limit_exceeded", message: check.message });
      return false;
    }
    const bomb = checkBombRatio(limits.maxCompressionRatio, {
      compressedSize,
      extractedSize: state.extractedSize,
    });
    if (bomb.bomb) {
      stoppedEarly = true;
      warnings.push({
        code: "limit_exceeded",
        message: `The archive expands to ${Math.round(bomb.ratio)}× its compressed size, which matches a decompression-bomb pattern. Atlas stopped extracting safely.`,
      });
      return false;
    }
    if (Date.now() - startedAt > limits.maxProcessingTimeMs) {
      stoppedEarly = true;
      warnings.push({
        code: "limit_exceeded",
        message: "Extraction exceeded the maximum processing time and was stopped safely.",
      });
      return false;
    }
    return true;
  };

  const files: RawExtractedFile[] = [];

  const unpack = async (archiveBytes: Uint8Array, format: "zip" | "rar", depth: number): Promise<void> => {
    const rawFiles =
      format === "zip"
        ? await extractZipFiles(archiveBytes)
        : await extractRarFiles(archiveBytes);

    // Directory entries can appear multiple times; sort for determinism.
    rawFiles.sort((a, b) => (a.rawPath < b.rawPath ? -1 : a.rawPath > b.rawPath ? 1 : 0));

    for (const raw of rawFiles) {
      if (!guard()) return;
      const ext = raw.rawPath.split(".").pop()?.toLowerCase() ?? "";

      // Nested archive handling — bounded by maxDepth.
      if (NESTED_ARCHIVE_EXT.has(ext)) {
        if (depth >= limits.maxDepth) {
          warnings.push({
            code: "nested_archive",
            message: `Nested archive “${raw.rawPath}” was not processed because the maximum extraction depth (${limits.maxDepth}) was reached.`,
          });
          continue;
        }
        const sniffed = sniffArchiveFormat(raw.bytes, raw.rawPath);
        if (sniffed.detected === "zip" || sniffed.detected === "rar") {
          try {
            await unpack(raw.bytes, sniffed.detected, depth + 1);
          } catch (e) {
            warnings.push({
              code: "nested_archive",
              message: `Nested archive “${raw.rawPath}” could not be unpacked (${e instanceof Error ? e.message : String(e)}).`,
            });
          }
          continue;
        }
        // .tar/.gz etc. are not yet supported — record honestly.
        warnings.push({
          code: "nested_archive",
          message: `Nested archive “${raw.rawPath}” uses a format Atlas doesn't unpack yet.`,
        });
        continue;
      }

      // Per-file extraction cap.
      const sizeCheck = checkFileSize(limits, raw.size);
      if (!sizeCheck.extractedOk) {
        warnings.push({ code: "limit_exceeded", message: sizeCheck.reason! });
        continue;
      }

      state.fileCount++;
      state.extractedSize += raw.size;
      if (!guard()) return;

      files.push({
        rawPath: raw.rawPath,
        bytes: raw.bytes,
        size: raw.size,
        depth,
        modifiedAt: raw.modifiedAt,
      });
      onProgress?.({ extractedSize: state.extractedSize, fileCount: state.fileCount, currentPath: raw.rawPath });
    }
  };

  try {
    await unpack(bytes, format, 0);
  } catch (e) {
    if (e instanceof ArchivePasswordError || e instanceof ArchiveCorruptError) {
      throw e;
    }
    throw new ArchiveCorruptError(
      `Extraction failed (${e instanceof Error ? e.message : String(e)}).`,
    );
  }

  return { files, warnings, stoppedEarly };
}
