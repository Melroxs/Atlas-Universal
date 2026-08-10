// ---------------------------------------------------------------------------
// Everest — Authority Hierarchy, Source Registry & Provenance
//
// Every authoritative source gets an explicit tier. Knowledge extracted from
// a source carries provenance (who issued it, when, which version, what it
// supersedes). Source Fact (what the source states) is always kept separate
// from Atlas Interpretation (what Atlas believes it means operationally).
// ---------------------------------------------------------------------------

export type AuthorityTier =
  | "tier1_primary"
  | "tier2_standard"
  | "tier3_industry"
  | "tier4_secondary"
  | "tier5_general";

export const AUTHORITY_TIERS: Record<
  AuthorityTier,
  { label: string; weight: number; description: string }
> = {
  tier1_primary: {
    label: "Primary authority",
    weight: 1.0,
    description: "Statutes, regulations, government agencies, regulators, official licensing bodies.",
  },
  tier2_standard: {
    label: "Recognized standard",
    weight: 0.9,
    description: "Accredited standards bodies, recognized technical standards, formal professional standards.",
  },
  tier3_industry: {
    label: "Industry authority",
    weight: 0.75,
    description: "Recognized professional associations, major industry bodies, established certification organizations.",
  },
  tier4_secondary: {
    label: "Secondary source",
    weight: 0.5,
    description: "Legal analysis, academic research, professional commentary, industry publications.",
  },
  tier5_general: {
    label: "General web",
    weight: 0.2,
    description: "General websites — context only, never silently regulatory authority.",
  },
};

export const TIER_ORDER: AuthorityTier[] = [
  "tier1_primary",
  "tier2_standard",
  "tier3_industry",
  "tier4_secondary",
  "tier5_general",
];

export function tierLabel(tier: AuthorityTier): string {
  return AUTHORITY_TIERS[tier].label;
}

export function tierWeight(tier: AuthorityTier): number {
  return AUTHORITY_TIERS[tier].weight;
}

/** Rank two tiers — returns -1/0/1 (higher authority wins). */
export function compareTiers(a: AuthorityTier, b: AuthorityTier): number {
  return TIER_ORDER.indexOf(b) - TIER_ORDER.indexOf(a);
}

// --- Source registry seed ----------------------------------------------------

export interface AuthoritativeSourceSeed {
  sourceId: string;
  name: string;
  organization: string;
  authorityTier: AuthorityTier;
  sourceType: string;
  industry?: string;
  jurisdiction?: string;
  canonicalUrl?: string;
  updateFrequency?: string;
}

/** Real, publicly identifiable authoritative sources. Knowledge items that
 *  rely on them must be reviewed before being treated as legal advice. */
export const AUTHORITATIVE_SOURCE_SEEDS: AuthoritativeSourceSeed[] = [
  {
    sourceId: "osha-general-industry",
    name: "OSHA — General Industry Standards (29 CFR 1910)",
    organization: "US Occupational Safety and Health Administration",
    authorityTier: "tier1_primary",
    sourceType: "regulation",
    industry: "manufacturing",
    jurisdiction: "United States",
    canonicalUrl: "https://www.osha.gov/laws-regs/regulations/standardnumber/1910",
    updateFrequency: "Continuous",
  },
  {
    sourceId: "osha-construction",
    name: "OSHA — Construction Standards (29 CFR 1926)",
    organization: "US Occupational Safety and Health Administration",
    authorityTier: "tier1_primary",
    sourceType: "regulation",
    industry: "construction",
    jurisdiction: "United States",
    canonicalUrl: "https://www.osha.gov/laws-regs/regulations/standardnumber/1926",
    updateFrequency: "Continuous",
  },
  {
    sourceId: "epa-lead-rrp",
    name: "EPA — Lead Renovation, Repair & Painting Rule",
    organization: "US Environmental Protection Agency",
    authorityTier: "tier1_primary",
    sourceType: "regulation",
    industry: "construction",
    jurisdiction: "United States",
    canonicalUrl: "https://www.epa.gov/lead/renovation-repair-and-painting-program",
    updateFrequency: "Periodic",
  },
  {
    sourceId: "irs-recordkeeping",
    name: "IRS — Recordkeeping for Businesses",
    organization: "US Internal Revenue Service",
    authorityTier: "tier1_primary",
    sourceType: "guidance",
    jurisdiction: "United States",
    canonicalUrl: "https://www.irs.gov/businesses/small-businesses-self-employed/recordkeeping",
    updateFrequency: "Periodic",
  },
  {
    sourceId: "ftc-privacy",
    name: "FTC — Consumer Privacy & Data Security Guidance",
    organization: "US Federal Trade Commission",
    authorityTier: "tier1_primary",
    sourceType: "guidance",
    jurisdiction: "United States",
    canonicalUrl: "https://www.ftc.gov/business-guidance",
    updateFrequency: "Periodic",
  },
  {
    sourceId: "fl-dbpr-contractor",
    name: "Florida DBPR — Certified & Registered Contractor Licensing",
    organization: "Florida Department of Business & Professional Regulation",
    authorityTier: "tier1_primary",
    sourceType: "official_licensing",
    industry: "construction",
    jurisdiction: "United States > Florida",
    canonicalUrl: "https://www.myfloridalicense.com",
    updateFrequency: "Periodic",
  },
  {
    sourceId: "tx-tdlr-contractor",
    name: "Texas TDLR — Contractor Licensing & Regulation",
    organization: "Texas Department of Licensing and Regulation",
    authorityTier: "tier1_primary",
    sourceType: "official_licensing",
    industry: "construction",
    jurisdiction: "United States > Texas",
    canonicalUrl: "https://www.tdlr.texas.gov",
    updateFrequency: "Periodic",
  },
  {
    sourceId: "nfpa",
    name: "NFPA Codes & Standards",
    organization: "National Fire Protection Association",
    authorityTier: "tier2_standard",
    sourceType: "standard",
    industry: "construction",
    canonicalUrl: "https://www.nfpa.org/codes-and-standards",
    updateFrequency: "Periodic",
  },
  {
    sourceId: "iso-9001",
    name: "ISO 9001 — Quality Management Systems",
    organization: "International Organization for Standardization",
    authorityTier: "tier2_standard",
    sourceType: "standard",
    industry: "manufacturing",
    canonicalUrl: "https://www.iso.org/standard/62085.html",
    updateFrequency: "Periodic",
  },
  {
    sourceId: "iicrc-s500",
    name: "IICRC S500 — Standard for Water Damage Restoration",
    organization: "Institute of Inspection, Cleaning and Restoration Certification",
    authorityTier: "tier3_industry",
    sourceType: "standard",
    industry: "insurance restoration",
    canonicalUrl: "https://iicrc.org/standards",
    updateFrequency: "Periodic",
  },
  {
    sourceId: "iicrc-s520",
    name: "IICRC S520 — Standard for Mold Remediation",
    organization: "Institute of Inspection, Cleaning and Restoration Certification",
    authorityTier: "tier3_industry",
    sourceType: "standard",
    industry: "insurance restoration",
    canonicalUrl: "https://iicrc.org/standards",
    updateFrequency: "Periodic",
  },
  {
    sourceId: "iicrc-s100",
    name: "IICRC S100 — Standard for Carpet Cleaning",
    organization: "Institute of Inspection, Cleaning and Restoration Certification",
    authorityTier: "tier3_industry",
    sourceType: "standard",
    industry: "insurance restoration",
    canonicalUrl: "https://iicrc.org/standards",
    updateFrequency: "Periodic",
  },
  {
    sourceId: "ashrae-62",
    name: "ASHRAE 62.1 — Ventilation for Acceptable Indoor Air Quality",
    organization: "American Society of Heating, Refrigerating and Air-Conditioning Engineers",
    authorityTier: "tier2_standard",
    sourceType: "standard",
    industry: "construction",
    canonicalUrl: "https://www.ashrae.org/technical-resources/standards-and-guidelines",
    updateFrequency: "Periodic",
  },
  {
    sourceId: "icc-building-codes",
    name: "ICC International Building Codes",
    organization: "International Code Council",
    authorityTier: "tier2_standard",
    sourceType: "standard",
    industry: "construction",
    canonicalUrl: "https://www.iccsafe.org/codes-tech-support/codes/",
    updateFrequency: "Periodic",
  },
  {
    sourceId: "gaap",
    name: "US GAAP — Accounting Standards",
    organization: "FASB",
    authorityTier: "tier2_standard",
    sourceType: "standard",
    industry: "financial services",
    jurisdiction: "United States",
    canonicalUrl: "https://fasb.org/standards",
    updateFrequency: "Periodic",
  },
  {
    sourceId: "restoration-industry-association",
    name: "Restoration Industry Association publications",
    organization: "RIA",
    authorityTier: "tier3_industry",
    sourceType: "industry_body",
    industry: "insurance restoration",
    canonicalUrl: "https://www.restorationindustry.org",
    updateFrequency: "Periodic",
  },
  {
    sourceId: "crc-claims-process",
    name: "Claims & Litigation Management guidance",
    organization: "Claims and Litigation Management Alliance",
    authorityTier: "tier4_secondary",
    sourceType: "industry_body",
    industry: "insurance restoration",
    canonicalUrl: "https://www.theclm.org",
    updateFrequency: "Periodic",
  },
];

/**
 * Retrieval metadata per source. implementationStatus is HONEST: sources
 * whose pages Atlas can safely fetch (allowlisted official HTML) are
 * "implemented"; paywalled/standards-publisher content is declared but never
 * claimed synchronized. enabled=false keeps a source registered but out of
 * the check loop.
 */
export const SOURCE_RETRIEVAL_META: Record<
  string,
  {
    retrievalMethod: string;
    implementationStatus: string;
    enabled: boolean;
    subjects: string[];
    industries?: string[];
  }
> = {
  "osha-general-industry": { retrievalMethod: "official_html", implementationStatus: "implemented", enabled: true, subjects: ["workplace safety", "general industry", "exposure limits"], industries: ["manufacturing", "insurance restoration"] },
  "osha-construction": { retrievalMethod: "official_html", implementationStatus: "implemented", enabled: true, subjects: ["construction safety", "excavation", "fall protection"], industries: ["construction", "insurance restoration"] },
  "epa-lead-rrp": { retrievalMethod: "official_html", implementationStatus: "implemented", enabled: true, subjects: ["lead safety", "renovation", "certification"], industries: ["construction", "insurance restoration"] },
  "irs-recordkeeping": { retrievalMethod: "official_html", implementationStatus: "implemented", enabled: true, subjects: ["recordkeeping", "tax records", "deductions"] },
  "ftc-privacy": { retrievalMethod: "official_html", implementationStatus: "implemented", enabled: true, subjects: ["data security", "consumer privacy"] },
  "fl-dbpr-contractor": { retrievalMethod: "official_html", implementationStatus: "implemented", enabled: true, subjects: ["contractor licensing", "florida"], industries: ["construction", "insurance restoration"] },
  "tx-tdlr-contractor": { retrievalMethod: "official_html", implementationStatus: "implemented", enabled: true, subjects: ["contractor licensing", "texas"], industries: ["construction"] },
  nfpa: { retrievalMethod: "official_document", implementationStatus: "not_implemented", enabled: true, subjects: ["fire codes", "standards"] },
  "iso-9001": { retrievalMethod: "standards_publisher", implementationStatus: "not_implemented", enabled: false, subjects: ["quality management"] },
  "iicrc-s500": { retrievalMethod: "standards_publisher", implementationStatus: "not_implemented", enabled: false, subjects: ["water damage restoration"], industries: ["insurance restoration"] },
  "iicrc-s520": { retrievalMethod: "standards_publisher", implementationStatus: "not_implemented", enabled: false, subjects: ["mold remediation"], industries: ["insurance restoration"] },
  "iicrc-s100": { retrievalMethod: "standards_publisher", implementationStatus: "not_implemented", enabled: false, subjects: ["cleaning standards"], industries: ["insurance restoration"] },
  "ashrae-62": { retrievalMethod: "standards_publisher", implementationStatus: "not_implemented", enabled: false, subjects: ["ventilation", "indoor air quality"] },
  "icc-building-codes": { retrievalMethod: "standards_publisher", implementationStatus: "not_implemented", enabled: false, subjects: ["building codes"] },
  gaap: { retrievalMethod: "standards_publisher", implementationStatus: "not_implemented", enabled: false, subjects: ["accounting standards"] },
  "restoration-industry-association": { retrievalMethod: "official_html", implementationStatus: "implemented", enabled: true, subjects: ["restoration industry", "best practices"], industries: ["insurance restoration"] },
  "crc-claims-process": { retrievalMethod: "official_html", implementationStatus: "implemented", enabled: true, subjects: ["claims management"], industries: ["insurance restoration"] },
};

// --- Knowledge seed ----------------------------------------------------------

export interface AuthoritativeKnowledgeSeed {
  knowledgeId: string;
  sourceId: string;
  title: string;
  statement: string;
  interpretation?: string;
  knowledgeType: string;
  jurisdiction?: string;
  industry?: string;
  version?: string;
  confidence: number;
}

/**
 * Seed knowledge is written conservatively: statements stay close to what the
 * named source actually says; anything Atlas infers operationally is labeled
 * as interpretation and every regulatory item is marked for review before
 * operational use. Never present interpretation as law or regulation.
 */
export const AUTHORITATIVE_KNOWLEDGE_SEEDS: AuthoritativeKnowledgeSeed[] = [
  {
    knowledgeId: "osha-1910-134-respiratory",
    sourceId: "osha-general-industry",
    title: "Respiratory protection requirements (29 CFR 1910.134)",
    statement:
      "Employers must provide respiratory protection when employees are exposed to airborne hazards at or above the applicable exposure limit, including a written program and fit testing.",
    interpretation:
      "Restoration and construction crews doing demolition, sanding or mold-related work should have a respiratory protection program before exposure occurs.",
    knowledgeType: "requirement",
    jurisdiction: "United States",
    industry: "insurance restoration",
    version: "1910.134",
    confidence: 0.85,
  },
  {
    knowledgeId: "osha-1926-651-trench",
    sourceId: "osha-construction",
    title: "Excavation protections (29 CFR 1926.651–652)",
    statement:
      "All excavations must have a competent person conducting inspections and protective systems for trenches deeper than 5 feet.",
    interpretation:
      "Any underground utility or foundation work on a job triggers excavation safety obligations — verify a competent person is assigned.",
    knowledgeType: "requirement",
    jurisdiction: "United States",
    industry: "construction",
    version: "1926.651",
    confidence: 0.85,
  },
  {
    knowledgeId: "epa-rrp-certification",
    sourceId: "epa-lead-rrp",
    title: "Lead RRP certification for renovation work",
    statement:
      "Firms performing renovation, repair or painting on pre-1978 housing or child-occupied facilities must be EPA-certified and follow lead-safe work practices.",
    interpretation:
      "Restoration jobs on older properties should confirm lead certification before demolition or repainting work begins.",
    knowledgeType: "requirement",
    jurisdiction: "United States",
    industry: "insurance restoration",
    version: "40 CFR 745",
    confidence: 0.8,
  },
  {
    knowledgeId: "irs-business-records",
    sourceId: "irs-recordkeeping",
    title: "Business recordkeeping",
    statement:
      "Businesses must keep records that support items reported on their tax returns, including income, expenses and deductions.",
    interpretation:
      "Complete job files (contracts, invoices, receipts) double as tax documentation — gaps there create both payment and tax exposure.",
    knowledgeType: "guidance",
    jurisdiction: "United States",
    version: "Pub. 583",
    confidence: 0.8,
  },
  {
    knowledgeId: "ftc-data-security",
    sourceId: "ftc-privacy",
    title: "Reasonable data security for customer information",
    statement:
      "The FTC expects businesses to maintain reasonable security for customer personal information and to avoid deceptive privacy practices.",
    interpretation:
      "Holding customer policy numbers, photos and inspection data means Atlas recommends documenting a data handling policy.",
    knowledgeType: "guidance",
    jurisdiction: "United States",
    version: "2021 safeguards",
    confidence: 0.7,
  },
  {
    knowledgeId: "fl-contractor-license",
    sourceId: "fl-dbpr-contractor",
    title: "Florida contractor licensing",
    statement:
      "Florida requires state certification or registration for construction contracting, with separate qualifications for general, building and specialty contractors.",
    interpretation:
      "Restoration work in Florida that constitutes contracting generally requires DBPR licensure; verify before bidding public or insurance work.",
    knowledgeType: "requirement",
    jurisdiction: "United States > Florida",
    industry: "construction",
    version: "Ch. 489 F.S.",
    confidence: 0.75,
  },
  {
    knowledgeId: "tx-contractor-license",
    sourceId: "tx-tdlr-contractor",
    title: "Texas contractor regulation",
    statement:
      "Texas licenses certain trades (electrical, plumbing, air conditioning) at the state level; general contracting is largely unlicensed at the state level.",
    interpretation:
      "In Texas, confirm trade-specific licensing for electrical/plumbing/AC work even where general contracting does not require a state license.",
    knowledgeType: "guidance",
    jurisdiction: "United States > Texas",
    industry: "construction",
    version: "TDLR statutes",
    confidence: 0.7,
  },
  {
    knowledgeId: "iicrc-s500-water",
    sourceId: "iicrc-s500",
    title: "IICRC S500 water damage restoration standard",
    statement:
      "S500 defines categories of water contamination and classes of water damage, and sets out the documentation and drying practices expected of certified restorers.",
    interpretation:
      "Drying logs and category/class classification in job files are the documented practices this standard expects — strong evidence in disputes.",
    knowledgeType: "standard",
    industry: "insurance restoration",
    version: "S500 6th ed.",
    confidence: 0.8,
  },
  {
    knowledgeId: "iicrc-s520-mold",
    sourceId: "iicrc-s520",
    title: "IICRC S520 mold remediation standard",
    statement:
      "S520 sets procedures for mold remediation including containment, personal protection and post-remediation verification.",
    interpretation:
      "Mold scopes should reference containment and clearance testing to match what the standard expects.",
    knowledgeType: "standard",
    industry: "insurance restoration",
    version: "S520 3rd ed.",
    confidence: 0.8,
  },
  {
    knowledgeId: "gaap-accrual",
    sourceId: "gaap",
    title: "Accrual accounting basis",
    statement:
      "US GAAP requires accrual accounting: revenue is recognized when earned and expenses when incurred, not when cash moves.",
    interpretation:
      "'Sales' reported by a company can differ from cash received in the same period; Atlas distinguishes billed, earned and collected.",
    knowledgeType: "standard",
    jurisdiction: "United States",
    version: "ASC 606",
    confidence: 0.9,
  },
];

// --- Provenance ---------------------------------------------------------------

export interface Provenance {
  sourceId: string;
  sourceName: string;
  organization: string;
  authorityTier: AuthorityTier;
  canonicalUrl?: string;
  sourceType: string;
  publicationDate?: number;
  retrievalDate?: number;
  effectiveDate?: number;
  version?: string;
  status: string;
  supersedes?: string[];
  supersededBy?: string[];
}

export function buildProvenance(
  knowledge: {
    sourceId: string;
    version?: string;
    publicationDate?: number;
    effectiveDate?: number;
    status: string;
    supersedes?: string[];
    supersededBy?: string[];
  },
  source: {
    name: string;
    organization: string;
    authorityTier: AuthorityTier;
    canonicalUrl?: string;
    sourceType: string;
  },
  retrievalTime: number,
): Provenance {
  return {
    sourceId: knowledge.sourceId,
    sourceName: source.name,
    organization: source.organization,
    authorityTier: source.authorityTier,
    canonicalUrl: source.canonicalUrl,
    sourceType: source.sourceType,
    publicationDate: knowledge.publicationDate,
    retrievalDate: retrievalTime,
    effectiveDate: knowledge.effectiveDate,
    version: knowledge.version,
    status: knowledge.status,
    supersedes: knowledge.supersedes,
    supersededBy: knowledge.supersededBy,
  };
}

/** The honest "Where did you get this?" answer. */
export function provenanceAnswer(p: Provenance): string {
  const issued = p.publicationDate
    ? `, published ${new Date(p.publicationDate).toISOString().slice(0, 10)}`
    : "";
  const effective = p.effectiveDate
    ? `, effective ${new Date(p.effectiveDate).toISOString().slice(0, 10)}`
    : "";
  const retrieved = p.retrievalDate
    ? ` Retrieved ${new Date(p.retrievalDate).toISOString().slice(0, 10)}.`
    : " Retrieval date unknown.";
  return `${p.sourceName} (${tierLabel(p.authorityTier)})${issued}${effective}${p.version ? `, version ${p.version}` : ""}.${retrieved}`;
}

/**
 * Register a new version of knowledge: mark the rows it supersedes as
 * superseded and link them. Returns the ids to patch. Never deletes history.
 */
export function applySupersession(
  rows: Array<{ knowledgeId: string; status: string; supersededBy?: string[] }>,
  newRow: { knowledgeId: string; supersedes?: string[] },
): Array<{ knowledgeId: string; patch: { status: "superseded"; supersededBy: string[] } }> {
  if (!newRow.supersedes?.length) return [];
  const target = new Set(newRow.supersedes);
  return rows
    .filter((r) => target.has(r.knowledgeId) && r.status === "active")
    .map((r) => ({
      knowledgeId: r.knowledgeId,
      patch: {
        status: "superseded" as const,
        supersededBy: [...(r.supersededBy ?? []), newRow.knowledgeId],
      },
    }));
}
