import { describe, expect, it } from "vitest";
import { enrichClaimFromEvidence, type EvidenceDocLike } from "./logic";

// Realistic chunk text as produced by the NPP dataset PDFs after extraction.
const ESTIMATE_TEXT = [
  "ESTIMATE — Claim GAP-26-51847",
  "Roof area measured: 32.4 SQ",
  "Line items:",
  "- Tear off and replace asphalt shingles (32.4 SQ)",
  "- Replace roof decking (14 sheets)",
  "Total estimate: $24,500.00",
  "Deductible: $2,500.00",
].join("\n");

const INVOICE_TEXT = [
  "INVOICE — Claim GAP-26-51847",
  "Invoice total: $28,400.00",
  "Terms: Net 30",
].join("\n");

const PAYMENT_TEXT = [
  "CARRIER PAYMENT — Claim GAP-26-51847",
  "Payment amount: $17,920.00",
].join("\n");

const SCOPE_TEXT = [
  "SCOPE OF WORK — Claim GAP-26-51847",
  "Documented scope (estimate + supplement):",
  "1. Roof shingle replacement (32.4 SQ)",
  "2. Roof decking replacement (14 sheets + 6 sheets supplement)",
  "3. Drip edge (142 linear ft)",
  "4. Ridge vent (60 linear ft)",
  "5. Pipe flashing (4 units)",
  "Total documented scope: $31,250.00",
].join("\n");

const docs: EvidenceDocLike[] = [
  { _id: "d1", title: "Estimate_NPP.pdf", classification: "Estimate", text: ESTIMATE_TEXT },
  { _id: "d2", title: "Invoice_10477.pdf", classification: "Invoice", text: INVOICE_TEXT },
  { _id: "d3", title: "Carrier_Payment_60811.pdf", classification: "Payment", text: PAYMENT_TEXT },
  { _id: "d4", title: "Scope_of_Work.pdf", classification: "Scope", text: SCOPE_TEXT },
];

describe("enrichClaimFromEvidence — Phase 15 evidence grounding", () => {
  it("extracts the financial amounts from the evidence documents", () => {
    const enriched = enrichClaimFromEvidence(
      { _id: "claim-1", claimNumber: "GAP-26-51847" },
      docs,
    );
    expect(enriched.estimateAmount).toBe(24500);
    expect(enriched.invoicedAmount).toBe(28400);
    expect(enriched.paymentAmount).toBe(17920);
  });

  it("derives scope line items and evidence categories", () => {
    const enriched = enrichClaimFromEvidence(
      { _id: "claim-1", claimNumber: "GAP-26-51847" },
      docs,
    );
    expect(enriched.expectedScope).toEqual(
      expect.arrayContaining([
        "Roof shingle replacement (32.4 SQ)",
        "Drip edge (142 linear ft)",
        "Ridge vent (60 linear ft)",
        "Pipe flashing (4 units)",
      ]),
    );
    expect(enriched.evidenceSummary).toEqual(
      expect.arrayContaining(["estimate", "invoice", "payment", "scope"]),
    );
  });

  it("never invents values when no evidence text is available", () => {
    const enriched = enrichClaimFromEvidence({ _id: "claim-1" }, []);
    expect(enriched.estimateAmount).toBeNull();
    expect(enriched.invoicedAmount).toBeNull();
    expect(enriched.paymentAmount).toBeNull();
    expect(enriched.evidenceSummary).toEqual([]);
  });

  it("keeps amounts already on the claim (never overwrites with doc values)", () => {
    const enriched = enrichClaimFromEvidence(
      { _id: "claim-1", estimateAmount: 25000 },
      docs,
    );
    expect(enriched.estimateAmount).toBe(25000);
  });
});
