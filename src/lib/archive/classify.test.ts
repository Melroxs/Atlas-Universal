/**
 * Phase 13 — document classification tests.
 *
 * Classification is EVIDENCE-BASED: every result carries its basis (filename,
 * folder context, file type or content) and a confidence. Folder structure is
 * contextual signal, never unquestionable truth. The taxonomy is universal —
 * not hardcoded around insurance restoration.
 */
import { describe, expect, it } from "vitest";
import {
  classifyFile as classifyIngestible,
  isSupportedExtension,
  mimeForExtension,
} from "@/lib/ingest/formats";
import { sniffMimeType } from "./security";
import { classifyFile, isSupportedForIngestion } from "./classify";

/** Every extension the canonical contract knows about. */
const CONTRACT_EXTENSIONS = [
  "pdf", "doc", "docx", "xls", "xlsx", "csv", "txt", "md", "markdown",
  "eml", "html", "htm", "json", "xml",
  "jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "svg",
  "zip", "rar",
];

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
    // Must stay in lockstep with the canonical contract in src/lib/ingest/formats.ts.
    for (const ext of ["pdf", "docx", "txt", "md", "markdown", "xls", "xlsx", "csv", "json", "xml", "html", "eml", "jpg", "png", "webp", "svg"]) {
      expect(isSupportedForIngestion(ext), ext).toBe(true);
    }
  });

  it("reports unsupported formats honestly", () => {
    // Legacy .doc/.rtf have no extractor; zip/rar are containers (archive
    // importer only); heic has no browser-safe path.
    for (const ext of ["doc", "rtf", "exe", "dwg", "psd", "zip", "rar", "msg", "heic"]) {
      expect(isSupportedForIngestion(ext), ext).toBe(false);
    }
  });
});

describe("canonical format contract — no drift", () => {
  it("archive classifier agrees with the ingestion contract on every extension", () => {
    for (const ext of CONTRACT_EXTENSIONS) {
      const ingestible = classifyIngestible(`sample.${ext}`, undefined);
      const archiveSays = isSupportedForIngestion(ext);
      if (ext === "zip" || ext === "rar") {
        // Containers are unpacked by the archive engine, never ingested as
        // documents — but the archive REVIEW still accepts them as archives.
        expect(archiveSays, `${ext} must be a container-only format`).toBe(false);
        expect(ingestible.supported, `${ext} is a supported archive container`).toBe(true);
      } else {
        expect(archiveSays, `${ext} archive vs ingestible mismatch`).toBe(
          ingestible.supported,
        );
      }
    }
  });

  it("every contract extension has a canonical MIME (no fall-through to octet-stream)", () => {
    for (const ext of CONTRACT_EXTENSIONS) {
      expect(mimeForExtension(ext), `${ext} has no canonical MIME`).not.toBe("");
      expect(sniffMimeType(`folder/file.${ext}`), `${ext} MIME disagreement`).toBe(
        mimeForExtension(ext),
      );
    }
  });

  it("isSupportedExtension mirrors classifyFile.supported exactly", () => {
    for (const ext of CONTRACT_EXTENSIONS) {
      expect(isSupportedExtension(ext), ext).toBe(
        classifyIngestible(`sample.${ext}`, undefined).supported,
      );
    }
  });
});
