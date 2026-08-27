// ---------------------------------------------------------------------------
// Atlas Knowledge Corpus — Federal Regulations
//
// 8 federal regulation records relevant to U.S. insurance restoration.
// These are sourced from OSHA, EPA, FEMA, and HUD regulations.
// ---------------------------------------------------------------------------

import type { CorpusKnowledgeRecord } from "./manifest";

export const FEDERAL_REGULATIONS: CorpusKnowledgeRecord[] = [
  {
    id: "fed_osha_fall_protection",
    knowledgeType: "federal_regulation",
    title: "OSHA Fall Protection (29 CFR 1926 Subpart M)",
    statement:
      "OSHA requires fall protection for construction workers at elevations of 6 feet or more above a lower level. Employers must provide guardrails, safety nets, or personal fall arrest systems.",
    interpretation:
      "Restoration work on roofs, attics, and elevated structures triggers fall protection requirements. Non-compliance can result in OSHA citations and liability exposure. Document compliance in the job file.",
    sourceClassification: "REGULATORY",
    sourceId: "osha-construction",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.95,
    isInference: false,
    status: "active",
    tags: ["osha", "safety", "fall_protection", "construction", "regulation"],
    verificationStatus: "official",
  },
  {
    id: "fed_osha_hazard_communication",
    knowledgeType: "federal_regulation",
    title: "OSHA Hazard Communication Standard (29 CFR 1910.1200)",
    statement:
      "OSHA requires employers to inform and train employees about chemical hazards in the workplace. Safety Data Sheets (SDS) must be available for all hazardous chemicals used on the job site.",
    interpretation:
      "Restoration projects frequently involve chemicals (cleaning agents, adhesives, coatings). Maintain SDS documentation and ensure crew training records are current.",
    sourceClassification: "REGULATORY",
    sourceId: "osha-construction",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.95,
    isInference: false,
    status: "active",
    tags: ["osha", "safety", "hazcom", "chemicals", "training"],
    verificationStatus: "official",
  },
  {
    id: "fed_osha_respiratory_protection",
    knowledgeType: "federal_regulation",
    title: "OSHA Respiratory Protection (29 CFR 1910.134)",
    statement:
      "OSHA requires respiratory protection when employees are exposed to airborne contaminants above permissible exposure limits, including during mold remediation, asbestos abatement, and dust-generating construction work.",
    interpretation:
      "Mold remediation and demolition work during restoration requires proper respiratory protection programs, fit testing, and medical evaluations. Document the respiratory protection program in the job file.",
    sourceClassification: "REGULATORY",
    sourceId: "osha-construction",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.95,
    isInference: false,
    status: "active",
    tags: ["osha", "respiratory", "mold", "asbestos", "safety"],
    verificationStatus: "official",
  },
  {
    id: "fed_epa_lead_rrp",
    knowledgeType: "federal_regulation",
    title: "EPA Lead Renovation, Repair & Painting Rule (40 CFR 745)",
    statement:
      "EPA requires that renovation, repair, and painting work in pre-1978 housing and child-occupied facilities be performed by certified lead-safe work practices. Certified renovators must be on site.",
    interpretation:
      "Nearly all residential insurance restoration in pre-1978 structures triggers the EPA Lead RRP Rule. Failure to follow lead-safe practices can result in EPA fines up to $37,500 per violation per day. Include lead testing in the inspection phase.",
    sourceClassification: "REGULATORY",
    sourceId: "epa-regulations",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.95,
    isInference: false,
    status: "active",
    tags: ["epa", "lead", "rrp", "pre1978", "renovation", "regulation"],
    verificationStatus: "official",
  },
  {
    id: "fed_epa_asbestos",
    knowledgeType: "federal_regulation",
    title: "EPA Asbestos National Emission Standards (40 CFR 61 Subpart M)",
    statement:
      "EPA requires asbestos surveys before renovation or demolition of buildings that may contain asbestos-containing materials (ACM). Disturbance of ACM without proper controls is a federal violation.",
    interpretation:
      "Pre-1980 buildings commonly contain asbestos in insulation, floor tiles, and roofing materials. An asbestos survey should be ordered before destructive restoration work begins. Include survey results in the claim documentation.",
    sourceClassification: "REGULATORY",
    sourceId: "epa-regulations",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.95,
    isInference: false,
    status: "active",
    tags: ["epa", "asbestos", "survey", "pre1980", "abatement", "regulation"],
    verificationStatus: "official",
  },
  {
    id: "fed_fema_flood_insurance",
    knowledgeType: "federal_regulation",
    title: "FEMA National Flood Insurance Program (NFIP)",
    statement:
      "The NFIP provides flood insurance to property owners in participating communities. Claims are adjusted by FEMA-authorized adjusters and follow specific documentation and proof-of-loss requirements.",
    interpretation:
      "Flood claims have unique requirements: proof of loss deadlines (typically 60 days), specific documentation of flood damage vs. non-flood damage, and elevation certificate requirements. Missing the proof-of-loss deadline can forfeit the claim.",
    sourceClassification: "REGULATORY",
    sourceId: "fema-flood-insurance",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.9,
    isInference: false,
    status: "active",
    tags: ["fema", "flood", "nfip", "proof_of_loss", "insurance"],
    verificationStatus: "official",
  },
  {
    id: "fed_osha_scaffolding",
    knowledgeType: "federal_regulation",
    title: "OSHA Scaffolding (29 CFR 1926 Subpart L)",
    statement:
      "OSHA requires scaffolds used in construction to be designed by a qualified person and erected under the supervision of a competent person. Scaffold capacity, access, fall protection, and inspection requirements apply.",
    interpretation:
      "Scaffolding during multi-story restoration work triggers specific OSHA requirements. Document scaffold inspections and competent person designation. Non-compliance creates both safety and liability exposure.",
    sourceClassification: "REGULATORY",
    sourceId: "osha-construction",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.95,
    isInference: false,
    status: "active",
    tags: ["osha", "scaffolding", "construction", "safety", "regulation"],
    verificationStatus: "official",
  },
  {
    id: "fed_osha_electrical_safety",
    knowledgeType: "federal_regulation",
    title: "OSHA Electrical Safety in Construction (29 CFR 1926 Subpart K)",
    statement:
      "OSHA requires safe electrical work practices during construction, including GFCI protection, proper wiring methods, and lockout/tagout procedures for de-energized equipment.",
    interpretation:
      "Water-damaged electrical systems present electrocution hazards during restoration. De-energize and lock out damaged electrical systems before water extraction and demolition. Document electrical safety measures.",
    sourceClassification: "REGULATORY",
    sourceId: "osha-construction",
    industry: "insurance restoration",
    jurisdiction: "United States",
    confidence: 0.95,
    isInference: false,
    status: "active",
    tags: ["osha", "electrical", "safety", "gfci", "lockout", "water_damage"],
    verificationStatus: "official",
  },
];
