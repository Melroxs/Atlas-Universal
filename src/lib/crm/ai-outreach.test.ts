import { describe, it, expect } from "vitest";
import { resolveVariables, type LeadContext } from "./ai-outreach";

// ── resolveVariables ─────────────────────────────────────────────────────

describe("resolveVariables", () => {
  const baseLead: LeadContext = {
    firstName: "John",
    lastName: "Smith",
    fullName: "John Smith",
    companyName: "ABC Roofing",
    industry: "Roofing",
    city: "Miami",
    state: "FL",
    serviceArea: "South Florida",
    website: "https://abcroofing.com",
    jobTitle: "Owner",
    notes: "",
    previousActivities: [],
  };

  it("resolves standard variables", () => {
    const text = "Hi {{first_name}}, I wanted to reach out about {{company_name}}.";
    const result = resolveVariables(text, baseLead);
    expect(result).toBe("Hi John, I wanted to reach out about ABC Roofing.");
  });

  it("resolves all supported variables", () => {
    const text = [
      "{{first_name}}",
      "{{last_name}}",
      "{{full_name}}",
      "{{company_name}}",
      "{{city}}",
      "{{state}}",
      "{{service_area}}",
      "{{industry}}",
      "{{website}}",
      "{{job_title}}",
    ].join(", ");
    const result = resolveVariables(text, baseLead);
    expect(result).toContain("John");
    expect(result).toContain("Smith");
    expect(result).toContain("John Smith");
    expect(result).toContain("ABC Roofing");
    expect(result).toContain("Miami");
    expect(result).toContain("FL");
    expect(result).toContain("South Florida");
    expect(result).toContain("Roofing");
    expect(result).toContain("https://abcroofing.com");
    expect(result).toContain("Owner");
  });

  it("replaces missing values with empty string and fixes greeting", () => {
    const lead: Partial<LeadContext> = {
      firstName: "",
      companyName: "XYZ Corp",
    };
    const text = "Hi {{first_name}}, welcome to {{company_name}}.";
    const result = resolveVariables(text, lead);
    // Empty first_name → "Hi ," → auto-fixed to "Hi there,"
    expect(result).toBe("Hi there, welcome to XYZ Corp.");
  });

  it("removes unresolved variables", () => {
    const text = "Hello {{unknown_var}}, this is {{first_name}}.";
    const result = resolveVariables(text, baseLead);
    expect(result).not.toContain("{{unknown_var}}");
    expect(result).toContain("John");
  });

  it("fixes empty greeting lines", () => {
    const lead: Partial<LeadContext> = { firstName: "", companyName: "Test" };
    const text = "Hi {{first_name}},\n\nWelcome to {{company_name}}.";
    const result = resolveVariables(text, lead);
    expect(result).not.toMatch(/Hi\s+,/);
    expect(result).toContain("Hi there,");
  });

  it("collapses excessive newlines", () => {
    const text = "Line 1\n\n\n\n\n\nLine 2";
    const result = resolveVariables(text, baseLead);
    expect(result).toBe("Line 1\n\nLine 2");
  });

  it("handles case-insensitive variable matching", () => {
    const text = "Hi {{FIRST_NAME}}, welcome to {{Company_Name}}.";
    const result = resolveVariables(text, baseLead);
    expect(result).toBe("Hi John, welcome to ABC Roofing.");
  });

  it("handles empty text gracefully", () => {
    const result = resolveVariables("", baseLead);
    expect(result).toBe("");
  });

  it("preserves text with no variables", () => {
    const text = "This is a plain email with no variables.";
    const result = resolveVariables(text, baseLead);
    expect(result).toBe(text);
  });

  it("uses company name when first name is missing in greeting", () => {
    const lead: Partial<LeadContext> = { firstName: "", companyName: "ABC Roofing" };
    const text = "Hi {{first_name}},\n\nI wanted to reach out about {{company_name}}.";
    const result = resolveVariables(text, lead);
    // After variable resolution, the greeting becomes "Hi ," → "Hi there,"
    expect(result).toContain("Hi there,");
    expect(result).toContain("ABC Roofing");
  });
});

// ── LeadContext shape ────────────────────────────────────────────────────

describe("LeadContext", () => {
  it("accepts all expected fields", () => {
    const ctx: LeadContext = {
      firstName: "Jane",
      lastName: "Doe",
      fullName: "Jane Doe",
      companyName: "Test Co",
      industry: "Construction",
      city: "Austin",
      state: "TX",
      serviceArea: "Central TX",
      website: "https://test.com",
      jobTitle: "CEO",
      notes: "Important note",
      previousActivities: ["Initial call", "Email sent"],
    };
    expect(ctx.firstName).toBe("Jane");
    expect(ctx.previousActivities).toHaveLength(2);
  });
});
