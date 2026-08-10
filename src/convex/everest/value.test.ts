import { describe, expect, it } from "vitest";
import { VALUE_ENGINES, discoverOpportunities, valueEngineFor } from "./value";

describe("industry value engines", () => {
  it("defines a killer use case per targeted industry", () => {
    const packs = VALUE_ENGINES.map((v) => v.industryPack);
    expect(packs).toContain("insurance-restoration");
    expect(packs).toContain("roofing");
    expect(packs).toContain("solar");
    expect(packs).toContain("property-management");
    expect(packs).toContain("construction");
    expect(packs).toContain("professional-services");
  });

  it("insurance restoration is the implemented reference vertical", () => {
    const engine = valueEngineFor("insurance-restoration");
    expect(engine).toBeTruthy();
    expect(engine?.implementationStatus).toBe("implemented");
    expect(engine?.confidence).toBeGreaterThan(0.5);
  });

  it("adjacent industries are honestly declared drafts, never claimed complete", () => {
    for (const v of VALUE_ENGINES) {
      if (v.industryPack === "insurance-restoration") continue;
      expect(v.implementationStatus).toBe("draft");
    }
  });

  it("every value engine ties to a measurable business problem", () => {
    for (const v of VALUE_ENGINES) {
      expect(v.problem.length).toBeGreaterThan(30);
      expect(v.measurableOutcome.length).toBeGreaterThan(20);
      expect(v.detectionSignals.length).toBeGreaterThan(0);
      expect(v.limitations.length).toBeGreaterThan(0);
      expect(v.recommendedActions.length).toBeGreaterThan(0);
    }
  });

  it("insurance recovery limitations forbid guarantees", () => {
    const engine = valueEngineFor("insurance-restoration");
    expect(engine?.limitations.join(" ").toLowerCase()).toContain("no guarantee");
  });

  it("returns undefined for unknown packs — no fabricated engines", () => {
    expect(valueEngineFor("nonexistent-industry")).toBeUndefined();
  });
});

describe("opportunity discovery", () => {
  it("returns a ranked set of opportunities", () => {
    const opps = discoverOpportunities("insurance-restoration");
    expect(opps.length).toBeGreaterThan(5);
    expect(opps[0].rank).toBe(1);
    expect(opps[0].category).toBe("uncollected_revenue");
  });

  it("labels opportunities as domain knowledge by default", () => {
    const opps = discoverOpportunities("insurance-restoration");
    for (const o of opps) {
      expect(o.evidenceKind).toBe("domain");
      expect(o.relevance).toContain("Domain-level knowledge");
    }
  });

  it("promotes opportunities to organization evidence only when supplied", () => {
    const evidence: Record<string, string | null> = {
      revenue_leakage: null,
      cost_leakage: null,
      compliance_risk: null,
      operational_bottleneck: null,
      missed_deadline: null,
      uncollected_revenue: "Three invoices over 60 days outstanding.",
      underbilling: null,
      missed_opportunity: null,
      documentation_failure: null,
      workflow_failure: null,
      customer_churn: null,
      labor_inefficiency: null,
    };
    const opps = discoverOpportunities("insurance-restoration", evidence);
    const hit = opps.find((o) => o.category === "uncollected_revenue");
    expect(hit?.evidenceKind).toBe("organization");
    expect(hit?.relevance).toContain("60 days");
    expect(hit?.confidence).toBeGreaterThan(0.5);
  });

  it("grounds descriptions in the pack's value problem", () => {
    const opps = discoverOpportunities("insurance-restoration");
    expect(opps[0].description).toContain("Restoration contractors");
  });
});
