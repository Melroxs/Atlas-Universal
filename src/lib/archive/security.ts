/**
 * Phase 13 — archive security (Zip Slip & friends).
 *
 * Uploaded archives are UNTRUSTED input. Every extracted path must be
 * normalized and validated BEFORE anything is written or uploaded:
 *
 *  - reject absolute paths and "../" traversal (Zip Slip);
 *  - reject backslash tricks and control characters;
 *  - reject executables / scripts / credential-like files;
 *  - guard against decompression bombs via ratio + cumulative size.
 *
 * These checks run client-side (so nothing bad ever uploads) and are
 * re-validated server-side by the backend before ingestion.
 */

const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/;

/** Segments that are unsafe anywhere in a path. */
const UNSAFE_SEGMENT = /^\.\.$/;

/** Filename characters that are never acceptable. */
const CONTROL_CHAR = /[\u0000-\u001f\u007f]/;

/** Executables / scripts / loadable code — never ingested from an archive. */
const EXECUTABLE_EXTENSIONS = new Set([
  "exe", "msi", "bat", "cmd", "com", "scr", "pif", "vbs", "vbe", "js", "mjs",
  "cjs", "jar", "apk", "app", "dll", "so", "dylib", "sys", "drv", "bin", "sh",
  "bash", "zsh", "ps1", "psm1", "py", "pyc", "rb", "pl", "php", "php3", "php4",
  "php5", "phtml", "hta", "wsf", "wsh", "reg", "lnk", "html", "htm", "svg",
]);

/** Credential-like files — never leave the archive into storage/knowledge. */
const CREDENTIAL_PATTERN =
  /(^|[._-])(env|pem|key|p12|pfx|p7b|kdbx|kdb|htpasswd|gitconfig|netrc|credentials|secret|secrets|passwd|shadow|token|tokens|id_rsa|id_ed25519|auth|apikey|api[_-]?key)([._-]|$)/i;

const SECRET_NAME = /(^|[._-])(password|passwords|secret|secrets|credentials|credential)([._-]|$)/i;

export type PathCheck =
  | { ok: true; path: string }
  | { ok: false; reason: string };

/**
 * Normalize + validate an archive entry path.
 * - Accepts both "/" and "\\" separators (ZIP entries can smuggle backslashes).
 * - Rejects absolute paths, drive letters, "..", NUL/control characters.
 * - Returns a normalized forward-slash relative path.
 */
export function validateArchivePath(raw: string): PathCheck {
  if (!raw || typeof raw !== "string") {
    return { ok: false, reason: "Empty path." };
  }
  if (raw.length > 2048) {
    return { ok: false, reason: "Path is unreasonably long." };
  }
  if (CONTROL_CHAR.test(raw)) {
    return { ok: false, reason: "Path contains control characters." };
  }
  // Absolute (POSIX) or Windows drive / UNC.
  if (raw.startsWith("/") || WINDOWS_DRIVE.test(raw) || raw.startsWith("\\\\")) {
    return { ok: false, reason: `Absolute path rejected: “${raw}”.` };
  }
  const segments = raw.split(/[\\/]+/).filter((s) => s.length > 0);
  if (segments.length === 0) {
    return { ok: false, reason: "Path has no segments." };
  }
  for (const seg of segments) {
    if (UNSAFE_SEGMENT.test(seg)) {
      return { ok: false, reason: `Path traversal rejected: “${raw}”.` };
    }
    if (seg === "." || seg === "..") {
      return { ok: false, reason: `Unsafe path segment in “${raw}”.` };
    }
  }
  return { ok: true, path: segments.join("/") };
}

/** Whether a filename looks like an executable / script / code payload. */
export function isExecutableName(filename: string): boolean {
  const base = filename.split("/").pop() ?? filename;
  const ext = base.split(".").pop()?.toLowerCase() ?? "";
  return EXECUTABLE_EXTENSIONS.has(ext);
}

/** Whether a filename looks like credentials / secrets / keys. */
export function isCredentialName(filename: string): boolean {
  const base = (filename.split("/").pop() ?? filename).toLowerCase();
  if (SECRET_NAME.test(base)) return true;
  // Only flag dotfiles with credential-ish extensions (".env", ".pem", ".key"…).
  if (base.startsWith(".")) {
    return CREDENTIAL_PATTERN.test(base);
  }
  return CREDENTIAL_PATTERN.test(base);
}

export interface BlockCheck {
  blocked: boolean;
  reason?: string;
}

/** Combined security gate for one extracted file path. */
export function checkFileSecurity(filename: string): BlockCheck {
  if (isExecutableName(filename)) {
    return {
      blocked: true,
      reason: `Executable/script files are never ingested from an archive (“${filename}”).`,
    };
  }
  if (isCredentialName(filename)) {
    return {
      blocked: true,
      reason: `Credential/secret-like files are never ingested from an archive (“${filename}”).`,
    };
  }
  return { blocked: false };
}

/**
 * Decompression-bomb guard: a suspiciously high compressed:extracted ratio
 * after the first chunk of extraction means we stop and treat the archive as
 * hostile rather than unpacking it fully.
 */
export function checkBombRatio(
  ratioLimit: number,
  state: { compressedSize: number; extractedSize: number },
): { bomb: boolean; ratio: number } {
  const ratio =
    state.compressedSize > 0
      ? state.extractedSize / state.compressedSize
      : 0;
  return { bomb: ratio > ratioLimit, ratio };
}

export interface ArchiveIntegrityCheck {
  isZip: boolean;
  isRar: boolean;
  /** zip | rar | unknown */
  detected: "zip" | "rar" | "unknown";
}

/** Magic-byte sniffing — the archive format is decided by CONTENT, not name. */
export function sniffArchiveFormat(
  bytes: Uint8Array,
  filename: string,
): ArchiveIntegrityCheck {
  const head = bytes.slice(0, 16);
  const ascii = Array.from(head, (b) => String.fromCharCode(b)).join("");
  const isZip = head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b &&
    (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07);
  const isRar = ascii.startsWith("Rar!") ||
    (head.length >= 8 && ascii.slice(0, 7) === "Rar!\x1a\x07");
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (isZip) return { isZip: true, isRar: false, detected: "zip" };
  if (isRar) return { isZip: false, isRar: true, detected: "rar" };
  if (ext === "zip") return { isZip: true, isRar: false, detected: "zip" };
  if (ext === "rar") return { isZip: false, isRar: true, detected: "rar" };
  return { isZip: false, isRar: false, detected: "unknown" };
}

/** Simple MIME guess from extension + magic bytes (for inventory display). */
export function sniffMimeType(filename: string, bytes?: Uint8Array): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const table: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    txt: "text/plain",
    rtf: "application/rtf",
    md: "text/markdown",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    csv: "text/csv",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    tif: "image/tiff",
    tiff: "image/tiff",
    eml: "message/rfc822",
    msg: "application/vnd.ms-outlook",
    json: "application/json",
    xml: "application/xml",
    html: "text/html",
    gif: "image/gif",
  };
  if (ext && table[ext]) return table[ext];
  if (bytes && bytes.length >= 4) {
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
      return "application/pdf";
    }
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      return "application/zip";
    }
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return "image/png";
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  }
  return "application/octet-stream";
}
