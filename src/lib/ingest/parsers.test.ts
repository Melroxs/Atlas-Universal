import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { makePdf } from "@/lib/npp/pdf";
import { parseFile, UnsupportedFormatError } from "./parsers";

const txt = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

/** Build a minimal real .docx (zip with word/document.xml) mammoth can read. */
async function makeDocx(title: string, paragraphs: string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  const body = [title, ...paragraphs]
    .map(
      (p) =>
        `<w:p><w:r><w:t xml:space="preserve">${p
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</w:t></w:r></w:p>`,
    )
    .join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

const HERE = dirname(fileURLToPath(import.meta.url));
const parserSource = readFileSync(resolve(HERE, "./parsers.ts"), "utf8");
const pdfSource = readFileSync(resolve(HERE, "./pdf.ts"), "utf8");
const docxSource = readFileSync(resolve(HERE, "./docx.ts"), "utf8");
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0x00, 0x00, 0x00, 0x05, 0x00,
  0x01, 0x5c, 0x9c, 0x6e, 0x67, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
]);

describe("parseFile — canonical parsing", () => {
  it("returns an honest image result — never fabricates text from pixels", async () => {
    const res = await parseFile("image/png", "photo.png", PNG.buffer as ArrayBuffer);
    expect(res.image).toBe(true);
    expect(res.kind).toBe("image");
    expect(res.text).toBe("");
    expect(res.mimeType).toBe("image/png");
  });

  it("parses .eml with normalized metadata preserved", async () => {
    const eml = [
      "From: claims@lonestarmutual.example",
      "To: office@npproofing.example",
      "Subject: Re: Supplement GAP-26-51847",
      "Date: Thu, 2 Apr 2026 09:14:00 -0500",
      "",
      "We received the supplement request for claim GAP-26-51847.",
      "We need the signed authorization before review.",
    ].join("\r\n");
    const res = await parseFile("message/rfc822", "carrier.eml", txt(eml));
    expect(res.kind).toBe("email");
    expect(res.email?.subject).toContain("Supplement GAP-26-51847");
    expect(res.email?.from).toContain("lonestarmutual");
    expect(res.text).toContain("Subject: Re: Supplement GAP-26-51847");
    expect(res.text).toContain("signed authorization");
  });

  it("parses csv with a header line preserved", async () => {
    const csv = "Item,Amount\nRoof,24500\nGutters,3100\n";
    const res = await parseFile("text/csv", "ledger.csv", txt(csv));
    expect(res.kind).toBe("csv");
    expect(res.text).toContain("Columns: Item,Amount");
    expect(res.text).toContain("Roof,24500");
  });

  it("extracts real text from a PDF via pdfjs-dist (no dynamic-require failure)", async () => {
    const bytes = makePdf(
      "Claim GAP-26-51847 — Estimate",
      "NPP Roofing & Restoration\nEstimate for claim GAP-26-51847\nRoof replacement total: $24,500.00\nDeductible: $2,500.00",
    );
    const res = await parseFile(
      "application/pdf",
      "estimate.pdf",
      bytes.buffer as ArrayBuffer,
    );
    expect(res.kind).toBe("pdf");
    expect(res.text).toContain("GAP-26-51847");
    expect(res.text).toContain("24,500");
  }, 30_000);

  it("extracts real text from a .docx via mammoth's browser build (no Buffer needed)", async () => {
    const bytes = await makeDocx("Homeowner authorization letter", [
      "I authorize NPP Roofing & Restoration to perform the work described in the estimate for claim GAP-26-51847.",
      "Signed: [signature pending]",
    ]);
    const res = await parseFile(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Authorization_Letter.docx",
      bytes.buffer as ArrayBuffer,
    );
    expect(res.kind).toBe("word");
    expect(res.text).toContain("Homeowner authorization letter");
    expect(res.text).toContain("GAP-26-51847");
  }, 30_000);

  it("fails honestly for a corrupt PDF (never fabricates text)", async () => {
    await expect(
      parseFile("application/pdf", "broken.pdf", txt("this is not a pdf at all")),
    ).rejects.toThrow(/Couldn't read text from this PDF/);
  });

  it("fails honestly for a corrupt DOCX (never fabricates text)", async () => {
    await expect(
      parseFile(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "broken.docx",
        txt("this is not a docx zip"),
      ),
    ).rejects.toThrow(/Parsing failed/);
  });

  it("extracts a spreadsheet from raw bytes without a Node Buffer", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Claim", "Amount"],
      ["GAP-26-51847", 17920],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Payments");
    const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const res = await parseFile(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "ledger.xlsx",
      out,
    );
    expect(res.kind).toBe("excel");
    expect(res.text).toContain("GAP-26-51847");
    expect(res.text).toContain("17920");
  }, 30_000);

  it("throws UnsupportedFormatError for legacy .doc", async () => {
    await expect(
      parseFile("application/msword", "old.doc", txt("nothing")),
    ).rejects.toThrow(UnsupportedFormatError);
  });

  it("throws UnsupportedFormatError for archives uploaded as documents", async () => {
    await expect(
      parseFile("application/zip", "pkg.zip", txt("PK\u0003\u0004junk")),
    ).rejects.toThrow(/archive importer/);
  });

  it("throws UnsupportedFormatError for unknown formats", async () => {
    await expect(
      parseFile("application/octet-stream", "weird.xyz", txt("data")),
    ).rejects.toThrow(UnsupportedFormatError);
  });
});

describe("parser source — production-bundle safety guards", () => {
  it("never imports the Node-only pdf-parse (the dynamic-require defect)", () => {
    // No import/require of the Node pdf-parse package, and no runtime
    // require() at all — the exact shape of the old failure was a dynamic
    // require of a path the bundler never saw. Comments are stripped so the
    // guard checks CODE only.
    const codeOnly = parserSource
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(codeOnly).not.toMatch(/from ["']pdf-parse/);
    expect(codeOnly).not.toMatch(/[^.\w]require\(/);
    expect(pdfSource).toContain("pdfjs-dist");
  });

  it("never depends on a Node Buffer for DOCX parsing (the 'Word parsing isn't available' defect)", () => {
    expect(docxSource).toContain("arrayBuffer");
    expect(parserSource).not.toMatch(/Buffer\.(from|alloc|isBuffer)/);
    expect(parserSource).not.toMatch(/typeof Buffer/);
    // The old code threw this exact error when Buffer was undefined in the
    // browser — the new code must never throw it.
    expect(parserSource).not.toMatch(/throw new Error\(["']Word parsing isn't available/);
  });

  it("declares PDF and DOCX extractors that accept a plain ArrayBuffer", () => {
    expect(pdfSource).toMatch(/export async function extractPdfText\(bytes: ArrayBuffer\)/);
    expect(docxSource).toMatch(/export async function extractDocxText\(bytes: ArrayBuffer\)/);
  });
});
