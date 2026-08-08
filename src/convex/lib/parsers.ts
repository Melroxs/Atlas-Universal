"use node";

// File → text extraction. Runs in the Node runtime via the ingestion action.

import mammoth from "mammoth";
// pdf-parse's root index.js runs a debug self-test at import time; the lib
// entry is the pure implementation.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — pdf-parse 1.x ships CommonJS without ESM type declarations
import pdfParse from "pdf-parse/lib/pdf-parse.js";

export interface ParseResult {
  text: string;
  /** Effective mime after inspection (used to pick parsers downstream). */
  mimeType: string;
}

const EXT = (title: string) => title.split(".").pop()?.toLowerCase() ?? "";

/** Extract plain text from a file buffer based on mime type + extension. */
export async function parseFile(
  mimeType: string | undefined,
  title: string,
  bytes: ArrayBuffer,
): Promise<ParseResult> {
  const ext = EXT(title);
  const buf = Buffer.from(bytes);

  const isPdf =
    mimeType?.includes("pdf") || ext === "pdf";
  const isDocx =
    mimeType?.includes("officedocument.wordprocessingml") ||
    ext === "docx";
  const isWord = ext === "doc" && !isDocx;
  const isCsv = mimeType?.includes("csv") || ext === "csv";
  const isExcel = ext === "xlsx" || ext === "xls";
  const isText = /^(text\/|application\/json|application\/xml)/.test(
    mimeType ?? "",
  );

  try {
    if (isPdf) {
      const parsed = await pdfParse(buf);
      return { text: parsed?.text ?? "", mimeType: "application/pdf" };
    }
    if (isDocx) {
      const result = await mammoth.extractRawText({ buffer: buf });
      return { text: result.value ?? "", mimeType: mimeType ?? "docx" };
    }
    if (isWord) {
      throw new Error(
        "Legacy .doc files aren't supported yet — save as .docx or paste the text.",
      );
    }
    if (isExcel) {
      throw new Error(
        ".xlsx/.xls files aren't supported yet — export as CSV and upload that.",
      );
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
    const msg = e instanceof Error ? e.message : String(e);
    if (isPdf) {
      // Scanned/encrypted PDFs have no text layer. Be explicit instead of
      // failing silently — OCR is a later-phase connector capability.
      throw new Error(
        `Couldn't read text from this PDF (${msg}). Scanned PDFs need OCR, which is coming in a later phase.`,
      );
    }
    throw new Error(`Parsing failed: ${msg}`);
  }
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
