// ---------------------------------------------------------------------------
// Atlas Knowledge Layer — Seed Industry Knowledge
//
// Deterministic seed dataset representing Atlas's baseline industry knowledge
// for the U.S. insurance restoration / roofing / construction ecosystem.
//
// This is Layer 1 knowledge — shared across all customers. It is NOT
// customer-specific and does NOT contain any company's proprietary data.
//
// The seed covers:
//   - Insurance restoration terminology
//   - Claim lifecycle concepts
//   - Documentation requirements
//   - Evidence requirements per workflow stage
//   - Common industry roles
//   - Supplement concepts
//   - Revenue recovery concepts
//   - Industry risk patterns
//   - Regulatory awareness (OSHA, EPA, licensing)
// ---------------------------------------------------------------------------

import type { KnowledgeItem, KnowledgeProvenance } from "./types";

// ---------------------------------------------------------------------------
// Industry Terminology
// ---------------------------------------------------------------------------

export const INDUSTRY_TERMS: KnowledgeItem[] = [
  {
    id: "term_fnol",
    layer: "atlas_industry",
    sourceClassification: "ATLAS_CURATED",
    title: "FNOL (First Notice of Loss)",
    statement: "FNOL is the first report of a loss to the insurance carrier, initiating the claims process.",
    interpretation: "Timely FNOL filing is critical — delays can jeopardize coverage. The FNOL should include date of loss, cause, and initial damage description.",
    knowledgeType: "terminology",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.95,
    status: "active",
    isInference: false,
    tags: ["claims", "insurance", "documentation"],
  },
  {
    id: "term_mitigation",
    layer: "atlas_industry",
    sourceClassification: "ATLAS_CURATED",
    title: "Emergency Mitigation",
    statement: "Mitigation is emergency work to stop further damage: water extraction, drying, tarping, board-up.",
    interpretation: "Mitigation is typically covered by insurance and should begin immediately. Failure to mitigate can reduce the carrier's liability for subsequent damage.",
    knowledgeType: "terminology",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.95,
    status: "active",
    isInference: false,
    tags: ["mitigation", "water", "emergency"],
  },
  {
    id: "term_supplement",
    layer: "atlas_industry",
    sourceClassification: "ATLAS_CURATED",
    title: "Supplement",
    statement: "A supplement is an additional invoice for work or materials not in the original Xactimate estimate.",
    interpretation: "Supplements are extremely common and represent a major revenue recovery opportunity. They typically arise from hidden damage, code requirements, or under-scoped original estimates.",
    knowledgeType: "terminology",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.9,
    status: "active",
    isInference: false,
    tags: ["supplement", "revenue", "estimating"],
  },
  {
    id: "term_xactimate",
    layer: "atlas_industry",
    sourceClassification: "ATLAS_CURATED",
    title: "Xactimate",
    statement: "Xactimate is the industry-standard estimating software used by restoration carriers and contractors.",
    interpretation: "Proficiency with Xactimate is essential for accurate scope documentation and supplement support. Line-item pricing in Xactimate directly affects what the carrier approves.",
    knowledgeType: "terminology",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.9,
    status: "active",
    isInference: false,
    tags: ["estimating", "software", "pricing"],
  },
  {
    id: "term_scope_of_work",
    layer: "atlas_industry",
    sourceClassification: "ATLAS_CURATED",
    title: "Scope of Work",
    statement: "The scope of work is the agreed list of tasks and line items for a restoration or construction job.",
    interpretation: "A complete scope of work is the foundation for accurate estimating and supplement support. Missing items in the scope directly result in missed revenue.",
    knowledgeType: "terminology",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.9,
    status: "active",
    isInference: false,
    tags: ["scope", "estimating", "documentation"],
  },
  {
    id: "term_drying_log",
    layer: "atlas_industry",
    sourceClassification: "ATLAS_CURATED",
    title: "Drying Log",
    statement: "A drying log is documentation of moisture readings over time proving a structure is dry.",
    interpretation: "Drying logs are critical evidence for water mitigation claims. Without them, equipment days and dehumidification charges are difficult to justify to the carrier.",
    knowledgeType: "terminology",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.9,
    status: "active",
    isInference: false,
    tags: ["drying", "documentation", "water", "evidence"],
  },
  {
    id: "term_adjuster",
    layer: "atlas_industry",
    sourceClassification: "ATLAS_CURATED",
    title: "Insurance Adjuster",
    statement: "An adjuster is the carrier representative who reviews estimates, inspects damage, and authorizes payments.",
    interpretation: "Building a professional relationship with adjusters improves outcomes. Documentation quality directly affects adjuster confidence and approval speed.",
    knowledgeType: "terminology",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.85,
    status: "active",
    isInference: false,
    tags: ["adjuster", "carrier", "relationship"],
  },
  {
    id: "term_policyholder",
    layer: "atlas_industry",
    sourceClassification: "ATLAS_CURATED",
    title: "Policyholder",
    statement: "The policyholder is the insured customer whose property was damaged and who filed the insurance claim.",
    interpretation: "The policyholder is the contractor's customer. Clear communication about the claims process, timelines, and expectations is essential.",
    knowledgeType: "terminology",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.9,
    status: "active",
    isInference: false,
    tags: ["customer", "insurance", "communication"],
  },
];

// ---------------------------------------------------------------------------
// Evidence Requirements per Claim Workflow Stage
// ---------------------------------------------------------------------------

export const EVIDENCE_REQUIREMENTS: KnowledgeItem[] = [
  {
    id: "evidence_fnol",
    layer: "atlas_industry",
    sourceClassification: "PROFESSIONAL_GUIDANCE",
    title: "FNOL Stage — Required Evidence",
    statement: "At FNOL, the contractor needs: loss report, policy information, initial photos, and date-of-loss documentation.",
    interpretation: "Incomplete FNOL documentation delays the entire claim. Atlas should flag missing items immediately when a claim enters the pipeline.",
    knowledgeType: "requirement",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.85,
    status: "active",
    isInference: false,
    tags: ["evidence", "fnol", "documentation", "requirements"],
  },
  {
    id: "evidence_inspection",
    layer: "atlas_industry",
    sourceClassification: "PROFESSIONAL_GUIDANCE",
    title: "Inspection Stage — Required Evidence",
    statement: "At inspection: inspection photos (date-stamped, wide and close-up), adjuster notes, scope measurements, and damage assessment.",
    interpretation: "Photo documentation is the most commonly incomplete item at the inspection stage. Photos should be labeled with room/area and damage type.",
    knowledgeType: "requirement",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.85,
    status: "active",
    isInference: false,
    tags: ["evidence", "inspection", "photos", "documentation"],
  },
  {
    id: "evidence_estimate",
    layer: "atlas_industry",
    sourceClassification: "PROFESSIONAL_GUIDANCE",
    title: "Estimate Stage — Required Evidence",
    statement: "At estimate stage: Xactimate estimate, scope of work, material specifications, and code requirements.",
    interpretation: "Estimate accuracy directly affects revenue. Under-scoped estimates are the primary source of missed revenue and the most common supplement trigger.",
    knowledgeType: "requirement",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.85,
    status: "active",
    isInference: false,
    tags: ["evidence", "estimate", "xactimate", "scope"],
  },
  {
    id: "evidence_mitigation",
    layer: "atlas_industry",
    sourceClassification: "PROFESSIONAL_GUIDANCE",
    title: "Mitigation Stage — Required Evidence",
    statement: "At mitigation: drying log with moisture readings, equipment invoices, daily readings, equipment placement photos, and authorization documentation.",
    interpretation: "Drying logs are the most frequently disputed item in water mitigation claims. Without timestamped moisture readings, equipment days cannot be justified.",
    knowledgeType: "requirement",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.85,
    status: "active",
    isInference: false,
    tags: ["evidence", "mitigation", "drying", "water"],
  },
  {
    id: "evidence_reconstruction",
    layer: "atlas_industry",
    sourceClassification: "PROFESSIONAL_GUIDANCE",
    title: "Reconstruction Stage — Required Evidence",
    statement: "At reconstruction: permits, subcontractor invoices, material receipts, before/after photos, and signed change orders.",
    interpretation: "Change orders not documented and billed are unrecovered revenue. Atlas should monitor scope changes during reconstruction.",
    knowledgeType: "requirement",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.85,
    status: "active",
    isInference: false,
    tags: ["evidence", "reconstruction", "permits", "invoices"],
  },
  {
    id: "evidence_invoicing",
    layer: "atlas_industry",
    sourceClassification: "PROFESSIONAL_GUIDANCE",
    title: "Invoicing Stage — Required Evidence",
    statement: "At invoicing: final invoice, estimate vs. actual comparison, proof of completion, and signed authorization.",
    interpretation: "The gap between estimate and final invoice is where revenue leakage occurs. Systematic reconciliation catches unbilled work.",
    knowledgeType: "requirement",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.85,
    status: "active",
    isInference: false,
    tags: ["evidence", "invoicing", "reconciliation", "revenue"],
  },
];

// ---------------------------------------------------------------------------
// Claim Lifecycle Workflow
// ---------------------------------------------------------------------------

export const CLAIM_LIFECYCLE: KnowledgeItem[] = [
  {
    id: "lifecycle_claim",
    layer: "atlas_industry",
    sourceClassification: "ATLAS_CURATED",
    title: "Insurance Restoration Claim Lifecycle",
    statement: "The standard claim lifecycle flows through: FNOL → Inspection → Estimate → Approval → Mitigation → Documentation → Reconstruction → Invoicing → Payment → Closeout.",
    interpretation: "Revenue recovery opportunities exist at every stage. The most common gaps occur at the transition between stages when documentation is incomplete.",
    knowledgeType: "workflow",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.85,
    status: "active",
    isInference: false,
    tags: ["lifecycle", "workflow", "claims", "process"],
  },
  {
    id: "lifecycle_supplement",
    layer: "atlas_industry",
    sourceClassification: "ATLAS_CURATED",
    title: "Supplement Lifecycle",
    statement: "Supplements flow through: scope gap identified → documentation assembled → submit to adjuster → review → approval/denial → re-submit if needed → payment.",
    interpretation: "Supplement approval rates correlate strongly with documentation quality. Well-documented supplements with photo evidence and code references are approved at much higher rates.",
    knowledgeType: "workflow",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.8,
    status: "active",
    isInference: false,
    tags: ["supplement", "lifecycle", "revenue", "process"],
  },
];

// ---------------------------------------------------------------------------
// Industry Risk Patterns
// ---------------------------------------------------------------------------

export const RISK_PATTERNS: KnowledgeItem[] = [
  {
    id: "risk_unauthorized_work",
    layer: "atlas_industry",
    sourceClassification: "ATLAS_CURATED",
    title: "Starting Work Without Authorization",
    statement: "Starting mitigation or reconstruction without a signed authorization from the policyholder risks the carrier refusing payment.",
    interpretation: "Always confirm written authorization is on file before work begins. This is the single most common reason for payment denial.",
    knowledgeType: "risk_pattern",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.9,
    status: "active",
    isInference: false,
    tags: ["risk", "authorization", "payment", "denial"],
  },
  {
    id: "risk_missing_docs",
    layer: "atlas_industry",
    sourceClassification: "ATLAS_CURATED",
    title: "Incomplete Documentation",
    statement: "Jobs missing expected documents (drying logs, photos, authorizations) face payment delays and disputes.",
    interpretation: "Documentation completeness is the most controllable factor in claim outcome. A documentation checklist at job start prevents downstream issues.",
    knowledgeType: "risk_pattern",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.85,
    status: "active",
    isInference: false,
    tags: ["risk", "documentation", "compliance", "payment"],
  },
  {
    id: "risk_underbilling",
    layer: "atlas_industry",
    sourceClassification: "ATLAS_CURATED",
    title: "Underbilling / Missed Billable Work",
    statement: "Delivered work that is never invoiced, or change orders not added to scope, quietly erodes revenue.",
    interpretation: "Revenue leakage from underbilling is typically 5-15% of total project value. Systematic scope reconciliation catches this.",
    knowledgeType: "risk_pattern",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.8,
    status: "active",
    isInference: false,
    tags: ["risk", "revenue", "billing", "leakage"],
  },
  {
    id: "risk_supplement_needed",
    layer: "atlas_industry",
    sourceClassification: "ATLAS_CURATED",
    title: "Likely Supplement Needed",
    statement: "Undocumented conditions discovered mid-job, aging estimates, or material price increases typically require a supplement.",
    interpretation: "Proactive supplement identification before the adjuster discovers the gap improves approval rates and reduces payment delays.",
    knowledgeType: "risk_pattern",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.75,
    status: "active",
    isInference: false,
    tags: ["risk", "supplement", "scope", "pricing"],
  },
  {
    id: "risk_doc_gap",
    layer: "atlas_industry",
    sourceClassification: "ATLAS_CURATED",
    title: "Documentation Gap Risk",
    statement: "A job missing expected documents per workflow stage is at risk of payment delay, dispute, or denial.",
    interpretation: "Atlas should continuously monitor documentation completeness against the expected document set for each claim lifecycle stage.",
    knowledgeType: "risk_pattern",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.8,
    status: "active",
    isInference: false,
    tags: ["risk", "documentation", "compliance", "claims"],
  },
];

// ---------------------------------------------------------------------------
// Revenue Recovery Concepts
// ---------------------------------------------------------------------------

export const REVENUE_CONCEPTS: KnowledgeItem[] = [
  {
    id: "revenue_scope_gaps",
    layer: "atlas_industry",
    sourceClassification: "ATLAS_CURATED",
    title: "Scope Gap Revenue Recovery",
    statement: "Scope gaps between the contractor's estimate and the carrier's approved estimate represent recoverable revenue through the supplement process.",
    interpretation: "The supplement process is the primary mechanism for recovering revenue that was missed in the original estimate. Quality documentation of the gap is essential.",
    knowledgeType: "concept",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.85,
    status: "active",
    isInference: false,
    tags: ["revenue", "recovery", "scope", "supplement"],
  },
  {
    id: "revenue_code_requirements",
    layer: "atlas_industry",
    sourceClassification: "REGULATORY",
    title: "Code Upgrade Revenue",
    statement: "Building code requirements that necessitate upgrades beyond the original scope represent additional recoverable revenue.",
    interpretation: "When building codes require upgrades (e.g., ice and water shield, upgraded ventilation), these are legitimate supplement items supported by regulatory authority.",
    knowledgeType: "concept",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.8,
    status: "active",
    isInference: false,
    tags: ["revenue", "recovery", "code", "regulation"],
  },
  {
    id: "revenue_material_price",
    layer: "atlas_industry",
    sourceClassification: "ATLAS_CURATED",
    title: "Material Price Variance",
    statement: "Material price increases between estimate date and purchase date create recoverable price variance.",
    interpretation: "When material prices increase after the estimate is approved, the price difference can be submitted as a supplement item with current pricing documentation.",
    knowledgeType: "concept",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.75,
    status: "active",
    isInference: false,
    tags: ["revenue", "recovery", "materials", "pricing"],
  },
];

// ---------------------------------------------------------------------------
// Industry Roles
// ---------------------------------------------------------------------------

export const INDUSTRY_ROLES: KnowledgeItem[] = [
  {
    id: "role_project_manager",
    layer: "atlas_industry",
    sourceClassification: "ATLAS_CURATED",
    title: "Restoration Project Manager",
    statement: "The project manager owns the job flow: assignments, documentation completion, carrier communication, and customer updates.",
    interpretation: "The PM is typically the primary point of contact for both the policyholder and the adjuster. Documentation quality often depends on PM diligence.",
    knowledgeType: "role",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.8,
    status: "active",
    isInference: false,
    tags: ["role", "management", "operations"],
  },
  {
    id: "role_estimator",
    layer: "atlas_industry",
    sourceClassification: "ATLAS_CURATED",
    title: "Restoration Estimator",
    statement: "The estimator builds Xactimate estimates, documents scope, identifies supplement opportunities, and supports adjuster negotiations.",
    interpretation: "Estimator accuracy directly affects revenue. Under-scoping is the most common estimator-related revenue leak.",
    knowledgeType: "role",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.85,
    status: "active",
    isInference: false,
    tags: ["role", "estimating", "revenue"],
  },
];

// ---------------------------------------------------------------------------
// Combined Seed
// ---------------------------------------------------------------------------

/** All seed knowledge items for the Atlas Industry Knowledge layer. */
export const ATLAS_INDUSTRY_KNOWLEDGE_SEED: KnowledgeItem[] = [
  ...INDUSTRY_TERMS,
  ...EVIDENCE_REQUIREMENTS,
  ...CLAIM_LIFECYCLE,
  ...RISK_PATTERNS,
  ...REVENUE_CONCEPTS,
  ...INDUSTRY_ROLES,
];

/** Knowledge provenance for the seed data sources. */
export const ATLAS_KNOWLEDGE_PROVENANCE: KnowledgeProvenance[] = [
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
    sourceId: "iicrc-s500",
    sourceName: "IICRC S500 — Standard for Water Damage Restoration",
    organization: "IICRC",
    authorityTier: "tier3_industry",
    sourceType: "standard",
    status: "active",
  },
  {
    sourceId: "iicrc-s520",
    sourceName: "IICRC S520 — Standard for Mold Remediation",
    organization: "IICRC",
    authorityTier: "tier3_industry",
    sourceType: "standard",
    status: "active",
  },
  {
    sourceId: "osha-construction",
    sourceName: "OSHA — Construction Standards (29 CFR 1926)",
    organization: "US OSHA",
    authorityTier: "tier1_primary",
    sourceType: "regulation",
    status: "active",
  },
  {
    sourceId: "epa-lead-rrp",
    sourceName: "EPA — Lead Renovation, Repair & Painting Rule",
    organization: "US EPA",
    authorityTier: "tier1_primary",
    sourceType: "regulation",
    status: "active",
  },
];
