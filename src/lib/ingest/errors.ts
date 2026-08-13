// ---------------------------------------------------------------------------
// Ingestion error reporting (Phase 15).
//
// Every failure identifies the actual stage, whether the file reached storage,
// whether it can be retried, and what the user should do next. Never a bare
// "Upload failed" when more is known.
// ---------------------------------------------------------------------------

export type IngestionErrorStage =
  | "unsupported_format"
  | "invalid_file"
  | "security_blocked"
  | "upload_failed"
  | "storage_failed"
  | "extraction_failed"
  | "ocr_failed"
  | "parsing_failed"
  | "database_failed"
  | "authorization_failed"
  | "tenant_failed"
  | "processing_failed";

export interface IngestionErrorInfo {
  stage: IngestionErrorStage;
  /** User-facing explanation. */
  message: string;
  /** Whether the file reached tenant storage before failing. */
  stored: boolean;
  /** Whether retrying the same file can succeed. */
  retryable: boolean;
  /** What the user should do next. */
  next: string;
}

export function describeIngestionError(e: unknown): IngestionErrorInfo {
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : String(e ?? "");
  const m = msg.toLowerCase();

  if (e instanceof Error && e.name === "UnsupportedFormatError") {
    return {
      stage: "unsupported_format",
      message: msg,
      stored: false,
      retryable: false,
      next: "Use a supported format, or upload ZIP/RAR packages through Company data archives.",
    };
  }
  if (m.includes("no extractable text layer") || m.includes("looks scanned") || m.includes("ocr isn't configured")) {
    return {
      stage: "ocr_failed",
      message: msg,
      stored: true,
      retryable: true,
      next: "Save the PDF with a text layer (or re-export from the source app) and upload again. OCR is not configured in this environment.",
    };
  }
  if (m.includes("legacy .doc") || m.includes("not supported yet")) {
    return {
      stage: "unsupported_format",
      message: msg,
      stored: false,
      retryable: false,
      next: "Convert the document to a supported format (.docx, PDF, or text) and upload it again.",
    };
  }
  if (m.includes("must be uploaded through the company data archive")) {
    return {
      stage: "unsupported_format",
      message: msg,
      stored: false,
      retryable: false,
      next: "Open Company data archives and use the archive uploader for ZIP/RAR files.",
    };
  }
  if (m.includes("missing from storage") || m.includes("storage")) {
    return {
      stage: "storage_failed",
      message: msg,
      stored: false,
      retryable: true,
      next: "The file could not be stored securely. Check your connection and retry the upload.",
    };
  }
  if (m.includes("must be signed in") || m.includes("invalid api key") || m.includes("401")) {
    return {
      stage: "authorization_failed",
      message: "Your session is no longer valid.",
      stored: false,
      retryable: true,
      next: "Sign in again and retry the upload.",
    };
  }
  if (m.includes("only editors") || m.includes("only managers") || m.includes("permission denied") || m.includes("42501")) {
    return {
      stage: "authorization_failed",
      message: msg,
      stored: false,
      retryable: false,
      next: "Your role cannot upload documents. Ask an owner or manager for access.",
    };
  }
  if (m.includes("could not find the function") || m.includes("pgrst202") || m.includes("schema cache")) {
    return {
      stage: "database_failed",
      message: "Atlas's data service is missing a required function — the application and database schema are out of sync.",
      stored: true,
      retryable: true,
      next: "The deployment needs to be updated. Retry after the next deployment.",
    };
  }
  if (m.includes("no readable text") || m.includes("couldn't read text") || m.includes("couldn't parse this spreadsheet") || m.includes("parsing failed") || m.includes("no readable cells")) {
    return {
      stage: m.includes("couldn't parse this spreadsheet") ? "parsing_failed" : "extraction_failed",
      message: msg,
      stored: true,
      retryable: true,
      next: "The file was stored but its content could not be read. Try exporting it to a simpler format (CSV for spreadsheets, PDF for print) and upload again.",
    };
  }
  if (m.includes("tenant") || m.includes("workspace")) {
    return {
      stage: "tenant_failed",
      message: msg,
      stored: false,
      retryable: true,
      next: "Your workspace could not be resolved. Refresh and try again.",
    };
  }
  if (m.includes("fetch failed") || m.includes("network") || m.includes("socket") || m.includes("timeout")) {
    return {
      stage: "upload_failed",
      message: msg,
      stored: false,
      retryable: true,
      next: "Network error during upload. Check your connection and retry.",
    };
  }
  return {
    stage: "processing_failed",
    message: msg || "The file could not be processed.",
    stored: true,
    retryable: true,
    next: "Review the error and retry the file, or contact support with the message above.",
  };
}
