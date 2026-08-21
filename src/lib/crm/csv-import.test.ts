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
  generateFieldKey,
  ensureUniqueKey,
  validateCustomFieldValue,
  parseCustomFieldValue,
  CUSTOM_FIELD_TYPES,
  type CustomFieldDefinition,
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

// ── generateFieldKey ────────────────────────────────────────────────────

describe("generateFieldKey", () => {
  it("converts display name to snake_case key", () => {
    expect(generateFieldKey("Insurance Focus")).toBe("insurance_focus");
    expect(generateFieldKey("Est. Lead Score (0-100)")).toBe("est_lead_score_0_100");
    expect(generateFieldKey("Multiple Locations")).toBe("multiple_locations");
  });

  it("handles special characters", () => {
    expect(generateFieldKey("Company & Co.")).toBe("company_co");
    expect(generateFieldKey("Xactimate/Est. Software")).toBe("xactimateest_software");
  });

  it("trims whitespace", () => {
    expect(generateFieldKey("  Insurance Focus  ")).toBe("insurance_focus");
  });
});

// ── ensureUniqueKey ─────────────────────────────────────────────────────

describe("ensureUniqueKey", () => {
  it("returns original key if unique", () => {
    expect(ensureUniqueKey("insurance_focus", new Set(["company", "email"]))).toBe("insurance_focus");
  });

  it("appends suffix if duplicate exists", () => {
    expect(ensureUniqueKey("insurance_focus", new Set(["insurance_focus"]))).toBe("insurance_focus_2");
  });

  it("handles multiple duplicates", () => {
    expect(ensureUniqueKey("insurance_focus", new Set(["insurance_focus", "insurance_focus_2"]))).toBe("insurance_focus_3");
  });

  it("falls back to custom_field for empty key", () => {
    expect(ensureUniqueKey("", new Set())).toBe("custom_field");
  });
});

// ── validateCustomFieldValue ─────────────────────────────────────────────

describe("validateCustomFieldValue", () => {
  it("allows empty values", () => {
    expect(validateCustomFieldValue("", "number", "Score")).toBeNull();
    expect(validateCustomFieldValue("  ", "url", "Website")).toBeNull();
  });

  it("validates number fields", () => {
    expect(validateCustomFieldValue("85", "number", "Score")).toBeNull();
    expect(validateCustomFieldValue("abc", "number", "Score")).toBe("Score must be a number");
  });

  it("validates boolean fields", () => {
    expect(validateCustomFieldValue("true", "boolean", "Active")).toBeNull();
    expect(validateCustomFieldValue("yes", "boolean", "Active")).toBeNull();
    expect(validateCustomFieldValue("1", "boolean", "Active")).toBeNull();
    expect(validateCustomFieldValue("maybe", "boolean", "Active")).toBe("Active must be true/false/yes/no/1/0");
  });

  it("validates URL fields", () => {
    expect(validateCustomFieldValue("https://example.com", "url", "Website")).toBeNull();
    expect(validateCustomFieldValue("not a url", "url", "Website")).toBe("Website must be a valid URL");
  });

  it("validates date fields", () => {
    expect(validateCustomFieldValue("2024-01-15", "date", "Date")).toBeNull();
    expect(validateCustomFieldValue("not a date", "date", "Date")).toBe("Date must be a valid date");
  });

  it("allows text fields always", () => {
    expect(validateCustomFieldValue("anything", "text", "Notes")).toBeNull();
    expect(validateCustomFieldValue("anything", "long_text", "Notes")).toBeNull();
  });
});

// ── parseCustomFieldValue ────────────────────────────────────────────────

describe("parseCustomFieldValue", () => {
  it("parses number values", () => {
    expect(parseCustomFieldValue("85", "number")).toBe(85);
    expect(parseCustomFieldValue("3.14", "number")).toBe(3.14);
  });

  it("parses boolean values", () => {
    expect(parseCustomFieldValue("true", "boolean")).toBe(true);
    expect(parseCustomFieldValue("yes", "boolean")).toBe(true);
    expect(parseCustomFieldValue("1", "boolean")).toBe(true);
    expect(parseCustomFieldValue("no", "boolean")).toBe(false);
  });

  it("parses multi_select values", () => {
    expect(parseCustomFieldValue("Xactimate, Symbility", "multi_select")).toEqual(["Xactimate", "Symbility"]);
    expect(parseCustomFieldValue("Xactimate; Symbility", "multi_select")).toEqual(["Xactimate", "Symbility"]);
  });

  it("returns null for empty values", () => {
    expect(parseCustomFieldValue("", "text")).toBeNull();
    expect(parseCustomFieldValue("  ", "number")).toBeNull();
  });

  it("preserves text as-is", () => {
    expect(parseCustomFieldValue("Insurance restoration", "text")).toBe("Insurance restoration");
  });
});

// ── CUSTOM_FIELD_TYPES ───────────────────────────────────────────────────

describe("CUSTOM_FIELD_TYPES", () => {
  it("has all expected field types", () => {
    const keys = CUSTOM_FIELD_TYPES.map((t) => t.key);
    expect(keys).toContain("text");
    expect(keys).toContain("number");
    expect(keys).toContain("boolean");
    expect(keys).toContain("url");
    expect(keys).toContain("date");
    expect(keys).toContain("select");
    expect(keys).toContain("multi_select");
  });
});

// ── suggestMappings with custom fields ───────────────────────────────────

describe("suggestMappings with custom fields", () => {
  const customFields: CustomFieldDefinition[] = [
    {
      id: "cf_1",
      tenant_id: "t1",
      name: "Insurance Focus",
      key: "insurance_focus",
      field_type: "text",
      entity_type: "lead",
      created_at: "2024-01-01",
    },
    {
      id: "cf_2",
      tenant_id: "t1",
      name: "Lead Score",
      key: "lead_score",
      field_type: "number",
      entity_type: "lead",
      created_at: "2024-01-01",
    },
  ];

  it("auto-maps CSV columns to existing custom fields by exact name", () => {
    const mappings = suggestMappings(["Company", "Email", "Insurance Focus"], customFields);
    expect(mappings).toHaveLength(3);
    expect(mappings[0].atlasField).toBe("companyName");
    expect(mappings[1].atlasField).toBe("email");
    expect(mappings[2].isCustom).toBe(true);
    expect(mappings[2].customFieldId).toBe("cf_1");
  });

  it("marks unmatched columns as __ignore__", () => {
    const mappings = suggestMappings(["Random Column"], customFields);
    expect(mappings[0].atlasField).toBe("__ignore__");
  });

  it("works without custom fields (backward compatible)", () => {
    const mappings = suggestMappings(["Company", "Email"]);
    expect(mappings).toHaveLength(2);
    expect(mappings[0].atlasField).toBe("companyName");
    expect(mappings[1].atlasField).toBe("email");
  });
});

// ── mapRowsToLeads with custom fields ───────────────────────────────────

describe("mapRowsToLeads with custom fields", () => {
  const customFields: CustomFieldDefinition[] = [
    {
      id: "cf_1",
      tenant_id: "t1",
      name: "Insurance Focus",
      key: "insurance_focus",
      field_type: "text",
      entity_type: "lead",
      created_at: "2024-01-01",
    },
  ];

  it("maps CSV rows with custom field values", () => {
    const rows = [{ Company: "ABC", Email: "a@b.com", "Insurance Focus": "Storm restoration" }];
    const mappings = [
      { csvColumn: "Company", atlasField: "companyName" },
      { csvColumn: "Email", atlasField: "email" },
      { csvColumn: "Insurance Focus", atlasField: "__custom__", customFieldId: "cf_1", isCustom: true },
    ];
    const leads = mapRowsToLeads(rows, mappings, customFields);
    expect(leads[0].customFields).toEqual({
      cf_1: {
        value: "Storm restoration",
        fieldKey: "insurance_focus",
        fieldName: "Insurance Focus",
        fieldType: "text",
      },
    });
  });

  it("returns empty customFields when no custom mappings exist", () => {
    const rows = [{ Company: "ABC", Email: "a@b.com" }];
    const mappings = [
      { csvColumn: "Company", atlasField: "companyName" },
      { csvColumn: "Email", atlasField: "email" },
    ];
    const leads = mapRowsToLeads(rows, mappings, customFields);
    expect(leads[0].customFields).toEqual({});
  });
});

// ── validateLeads with custom field validation ───────────────────────────

describe("validateLeads with custom field validation", () => {
  it("flags invalid number custom field values", () => {
    const leads = [{
      firstName: "John",
      lastName: "",
      fullName: "John",
      email: "john@test.com",
      phone: "",
      companyName: "ABC",
      website: "",
      location: "",
      serviceArea: "",
      industry: "",
      jobTitle: "",
      source: "",
      notes: "",
      customFields: {
        cf_1: { value: "not-a-number", fieldKey: "score", fieldName: "Lead Score", fieldType: "number" },
      },
      _raw: { Email: "john@test.com", Company: "ABC", Score: "not-a-number" },
      _rowIndex: 0,
    } as any];
    const result = validateLeads(leads);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].errors[0]).toContain("Lead Score must be a number");
  });

  it("validates custom fields with correct types", () => {
    const leads = [{
      firstName: "John",
      lastName: "",
      fullName: "John",
      email: "john@test.com",
      phone: "",
      companyName: "ABC",
      website: "",
      location: "",
      serviceArea: "",
      industry: "",
      jobTitle: "",
      source: "",
      notes: "",
      customFields: {
        cf_1: { value: "42", fieldKey: "score", fieldName: "Lead Score", fieldType: "number" },
      },
      _raw: { Email: "john@test.com", Company: "ABC", Score: "42" },
      _rowIndex: 0,
    } as any];
    const result = validateLeads(leads);
    expect(result.valid).toHaveLength(1);
    expect(result.invalid).toHaveLength(0);
  });
});
