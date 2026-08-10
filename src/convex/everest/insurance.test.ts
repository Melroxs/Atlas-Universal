import { describe, expect, it } from "vitest";
import {
  CLAIM_BASELINE,
  CLAIM_EVIDENCE_CATEGORIES,
  CLAIM_LIFECYCLE,
  analyzeRecoveryOpportunities,
} from "./insurance";

describe("generalized claim lifecycle", () => {
  it("models the full lifecycle from loss to closure", () => {
    const stages = CLAIM_LIFECYCLE.map((s) => s.stage);
    expect(stages[0]).toBe("Loss");
    expect(stages[stages.length - 1]).toBe("Closure");
    for (const expected of ["FNOL", "Inspection", "Estimate", "Carrier / adjuster review", "Supplement submission", "Approval / partial / denial", "Recovery"]) {
      expect(stages).toContain(expected);
    }
  });

  it("documents typical inputs and outputs per stage", () => {
    const estimate = CLAIM_LIFECYCLE.find((s) => s.stage === "Estimate");
    expect(estimate?.typicalInputs).toContain("Scope of work");
    expect(estimate?.typicalOutputs).toContain("Estimate");
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

  it("reports no opportunities for a consistent claim", () => {
    const r = analyzeRecoveryOpportunities({
      expectedScope: ["demo", "drywall", "paint"],
      actualScope: ["demo", "drywall", "paint"],
      evidenceSummary: ["damage", "scope", "quantity", "pricing", "necessity"],
      estimateAmount: 25000,
      paymentAmount: 25000,
      carrierResponse: "approved — paid in full",
      currentStage: "Closure",
      stageAgeDays: 2,
    });
    expect(r).toEqual([]);
  });

  it("never guarantees recovery and always names evidence", () => {
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
    }
  });
});
