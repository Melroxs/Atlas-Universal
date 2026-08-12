"use node";

// File → text extraction. Runs in the Node runtime via the ingestion action.
// All supported formats converge here; every source (manual upload, Google
// Drive, future connectors) feeds the same parser and therefore the same
// normalization pipeline.

import mammoth from "mammoth";
import * as XLSX from "xlsx";
// pdf-parse's root index.js runs a debug self-test at import time; the lib
// entry is the pure implementation.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — pdf-parse 1.x ships CommonJS without ESM type declarations
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { ocrPdf } from "./ocr";

export interface ParseResult {
  text: string;
  /** Effective mime after inspection (used to pick parsers downstream). */
  mimeType: string;
}

/** Thrown when a PDF has no text layer and OCR can't recover it. */
export class ScannedPdfError extends Error {}

const EXT = (title: string) => title.split(".").pop()?.toLowerCase() ?? "";

/** Extract plain text from a file buffer based on mime type + extension. */
export async function parseFile(
  mimeType: string | undefined,
  title: string,
  bytes: ArrayBuffer,
): Promise<ParseResult> {
  const ext = EXT(title);
  const buf = Buffer.from(bytes);

  const isPdf = mimeType?.includes("pdf") || ext === "pdf";
  const isDocx =
    mimeType?.includes("officedocument.wordprocessingml") || ext === "docx";
  const isWord = ext === "doc" && !isDocx;
  const isCsv = mimeType?.includes("csv") || ext === "csv";
  const isExcel = ext === "xlsx" || ext === "xls";
  const isText = /^(text\/|application\/json|application\/xml)/.test(
    mimeType ?? "",
  );

  try {
    if (isPdf) {
      const parsed = await pdfParse(buf);
      const text = parsed?.text ?? "";
      if (text.trim().length < 40) {
        // Likely a scanned PDF with no text layer. Try OCR; if unavailable,
        // fail honestly instead of pretending text was extracted.
        const ocr = await ocrPdf(bytes);
        if (ocr?.text?.trim()) {
          return { text: ocr.text.trim(), mimeType: "application/pdf" };
        }
        throw new ScannedPdfError(
          "This PDF looks scanned (no extractable text layer). OCR isn't configured in this environment yet — save the PDF with a text layer, or paste its content into a text file.",
        );
      }
      return { text, mimeType: "application/pdf" };
    }
    if (isDocx) {
      const result = await mammoth.extractRawText({ buffer: buf });
      const text = (result.value ?? "").trim();
      if (!text) {
        throw new Error("No readable text found in this Word document.");
      }
      return { text, mimeType: mimeType ?? "docx" };
    }
    if (isWord) {
      throw new Error(
        "Legacy .doc files aren't supported yet — save as .docx and upload that.",
      );
    }
    if (isExcel) {
      const text = parseExcelToText(buf, title);
      if (!text.trim()) {
        throw new Error("No readable cells found in this workbook.");
      }
      return {
        text,
        mimeType:
          mimeType ??
          (ext === "xls"
            ? "application/vnd.ms-excel"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
      };
    }
    if (isCsv) {
      const text = buf.toString("utf8");
      return { text: parseCsvToText(text), mimeType: "text/csv" };
    }
    if (isText || ext === "md" || ext === "txt" || ext === "markdown") {
      return {
        text: buf.toString("utf8"),
        mimeType: mimeType ?? "text/plain",
      };
    }
    // Fallback: try utf8 text
    return { text: buf.toString("utf8"), mimeType: mimeType ?? "text/plain" };
  } catch (e) {
    if (e instanceof ScannedPdfError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (isPdf) {
      throw new Error(
        `Couldn't read text from this PDF (${msg}). If it's a scanned document, OCR support is coming soon.`,
      );
    }
    if (isExcel) {
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
function parseExcelToText(buf: Buffer, title: string): string {
  const wb = XLSX.read(buf, { type: "buffer" });
  if (!wb.SheetNames.length) return "";
  const parts: string[] = [];
  let rowsSeen = 0;
  const total = wb.SheetNames.length;

  for (let s = 0; s < total; s++) {
    const sheetName = wb.SheetNames[s];
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
