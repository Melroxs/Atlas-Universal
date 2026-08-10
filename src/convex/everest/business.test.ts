import { describe, expect, it } from "vitest";
import {
  AMBIGUOUS_TERMS,
  BUSINESS_LIFECYCLES,
  BUSINESS_MODELS,
  BUSINESS_OBJECTS,
  BUSINESS_TYPES,
  COMPANY_MATURITY,
  FINANCIAL_KNOWLEDGE,
  OBJECT_RELATIONSHIPS,
  ORG_ROLES,
  ORG_STRUCTURES,
  disambiguateTerm,
  maturityGuidance,
} from "./business";

describe("business types", () => {
  it("covers the required universal business types", () => {
    const names = BUSINESS_TYPES.map((b) => b.name);
    for (const expected of [
      "B2B", "B2C", "B2B2C", "D2C", "Marketplace", "Subscription",
      "Usage-based", "Transaction-based", "Commission-based", "Project-based",
      "Recurring services", "Professional services", "Retail", "Wholesale",
      "Manufacturing", "Distribution", "Logistics", "Franchise", "Licensing",
      "Membership", "Nonprofit", "Hybrid",
    ]) {
      expect(names).toContain(expected);
    }
    expect(BUSINESS_TYPES).toHaveLength(22);
    expect(BUSINESS_MODELS).toHaveLength(22);
  });

  it("every business type carries structured content, not just a label", () => {
    for (const t of BUSINESS_TYPES) {
      expect(t.summary.length).toBeGreaterThan(10);
      expect(Object.keys(t.content).length).toBeGreaterThan(0);
      expect(t.confidence).toBeGreaterThan(0.8);
    }
  });
});

describe("financial knowledge", () => {
  it("covers revenue, expenses, profitability and balance sheet families", () => {
    expect(FINANCIAL_KNOWLEDGE.revenue.length).toBeGreaterThanOrEqual(10);
    expect(FINANCIAL_KNOWLEDGE.expenses.length).toBeGreaterThanOrEqual(8);
    expect(FINANCIAL_KNOWLEDGE.profitability.length).toBeGreaterThanOrEqual(6);
    expect(FINANCIAL_KNOWLEDGE.balanceSheet.length).toBeGreaterThanOrEqual(8);
  });

  it("models the income statement waterfall in order", () => {
    const stages = FINANCIAL_KNOWLEDGE.incomeStatementFlow.map((s) => s.stage);
    expect(stages[0]).toBe("Revenue");
    expect(stages).toContain("Gross profit");
    expect(stages).toContain("Operating profit");
    expect(stages[stages.length - 1]).toBe("Net income");
    // COGS must come before gross profit.
    expect(stages.indexOf("COGS / Cost of sales")).toBeLessThan(stages.indexOf("Gross profit"));
  });

  it("states the accounting identity as a universal relationship", () => {
    expect(FINANCIAL_KNOWLEDGE.accountingIdentity.statement).toBe("Assets = Liabilities + Equity");
    expect(FINANCIAL_KNOWLEDGE.accountingIdentity.scope).toContain("universal");
  });

  it("distinguishes ambiguous sales language", () => {
    const meanings = FINANCIAL_KNOWLEDGE.revenue.find((r) => r.term === "Sales");
    expect(meanings?.caution).toContain("ambiguous");
  });
});

describe("accounting semantic intelligence", () => {
  it("never equates bookings, billings, recognized revenue and collections", () => {
    expect(disambiguateTerm("sales")?.meanings).toEqual(
      expect.arrayContaining(["Bookings (committed)", "Recognized revenue (earned)", "Collected cash"]),
    );
    expect(disambiguateTerm("profit")?.meanings).toHaveLength(3);
  });

  it("returns null for unknown terms", () => {
    expect(disambiguateTerm("definitely-not-a-term")).toBeNull();
    expect(Object.keys(AMBIGUOUS_TERMS).length).toBeGreaterThanOrEqual(3);
  });
});

describe("organizational structures, roles, functions, objects", () => {
  it("covers required org structures", () => {
    const names = ORG_STRUCTURES.map((s) => s.name);
    for (const expected of ["LLC", "Corporation", "S corporation", "Partnership", "Subsidiary", "Holding company", "Joint venture"]) {
      expect(names).toContain(expected);
    }
  });

  it("covers required roles", () => {
    const names = ORG_ROLES.map((r) => r.name);
    for (const expected of ["Owner", "Shareholder", "Director", "Manager", "Employee", "Contractor", "Vendor", "Customer"]) {
      expect(names).toContain(expected);
    }
  });

  it("objects include the core business artifacts", () => {
    const names = BUSINESS_OBJECTS.map((o) => o.name);
    for (const expected of ["Lead", "Opportunity", "Quote", "Contract", "Invoice", "Payment", "Purchase order", "Vendor", "Account"]) {
      expect(names).toContain(expected);
    }
  });

  it("relationships link the universal objects meaningfully", () => {
    expect(OBJECT_RELATIONSHIPS.length).toBeGreaterThanOrEqual(12);
    const rel = OBJECT_RELATIONSHIPS.find((r) => r.from === "invoice" && r.to === "payment");
    expect(rel?.relationship).toBe("settled_by");
  });
});

describe("lifecycles & maturity", () => {
  it("models the sales lifecycle end to end", () => {
    const sales = BUSINESS_LIFECYCLES.find((l) => l.key === "sales");
    expect(sales?.stages).toEqual(
      expect.arrayContaining(["Lead", "Opportunity", "Quote", "Contract", "Invoice", "Payment", "Accounting"]),
    );
    expect(BUSINESS_LIFECYCLES.map((l) => l.key)).toEqual(
      expect.arrayContaining(["sales", "procurement", "employee", "customer"]),
    );
  });

  it("covers company maturity levels with adaptation guidance", () => {
    const keys = COMPANY_MATURITY.map((m) => m.key);
    expect(keys).toEqual(["solo", "micro", "small", "mid_market", "enterprise"]);
    expect(maturityGuidance("solo")).toContain("cash");
    expect(maturityGuidance("enterprise")).toContain("controls");
    expect(maturityGuidance(undefined)).toContain("maturity");
    // Never recommends full control frameworks to a solo operator.
    expect(maturityGuidance("solo")).not.toContain("full control frameworks");
  });
});
