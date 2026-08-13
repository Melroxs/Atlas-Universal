import { describe, expect, it } from "vitest";
import { classifyFile } from "./formats";

const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_MAGIC = new TextEncoder().encode("%PDF-1.7\n");
const ZIP_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

describe("classifyFile — supported-file contract", () => {
  it("classifies by extension even when the browser MIME lies", () => {
    expect(classifyFile("invoice.xlsx", "application/octet-stream").kind).toBe("excel");
    expect(classifyFile("note.docx", "application/octet-stream").kind).toBe("word");
    expect(classifyFile("scan.pdf", "application/octet-stream").kind).toBe("pdf");
  });

  it("normalizes inconsistent browser MIME values", () => {
    expect(classifyFile("a.xlsx", "application/vnd.ms-excel").kind).toBe("excel");
    expect(classifyFile("a.csv", "application/csv").kind).toBe("csv");
    expect(classifyFile("a.csv", "text/x-csv").kind).toBe("csv");
    expect(classifyFile("a.md", "text/x-markdown").kind).toBe("markdown");
    expect(classifyFile("a.png", "image/x-png").kind).toBe("image");
    expect(classifyFile("a.zip", "application/x-zip-compressed").kind).toBe("archive");
    expect(classifyFile("a.rar", "application/x-rar-compressed").kind).toBe("archive");
    expect(classifyFile("a.jpg", "image/pjpeg").kind).toBe("image");
  });

  it("uses magic bytes when the extension is missing or misleading", () => {
    expect(classifyFile("download", "", PNG_MAGIC).kind).toBe("image");
    expect(classifyFile("file.bin", "application/octet-stream", PDF_MAGIC).kind).toBe("pdf");
    expect(classifyFile("package", "", ZIP_MAGIC).kind).toBe("archive");
  });

  it("handles every supported extension", () => {
    const cases: Array<[string, string]> = [
      ["a.pdf", "pdf"],
      ["a.docx", "word"],
      ["a.xls", "excel"],
      ["a.xlsx", "excel"],
      ["a.csv", "csv"],
      ["a.txt", "text"],
      ["a.md", "markdown"],
      ["a.markdown", "markdown"],
      ["a.eml", "email"],
      ["a.jpg", "image"],
      ["a.jpeg", "image"],
      ["a.png", "image"],
      ["a.webp", "image"],
      ["a.gif", "image"],
      ["a.bmp", "image"],
      ["a.tiff", "image"],
      ["a.zip", "archive"],
      ["a.rar", "archive"],
    ];
    for (const [name, kind] of cases) {
      const info = classifyFile(name, undefined);
      expect(info.kind).toBe(kind);
      expect(info.supported).toBe(true);
    }
  });

  it("marks legacy .doc as word but unsupported with an honest reason", () => {
    const info = classifyFile("legacy.doc", "application/msword");
    expect(info.kind).toBe("word");
    expect(info.supported).toBe(false);
    expect(info.reason).toContain("as .docx");
  });

  it("rejects genuinely unsupported formats explicitly", () => {
    const info = classifyFile("weird.xyz", "application/octet-stream");
    expect(info.kind).toBe("unsupported");
    expect(info.supported).toBe(false);
    expect(info.reason).toContain("isn't supported");
  });

  it("keeps the canonical mime for downstream parsers", () => {
    expect(classifyFile("a.xlsx", "application/octet-stream").mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(classifyFile("a.pdf", undefined).mimeType).toBe("application/pdf");
  });
});
