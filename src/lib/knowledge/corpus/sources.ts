// ---------------------------------------------------------------------------
// Atlas Knowledge Corpus — Sources & Provenance
//
// The 5 authoritative sources for the Atlas Insurance Restoration Industry
// Knowledge Corpus, plus Atlas-curated provenance.
// ---------------------------------------------------------------------------

import type { CorpusProvenanceRecord } from "./manifest";

/**
 * The 5 authoritative sources for this corpus release.
 * These map to provenance records in atlasIndustryProvenance.
 */
export const CORPUS_SOURCES: CorpusProvenanceRecord[] = [
  {
    sourceId: "fema-flood-insurance",
    sourceName: "FEMA National Flood Insurance Program (NFIP)",
    organization: "US FEMA",
    authorityTier: "tier1_primary",
    sourceType: "regulation",
    canonicalUrl: "https://www.fema.gov/flood-insurance",
    status: "active",
  },
  {
    sourceId: "iicrc-standards",
    sourceName: "IICRC Restoration Standards (S500, S520, S530)",
    organization: "Institute of Inspection, Cleaning and Restoration Certification",
    authorityTier: "tier2_authoritative",
    sourceType: "standard",
    canonicalUrl: "https://www.iicrc.org/standards/",
    status: "active",
  },
  {
    sourceId: "osha-construction",
    sourceName: "OSHA Construction Standards (29 CFR 1926)",
    organization: "US OSHA",
    authorityTier: "tier1_primary",
    sourceType: "regulation",
    canonicalUrl: "https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1926",
    status: "active",
  },
  {
    sourceId: "epa-regulations",
    sourceName: "EPA Lead RRP Rule & Asbestos Regulations",
    organization: "US EPA",
    authorityTier: "tier1_primary",
    sourceType: "regulation",
    canonicalUrl: "https://www.epa.gov/lead",
    status: "active",
  },
  {
    sourceId: "insurance-industry-practice",
    sourceName: "U.S. Insurance Restoration Industry Practice & Guidance",
    organization: "Atlas (curated from industry sources)",
    authorityTier: "tier3_industry",
    sourceType: "curated",
    status: "active",
  },
];

/**
 * All provenance records for the corpus — includes the 5 authoritative sources
 * plus Atlas internal provenance.
 */
export const CORPUS_PROVENANCE: CorpusProvenanceRecord[] = [
  ...CORPUS_SOURCES,
  {
    sourceId: "atlas-curated",
    sourceName: "Atlas Industry Knowledge — Curated",
    organization: "Atlas",
    authorityTier: "tier3_industry",
    sourceType: "curated",
    status: "active",
  },
  {
    sourceId: "atlas-evidence-model",
    sourceName: "Atlas Evidence Requirements Model",
    organization: "Atlas",
    authorityTier: "tier3_industry",
    sourceType: "curated",
    status: "active",
  },
  {
    sourceId: "atlas-professional-guidance",
    sourceName: "Atlas Industry Operational Guidance",
    organization: "Atlas",
    authorityTier: "tier3_industry",
    sourceType: "curated",
    status: "active",
  },
  {
    sourceId: "iicrc-s500",
    sourceName: "IICRC S500 — Standard for Professional Water Damage Restoration",
    organization: "IICRC",
    authorityTier: "tier2_authoritative",
    sourceType: "standard",
    canonicalUrl: "https://www.iicrc.org/page/560/s500-standard",
    status: "active",
  },
  {
    sourceId: "iicrc-s520",
    sourceName: "IICRC S520 — Standard for Professional Mold Remediation",
    organization: "IICRC",
    authorityTier: "tier2_authoritative",
    sourceType: "standard",
    canonicalUrl: "https://www.iicrc.org/page/561/s520-standard",
    status: "active",
  },
  {
    sourceId: "osha-construction-detail",
    sourceName: "OSHA — Construction Standards Detail (29 CFR 1926)",
    organization: "US OSHA",
    authorityTier: "tier1_primary",
    sourceType: "regulation",
    status: "active",
  },
  {
    sourceId: "epa-lead-rrp",
    sourceName: "EPA — Lead Renovation, Repair & Painting Rule (40 CFR 745)",
    organization: "US EPA",
    authorityTier: "tier1_primary",
    sourceType: "regulation",
    status: "active",
  },
];
