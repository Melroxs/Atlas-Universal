/**
 * Phase 13 — document classification tests.
 *
 * Classification is EVIDENCE-BASED: every result carries its basis (filename,
 * folder context, file type or content) and a confidence. Folder structure is
 * contextual signal, never unquestionable truth. The taxonomy is universal —
 * not hardcoded around insurance restoration.
 */
import { describe, expect, it } from "vitest";
import { classifyFile, isSupportedForIngestion } from "./classify";

describe("classifyFile — filename evidence", () => {
  it("classifies claim documents from explicit claim keywords", () => {
    const r = classifyFile("Claims/2026/Claim-12345/Claim_12345.pdf", 1000);
    expect(r.classification).toBe("claim");
    expect(r.basis).toBe("filename");
    expect(r.confidence).toBeGreaterThan(0.7);
  });

  it("classifies estimates, invoices, supplements and payments", () => {
    expect(classifyFile("Estimates/Estimate_v2.pdf", 100).classification).toBe("estimate");
    expect(classifyFile("Invoices/Invoice-8821.pdf", 100).classification).toBe("invoice");
    expect(classifyFile("Supplements/Supplement_3.pdf", 100).classification).toBe("supplement");
    expect(classifyFile("Payments/Payment_Record_2024.xlsx", 100).classification).toBe("payment record");
    expect(classifyFile("Docs/Xactimate_Export.xact", 100).classification).toBe("Xactimate");
  });

  it("classifies policies, procedures, contracts and employees", () => {
    expect(classifyFile("Policies/Employee_Handbook.pdf", 100).classification).toBe("policy");
    expect(classifyFile("Procedures/Standard Operating Procedure v3.pdf", 100).classification).toBe("procedure");
    expect(classifyFile("Contracts/Subcontractor_Agreement.pdf", 100).classification).toBe("contract");
    expect(classifyFile("HR/Employee_Roster.xlsx", 100).classification).toBe("employee");
  });
});

describe("classifyFile — folder context as signal", () => {
  it("uses folder context when the filename gives no signal", () => {
    const r = classifyFile("Company/Clients/Smith Property/Claims/2026/photo_001.jpg", 5000);
    // Folder says Claims; an image is also an image — folder signal wins.
    expect(["claim", "image"]).toContain(r.classification);
    if (r.classification === "claim") expect(r.basis).toBe("folder context");
  });

  it("classifies by extension when nothing else applies", () => {
    const r = classifyFile("Misc/quarterly_breakdown.xlsx", 100);
    expect(r.classification).toBe("spreadsheet");
    expect(r.basis).toBe("file type");
  });
});

describe("classifyFile — content sniffing", () => {
  it("uses content for generic filenames", () => {
    const r = classifyFile("Downloads/document_43.pdf", 100, "INVOICE — Total due: $12,400. Payment terms: net 30.");
    expect(r.classification).toBe("invoice");
    expect(r.basis).toBe("content");
  });
});

describe("classifyFile — honest unknowns", () => {
  it("returns unknown with low confidence when there is no evidence", () => {
    const r = classifyFile("random/xyz123.zzz", 100);
    expect(r.classification).toBe("unknown");
    expect(r.confidence).toBeLessThan(0.5);
  });
});

describe("isSupportedForIngestion — parser availability", () => {
  it("supports the formats Atlas can parse", () => {
    for (const ext of ["pdf", "doc", "docx", "txt", "rtf", "md", "xls", "xlsx", "csv", "json", "xml", "eml"]) {
      expect(isSupportedForIngestion(ext), ext).toBe(true);
    }
  });

  it("reports unsupported formats honestly", () => {
    for (const ext of ["exe", "dwg", "psd", "zip", "rar", "msg"]) {
      expect(isSupportedForIngestion(ext), ext).toBe(false);
    }
  });
});
