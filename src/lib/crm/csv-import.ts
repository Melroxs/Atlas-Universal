// ---------------------------------------------------------------------------
// Atlas CRM — CSV Lead Import Engine
//
// Handles: parsing, column mapping, validation, deduplication, batch tracking.
// Runs entirely client-side — no server round-trip for parsing/validation.
// Only the final import writes to Supabase via RPC.
// ---------------------------------------------------------------------------

export interface CSVRow {
  [key: string]: string;
}

export interface MappedLead {
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  companyName: string;
  website: string;
  location: string;
  serviceArea: string;
  industry: string;
  jobTitle: string;
  source: string;
  notes: string;
  _raw: CSVRow;
  _rowIndex: number;
}

export interface ColumnMapping {
  csvColumn: string;
  atlasField: string;
}

export interface ValidationResult {
  valid: MappedLead[];
  invalid: Array<{ row: CSVRow; rowIndex: number; errors: string[] }>;
  duplicates: Array<{ row: CSVRow; rowIndex: number; existingLeadId?: string; reason: string }>;
  stats: {
    totalRows: number;
    validCount: number;
    invalidCount: number;
    duplicateCount: number;
    emptyCount: number;
  };
}

export interface ImportBatch {
  id: string;
  filename: string;
  importedAt: string;
  importedBy: string;
  totalRows: number;
  importedCount: number;
  skippedCount: number;
  duplicateCount: number;
}

// Atlas CRM field definitions
export const ATLAS_FIELDS = [
  { key: "firstName", label: "First Name", required: false },
  { key: "lastName", label: "Last Name", required: false },
  { key: "fullName", label: "Full Name", required: false },
  { key: "email", label: "Email", required: true },
  { key: "phone", label: "Phone", required: false },
  { key: "companyName", label: "Company Name", required: true },
  { key: "website", label: "Website", required: false },
  { key: "location", label: "City / Location", required: false },
  { key: "serviceArea", label: "Service Area", required: false },
  { key: "industry", label: "Industry", required: false },
  { key: "jobTitle", label: "Job Title", required: false },
  { key: "source", label: "Source", required: false },
  { key: "notes", label: "Notes", required: false },
] as const;

// Common CSV header patterns → Atlas field mapping
const AUTO_MAP_PATTERNS: Record<string, string[]> = {
  firstName: ["first name", "first_name", "fname", "first"],
  lastName: ["last name", "last_name", "lname", "last", "surname"],
  fullName: ["full name", "full_name", "contact name", "contact_name"],
  email: ["email", "email address", "email_address", "e-mail", "work email"],
  phone: ["phone", "phone number", "phone_number", "mobile", "cell", "tel", "telephone", "work phone"],
  companyName: ["company", "company name", "company_name", "organization", "org", "business", "business name"],
  website: ["website", "url", "web", "site", "company website", "company_url"],
  location: ["location", "city", "address", "city/state", "city, state", "region"],
  serviceArea: ["service area", "service_area", "territory", "coverage area"],
  industry: ["industry", "type", "sector", "contractor type", "business type", "company type"],
  jobTitle: ["title", "job title", "job_title", "role", "position", "job"],
  source: ["source", "lead source", "lead_source", "how did you hear", "referral"],
  notes: ["notes", "comments", "description", "details", "memo"],
};

/**
 * Parse raw CSV text into structured rows.
 * Handles quoted fields, commas in values, and various line endings.
 */
export function parseCSV(text: string): CSVRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const rows: CSVRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0 || values.every((v) => !v.trim())) continue;

    const row: CSVRow = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (values[idx] ?? "").trim();
    });
    rows.push(row);
  }

  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        result.push(current);
        current = "";
      } else {
        current += char;
      }
    }
  }
  result.push(current);
  return result;
}

/**
 * Auto-suggest column mappings based on CSV headers.
 */
export function suggestMappings(headers: string[]): ColumnMapping[] {
  const mappings: ColumnMapping[] = [];
  const usedAtlasFields = new Set<string>();

  for (const header of headers) {
    const normalized = header.toLowerCase().trim();
    let matched = false;

    for (const [atlasField, patterns] of Object.entries(AUTO_MAP_PATTERNS)) {
      if (usedAtlasFields.has(atlasField)) continue;
      if (patterns.some((p) => normalized.includes(p))) {
        mappings.push({ csvColumn: header, atlasField });
        usedAtlasFields.add(atlasField);
        matched = true;
        break;
      }
    }

    if (!matched) {
      mappings.push({ csvColumn: header, atlasField: "__ignore__" });
    }
  }

  return mappings;
}

/**
 * Map CSV rows to Atlas leads using column mappings.
 */
export function mapRowsToLeads(rows: CSVRow[], mappings: ColumnMapping[]): MappedLead[] {
  return rows.map((row, idx) => {
    const get = (field: string) => {
      const m = mappings.find((mp) => mp.atlasField === field);
      return m ? (row[m.csvColumn] ?? "").trim() : "";
    };

    const firstName = get("firstName");
    const lastName = get("lastName");
    const fullName = get("fullName") || [firstName, lastName].filter(Boolean).join(" ");

    return {
      firstName,
      lastName,
      fullName,
      email: get("email"),
      phone: get("phone"),
      companyName: get("companyName"),
      website: normalizeUrl(get("website")),
      location: get("location"),
      serviceArea: get("serviceArea"),
      industry: get("industry"),
      jobTitle: get("jobTitle"),
      source: get("source") || "csv_import",
      notes: get("notes"),
      _raw: row,
      _rowIndex: idx,
    };
  });
}

function normalizeUrl(url: string): string {
  if (!url) return "";
  if (url.match(/^https?:\/\//)) return url;
  if (url.match(/^\w+\.\w+/)) return `https://${url}`;
  return url;
}

/**
 * Validate mapped leads.
 */
export function validateLeads(leads: MappedLead[]): ValidationResult {
  const valid: MappedLead[] = [];
  const invalid: ValidationResult["invalid"] = [];
  let emptyCount = 0;

  for (const lead of leads) {
    const errors: string[] = [];

    // Empty row check
    if (!lead.email && !lead.companyName && !lead.fullName) {
      emptyCount++;
      continue;
    }

    // Required field validation
    if (!lead.email) {
      errors.push("Email is required");
    } else if (!isValidEmail(lead.email)) {
      errors.push(`Invalid email: ${lead.email}`);
    }

    if (!lead.companyName) {
      errors.push("Company name is required");
    }

    // URL validation
    if (lead.website && !lead.website.match(/^https?:\/\//)) {
      errors.push(`Invalid URL: ${lead.website}`);
    }

    // Length validation
    if (lead.companyName.length > 200) errors.push("Company name too long (max 200)");
    if (lead.email.length > 254) errors.push("Email too long");
    if (lead.notes.length > 5000) errors.push("Notes too long (max 5000)");

    if (errors.length > 0) {
      invalid.push({ row: lead._raw, rowIndex: lead._rowIndex, errors });
    } else {
      valid.push(lead);
    }
  }

  return {
    valid,
    invalid,
    duplicates: [], // Populated during dedup phase
    stats: {
      totalRows: leads.length,
      validCount: 0, // Set after dedup
      invalidCount: invalid.length,
      duplicateCount: 0,
      emptyCount,
    },
  };
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Normalize email for dedup comparison.
 */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Normalize company name for dedup comparison.
 */
export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Deduplicate leads against existing CRM leads and within the batch.
 */
export function deduplicateLeads(
  validLeads: MappedLead[],
  existingLeads: Array<{ id: string; contact_email?: string; company_name: string }>,
): {
  unique: MappedLead[];
  duplicates: ValidationResult["duplicates"];
} {
  const seenEmails = new Set<string>();
  const seenCompanies = new Map<string, string>(); // normalized → first lead's company
  const unique: MappedLead[] = [];
  const duplicates: ValidationResult["duplicates"] = [];

  // Build lookup of existing leads
  const existingByEmail = new Map<string, string>();
  const existingByCompany = new Map<string, string>();
  for (const existing of existingLeads) {
    if (existing.contact_email) {
      existingByEmail.set(normalizeEmail(existing.contact_email), existing.id);
    }
    existingByCompany.set(normalizeCompany(existing.company_name), existing.id);
  }

  for (const lead of validLeads) {
    const emailKey = normalizeEmail(lead.email);
    const companyKey = normalizeCompany(lead.companyName);

    // Check against existing leads
    if (emailKey && existingByEmail.has(emailKey)) {
      duplicates.push({
        row: lead._raw,
        rowIndex: lead._rowIndex,
        existingLeadId: existingByEmail.get(emailKey),
        reason: `Duplicate email: existing lead has this email`,
      });
      continue;
    }

    if (companyKey && existingByCompany.has(companyKey)) {
      duplicates.push({
        row: lead._raw,
        rowIndex: lead._rowIndex,
        existingLeadId: existingByCompany.get(companyKey),
        reason: `Possible duplicate: similar company name exists`,
      });
      continue;
    }

    // Check within batch
    if (emailKey && seenEmails.has(emailKey)) {
      duplicates.push({
        row: lead._raw,
        rowIndex: lead._rowIndex,
        reason: `Duplicate email within CSV batch`,
      });
      continue;
    }

    if (emailKey) seenEmails.add(emailKey);
    if (companyKey) seenCompanies.set(companyKey, lead.companyName);
    unique.push(lead);
  }

  return { unique, duplicates };
}

/**
 * Generate a unique batch ID for import tracking.
 */
export function generateBatchId(): string {
  return `csv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
