/**
 * Phase 13 — claim reconstruction hint tests.
 *
 * Atlas NEVER merges files into a claim just because they sit in the same
 * folder. It extracts deterministic identifiers (claim numbers, invoice
 * numbers) and only then builds a CLAIM HINT — evidence that may relate to a
 * claim. Creating an actual claim record still requires confirmation.
 */
import { describe, expect, it } from "vitest";
import { aggregateClaimHints, extractClaimHints } from "./claims";

describe("extractClaimHints — filename identifiers", () => {
  it("extracts explicit claim numbers from filenames", () => {
    const { hints } = extractClaimHints("Claims/2026/Claim_12345.pdf");
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0].claimNumber).toBe("12345");
    expect(hints[0].confidence).toBeGreaterThan(0.6);
    expect(hints[0].reasons[0]).toMatch(/claim number/);
  });

  it("extracts claim ids from prefixes like CL/CLM", () => {
    const { hints } = extractClaimHints("Invoices/CL88210044_invoice.pdf");
    expect(hints.some((h) => h.claimNumber === "CL88210044")).toBe(true);
  });

  it("needs supporting context for bare long numbers", () => {
    const plain = extractClaimHints("Misc/12345678.pdf");
    const withContext = extractClaimHints("Claims/12345678_estimate.pdf");
    const plainHint = plain.hints.find((h) => h.claimNumber === "12345678");
    const ctxHint = withContext.hints.find((h) => h.claimNumber === "12345678");
    expect(plainHint?.confidence ?? 0).toBeLessThan(0.5);
    expect(ctxHint?.confidence ?? 0).toBeGreaterThanOrEqual(0.5);
  });
});

describe("extractClaimHints — folder context", () => {
  it("derives a claim id from a claim folder when the filename has none", () => {
    const { hints } = extractClaimHints("Claims/2026/Claim-12345/Photos/photo_001.jpg");
    expect(hints.some((h) => h.claimNumber === "12345")).toBe(true);
  });

  it("records low-confidence context for claim folders without an id", () => {
    const { hints } = extractClaimHints("Company/Claims/photo_001.jpg");
    expect(hints.some((h) => h.claimNumber === "")).toBe(true);
  });

  it("does not invent hints for unrelated paths", () => {
    const { hints } = extractClaimHints("Marketing/Branding/logo.png");
    expect(hints).toHaveLength(0);
  });
});

describe("aggregateClaimHints — evidence across an archive", () => {
  it("groups files that reference the same claim number", () => {
    const paths = [
      "Claims/12345/Claim_12345.pdf",
      "Claims/12345/Estimate_12345.pdf",
      "Claims/12345/Invoice_12345.pdf",
      "Claims/99999/Supplement_99999.pdf",
      "Marketing/logo.png",
    ];
    const agg = aggregateClaimHints(paths);
    const c12345 = agg.find((c) => c.claimNumber === "12345")!;
    expect(c12345.fileCount).toBe(3);
    expect(agg.find((c) => c.claimNumber === "99999")!.fileCount).toBe(1);
    // Nothing invented for unrelated files.
    expect(agg).toHaveLength(2);
  });

  it("groups files inside claim folders even when filenames carry no id", () => {
    const agg = aggregateClaimHints([
      "Claims/10001/estimate.pdf",
      "Claims/10001/invoice.pdf",
      "Claims/10001/photo_001.jpg",
      "Claims/10002/supplement.pdf",
    ]);
    expect(agg.find((c) => c.claimNumber === "10001")!.fileCount).toBe(3);
    expect(agg.find((c) => c.claimNumber === "10002")!.fileCount).toBe(1);
  });

  it("sorts by file count, most evidence first", () => {
    const agg = aggregateClaimHints([
      "Claims/10001/a.pdf",
      "Claims/10001/b.pdf",
      "Claims/10001/c.pdf",
      "Claims/10002/d.pdf",
    ]);
    expect(agg[0].claimNumber).toBe("10001");
  });
});
