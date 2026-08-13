// ---------------------------------------------------------------------------
// DOCX text extraction — mammoth's official browser distribution.
//
// Production defect this fixes: the old code required a Node `Buffer`:
//
//   if (!buf) throw new Error("Word parsing isn't available in this environment.");
//
// In the deployed browser bundle `Buffer` does not exist, so every .docx
// failed with exactly that error. mammoth's canonical browser build
// (mammoth/mammoth.browser.js) is self-contained and reads a plain
// ArrayBuffer — the same input works in the browser and in Node, so the unit
// tests exercise exactly what ships to production.
// ---------------------------------------------------------------------------

// mammoth.browser.js is a CommonJS bundle without bundled type declarations;
// the ambient module in src/types/mammoth-browser.d.ts types the surface used
// here.
import mammoth from "mammoth/mammoth.browser.js";

/** Extract the plain text of a .docx from its raw bytes. */
export async function extractDocxText(bytes: ArrayBuffer): Promise<string> {
  const result = await mammoth.extractRawText({ arrayBuffer: bytes });
  return (result?.value ?? "").trim();
}
