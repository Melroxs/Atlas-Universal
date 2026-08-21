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
  /** Custom field values keyed by field ID: { fieldId: { value: any, fieldKey: string, fieldName: string, fieldType: string } } */
  customFields: Record<string, { value: unknown; fieldKey: string; fieldName: string; fieldType: string }>;
  _raw: CSVRow;
  _rowIndex: number;
}

export interface ColumnMapping {
  csvColumn: string;
  atlasField: string;
  /** Set when this column maps to a custom field */
  customFieldId?: string;
  /** True when this column maps to an existing or newly created custom field */
  isCustom?: boolean;
}

/** Custom field definition from crm_custom_fields table */
export interface CustomFieldDefinition {
  id: string;
  tenant_id: string;
  name: string;
  key: string;
  field_type: string;
  entity_type: string;
  description?: string | null;
  options?: string[] | null;
  created_at: string;
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

// ── Custom Field Support ───────────────────────────────────────────────

/** Field type options available when creating a new custom field */
export const CUSTOM_FIELD_TYPES = [
  { key: "text", label: "Text" },
  { key: "long_text", label: "Long Text" },
  { key: "number", label: "Number" },
  { key: "boolean", label: "Boolean" },
  { key: "date", label: "Date" },
  { key: "url", label: "URL" },
  { key: "select", label: "Select" },
  { key: "multi_select", label: "Multi-select" },
] as const;

/**
 * Generate a safe snake_case key from a display name.
 * - lowercase
 * - spaces → underscores
 * - strips non-alphanumeric chars (except underscores)
 * - collapses multiple underscores
 * - trims leading/trailing underscores
 */
export function generateFieldKey(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Ensure a field key is unique by appending a numeric suffix if needed.
 */
export function ensureUniqueKey(
  baseKey: string,
  existingKeys: Set<string>,
): string {
  let candidate = baseKey || "custom_field";
  let counter = 1;
  while (existingKeys.has(candidate)) {
    counter++;
    candidate = `${baseKey}_${counter}`;
  }
  return candidate;
}

/**
 * Validate a custom field value against its field type.
 * Returns null if valid, or an error message if invalid.
 */
export function validateCustomFieldValue(
  value: string,
  fieldType: string,
  fieldName: string,
): string | null {
  if (!value || !value.trim()) return null; // empty is always valid

  switch (fieldType) {
    case "number":
      if (isNaN(Number(value))) return `${fieldName} must be a number`;
      return null;
    case "boolean":
      if (!/^(true|false|yes|no|1|0)$/i.test(value.trim()))
        return `${fieldName} must be true/false/yes/no/1/0`;
      return null;
    case "url":
      try {
        new URL(value.trim());
        return null;
      } catch {
        return `${fieldName} must be a valid URL`;
      }
    case "date":
      if (isNaN(Date.parse(value))) return `${fieldName} must be a valid date`;
      return null;
    default:
      return null;
  }
}

/**
 * Parse a string value into the appropriate type for storage as JSONB.
 */
export function parseCustomFieldValue(value: string, fieldType: string): unknown {
  if (!value || !value.trim()) return null;
  const trimmed = value.trim();

  switch (fieldType) {
    case "number":
      return Number(trimmed);
    case "boolean":
      return /^(true|yes|1)$/i.test(trimmed);
    case "date":
      return new Date(trimmed).toISOString();
    case "multi_select":
      return trimmed.split(/[,;]\s*/).map((s) => s.trim()).filter(Boolean);
    case "select":
    case "text":
    case "long_text":
    case "url":
    default:
      return trimmed;
  }
}

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
 * Optionally matches against existing custom field definitions.
 */
export function suggestMappings(
  headers: string[],
  existingCustomFields: CustomFieldDefinition[] = [],
): ColumnMapping[] {
  const mappings: ColumnMapping[] = [];
  const usedAtlasFields = new Set<string>();

  // Build a lookup of existing custom fields by their normalized name/key
  const customFieldByName = new Map<string, CustomFieldDefinition>();
  const customFieldByKey = new Map<string, CustomFieldDefinition>();
  for (const cf of existingCustomFields) {
    customFieldByName.set(cf.name.toLowerCase().trim(), cf);
    customFieldByKey.set(cf.key, cf);
  }

  for (const header of headers) {
    const normalized = header.toLowerCase().trim();
    let matched = false;

    // First: try to match against existing built-in Atlas fields
    for (const [atlasField, patterns] of Object.entries(AUTO_MAP_PATTERNS)) {
      if (usedAtlasFields.has(atlasField)) continue;
      if (patterns.some((p) => normalized.includes(p))) {
        mappings.push({ csvColumn: header, atlasField });
        usedAtlasFields.add(atlasField);
        matched = true;
        break;
      }
    }

    // Second: try to match against existing custom fields
    if (!matched) {
      const cfByName = customFieldByName.get(normalized);
      if (cfByName) {
        mappings.push({
          csvColumn: header,
          atlasField: "__custom__",
          customFieldId: cfByName.id,
          isCustom: true,
        });
        matched = true;
      }
    }

    // Third: try partial match on custom field names (e.g. "Insurance Focus" matches "insurance focus (site says)")
    if (!matched) {
      for (const [, cf] of customFieldByName) {
        if (cf.name.toLowerCase().trim().includes(normalized) || normalized.includes(cf.name.toLowerCase().trim())) {
          mappings.push({
            csvColumn: header,
            atlasField: "__custom__",
            customFieldId: cf.id,
            isCustom: true,
          });
          matched = true;
          break;
        }
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
 * Custom field mappings are captured in each lead's customFields record.
 */
export function mapRowsToLeads(
  rows: CSVRow[],
  mappings: ColumnMapping[],
  customFieldDefs: CustomFieldDefinition[] = [],
): MappedLead[] {
  // Build a lookup from custom field ID to definition
  const cfDefById = new Map<string, CustomFieldDefinition>();
  for (const cf of customFieldDefs) {
    cfDefById.set(cf.id, cf);
  }

  return rows.map((row, idx) => {
    const get = (field: string) => {
      const m = mappings.find((mp) => mp.atlasField === field);
      return m ? (row[m.csvColumn] ?? "").trim() : "";
    };

    const firstName = get("firstName");
    const lastName = get("lastName");
    const fullName = get("fullName") || [firstName, lastName].filter(Boolean).join(" ");

    // Collect custom field values from the mapping
    const customFields: MappedLead["customFields"] = {};
    for (const m of mappings) {
      if (m.isCustom && m.customFieldId) {
        const def = cfDefById.get(m.customFieldId);
        const rawValue = (row[m.csvColumn] ?? "").trim();
        if (rawValue && def) {
          customFields[m.customFieldId] = {
            value: parseCustomFieldValue(rawValue, def.field_type),
            fieldKey: def.key,
            fieldName: def.name,
            fieldType: def.field_type,
          };
        }
      }
    }

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
      customFields,
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
 * Validate mapped leads, including custom field value types.
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

    // Custom field type validation
    for (const [, cf] of Object.entries(lead.customFields ?? {})) {
      if (cf.value === null || cf.value === undefined || cf.value === "") continue;
      const rawValue = String(cf.value);
      const validationError = validateCustomFieldValue(rawValue, cf.fieldType, cf.fieldName);
      if (validationError) {
        errors.push(validationError);
      }
    }

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
