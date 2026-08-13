// ---------------------------------------------------------------------------
// Supported-file classification contract (Phase 15).
//
// One place decides what Atlas can ingest and how. It does NOT trust the
// extension or the browser MIME alone: a known extension, a known MIME, and
// (when available) magic bytes all vote, with a normalization table for the
// inconsistent MIME values browsers send for the same file.
//
//   classifyFile(title, mimeType, bytes?) → FileTypeInfo
//
// kind = pdf | word | excel | csv | text | markdown | email | image | archive
//        | unsupported
//
// Every code path (individual upload, archive extraction, parsers, the UI's
// file picker) uses this single contract so nothing silently falls through
// to "the file was stored but we pretend we read it".
// ---------------------------------------------------------------------------

export type FileKind =
  | "pdf"
  | "word"
  | "excel"
  | "csv"
  | "text"
  | "markdown"
  | "email"
  | "image"
  | "archive"
  | "unsupported";

export interface FileTypeInfo {
  kind: FileKind;
  /** Lowercased extension without the dot ("" when none). */
  extension: string;
  /** Canonical MIME used downstream (never the browser's raw value). */
  mimeType: string;
  /** True when Atlas can ingest this file type. */
  supported: boolean;
  /** Human reason when unsupported (shown in the UI). */
  reason?: string;
  /** Sub-kind for images (jpeg/png/webp/gif/bmp/tiff/svg). */
  imageKind?: string;
}

/** Canonical MIME per extension. Extension wins over the browser's MIME. */
const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  eml: "message/rfc822",
  html: "text/html",
  htm: "text/html",
  json: "application/json",
  xml: "application/xml",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  svg: "image/svg+xml",
  zip: "application/zip",
  rar: "application/vnd.rar",
};

/** Normalize the messy MIME values browsers/OSes send for a file. */
function normalizeMime(mimeType: string | undefined): string {
  if (!mimeType) return "";
  const m = mimeType.trim().toLowerCase();
  if (m.includes("pdf")) return "application/pdf";
  if (m.includes("wordprocessingml.document") || m.includes("officedocument.wordprocessingml")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (m.includes("spreadsheetml.sheet")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (m.includes("csv") || m === "text/comma-separated-values") return "text/csv";
  if (m.includes("ms-excel") || m.includes("excel") || m.includes("spreadsheet")) {
    return "application/vnd.ms-excel";
  }
  if (m.includes("msword") || m.includes("ms-word") || m.includes("word")) {
    return "application/msword";
  }
  if (m.includes("markdown")) return "text/markdown";
  if (m.includes("rfc822") || m.includes("eml")) return "message/rfc822";
  if (m.includes("jpeg") || m.includes("jpg")) return "image/jpeg";
  if (m.includes("png")) return "image/png";
  if (m.includes("webp")) return "image/webp";
  if (m.includes("gif")) return "image/gif";
  if (m.includes("bmp")) return "image/bmp";
  if (m.includes("tiff")) return "image/tiff";
  if (m.includes("svg")) return "image/svg+xml";
  if (m.includes("zip") || m.includes("x-zip") || m.includes("x-zip-compressed")) {
    return "application/zip";
  }
  if (m.includes("rar") || m.includes("x-rar")) return "application/vnd.rar";
  if (m.startsWith("text/")) return "text/plain";
  if (m === "application/octet-stream") return "application/octet-stream";
  return m;
}

/** Magic-byte sniffing for files whose extension/MIME disagree or are absent. */
function sniffKind(bytes: Uint8Array | ArrayBuffer | undefined): { kind: FileKind; mimeType: string } | null {
  if (!bytes) return null;
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const head = (n: number) =>
    Array.from(b.slice(0, n))
      .map((x) => String.fromCharCode(x))
      .join("");
  if (b.length >= 5 && head(5) === "%PDF-") return { kind: "pdf", mimeType: "application/pdf" };
  if (b.length >= 4 && head(4) === "PK\u0003\u0004") return { kind: "archive", mimeType: "application/zip" };
  if (b.length >= 7 && head(7) === "Rar!\u001a\u0007") return { kind: "archive", mimeType: "application/vnd.rar" };
  if (b.length >= 8 && head(8) === "\u0089PNG\r\n\u001a\n") return { kind: "image", mimeType: "image/png" };
  if (b.length >= 3 && head(3) === "\u00ff\u00d8\u00ff") return { kind: "image", mimeType: "image/jpeg" };
  if (b.length >= 12 && head(4) === "RIFF" && head(8).slice(4) === "WEBP") {
    return { kind: "image", mimeType: "image/webp" };
  }
  if (b.length >= 4 && (head(4) === "GIF8")) return { kind: "image", mimeType: "image/gif" };
  if (b.length >= 2 && head(2) === "BM") return { kind: "image", mimeType: "image/bmp" };
  if (b.length >= 4 && (head(4) === "II*\u0000" || head(4) === "MM\u0000*")) {
    return { kind: "image", mimeType: "image/tiff" };
  }
  return null;
}

const IMAGE_KINDS: Record<string, string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
};

const SUPPORTED_EXTENSIONS = new Set(Object.keys(EXT_MIME));

/**
 * Classify a file by extension → MIME → magic bytes.
 *
 * - A known extension wins (browsers lie; the extension is what the user
 *   actually handed over).
 * - Otherwise a normalized known MIME wins.
 * - Otherwise magic bytes win (e.g. a .bin that is really a PDF).
 * - Otherwise: unsupported — the UI must say so explicitly.
 */
export function classifyFile(
  title: string,
  mimeType?: string | null,
  bytes?: Uint8Array | ArrayBuffer | null,
): FileTypeInfo {
  const ext = (title.split(".").pop() ?? "").toLowerCase();
  const normalized = normalizeMime(mimeType ?? undefined);

  // 1. Known extension.
  if (ext && EXT_MIME[ext]) {
    const mime = EXT_MIME[ext];
    // Legacy .doc is recognized as Word but Atlas has no .doc extractor —
    // mark it unsupported up front so the UI can say so explicitly.
    if (ext === "doc") {
      return {
        kind: "word",
        extension: ext,
        mimeType: mime,
        supported: false,
        reason: "Legacy .doc files aren't supported — save the document as .docx and upload that.",
      };
    }
    return {
      kind: kindForMime(mime),
      extension: ext,
      mimeType: mime,
      supported: kindForMime(mime) !== "unsupported",
      imageKind: IMAGE_KINDS[mime],
    };
  }

  // 2. Known normalized MIME.
  if (normalized && normalized !== "application/octet-stream") {
    const kind = kindForMime(normalized);
    return {
      kind,
      extension: ext,
      mimeType: normalized,
      supported: kind !== "unsupported",
      imageKind: IMAGE_KINDS[normalized],
    };
  }

  // 3. Magic bytes (when bytes are available).
  const sniffed = sniffKind(bytes ?? undefined);
  if (sniffed && sniffed.kind !== "unsupported") {
    return {
      kind: sniffed.kind,
      extension: ext,
      mimeType: sniffed.mimeType,
      supported: true,
      imageKind: IMAGE_KINDS[sniffed.mimeType],
    };
  }

  return {
    kind: "unsupported",
    extension: ext,
    mimeType: normalized || "application/octet-stream",
    supported: false,
    reason: unsupportedReason(ext, normalized),
  };
}

function kindForMime(mime: string): FileKind {
  if (mime === "application/pdf") return "pdf";
  if (mime.includes("wordprocessingml") || mime === "application/msword") return "word";
  if (mime.includes("spreadsheetml") || mime === "application/vnd.ms-excel") return "excel";
  if (mime === "text/csv") return "csv";
  if (mime === "text/markdown") return "markdown";
  if (mime === "message/rfc822") return "email";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/zip" || mime === "application/vnd.rar") return "archive";
  if (mime.startsWith("text/") || mime === "application/json" || mime === "application/xml") {
    return "text";
  }
  return "unsupported";
}

function unsupportedReason(ext: string, mime: string): string {
  if (ext === "doc") {
    return "Legacy .doc files aren't supported — save the document as .docx and upload that.";
  }
  if (ext === "msg") {
    return ".msg email files aren't supported — export the email as .eml or .txt and upload that.";
  }
  if (mime && mime.startsWith("image/")) {
    return "This image format isn't supported yet — try JPEG, PNG, WebP, GIF, BMP or TIFF.";
  }
  if (ext) {
    return `The .${ext} format isn't supported. Supported formats: PDF, Word (.docx), Excel/CSV, images, text/Markdown, email (.eml), and ZIP/RAR archives.`;
  }
  return "This file type isn't supported. Supported formats: PDF, Word (.docx), Excel/CSV, images, text/Markdown, email (.eml), and ZIP/RAR archives.";
}

/** A small human-readable list of the file types the picker should accept. */
export const ACCEPTED_EXTENSIONS =
  ".pdf,.docx,.doc,.xls,.xlsx,.csv,.txt,.md,.markdown,.eml,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tif,.tiff";
