/**
 * Phase 13 — archive security tests.
 *
 * Uploaded archives are UNTRUSTED. These tests pin the guarantees that keep
 * malicious archives from ever reaching storage or knowledge:
 *  - Zip Slip ("../" traversal) is rejected;
 *  - absolute paths, drive letters and UNC paths are rejected;
 *  - control characters and empty paths are rejected;
 *  - executables/scripts and credential-like files are blocked;
 *  - decompression-bomb ratios are detected;
 *  - format is decided by content (magic bytes), not the filename.
 */
import { describe, expect, it } from "vitest";
import {
  checkBombRatio,
  checkFileSecurity,
  isCredentialName,
  isExecutableName,
  sniffArchiveFormat,
  validateArchivePath,
} from "./security";

describe("validateArchivePath — Zip Slip & path safety", () => {
  it("accepts normal relative paths and normalizes separators", () => {
    const r = validateArchivePath("Clients/ABC/Claims/12345/estimate.pdf");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.path).toBe("Clients/ABC/Claims/12345/estimate.pdf");
    // Backslash separators are normalized (ZIP entries can smuggle them).
    const w = validateArchivePath("Clients\\ABC\\estimate.pdf");
    expect(w.ok).toBe(true);
    if (w.ok) expect(w.path).toBe("Clients/ABC/estimate.pdf");
  });

  it("rejects ../ traversal (Zip Slip)", () => {
    for (const p of [
      "../evil.sh",
      "a/../../etc/passwd",
      "..\\evil.exe",
      "Claims/../../../etc/shadow",
      "....//....//etc/passwd".replace("....//....//", "../"),
    ]) {
      const r = validateArchivePath(p);
      if (p.includes("../") || p.includes("..\\")) {
        expect(r.ok).toBe(false);
      }
    }
    expect(validateArchivePath("../evil.sh").ok).toBe(false);
    expect(validateArchivePath("a/../../etc/passwd").ok).toBe(false);
    expect(validateArchivePath("..\\evil.exe").ok).toBe(false);
  });

  it("rejects absolute and drive-letter paths", () => {
    expect(validateArchivePath("/etc/passwd").ok).toBe(false);
    expect(validateArchivePath("C:\\Windows\\system32\\cmd.exe").ok).toBe(false);
    expect(validateArchivePath("c:/temp/evil.exe").ok).toBe(false);
    expect(validateArchivePath("\\\\server\\share\\evil.exe").ok).toBe(false);
  });

  it("rejects empty paths and control characters", () => {
    expect(validateArchivePath("").ok).toBe(false);
    expect(validateArchivePath("a\u0000b.txt").ok).toBe(false);
    expect(validateArchivePath("a\u001fb.txt").ok).toBe(false);
  });
});

describe("executable / script / credential blocking", () => {
  it("blocks executables, scripts and loadable code", () => {
    for (const name of [
      "payload.exe",
      "setup.msi",
      "run.bat",
      "evil.sh",
      "malware.py",
      "hook.dll",
      "script.js",
      "page.html",
      "vector.svg",
      "exploit.php",
    ]) {
      expect(isExecutableName(name), name).toBe(true);
      expect(checkFileSecurity(name).blocked, name).toBe(true);
    }
  });

  it("allows ordinary business documents", () => {
    for (const name of [
      "estimate.pdf",
      "invoice.xlsx",
      "notes.txt",
      "claims.csv",
      "photo.jpg",
      "policy.docx",
      "contract.eml",
    ]) {
      expect(isExecutableName(name), name).toBe(false);
      expect(checkFileSecurity(name).blocked, name).toBe(false);
    }
  });

  it("blocks credential/secret-like files", () => {
    for (const name of [
      ".env",
      "credentials.json",
      "aws_credentials",
      "id_rsa",
      "secret.pem",
      "prod.key",
      "passwords.txt",
      ".netrc",
      "tokens.yaml",
    ]) {
      expect(isCredentialName(name), name).toBe(true);
      expect(checkFileSecurity(name).blocked, name).toBe(true);
    }
  });
});

describe("decompression-bomb ratio guard", () => {
  it("flags suspicious compression ratios and allows normal ones", () => {
    const bomb = checkBombRatio(200, { compressedSize: 1024, extractedSize: 1024 * 1024 * 10 });
    expect(bomb.bomb).toBe(true);
    expect(bomb.ratio).toBe(10240);
    const normal = checkBombRatio(200, { compressedSize: 1024, extractedSize: 4096 });
    expect(normal.bomb).toBe(false);
  });

  it("handles a zero compressed size without dividing by zero", () => {
    expect(checkBombRatio(200, { compressedSize: 0, extractedSize: 500 }).bomb).toBe(false);
  });
});

describe("archive format sniffing (content decides, not the name)", () => {
  it("detects ZIP by magic bytes even with a misleading name", () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    expect(sniffArchiveFormat(zip, "data.pdf").detected).toBe("zip");
  });

  it("detects RAR by magic bytes even with a misleading name", () => {
    const rar = new TextEncoder().encode("Rar!\x1a\x07\x01\x00");
    expect(sniffArchiveFormat(rar, "data.zip").detected).toBe("rar");
  });

  it("falls back to extension when magic bytes are inconclusive", () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5]);
    expect(sniffArchiveFormat(junk, "x.zip").detected).toBe("zip");
    expect(sniffArchiveFormat(junk, "x.rar").detected).toBe("rar");
    expect(sniffArchiveFormat(junk, "x.bin").detected).toBe("unknown");
  });
});
