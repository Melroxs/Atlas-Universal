import { describe, it, expect } from "vitest";
import {
  parseCSV,
  suggestMappings,
  mapRowsToLeads,
  validateLeads,
  deduplicateLeads,
  normalizeEmail,
  normalizeCompany,
  ATLAS_FIELDS,
} from "./csv-import";

// ── parseCSV ────────────────────────────────────────────────────────────

describe("parseCSV", () => {
  it("parses a simple CSV with header + 2 rows", () => {
    const csv = "Name,Email,Company\nJohn,john@test.com,ABC\nJane,jane@test.com,XYZ";
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ Name: "John", Email: "john@test.com", Company: "ABC" });
    expect(rows[1]).toEqual({ Name: "Jane", Email: "jane@test.com", Company: "XYZ" });
  });

  it("handles quoted fields containing commas", () => {
    const csv = 'Name,Company\nJohn,"Smith, LLC",ABC';
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].Company).toBe("Smith, LLC");
  });

  it("handles empty rows gracefully", () => {
    const csv = "Name,Email\nJohn,john@test.com\n\n\nJane,jane@test.com";
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(2);
  });

  it("returns empty array for header-only CSV", () => {
    const csv = "Name,Email,Company";
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(0);
  });

  it("handles Windows-style line endings (CRLF)", () => {
    const csv = "Name,Email\r\nJohn,john@test.com\r\nJane,jane@test.com";
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(2);
  });

  it("trims whitespace from headers and values", () => {
    const csv = "  Name  ,  Email  \n  John  ,  john@test.com  ";
    const rows = parseCSV(csv);
    expect(rows[0]).toEqual({ Name: "John", Email: "john@test.com" });
  });

  it("skips all-blank rows", () => {
    const csv = "Name,Email\nJohn,john@test.com\n   ,   \nJane,jane@test.com";
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(2);
  });

  it("handles escaped double quotes", () => {
    const csv = 'Name,Notes\nJohn,"He said ""hello"""';
    const rows = parseCSV(csv);
    expect(rows[0].Notes).toBe('He said "hello"');
  });
});

// ── suggestMappings ──────────────────────────────────────────────────────

describe("suggestMappings", () => {
  it("auto-maps common headers to Atlas fields", () => {
    const headers = ["First Name", "Last Name", "Email", "Company", "Phone", "Website"];
    const mappings = suggestMappings(headers);
    expect(mappings).toEqual([
      { csvColumn: "First Name", atlasField: "firstName" },
      { csvColumn: "Last Name", atlasField: "lastName" },
      { csvColumn: "Email", atlasField: "email" },
      { csvColumn: "Company", atlasField: "companyName" },
      { csvColumn: "Phone", atlasField: "phone" },
      { csvColumn: "Website", atlasField: "website" },
    ]);
  });

  it("ignores unrecognized columns", () => {
    const headers = ["Random Column", "Email"];
    const mappings = suggestMappings(headers);
    expect(mappings[0].atlasField).toBe("__ignore__");
    expect(mappings[1].atlasField).toBe("email");
  });

  it("does not map the same Atlas field twice", () => {
    const headers = ["Email", "email_address", "Contact Email"];
    const mappings = suggestMappings(headers);
    const emailMappings = mappings.filter((m) => m.atlasField === "email");
    expect(emailMappings).toHaveLength(1);
  });

  it("handles snake_case headers", () => {
    const headers = ["first_name", "last_name", "company_name", "job_title"];
    const mappings = suggestMappings(headers);
    expect(mappings.map((m) => m.atlasField)).toEqual([
      "firstName",
      "lastName",
      "companyName",
      "jobTitle",
    ]);
  });
});

// ── mapRowsToLeads ──────────────────────────────────────────────────────

describe("mapRowsToLeads", () => {
  const mappings = [
    { csvColumn: "Company", atlasField: "companyName" },
    { csvColumn: "Email", atlasField: "email" },
    { csvColumn: "Name", atlasField: "fullName" },
    { csvColumn: "Notes", atlasField: "__ignore__" },
  ];

  it("maps CSV rows to lead objects", () => {
    const rows = [
      { Company: "ABC", Email: "john@abc.com", Name: "John Smith", Notes: "ignored" },
    ];
    const leads = mapRowsToLeads(rows, mappings);
    expect(leads).toHaveLength(1);
    expect(leads[0].companyName).toBe("ABC");
    expect(leads[0].email).toBe("john@abc.com");
    expect(leads[0].fullName).toBe("John Smith");
    expect(leads[0].notes).toBe(""); // ignored column
  });

  it("normalizes website URLs", () => {
    const rows = [{ Company: "ABC", Email: "a@b.com", Name: "X", Website: "abc.com" }];
    const m = [...mappings, { csvColumn: "Website", atlasField: "website" }];
    const leads = mapRowsToLeads(rows, m);
    expect(leads[0].website).toBe("https://abc.com");
  });

  it("preserves already-normalized URLs", () => {
    const rows = [{ Company: "ABC", Email: "a@b.com", Name: "X", Website: "https://abc.com" }];
    const m = [...mappings, { csvColumn: "Website", atlasField: "website" }];
    const leads = mapRowsToLeads(rows, m);
    expect(leads[0].website).toBe("https://abc.com");
  });

  it("sets source to csv_import by default", () => {
    const rows = [{ Company: "ABC", Email: "a@b.com", Name: "X" }];
    const leads = mapRowsToLeads(rows, mappings);
    expect(leads[0].source).toBe("csv_import");
  });

  it("uses source from CSV when provided", () => {
    const m = [...mappings, { csvColumn: "Source", atlasField: "source" }];
    const rows = [{ Company: "ABC", Email: "a@b.com", Name: "X", Source: "referral" }];
    const leads = mapRowsToLeads(rows, m);
    expect(leads[0].source).toBe("referral");
  });

  it("populates _raw and _rowIndex", () => {
    const rows = [
      { Company: "ABC", Email: "a@b.com", Name: "X" },
      { Company: "XYZ", Email: "b@c.com", Name: "Y" },
    ];
    const leads = mapRowsToLeads(rows, mappings);
    expect(leads[0]._rowIndex).toBe(0);
    expect(leads[1]._rowIndex).toBe(1);
    expect(leads[0]._raw).toEqual(rows[0]);
  });
});

// ── validateLeads ────────────────────────────────────────────────────────

describe("validateLeads", () => {
  const toMapped = (
    company: string,
    email: string,
    name = "",
  ) => ({
    companyName: company,
    email,
    fullName: name,
    firstName: "",
    lastName: "",
    phone: "",
    website: "",
    location: "",
    serviceArea: "",
    industry: "",
    jobTitle: "",
    source: "csv_import",
    notes: "",
    _raw: {},
    _rowIndex: 0,
  });

  it("valid leads pass validation", () => {
    const leads = [toMapped("ABC", "john@abc.com", "John")];
    const result = validateLeads(leads);
    expect(result.valid).toHaveLength(1);
    expect(result.invalid).toHaveLength(0);
    expect(result.stats.validCount).toBe(0); // set after dedup
  });

  it("rejects leads missing email", () => {
    const leads = [toMapped("ABC", "")];
    const result = validateLeads(leads);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].errors[0]).toContain("Email is required");
  });

  it("rejects leads with invalid email", () => {
    const leads = [toMapped("ABC", "not-an-email")];
    const result = validateLeads(leads);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].errors[0]).toContain("Invalid email");
  });

  it("rejects leads missing company name", () => {
    const leads = [toMapped("", "john@test.com")];
    const result = validateLeads(leads);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].errors[0]).toContain("Company name is required");
  });

  it("skips completely empty rows", () => {
    const empty = {
      companyName: "",
      email: "",
      fullName: "",
      firstName: "",
      lastName: "",
      phone: "",
      website: "",
      location: "",
      serviceArea: "",
      industry: "",
      jobTitle: "",
      source: "",
      notes: "",
      _raw: {},
      _rowIndex: 0,
    };
    const result = validateLeads([empty]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(0);
    expect(result.stats.emptyCount).toBe(1);
  });

  it("rejects URLs that are not valid", () => {
    const leads = [toMapped("ABC", "a@b.com")];
    leads[0].website = "not-a-url";
    const result = validateLeads(leads);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].errors[0]).toContain("Invalid URL");
  });

  it("accepts valid HTTP URLs", () => {
    const leads = [toMapped("ABC", "a@b.com")];
    leads[0].website = "https://example.com";
    const result = validateLeads(leads);
    expect(result.valid).toHaveLength(1);
    expect(result.invalid).toHaveLength(0);
  });
});

// ── deduplicateLeads ─────────────────────────────────────────────────────

describe("deduplicateLeads", () => {
  const toLead = (
    company: string,
    email: string,
    idx: number,
  ) => ({
    companyName: company,
    email,
    fullName: "",
    firstName: "",
    lastName: "",
    phone: "",
    website: "",
    location: "",
    serviceArea: "",
    industry: "",
    jobTitle: "",
    source: "csv_import",
    notes: "",
    _raw: {},
    _rowIndex: idx,
  });

  it("deduplicates by exact email match against existing leads", () => {
    const leads = [toLead("ABC", "john@abc.com", 0)];
    const existing = [{ id: "1", contact_email: "john@abc.com", company_name: "ABC" }];
    const { unique, duplicates } = deduplicateLeads(leads, existing);
    expect(unique).toHaveLength(0);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].reason).toContain("Duplicate email");
  });

  it("deduplicates by company name match", () => {
    const leads = [toLead("ABC Roofing", "new@abc.com", 0)];
    const existing = [{ id: "1", contact_email: "", company_name: "ABC Roofing" }];
    const { unique, duplicates } = deduplicateLeads(leads, existing);
    expect(unique).toHaveLength(0);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].reason).toContain("similar company");
  });

  it("deduplicates by normalized email (case-insensitive)", () => {
    const leads = [toLead("ABC", "John@ABC.com", 0)];
    const existing = [{ id: "1", contact_email: "john@abc.com", company_name: "XYZ" }];
    const { unique, duplicates } = deduplicateLeads(leads, existing);
    expect(unique).toHaveLength(0);
    expect(duplicates).toHaveLength(1);
  });

  it("deduplicates within the same batch by email", () => {
    const leads = [
      toLead("ABC", "john@abc.com", 0),
      toLead("ABC2", "john@abc.com", 1),
    ];
    const { unique, duplicates } = deduplicateLeads(leads, []);
    expect(unique).toHaveLength(1);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].reason).toContain("within CSV batch");
  });

  it("normalizes company names for comparison", () => {
    const leads = [toLead("A.B.C. Roofing", "new@abc.com", 0)];
    const existing = [{ id: "1", contact_email: "", company_name: "abc roofing" }];
    const { unique, duplicates } = deduplicateLeads(leads, existing);
    expect(unique).toHaveLength(0);
    expect(duplicates).toHaveLength(1);
  });

  it("allows unique leads through", () => {
    const leads = [
      toLead("ABC", "john@abc.com", 0),
      toLead("XYZ", "jane@xyz.com", 1),
    ];
    const existing = [{ id: "1", contact_email: "other@test.com", company_name: "Other" }];
    const { unique, duplicates } = deduplicateLeads(leads, existing);
    expect(unique).toHaveLength(2);
    expect(duplicates).toHaveLength(0);
  });

  it("handles empty existing leads list", () => {
    const leads = [toLead("ABC", "john@abc.com", 0)];
    const { unique, duplicates } = deduplicateLeads(leads, []);
    expect(unique).toHaveLength(1);
    expect(duplicates).toHaveLength(0);
  });
});

// ── normalizeEmail ───────────────────────────────────────────────────────

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  John@ABC.com  ")).toBe("john@abc.com");
  });
});

// ── normalizeCompany ─────────────────────────────────────────────────────

describe("normalizeCompany", () => {
  it("normalizes company names", () => {
    // Dots are stripped, spaces are collapsed
    expect(normalizeCompany("  A.B.C. Roofing  ")).toBe("abc roofing");
    expect(normalizeCompany("ABC Roofing & Restoration")).toBe("abc roofing restoration");
  });
});

// ── ATLAS_FIELDS ─────────────────────────────────────────────────────────

describe("ATLAS_FIELDS", () => {
  it("has email and companyName as required", () => {
    const email = ATLAS_FIELDS.find((f) => f.key === "email");
    const company = ATLAS_FIELDS.find((f) => f.key === "companyName");
    expect(email?.required).toBe(true);
    expect(company?.required).toBe(true);
  });
});
