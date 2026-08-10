import { describe, expect, it } from "vitest";
import { COVERAGE_STATES, coverageState, deriveCoverage } from "./coverage";

describe("coverage states", () => {
  it("maps scores to explicit, stable states", () => {
    expect(coverageState(0)).toBe("Foundational");
    expect(coverageState(2)).toBe("Developing");
    expect(coverageState(5)).toBe("Deep");
    expect(coverageState(10)).toBe("Production-ready");
    expect(COVERAGE_STATES).toEqual(["Foundational", "Developing", "Deep", "Production-ready"]);
  });
});

describe("deriveCoverage", () => {
  it("measures a deep vertical (insurance restoration) honestly from counts", () => {
    const c = deriveCoverage({
      packKey: "insurance-restoration",
      name: "Insurance Restoration Industry Pack",
      itemTypes: [
        "terminology", "terminology", "terminology", "terminology",
        "entity_type", "entity_type", "entity_type", "entity_type", "entity_type", "entity_type", "entity_type",
        "workflow", "risk_pattern", "risk_pattern", "risk_pattern",
        "document_expectation", "benchmark", "role",
      ],
      authorityKnowledgeCount: 4,
      sourceCount: 5,
      packType: "industry",
    });
    expect(c.axes.map((a) => a.label)).toEqual(
      expect.arrayContaining(["Ontology", "Authority", "Workflow", "Evidence", "Source", "Benchmarks"]),
    );
    const ontology = c.axes.find((a) => a.label === "Ontology");
    expect(ontology?.score).toBeGreaterThanOrEqual(11);
    const authority = c.axes.find((a) => a.label === "Authority");
    expect(authority?.score).toBeGreaterThanOrEqual(4);
    expect(c.note).toContain("Measured from");
  });

  it("reports a thin pack as developing, not production-ready", () => {
    const thin = deriveCoverage({
      packKey: "solar",
      name: "Solar Pack",
      itemTypes: ["entity_type", "entity_type", "workflow"],
      authorityKnowledgeCount: 0,
      sourceCount: 0,
      packType: "industry",
    });
    expect(["Foundational", "Developing"]).toContain(thin.overall);
    expect(thin.axes.find((a) => a.label === "Source")?.state).toBe("Foundational");
  });

  it("labels core/benchmark packs as universal, never industry-depth", () => {
    const core = deriveCoverage({
      packKey: "general-business",
      name: "General Business Benchmarks",
      itemTypes: ["kpi", "kpi", "risk_pattern"],
      authorityKnowledgeCount: 0,
      sourceCount: 0,
      packType: "benchmark",
    });
    expect(core.implementation).toBe("Foundational");
    expect(core.note).toContain("Universal pack");
  });

  it("never fabricates: every axis carries its real basis", () => {
    const c = deriveCoverage({
      packKey: "p",
      name: "P",
      itemTypes: ["terminology", "workflow"],
      authorityKnowledgeCount: 1,
      sourceCount: 2,
      packType: "industry",
    });
    for (const a of c.axes) {
      expect(a.basis).toMatch(/items|entries|sources/);
    }
  });
});
