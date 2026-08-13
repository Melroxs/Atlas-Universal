import { describe, expect, it } from "vitest";
import { buildNppDataset, buildNppZip } from "@/lib/npp/dataset";
import { parseFile } from "@/lib/ingest/parsers";
import { analyzeArchive } from "@/lib/archive/engine";

describe("npp dataset sanity", () => {
  it("builds exactly 113 files with the right category mix", async () => {
    const files = await buildNppDataset();
    const byExt = new Map<string, number>();
    for (const f of files) {
      const ext = f.path.split(".").pop()?.toLowerCase() ?? "";
      byExt.set(ext, (byExt.get(ext) ?? 0) + 1);
    }
    expect(files.length).toBe(113);
    expect(byExt.get("pdf")).toBe(48);
    expect((byExt.get("xlsx") ?? 0) + (byExt.get("csv") ?? 0)).toBe(8);
    expect(byExt.get("docx")).toBe(6);
    expect((byExt.get("jpg") ?? 0) + (byExt.get("png") ?? 0)).toBe(41);
    expect((byExt.get("eml") ?? 0) + (byExt.get("txt") ?? 0) + (byExt.get("md") ?? 0)).toBe(10);
  }, 120_000);

  it("parses a generated PDF via the real parser", async () => {
    const files = await buildNppDataset();
    const pdf = files.find((f) => f.path === "Claims/GAP-26-51847/FNOL_Report.pdf")!;
    const bytes = pdf.content instanceof Uint8Array ? pdf.content : new TextEncoder().encode(pdf.content);
    const parsed = await parseFile("application/pdf", pdf.path, bytes.buffer as ArrayBuffer);
    expect(parsed.kind).toBe("pdf");
    expect(parsed.text).toContain("GAP-26-51847");
  }, 60_000);

  it("analyzes the full 113-file zip through the real archive engine", async () => {
    const { bytes, files } = await buildNppZip();
    expect(files.length).toBe(113);
    const analysis = await analyzeArchive({
      name: "NPP_Company_Data.zip",
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.buffer as ArrayBuffer,
    });
    expect(analysis.fileType).toBe("zip");
    expect(analysis.entries.length).toBe(113);
  }, 120_000);
});
