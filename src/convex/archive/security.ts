/**
 * Phase 13 — SERVER-SIDE archive security validation.
 *
 * Mirrors src/lib/archive/security.ts. The client checks paths so nothing bad
 * uploads; the SERVER re-checks every path it is handed because uploaded
 * manifests are still untrusted input. Never relax this.
 */

const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/;
const CONTROL_CHAR = /[\u0000-\u001f\u007f]/;

const EXECUTABLE_EXTENSIONS = new Set([
  "exe", "msi", "bat", "cmd", "com", "scr", "pif", "vbs", "vbe", "js", "mjs",
  "cjs", "jar", "apk", "app", "dll", "so", "dylib", "sys", "drv", "bin", "sh",
  "bash", "zsh", "ps1", "psm1", "py", "pyc", "rb", "pl", "php", "php3", "php4",
  "php5", "phtml", "hta", "wsf", "wsh", "reg", "lnk", "html", "htm", "svg",
]);

const SECRET_NAME =
  /(^|[._-])(password|passwords|secret|secrets|credentials|credential)([._-]|$)/i;
const CREDENTIAL_EXT =
  /(^|[._-])(env|pem|key|p12|pfx|p7b|kdbx|kdb|htpasswd|gitconfig|netrc|credentials|secret|secrets|passwd|shadow|token|tokens|id_rsa|id_ed25519|auth|apikey|api[_-]?key)([._-]|$)/i;

export type ServerPathCheck =
  | { ok: true; path: string }
  | { ok: false; reason: string };

export function serverValidatePath(raw: string): ServerPathCheck {
  if (!raw || typeof raw !== "string") {
    return { ok: false, reason: "Empty path." };
  }
  if (raw.length > 2048) return { ok: false, reason: "Path too long." };
  if (CONTROL_CHAR.test(raw)) return { ok: false, reason: "Control characters in path." };
  if (raw.startsWith("/") || WINDOWS_DRIVE.test(raw) || raw.startsWith("\\\\")) {
    return { ok: false, reason: `Absolute path rejected: “${raw}”.` };
  }
  const segments = raw.split(/[\\/]+/).filter((s) => s.length > 0);
  if (segments.length === 0) return { ok: false, reason: "Path has no segments." };
  for (const seg of segments) {
    if (seg === ".." || seg === ".") {
      return { ok: false, reason: `Path traversal rejected: “${raw}”.` };
    }
  }
  return { ok: true, path: segments.join("/") };
}

export function serverCheckFileSecurity(filename: string): {
  blocked: boolean;
  reason?: string;
} {
  const base = (filename.split("/").pop() ?? filename).toLowerCase();
  const ext = base.split(".").pop() ?? "";
  if (EXECUTABLE_EXTENSIONS.has(ext)) {
    return {
      blocked: true,
      reason: `Executable/script files are never ingested from an archive (“${filename}”).`,
    };
  }
  if (SECRET_NAME.test(base) || (base.startsWith(".") && CREDENTIAL_EXT.test(base)) || CREDENTIAL_EXT.test(base)) {
    return {
      blocked: true,
      reason: `Credential/secret-like files are never ingested from an archive (“${filename}”).`,
    };
  }
  return { blocked: false };
}
