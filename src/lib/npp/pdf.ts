// ---------------------------------------------------------------------------
// Minimal PDF writer for SYNTHETIC demo data (Phase 15).
//
// Produces a valid single-page text PDF (Helvetica, wrapped lines, correct
// xref) that pdfjs-dist can read. Intentionally tiny and dependency free —
// this is for building the NPP demonstration dataset, not a general PDF
// library.
// ---------------------------------------------------------------------------

function escapePdfText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r/g, "")
    .replace(/\n/g, " ");
}

/** Wrap text into lines of roughly `width` characters (crude, byte-safe). */
function wrap(text: string, width = 92): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n+/)) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      if (line && (line + " " + w).length > width) {
        out.push(line);
        line = w;
      } else {
        line = line ? `${line} ${w}` : w;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/** Build a single-page text PDF and return its bytes. */
export function makePdf(title: string, body: string): Uint8Array {
  const lines = wrap(body);
  const contentLines = ["BT", "/F1 11 Tf", "50 760 Td", "16 TL"];
  contentLines.push(`(${escapePdfText(title)}) Tj`, "T*", "T*");
  for (const line of lines) {
    contentLines.push(`(${escapePdfText(line)}) Tj`, "T*");
  }
  contentLines.push("ET");
  const content = contentLines.join("\n");

  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  objects[3] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>";
  objects[4] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  objects[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefPos = out.length;
  out += `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) {
    out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
