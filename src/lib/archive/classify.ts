/**
 * Phase 13 — universal document classification for archived files.
 *
 * Classification is EVIDENCE-BASED, never guessed from nowhere. Every result
 * carries its basis (extension / filename / folder context / content) and a
 * confidence. Folder structure is treated as contextual signal — helpful,
 * never unquestionable truth. The taxonomy is open: industry packs can extend
 * it; Atlas is not hardcoded around insurance restoration.
 */

export const ARCHIVE_CLASSIFICATIONS = [
  "company profile",
  "financial",
  "accounting",
  "invoice",
  "receipt",
  "contract",
  "proposal",
  "estimate",
  "claim",
  "supplement",
  "policy",
  "procedure",
  "employee",
  "customer",
  "vendor",
  "project",
  "property",
  "compliance",
  "legal",
  "insurance",
  "correspondence",
  "email",
  "report",
  "spreadsheet",
  "presentation",
  "image",
  "Xactimate",
  "depreciation",
  "payment record",
  "unknown",
] as const;

export type ArchiveClassification = (typeof ARCHIVE_CLASSIFICATIONS)[number];

export interface ClassificationResult {
  classification: ArchiveClassification;
  basis: string;
  confidence: number;
}

/** Strong keyword → classification rules (filename OR folder context). */
const KEYWORD_RULES: Array<{
  re: RegExp;
  classification: ArchiveClassification;
  weight: number;
}> = [
  { re: /xactimate|xim/i, classification: "Xactimate", weight: 0.95 },
  { re: /supplement/i, classification: "supplement", weight: 0.92 },
  { re: /estimate|scope of work|scope_|scopework/i, classification: "estimate", weight: 0.9 },
  { re: /invoice|receipt|billing|bill\b/i, classification: "invoice", weight: 0.9 },
  { re: /payment|paid|received.*check|check.*received|accounting/i, classification: "payment record", weight: 0.85 },
  { re: /depreciat/i, classification: "depreciation", weight: 0.9 },
  { re: /claim[-_ ]?\d|claims?\b|adjuster|carrier|insurance[-_ ]?loss/i, classification: "claim", weight: 0.85 },
  { re: /insurance|policy[-_ ]?(number|no)?\b|coverage/i, classification: "insurance", weight: 0.8 },
  { re: /contract|agreement|signed/gi, classification: "contract", weight: 0.88 },
  { re: /proposal|quote\b|bid\b/gi, classification: "proposal", weight: 0.85 },
  { re: /sop\b|procedure|standard operating/gi, classification: "procedure", weight: 0.85 },
  { re: /^policy|policies|employee[-_ ]?handbook|handbook/gi, classification: "policy", weight: 0.8 },
  { re: /resume|employee|staff|hiring|onboarding|payroll|w-2|w2|i-9|1099/gi, classification: "employee", weight: 0.8 },
  { re: /customer|client|account[-_ ]?list|lead[-_ ]?list|contact/gi, classification: "customer", weight: 0.75 },
  { re: /vendor|supplier|subcontractor|sub[-_ ]?contractor/gi, classification: "vendor", weight: 0.8 },
  { re: /project|job[-_ ]?folder|work[-_ ]?order|w\.?o\.?/gi, classification: "project", weight: 0.7 },
  { re: /property|address|deed|mortgage|title/gi, classification: "property", weight: 0.7 },
  { re: /compliance|audit|regulatory|regulation|osha|environmental/gi, classification: "compliance", weight: 0.85 },
  { re: /legal|lawsuit|litigation|attorney|counsel|affidavit/gi, classification: "legal", weight: 0.8 },
  { re: /correspondence|letter|memo|notice/gi, classification: "correspondence", weight: 0.7 },
  { re: /email|outlook|\.eml/gi, classification: "email", weight: 0.9 },
  { re: /report|summary|analysis/gi, classification: "report", weight: 0.65 },
  { re: /financial|p&l|profit|balance[-_ ]?sheet|cash[-_ ]?flow|statement/gi, classification: "financial", weight: 0.9 },
  { re: /company[-_ ]?profile|about[-_ ]?us|brochure|capabilit/gi, classification: "company profile", weight: 0.85 },
];

const EXT_CLASSIFICATION: Record<string, { classification: ArchiveClassification; weight: number }> = {
  xlsx: { classification: "spreadsheet", weight: 0.9 },
  xls: { classification: "spreadsheet", weight: 0.9 },
  csv: { classification: "spreadsheet", weight: 0.9 },
  pptx: { classification: "presentation", weight: 0.9 },
  ppt: { classification: "presentation", weight: 0.9 },
  jpg: { classification: "image", weight: 0.95 },
  jpeg: { classification: "image", weight: 0.95 },
  png: { classification: "image", weight: 0.95 },
  webp: { classification: "image", weight: 0.95 },
  tif: { classification: "image", weight: 0.95 },
  tiff: { classification: "image", weight: 0.95 },
  gif: { classification: "image", weight: 0.95 },
  pdf: { classification: "report", weight: 0.4 },
  docx: { classification: "report", weight: 0.4 },
  doc: { classification: "report", weight: 0.4 },
  txt: { classification: "report", weight: 0.3 },
  md: { classification: "report", weight: 0.3 },
  rtf: { classification: "report", weight: 0.3 },
  eml: { classification: "email", weight: 0.9 },
  msg: { classification: "email", weight: 0.9 },
  json: { classification: "report", weight: 0.35 },
  xml: { classification: "report", weight: 0.35 },
};

/** Folder-context signals — the folder the file lives in suggests its role. */
const FOLDER_RULES: Array<{
  re: RegExp;
  classification: ArchiveClassification;
  weight: number;
}> = [
  { re: /claims?/i, classification: "claim", weight: 0.7 },
  { re: /supplements?/i, classification: "supplement", weight: 0.75 },
  { re: /estimates?|scopes?/i, classification: "estimate", weight: 0.7 },
  { re: /invoices?|billing|ar\b/i, classification: "invoice", weight: 0.7 },
  { re: /payments?|ap\b/i, classification: "payment record", weight: 0.7 },
  { re: /contracts?/i, classification: "contract", weight: 0.7 },
  { re: /insurance|policies?/i, classification: "insurance", weight: 0.7 },
  { re: /employees?|hr\b|staff/i, classification: "employee", weight: 0.65 },
  { re: /customers?|clients?/i, classification: "customer", weight: 0.65 },
  { re: /vendors?|suppliers?/i, classification: "vendor", weight: 0.65 },
  { re: /projects?|jobs?/i, classification: "project", weight: 0.6 },
  { re: /properties?/i, classification: "property", weight: 0.6 },
  { re: /legal|litigation/i, classification: "legal", weight: 0.6 },
  { re: /compliance|regulatory/i, classification: "compliance", weight: 0.65 },
  { re: /financial|accounting|bookkeeping/i, classification: "financial", weight: 0.65 },
];

/**
 * Classify a single archived file from its path + a small content sample.
 * Basis is recorded so the user can see WHY Atlas called it what it did.
 */
export function classifyFile(
  path: string,
  size: number,
  contentSample?: string,
): ClassificationResult {
  const filename = (path.split("/").pop() ?? path).toLowerCase();
  const folder = path.split("/").slice(0, -1).join("/").toLowerCase();
  const ext = filename.split(".").pop() ?? "";

  // 1. Filename / folder keywords (strongest evidence).
  let best: { classification: ArchiveClassification; weight: number; basis: string } | null = null;
  for (const rule of KEYWORD_RULES) {
    if (rule.re.test(filename)) {
      if (!best || rule.weight > best.weight) {
        best = { classification: rule.classification, weight: rule.weight, basis: "filename" };
      }
    }
  }
  if (!best) {
    for (const rule of FOLDER_RULES) {
      if (rule.re.test(folder)) {
        best = { classification: rule.classification, weight: rule.weight, basis: "folder context" };
        break;
      }
    }
  }

  // 2. Extension-based default.
  const extRule = EXT_CLASSIFICATION[ext];
  if (!best && extRule) {
    best = { classification: extRule.classification, weight: extRule.weight, basis: "file type" };
  }

  // 3. Content sniffing for text files (spreadsheet-y rows, invoice lines…).
  if (!best || best.weight < 0.6) {
    const sample = (contentSample ?? "").slice(0, 2000).toLowerCase();
    if (sample) {
      if (/invoice|amount due|total due|payment terms/i.test(sample)) {
        best = { classification: "invoice", weight: 0.6, basis: "content" };
      } else if (/claim\s*no|claim number|date of loss|adjuster/i.test(sample)) {
        best = { classification: "claim", weight: 0.6, basis: "content" };
      } else if (/policy number|coverage|insured/i.test(sample)) {
        best = { classification: "insurance", weight: 0.6, basis: "content" };
      }
    }
  }

  if (!best) {
    // Empty spreadsheets / images with no folder signal stay honest.
    if (extRule) {
      return {
        classification: extRule.classification,
        basis: "file type",
        confidence: 0.9,
      };
    }
    return { classification: "unknown", basis: "no evidence", confidence: 0.2 };
  }

  const confidence = Math.min(0.95, Math.max(0.3, best.weight));
  return {
    classification: best.classification,
    basis: best.basis,
    confidence,
  };
}

/** True when a parser exists for this extension (mirrors backend parsers). */
export function isSupportedForIngestion(extension: string): boolean {
  // This list must stay in lockstep with the canonical format contract in
  // src/lib/ingest/formats.ts — the archive review and the ingestion core can
  // never disagree about what Atlas can ingest. Legacy .doc and .rtf have no
  // text extractor (formats.ts marks them unsupported with an honest reason);
  // nested zip/rar are containers, not ingestible documents.
  const SUPPORTED = new Set([
    "pdf", "docx", "txt", "md", "markdown",
    "xls", "xlsx", "csv",
    "json", "xml", "html", "htm", "eml",
    // Images are stored + represented as evidence even though no OCR is
    // available (Phase 15): the ingestion core records an honest
    // content_extraction_unavailable state instead of fabricating text.
    "jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "svg",
  ]);
  return SUPPORTED.has(extension.toLowerCase());
}
