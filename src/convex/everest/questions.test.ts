import { describe, expect, it } from "vitest";
import { classifyQuestion, questionTypeBadge } from "./questions";

describe("classifyQuestion", () => {
  it("classifies a definition question as domain", () => {
    const r = classifyQuestion("What is a supplement in insurance restoration?");
    expect(r.type).toBe("domain");
    expect(r.label).toContain("Domain");
  });

  it("classifies a general industry question as domain", () => {
    const r = classifyQuestion("How does EBITDA differ from net income?");
    expect(r.type).toBe("domain");
  });

  it("classifies a company-data question as organization", () => {
    const r = classifyQuestion("Which of our claims are currently pending?");
    expect(r.type).toBe("organization");
    expect(r.label).toContain("Organization");
  });

  it("classifies a question about our customers as organization", () => {
    const r = classifyQuestion("How many invoices do we have outstanding?");
    expect(r.type).toBe("organization");
  });

  it("classifies a pure regulatory question as regulatory", () => {
    const r = classifyQuestion("What does OSHA require for respiratory protection?");
    expect(r.type).toBe("regulatory");
    expect(r.label).toContain("Regulatory");
  });

  it("classifies a licensing question as regulatory", () => {
    const r = classifyQuestion("Does Texas require a contractor license for restoration?");
    expect(r.type).toBe("regulatory");
  });

  it("classifies an authority question about THIS company as mixed", () => {
    const r = classifyQuestion("Which of our projects are affected by the new EPA lead rule?");
    expect(r.type).toBe("mixed");
    expect(r.label).toContain("authority × organization");
  });

  it("classifies an empty question as general", () => {
    expect(classifyQuestion("").type).toBe("general");
    expect(classifyQuestion("   ").type).toBe("general");
  });

  it("classifies an unclassified question as general", () => {
    expect(classifyQuestion("hello there").type).toBe("general");
  });

  it("exposes the reasoning behind the classification", () => {
    const r = classifyQuestion("What does OSHA require?");
    expect(r.signals.length).toBeGreaterThan(0);
    expect(r.reasoning.length).toBeGreaterThan(10);
  });
});

describe("questionTypeBadge", () => {
  it("returns a human label for every type", () => {
    expect(questionTypeBadge("domain")).toBe("Domain knowledge");
    expect(questionTypeBadge("organization")).toBe("Organization data");
    expect(questionTypeBadge("regulatory")).toContain("Authority");
    expect(questionTypeBadge("mixed")).toContain("×");
    expect(questionTypeBadge("general")).toBe("General");
  });
});
