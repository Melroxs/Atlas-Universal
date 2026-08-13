import { describe, expect, it } from "vitest";
import { makePdf } from "./pdf";
import { parseFile } from "@/lib/ingest/parsers";

describe("makePdf — synthetic PDF writer", () => {
  it("produces bytes pdfjs-dist can read (the real production parser)", async () => {
    const bytes = makePdf(
      "Claim GAP-26-51847 — Estimate",
      "NPP Roofing & Restoration\nEstimate for claim GAP-26-51847\nRoof replacement total: $24,500.00\nDeductible: $2,500.00",
    );
    expect(bytes[0]).toBe(0x25); // '%'
    const res = await parseFile("application/pdf", "estimate.pdf", bytes.buffer as ArrayBuffer);
    expect(res.kind).toBe("pdf");
    expect(res.text).toContain("GAP-26-51847");
    expect(res.text).toContain("24,500");
  });
});
