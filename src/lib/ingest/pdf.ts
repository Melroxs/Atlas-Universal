// ---------------------------------------------------------------------------
// PDF text extraction — pdfjs-dist (browser-safe).
//
// Production defect this fixes: the previous parser (pdf-parse) is a Node
// library that dynamically require()s an internal copy of pdf.js at runtime:
//
//   Could not dynamically require "./pdf.js/v1.10.100/build/pdf.js"
//
// A runtime require() of a path the bundler never saw cannot survive Vite's
// production bundle, so in the deployed browser every PDF failed with that
// error even though the same code passed in Node tests.
//
// This module uses pdfjs-dist — the ESM PDF engine Firefox ships — which
// Vite bundles natively. The LEGACY build is used so the exact same module
// runs in the browser and in Node (unit tests): the main build references
// browser-only globals (DOMMatrix) at module scope and is not usable under
// Node. The worker script is emitted as a static asset via the
// `new URL(..., import.meta.url)` pattern and handed to pdf.js through
// GlobalWorkerOptions.workerSrc. In Node pdf.js runs on the main thread
// without a worker, and if the browser worker ever fails to load pdf.js
// automatically falls back to main-thread execution — text extraction never
// depends on a fragile runtime require().
// ---------------------------------------------------------------------------

import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

let workerConfigured = false;

function isNodeRuntime(): boolean {
  return (
    typeof process !== "undefined" &&
    typeof process.versions !== "undefined" &&
    !!process.versions.node
  );
}

/** Point pdf.js at the bundled worker asset. Safe to call repeatedly. */
function ensurePdfWorker(): void {
  if (workerConfigured) return;
  workerConfigured = true;
  // Node (unit tests): pdf.js detects isNodeJS, disables the worker and
  // resolves its own worker module relative to the package — overriding
  // workerSrc with a Vite asset URL would break that resolution.
  if (isNodeRuntime()) return;
  try {
    // Browser: Vite statically rewrites this literal to the hashed asset it
    // emits for the worker file, so workerSrc points at a real same-origin
    // module. If that worker ever fails to load, pdf.js automatically falls
    // back to main-thread execution (the fake worker imports the same URL).
    GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  } catch {
    // Keep pdf.js' default resolution if URL construction is unavailable.
  }
}

/**
 * Extract the text layer of a PDF. Returns "" when the PDF has no text layer
 * (scanned documents) so callers can decide whether OCR applies — this
 * function never fabricates content. Throws for corrupt/unreadable PDFs.
 */
export async function extractPdfText(bytes: ArrayBuffer): Promise<string> {
  ensurePdfWorker();
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const task = getDocument({
    data,
    // Buffers are supplied locally — never touch the network layer.
    useWorkerFetch: false,
  });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      try {
        const content = await page.getTextContent();
        let line = "";
        for (const item of content.items) {
          if (typeof (item as { str?: unknown }).str !== "string") continue;
          const { str, hasEOL } = item as { str: string; hasEOL: boolean };
          line += str;
          if (hasEOL) {
            if (line.trim()) pages.push(line.trim());
            line = "";
          } else {
            line += " ";
          }
        }
        if (line.trim()) pages.push(line.trim());
      } finally {
        page.cleanup();
      }
    }
    return pages.join("\n").trim();
  } finally {
    // Destroying the loading task tears down the worker + frees the buffer.
    await task.destroy();
  }
}
