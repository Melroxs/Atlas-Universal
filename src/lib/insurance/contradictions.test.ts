// ---------------------------------------------------------------------------
// Tests for the Contradiction Engine (canonical module:
// supabase/functions/conversation-converse/source/contradictions.ts).
//
// The MANDATORY contradiction test (§43): evidence containing 32.4 SQ (carrier
// estimate) and 28.7 SQ (inspection) must produce a contradiction that cites
// BOTH sources and never silently picks one.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  compareClaimAgainstDocuments,
  scanDocumentsForContradictions,
  type ContradictionDoc,
} from "../../../supabase/functions/conversation-converse/source/contradictions.ts";

const ESTIMATE_TEXT = [
  "ESTIMATE — Claim GAP-26-51847",
  "Roof area measured: 32.4 SQ",
  "Total estimate: $24,500.00",
  "Deductible: $2,500.00",
].join("\n");

const INSPECTION_TEXT = [
  "INSPECTION REPORT — Claim GAP-26-51847",
  "Roof area: 28.7 SQ",
].join("\n");

const INVOICE_TEXT = [
  "INVOICE — Claim GAP-26-51847",
  "Invoice total: $28,400.00",
].join("\n");

const PAYMENT_TEXT = [
  "CARRIER PAYMENT — Claim GAP-26-51847",
  "Payment amount: $17,920.00",
].join("\n");

function doc(title: string, classification: string, text: string): ContradictionDoc {
  return { _id: `d-${title}`, title, classification, text };
}

describe("scanDocumentsForContradictions", () => {
  it("detects the 32.4 SQ vs 28.7 SQ roof-area contradiction and cites both sources (§43)", () => {
    const hits = scanDocumentsForContradictions([
      doc("Estimate_NPP.pdf", "Estimate", ESTIMATE_TEXT),
      doc("Inspection_NPP.pdf", "Inspection", INSPECTION_TEXT),
    ]);
    const roof = hits.find((h) => h.field === "Roof area (SQ)");
    expect(roof).toBeDefined();
    expect(roof?.claim).toBe("GAP-26-51847");
    expect(roof?.kind).toBe("quantity");
    expect(roof?.values.map((v) => v.value).sort()).toEqual(["28.7 SQ", "32.4 SQ"]);
    expect(roof?.values.some((v) => v.documentTitle.includes("Estimate"))).toBe(true);
    expect(roof?.values.some((v) => v.documentTitle.includes("Inspection"))).toBe(true);
    expect(roof?.severity).toBe("HIGH");
    expect(roof?.detail).toContain("28.7 SQ");
    expect(roof?.detail).toContain("32.4 SQ");
    // Both sources are preserved — the engine never picks a winner.
    expect(roof?.detail).toMatch(/reconcile/i);
  });

  it("detects estimate vs invoice amount contradiction with the difference", () => {
    const hits = scanDocumentsForContradictions([
      doc("Estimate_NPP.pdf", "Estimate", ESTIMATE_TEXT),
      doc("Invoice_10477.pdf", "Invoice", INVOICE_TEXT),
    ]);
    const cross = hits.find((h) => h.field === "Estimate vs invoice");
    expect(cross).toBeDefined();
    expect(cross?.severity).toBe("HIGH");
    expect(cross?.detail).toContain("$3,900");
    expect(cross?.detail).toContain("14%"); // 3900 / larger (28400)
  });

  it("does not flag equal values as a contradiction", () => {
    const hits = scanDocumentsForContradictions([
      doc("Payment_1.pdf", "Payment", "Claim GAP-26-51847. Payment amount: $17,920.00."),
      doc("Payment_2.pdf", "Payment", "Claim GAP-26-51847. Payment amount: $17,920.00."),
    ]);
    expect(hits).toHaveLength(0);
  });

  it("groups values by claim so unrelated claims never conflict", () => {
    const hits = scanDocumentsForContradictions([
      doc("Claim_AAA.pdf", "Estimate", "Claim AAA-26-1000. Roof area: 30.0 SQ."),
      doc("Claim_BBB.pdf", "Inspection", "Claim BBB-26-2000. Roof area: 28.0 SQ."),
    ]);
    expect(hits).toHaveLength(0);
  });

  it("dedupes repeated identical values inside one document", () => {
    const hits = scanDocumentsForContradictions([
      doc("Estimate_NPP.pdf", "Estimate", [ESTIMATE_TEXT, "Roof area: 32.4 SQ"].join("\n")),
      doc("Inspection_NPP.pdf", "Inspection", INSPECTION_TEXT),
    ]);
    const roof = hits.find((h) => h.field === "Roof area (SQ)");
    expect(roof?.values).toHaveLength(2);
  });

  it("sorts contradictions by severity (HIGH first)", () => {
    const hits = scanDocumentsForContradictions([
      doc("Estimate_NPP.pdf", "Estimate", ESTIMATE_TEXT),
      doc("Inspection_NPP.pdf", "Inspection", INSPECTION_TEXT),
      doc("Invoice_10477.pdf", "Invoice", INVOICE_TEXT),
    ]);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[0]?.severity).toBe("HIGH");
  });
});

describe("compareClaimAgainstDocuments — claim record vs evidence", () => {
  it("flags a claim payment amount that differs from the payment document", () => {
    const hits = compareClaimAgainstDocuments(
      {
        claimNumber: "GAP-26-51847",
        paymentAmount: 12500,
      },
      [
        doc("Carrier_Payment_60811.pdf", "Payment", PAYMENT_TEXT),
      ],
    );
    const payment = hits.find((h) => h.field.includes("Payment amount"));
    expect(payment).toBeDefined();
    expect(payment?.values[0]?.documentTitle).toBe("Claim record");
    expect(payment?.values[1]?.documentTitle).toBe("Carrier_Payment_60811.pdf");
  });

  it("does not flag when claim and document agree", () => {
    const hits = compareClaimAgainstDocuments(
      {
        claimNumber: "GAP-26-51847",
        estimateAmount: 24500,
      },
      [
        doc("Estimate_NPP.pdf", "Estimate", ESTIMATE_TEXT),
      ],
    );
    expect(hits).toHaveLength(0);
  });

  it("flags a deductible mismatch between the claim and the policy/estimate", () => {
    const hits = compareClaimAgainstDocuments(
      {
        claimNumber: "GAP-26-51847",
        deductible: 1000,
      },
      [
        doc("Estimate_NPP.pdf", "Estimate", ESTIMATE_TEXT),
      ],
    );
    const d = hits.find((h) => h.field.includes("Deductible"));
    expect(d).toBeDefined();
    expect(d?.values.map((v) => v.value)).toContain("$2,500");
  });
});
