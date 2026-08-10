import { describe, expect, it } from "vitest";
import {
  JURISDICTION_LEVELS,
  contextIncludesPlace,
  evaluateApplicability,
  jurisdictionPath,
  jurisdictionSummary,
  parseJurisdictionPath,
} from "./jurisdiction";

describe("jurisdiction hierarchy", () => {
  it("parses a country > state > county path into leveled nodes", () => {
    const nodes = parseJurisdictionPath("United States > Florida > Miami-Dade");
    expect(nodes.map((n) => n.name)).toEqual(["United States", "Florida", "Miami-Dade"]);
    expect(nodes.map((n) => n.level)).toEqual(["country", "state", "county"]);
  });

  it("is internationally extensible and tolerant of missing levels", () => {
    const nodes = parseJurisdictionPath("Canada > Ontario");
    expect(nodes).toHaveLength(2);
    expect(nodes[0].level).toBe("country");
    expect(parseJurisdictionPath("")).toEqual([]);
    expect(parseJurisdictionPath(null)).toEqual([]);
    expect(JURISDICTION_LEVELS).toEqual(["country", "state", "county", "municipality"]);
  });

  it("builds context paths and summaries", () => {
    const ctx = { country: "United States", state: "Texas", municipality: "Austin" };
    expect(jurisdictionPath(ctx)).toEqual(["United States", "Texas", "Austin"]);
    expect(jurisdictionSummary(ctx)).toBe("United States > Texas > Austin");
    expect(contextIncludesPlace(ctx, "Texas")).toBe(true);
    expect(contextIncludesPlace(ctx, "Florida")).toBe(false);
  });
});

describe("applicability evaluation", () => {
  it("applies universal knowledge anywhere", () => {
    const r = evaluateApplicability({}, { country: "United States" });
    expect(r.applicable).toBe(true);
  });

  it("applies country-level jurisdiction when the country matches", () => {
    const k = { jurisdiction: "United States", industry: "construction" };
    expect(evaluateApplicability(k, { country: "United States", industry: "construction" }).applicable).toBe(true);
  });

  it("fails closed when the state-level jurisdiction is unknown", () => {
    const k = { jurisdiction: "United States > Florida" };
    const r = evaluateApplicability(k, { country: "United States" });
    expect(r.applicable).toBe(false);
    expect(r.missingFactors.join(" ")).toContain("Florida");
    expect(r.reason).toContain("Cannot confirm");
  });

  it("rejects the wrong country", () => {
    const k = { jurisdiction: "United States > Florida" };
    expect(evaluateApplicability(k, { country: "Canada", state: "Ontario" }).applicable).toBe(false);
  });

  it("rejects mismatched industries", () => {
    const k = { jurisdiction: "United States", industry: "construction" };
    const r = evaluateApplicability(k, { country: "United States", industry: "insurance restoration" });
    expect(r.applicable).toBe(false);
    expect(r.missingFactors.join(" ")).toContain("construction");
  });

  it("fails closed when the company industry is unknown", () => {
    const k = { industry: "construction" };
    const r = evaluateApplicability(k, { country: "United States" });
    expect(r.applicable).toBe(false);
    expect(r.missingFactors.join(" ")).toContain("company industry");
  });

  it("respects effective/expiration dates", () => {
    const k = { effectiveDate: 2000000000000 };
    expect(evaluateApplicability(k, { asOf: 1000000000000 }).applicable).toBe(false);
    const expired = { expirationDate: 1000000000000 };
    expect(evaluateApplicability(expired, { asOf: 2000000000000 }).applicable).toBe(false);
  });

  it("never silently treats an unknown jurisdiction as applicable", () => {
    const k = { jurisdiction: "Mars" };
    expect(evaluateApplicability(k, { country: "United States" }).applicable).toBe(false);
  });
});
