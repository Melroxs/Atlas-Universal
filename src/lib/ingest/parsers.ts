// ---------------------------------------------------------------------------
// File → text extraction. Runs in the BROWSER runtime (client-side ingestion
// via src/lib/actions/ingestion.ts + archive.ts), so every extractor here
// must be bundleable by Vite — no Node-only require() calls, no Node Buffer
// APIs, no fs access.
//
// All supported formats converge here; every source (manual upload, archive,
// future connectors) feeds the same parser and therefore the same
// normalization pipeline. Detection goes through the canonical format
// contract in ./formats — extension, normalized MIME and magic bytes.
//
// Production defects this file fixed:
//   - PDF used pdf-parse (a Node library) whose dynamic require() of its
//     internal pdf.js could not survive the Vite bundle ("Could not
//     dynamically require ./pdf.js/..."). PDFs now go through pdfjs-dist
//     (src/lib/ingest/pdf.ts).
//   - DOCX required a Node Buffer ("Word parsing isn't available in this
//     environment"). DOCX now goes through mammoth's browser build with a
//     plain ArrayBuffer (src/lib/ingest/docx.ts).
//   - XLSX required a Buffer as well; XLSX.read now consumes the raw
//     Uint8Array directly.
// ---------------------------------------------------------------------------

import * as XLSX from "xlsx";
import { extractPdfText } from "./pdf";
import { extractDocxText } from "./docx";
import { ocrPdf } from "./ocr";
import { classifyFile, type FileKind } from "./formats";

export interface ParseResult {
  text: string;
  /** Effective mime after inspection (used to pick parsers downstream). */
  mimeType: string;
  /** Canonical file kind from the format contract. */
  kind: FileKind;
  /** True for image files — no text content, evidence representation only. */
  image?: boolean;
  /** Normalized email metadata when the file is an .eml. */
  email?: { subject?: string; from?: string; to?: string; date?: string };
}

/** Thrown when a PDF has no text layer and OCR can't recover it. */
export class ScannedPdfError extends Error {}

/** Thrown when the format contract says the file is not supported. */
export class UnsupportedFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedFormatError";
  }
}

/** Extract plain text from a file buffer based on the format contract. */
function decodeUtf8(bytes: ArrayBuffer): string {
  return new TextDecoder("utf-8").decode(bytes);
}

export async function parseFile(
  mimeType: string | undefined,
  title: string,
  bytes: ArrayBuffer,
): Promise<ParseResult> {
  const info = classifyFile(title, mimeType, bytes);

  // Images: never pretend binary pixels are text. The ingestion core stores
  // them as evidence with an honest content-extraction state.
  if (info.kind === "image") {
    return {
      text: "",
      mimeType: info.mimeType,
      kind: "image",
      image: true,
    };
  }

  if (!info.supported) {
    throw new UnsupportedFormatError(
      info.reason ?? "This file format isn't supported by Atlas.",
    );
  }

  try {
    if (info.kind === "pdf") {
      const text = (await extractPdfText(bytes)).trim();
      if (text.length < 40) {
        // Likely a scanned PDF with no text layer. Try OCR; if unavailable,
        // fail honestly instead of pretending text was extracted.
        const ocr = await ocrPdf(bytes);
        if (ocr?.text?.trim()) {
          return { text: ocr.text.trim(), mimeType: "application/pdf", kind: "pdf" };
        }
        throw new ScannedPdfError(
          "This PDF looks scanned (no extractable text layer). OCR isn't configured in this environment yet — save the PDF with a text layer, or paste its content into a text file.",
        );
      }
      return { text, mimeType: "application/pdf", kind: "pdf" };
    }
    if (info.kind === "word") {
      if (info.extension === "doc") {
        throw new UnsupportedFormatError(
          "Legacy .doc files aren't supported yet — save as .docx and upload that.",
        );
      }
      const text = await extractDocxText(bytes);
      if (!text) {
        throw new Error("No readable text found in this Word document.");
      }
      return {
        text,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        kind: "word",
      };
    }
    if (info.kind === "excel") {
      const text = parseExcelToText(bytes, title);
      if (!text.trim()) {
        throw new Error("No readable cells found in this workbook.");
      }
      return { text, mimeType: info.mimeType, kind: "excel" };
    }
    if (info.kind === "csv") {
      return {
        text: parseCsvToText(decodeUtf8(bytes)),
        mimeType: "text/csv",
        kind: "csv",
      };
    }
    if (info.kind === "email") {
      const eml = parseEml(decodeUtf8(bytes), title);
      if (!eml.body.trim()) {
        throw new Error("No readable message body found in this email file.");
      }
      return {
        text: eml.body,
        mimeType: "message/rfc822",
        kind: "email",
        email: eml.meta,
      };
    }
    if (info.kind === "text" || info.kind === "markdown") {
      return {
        text: decodeUtf8(bytes),
        mimeType: info.mimeType,
        kind: info.kind,
      };
    }
    if (info.kind === "archive") {
      throw new UnsupportedFormatError(
        "ZIP/RAR archives must be uploaded through the Company data archive importer, not as individual documents.",
      );
    }
    // Defensive: the contract should have marked this unsupported.
    throw new UnsupportedFormatError(
      info.reason ?? "This file format isn't supported by Atlas.",
    );
  } catch (e) {
    if (e instanceof ScannedPdfError || e instanceof UnsupportedFormatError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (info.kind === "pdf") {
      throw new Error(
        `Couldn't read text from this PDF (${msg}). If it's a scanned document, OCR support is coming soon.`,
      );
    }
    if (info.kind === "excel") {
      throw new Error(
        `Couldn't parse this spreadsheet (${msg}). Export a CSV version and upload that if it keeps failing.`,
      );
    }
    throw new Error(`Parsing failed: ${msg}`);
  }
}

/**
 * Spreadsheet → normalized text. Every sheet becomes a section with its own
 * name (preserved for provenance), a header row, then up to 400 data rows.
 * This keeps tables queryable for search, entity extraction and reasoning.
 */
function parseExcelToText(bytes: ArrayBuffer, title: string): string {
  // { type: "array" } accepts the raw Uint8Array in both the browser and
  // Node — no Buffer required.
  const wb = XLSX.read(new Uint8Array(bytes), { type: "array" });
  if (!wb.SheetNames.length) return "";
  const parts: string[] = [];
  let rowsSeen = 0;

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
    }) as unknown[][];
    if (!rows.length) continue;

    const header = (rows[0] ?? [])
      .map(String)
      .map((c) => c.trim())
      .filter(Boolean);
    parts.push(`Sheet "${sheetName}" of "${title}":`);
    parts.push(
      `Columns: ${header.length ? header.join(", ") : "(unnamed columns)"}`,
    );
    for (const row of rows.slice(1, 401)) {
      const cells = row
        .map(String)
        .map((c) => c.trim())
        .filter(Boolean)
        .join(" | ");
      if (cells) parts.push(`Row ${rowsSeen + 2}: ${cells}`);
      rowsSeen++;
    }
    parts.push("");
  }

  return parts.join("\n").slice(0, 120_000);
}

/** Turn CSV rows into readable text so chunking + extraction can use it. */
function parseCsvToText(raw: string): string {
  const rows = raw
    .split(/\r?\n/)
    .map((r) => r.trim())
    .filter(Boolean);
  if (rows.length === 0) return "";
  const header = rows[0];
  const body = rows.slice(1);
  const lines: string[] = [`CSV import. Columns: ${header}`];
  for (const row of body.slice(0, 500)) {
    lines.push(row);
  }
  return lines.join("\n");
}

/**
 * Minimal .eml parsing: headers (From/To/Subject/Date) become a metadata
 * prefix on the body so the knowledge base keeps provenance without leaking
 * anything beyond the message itself.
 */
function parseEml(raw: string, title: string): { body: string; meta: { subject?: string; from?: string; to?: string; date?: string } } {
  const lines = raw.split(/\r?\n/);
  const headers: Record<string, string> = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      i++; // blank line separates headers from body
      break;
    }
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim().toLowerCase();
      const value = line.slice(idx + 1).trim();
      if (!headers[key]) headers[key] = value;
    }
  }
  const body = lines
    .slice(i)
    .join("\n")
    .trim()
    .slice(0, 100_000);
  const meta = {
    subject: headers.subject || undefined,
    from: headers.from || undefined,
    to: headers.to || undefined,
    date: headers.date || undefined,
  };
  const prefix = [
    meta.subject ? `Subject: ${meta.subject}` : null,
    meta.from ? `From: ${meta.from}` : null,
    meta.to ? `To: ${meta.to}` : null,
    meta.date ? `Date: ${meta.date}` : null,
  ].filter(Boolean);
  const text = prefix.length
    ? `${prefix.join("\n")}\n\n${body}`
    : body;
  return { body: text, meta };
}
