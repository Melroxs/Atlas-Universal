import { describe, expect, it } from "vitest";
import {
  CLAIM_BASELINE,
  CLAIM_EVIDENCE_CATEGORIES,
  CLAIM_LIFECYCLE,
  analyzeRecoveryOpportunities,
} from "./insurance";

describe("generalized claim lifecycle", () => {
  it("models the full 17-stage lifecycle from loss to revenue reconciliation", () => {
    const stages = CLAIM_LIFECYCLE.map((s) => s.stage);
    expect(stages[0]).toBe("Lead / Loss");
    expect(stages[stages.length - 1]).toBe("Revenue reconciliation");
    for (const expected of [
      "FNOL",
      "Coverage / Claim",
      "Inspection",
      "Documentation",
      "Estimate",
      "Scope comparison",
      "Carrier review",
      "Supplement identification",
      "Supplement preparation",
      "Submission",
      "Carrier response",
      "Negotiation / revision",
      "Approval",
      "Work completion",
      "Final billing",
    ]) {
      expect(stages).toContain(expected);
    }
  });

  it("documents typical inputs and outputs per stage", () => {
    const estimate = CLAIM_LIFECYCLE.find((s) => s.stage === "Estimate");
    expect(estimate?.typicalInputs).toContain("Scope of work");
    expect(estimate?.typicalOutputs).toContain("Estimate");
    const supplement = CLAIM_LIFECYCLE.find((s) => s.stage === "Supplement preparation");
    expect(supplement?.typicalInputs).toContain("Evidence");
  });
});

describe("claim evidence model", () => {
  it("covers the five evidence categories", () => {
    const keys = CLAIM_EVIDENCE_CATEGORIES.map((c) => c.key);
    expect(keys).toEqual(["damage", "scope", "quantity", "pricing", "necessity"]);
  });

  it("never presents examples as universal requirements", () => {
    for (const c of CLAIM_EVIDENCE_CATEGORIES) {
      expect(c.examples.length).toBeGreaterThan(0);
      expect(c.note).toMatch(/not a fixed list|varies|commonly|should|Note/i);
    }
  });
});

describe("claim knowledge baseline", () => {
  it("exists before any customer-uploaded claim", () => {
    expect(CLAIM_BASELINE.entities).toEqual(
      expect.arrayContaining(["claim", "carrier", "adjuster", "estimate", "supplement", "recoverable depreciation"]),
    );
    expect(CLAIM_BASELINE.workflows).toContain("FNOL");
    expect(CLAIM_BASELINE.evidenceExpectations.damage).toContain("Photographs");
    expect(CLAIM_BASELINE.regulatoryContext).toContain("never presents unverified guidance as law");
    expect(CLAIM_BASELINE.companySpecific).toContain("tenant-scoped");
  });

  it("distinguishes domain knowledge, organization knowledge and evidence", () => {
    expect(CLAIM_BASELINE.knowledgeKinds.domain[0]).toContain("generally");
    expect(CLAIM_BASELINE.knowledgeKinds.organization[0]).toContain("only ever asserted from actual records");
    expect(CLAIM_BASELINE.knowledgeKinds.evidence[0]).toContain("proves organization-specific facts");
  });
});

describe("revenue recovery intelligence", () => {
  it("detects missing scope", () => {
    const r = analyzeRecoveryOpportunities({
      expectedScope: ["demo", "drywall"],
      actualScope: ["demo", "drywall", "flooring", "paint"],
    });
    const hit = r.find((o) => o.type === "missing_scope");
    expect(hit).toBeTruthy();
    expect(hit?.severity).toBe("high");
    expect(hit?.evidence.join(" ")).toContain("flooring");
    expect(hit?.confidence).toBeLessThan(1);
    expect(hit?.limitation.length).toBeGreaterThan(10);
  });

  it("flags documentation gaps against expected evidence categories", () => {
    const r = analyzeRecoveryOpportunities({ evidenceSummary: [] });
    const hit = r.find((o) => o.type === "documentation_gap");
    expect(hit).toBeTruthy();
    expect(hit?.evidence.join(" ")).toContain("damage");
  });

  it("flags potential underpayment without guaranteeing recovery", () => {
    const r = analyzeRecoveryOpportunities({
      estimateAmount: 25000,
      paymentAmount: 18000,
      carrierResponse: "approved",
    });
    const hit = r.find((o) => o.type === "potential_underpayment");
    expect(hit).toBeTruthy();
    expect(hit?.title).toContain("Potential");
    expect(hit?.explanation).toContain("can be legitimate");
  });

  it("flags unresolved carrier responses", () => {
    const r = analyzeRecoveryOpportunities({ carrierResponse: "partial — 30% cut on drying" });
    const hit = r.find((o) => o.type === "unresolved_carrier_response");
    expect(hit).toBeTruthy();
    expect(hit?.severity).toBe("high");
  });

  it("flags workflow delays from stage age", () => {
    const r = analyzeRecoveryOpportunities({ currentStage: "Supplement review", stageAgeDays: 30 });
    expect(r.some((o) => o.type === "workflow_delay")).toBe(true);
    expect(analyzeRecoveryOpportunities({ stageAgeDays: 2 }).some((o) => o.type === "workflow_delay")).toBe(false);
  });

  it("detects supplement opportunities from long stage age", () => {
    const r = analyzeRecoveryOpportunities({
      expectedScope: ["a", "b"],
      actualScope: ["a", "b"],
      stageAgeDays: 95,
      currentStage: "Carrier review",
    });
    const hit = r.find((o) => o.type === "supplement_opportunity");
    expect(hit).toBeTruthy();
    expect(hit?.title.toLowerCase()).toContain("supplement");
    expect(hit?.financialRelevance).toContain("Supplements");
    expect(hit?.limitation).toContain("Age alone is not proof");
  });

  it("flags estimate vs billing inconsistencies", () => {
    const r = analyzeRecoveryOpportunities({
      estimateAmount: 25000,
      invoicedAmount: 22000,
    });
    const hit = r.find((o) => o.type === "estimate_inconsistency");
    expect(hit).toBeTruthy();
    expect(hit?.evidence.join(" ")).toContain("25,000");
  });

  it("flags overlooked line items when the estimate has fewer lines than the scope", () => {
    const r = analyzeRecoveryOpportunities({
      expectedScope: ["demo", "drywall", "paint", "flooring", "cabinets", "countertop"],
      estimateLineItemCount: 3,
    });
    const hit = r.find((o) => o.type === "overlooked_line_item");
    expect(hit).toBeTruthy();
    expect(hit?.limitation).toContain("legitimately consolidated");
  });

  it("flags billing reconciliation gaps between invoice and payment", () => {
    const r = analyzeRecoveryOpportunities({
      invoicedAmount: 24000,
      paymentAmount: 18000,
    });
    const hit = r.find((o) => o.type === "billing_reconciliation");
    expect(hit).toBeTruthy();
    expect(hit?.severity).toBe("medium");
  });

  it("reports no opportunities for a consistent claim", () => {
    const r = analyzeRecoveryOpportunities({
      expectedScope: ["demo", "drywall", "paint"],
      actualScope: ["demo", "drywall", "paint"],
      evidenceSummary: ["damage", "scope", "quantity", "pricing", "necessity"],
      estimateAmount: 25000,
      paymentAmount: 25000,
      invoicedAmount: 25000,
      estimateLineItemCount: 3,
      carrierResponse: "approved — paid in full",
      currentStage: "Revenue reconciliation",
      stageAgeDays: 2,
    });
    expect(r).toEqual([]);
  });

  it("never guarantees recovery and always names evidence and a limitation", () => {
    const r = analyzeRecoveryOpportunities({
      expectedScope: ["a"],
      actualScope: ["a", "b"],
      estimateAmount: 10000,
      paymentAmount: 5000,
      carrierResponse: "denied",
      stageAgeDays: 45,
    });
    expect(r.length).toBeGreaterThan(0);
    for (const o of r) {
      expect(o.explanation.toLowerCase()).not.toContain("guaranteed");
      expect(o.title.toLowerCase()).not.toContain("guaranteed");
      expect(o.evidence.length).toBeGreaterThan(0);
      expect(o.financialRelevance.length).toBeGreaterThan(10);
      expect(o.recommendedNextStep.length).toBeGreaterThan(10);
      expect(o.limitation.length).toBeGreaterThan(10);
    }
  });
});
