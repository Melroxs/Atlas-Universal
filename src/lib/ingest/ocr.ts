"use node";

// ---------------------------------------------------------------------------
// OCR abstraction.
//
// Scanned PDFs and images have no text layer. The pipeline detects that case
// and asks this module for OCR. No OCR engine is configured in the current
// environment, so these functions return null and callers surface a clear,
// honest "scanned content needs OCR" state instead of pretending text was
// extracted. To enable OCR later, wire an engine here (e.g. Tesseract via a
// hosted API) — no pipeline changes required.
// ---------------------------------------------------------------------------

export const OCR_AVAILABLE = false;

/** Attempt OCR on an image buffer. Returns null when no engine is available. */
export async function ocrImage(
  _bytes: ArrayBuffer,
  _mimeType?: string,
): Promise<{ text: string } | null> {
  return null;
}

/** Attempt OCR on a scanned PDF buffer. Returns null when unavailable. */
export async function ocrPdf(_bytes: ArrayBuffer): Promise<{ text: string } | null> {
  return null;
}
