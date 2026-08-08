// ---------------------------------------------------------------------------
// Intelligence Packs — versioned bundles of industry, geographic, workflow and
// benchmark knowledge. Packs are configuration, never hard-coded core logic.
// ---------------------------------------------------------------------------

export interface PackItemSeed {
  itemType: string;
  key: string;
  title: string;
  summary?: string;
  content: unknown;
  jurisdiction?: string;
  industry?: string;
  confidence?: number;
}

export interface PackSeed {
  key: string;
  name: string;
  packType: string;
  description: string;
  version: string;
  publisher?: string;
  items: PackItemSeed[];
}

export const PACK_SEEDS: PackSeed[] = [
  {
    key: "atlas-core",
    name: "Atlas Core Knowledge",
    packType: "core",
    description:
      "Universal operating knowledge: how Atlas classifies knowledge, ranks sources, and labels every output.",
    version: "1.0.0",
    publisher: "Atlas",
    items: [
      {
        itemType: "terminology",
        key: "knowledge_classification",
        title: "Knowledge classification",
        summary:
          "Every Atlas output is labeled FACT, RULE, OBSERVATION, INFERENCE or RECOMMENDATION.",
        content: {
          FACT: "Directly supported by source data.",
          RULE: "Supported by authoritative knowledge (regulation, standard, policy).",
          OBSERVATION: "Observed from company behavior or operational data.",
          INFERENCE: "AI-derived conclusion, not yet confirmed.",
          RECOMMENDATION: "Suggested action.",
        },
        confidence: 1,
      },
      {
        itemType: "terminology",
        key: "source_hierarchy",
        title: "Knowledge source hierarchy",
        summary:
          "Source rank that influences confidence: 1 regulation, 2 industry standard, 3 partner/carrier requirement, 4 company policy, 5 historical behavior, 6 AI inference, 7 user assertion.",
        content: {
          rank: [
            "Authoritative regulation / law",
            "Official industry standard",
            "Official partner / carrier requirement",
            "Company policy / SOP",
            "Historical company behavior",
            "AI inference",
            "User-provided assertion",
          ],
        },
        confidence: 1,
      },
      {
        itemType: "rule",
        key: "no_fabrication",
        title: "Evidence-first guardrail",
        summary:
          "Atlas never presents inference as fact and never fabricates evidence or citations.",
        content: {
          rule:
            "Every claim must link to a document chunk, source record, entity, intelligence item or observation. If no evidence exists, Atlas says so.",
        },
        confidence: 1,
      },
    ],
  },
  {
    key: "general-business",
    name: "General Business Benchmarks",
    packType: "benchmark",
    description:
      "Standard KPIs and benchmark ranges any service business can measure against.",
    version: "1.0.0",
    publisher: "Atlas",
    items: [
      {
        itemType: "kpi",
        key: "kpi_days_to_invoice",
        title: "Days to invoice",
        content: {
          definition: "Average days between work completion and invoice issue.",
          benchmark: "Under 7 days is strong; over 14 signals leakage.",
        },
        confidence: 0.7,
      },
      {
        itemType: "kpi",
        key: "kpi_doc_gap",
        title: "Documentation completeness",
        content: {
          definition:
            "Share of jobs with the full expected document set on file.",
          benchmark: "Above 90% is strong; below 70% risks disputes.",
        },
        confidence: 0.7,
      },
      {
        itemType: "kpi",
        key: "kpi_ar_aging",
        title: "Accounts receivable aging",
        content: {
          definition: "Share of receivables over 30 days old.",
          benchmark: "Under 20% is healthy; over 35% is a cash-flow risk.",
        },
        confidence: 0.7,
      },
      {
        itemType: "risk_pattern",
        key: "risk_incomplete_docs",
        title: "Incomplete documentation",
        summary:
          "Jobs missing expected documents (signed authorizations, photos, drying logs) face payment delays and disputes.",
        content: {
          signals: [
            "Work completed without signed authorization",
            "Missing dated photos",
            "No drying log for water losses",
          ],
          mitigation: "Route a documentation checklist when work starts.",
        },
        confidence: 0.8,
      },
    ],
  },
  {
    key: "insurance-restoration",
    name: "Insurance Restoration Industry Pack",
    packType: "industry",
    description:
      "Claims, carriers, adjusters, mitigation, reconstruction, supplements and the documentation a restoration company needs to get paid.",
    version: "1.0.0",
    publisher: "Atlas",
    items: [
      {
        itemType: "terminology",
        key: "term_fnol",
        title: "FNOL",
        summary: "First Notice of Loss — the first report of a loss to the carrier.",
        content: { term: "FNOL", definition: "First Notice of Loss." },
        confidence: 0.95,
      },
      {
        itemType: "terminology",
        key: "term_mitigation",
        title: "Mitigation",
        summary:
          "Emergency work to stop further damage: water extraction, drying, tarping, board-up.",
        content: {
          term: "Mitigation",
          definition: "Emergency measures to prevent additional damage.",
        },
        confidence: 0.95,
      },
      {
        itemType: "terminology",
        key: "term_supplement",
        title: "Supplement",
        summary:
          "An additional invoice for work or materials not in the original estimate.",
        content: {
          term: "Supplement",
          definition:
            "Additional scope requested when the original estimate misses work, materials or conditions.",
        },
        confidence: 0.9,
      },
      {
        itemType: "terminology",
        key: "term_xactimate",
        title: "Xactimate",
        summary: "The standard estimating software used by restoration carriers.",
        content: {
          term: "Xactimate",
          definition:
            "Industry-standard estimating platform for insurance restoration pricing.",
        },
        confidence: 0.9,
      },
      {
        itemType: "terminology",
        key: "term_drying_log",
        title: "Drying log",
        summary: "Documentation of moisture readings proving a structure is dry.",
        content: {
          term: "Drying log",
          definition:
            "Record of moisture readings over time used to justify equipment days.",
        },
        confidence: 0.9,
      },
      {
        itemType: "terminology",
        key: "term_scope_of_work",
        title: "Scope of work",
        summary: "The agreed list of tasks and line items for a job.",
        content: {
          term: "Scope of work",
          definition: "Approved line-item breakdown of the work to be performed.",
        },
        confidence: 0.9,
      },
      {
        itemType: "entity_type",
        key: "entity_claim",
        title: "Claim",
        summary: "An insurance claim for a loss event.",
        content: {
          attributes: [
            "claim_number",
            "carrier",
            "adjuster",
            "policyholder",
            "loss_type",
            "cause_of_loss",
            "status",
            "date_of_loss",
          ],
        },
        confidence: 0.9,
      },
      {
        itemType: "entity_type",
        key: "entity_carrier",
        title: "Carrier",
        summary: "Insurance company paying the claim.",
        content: { attributes: ["name", "contact", "portal"] },
        confidence: 0.9,
      },
      {
        itemType: "entity_type",
        key: "entity_adjuster",
        title: "Adjuster",
        summary: "Carrier representative who reviews estimates and scope.",
        content: { attributes: ["name", "email", "carrier"] },
        confidence: 0.9,
      },
      {
        itemType: "entity_type",
        key: "entity_policyholder",
        title: "Policyholder",
        summary: "The insured customer whose property was damaged.",
        content: { attributes: ["name", "email", "phone", "property"] },
        confidence: 0.9,
      },
      {
        itemType: "entity_type",
        key: "entity_property",
        title: "Property",
        summary: "The damaged location.",
        content: { attributes: ["address", "type"] },
        confidence: 0.9,
      },
      {
        itemType: "entity_type",
        key: "entity_inspection",
        title: "Inspection",
        summary: "On-site review of damage to build an estimate.",
        content: { attributes: ["date", "adjuster", "findings"] },
        confidence: 0.85,
      },
      {
        itemType: "entity_type",
        key: "entity_estimate",
        title: "Estimate",
        summary: "Priced scope of work (often built in Xactimate).",
        content: { attributes: ["amount", "version", "software"] },
        confidence: 0.9,
      },
      {
        itemType: "entity_type",
        key: "entity_supplement",
        title: "Supplement",
        summary: "Additional requested scope beyond the original estimate.",
        content: { attributes: ["amount_requested", "status", "reason"] },
        confidence: 0.9,
      },
      {
        itemType: "workflow",
        key: "workflow_claim_lifecycle",
        title: "Restoration claim lifecycle",
        summary:
          "Standard workflow from first notice of loss through closeout.",
        content: {
          stages: [
            { name: "FNOL", expectedDocuments: ["Loss report", "Policy info"] },
            {
              name: "Inspection",
              expectedDocuments: ["Inspection photos", "Adjuster notes"],
            },
            {
              name: "Estimate",
              expectedDocuments: ["Xactimate estimate", "Scope of work"],
            },
            {
              name: "Approval",
              expectedDocuments: ["Signed authorization", "Carrier approval"],
            },
            {
              name: "Mitigation",
              expectedDocuments: [
                "Drying log",
                "Equipment invoice",
                "Daily moisture readings",
              ],
            },
            {
              name: "Documentation",
              expectedDocuments: ["Completion photos", "Signed paperwork"],
            },
            {
              name: "Reconstruction",
              expectedDocuments: ["Permits", "Subcontractor invoices"],
            },
            {
              name: "Invoicing",
              expectedDocuments: ["Invoice", "Estimate vs actual"],
            },
            { name: "Payment", expectedDocuments: ["Payment confirmation"] },
            { name: "Closeout", expectedDocuments: ["Final report"] },
          ],
        },
        confidence: 0.85,
      },
      {
        itemType: "risk_pattern",
        key: "risk_missing_authorization",
        title: "Unapproved work",
        summary:
          "Starting mitigation or reconstruction without a signed authorization risks the carrier refusing payment.",
        content: {
          signals: [
            "Work starts before signed authorization",
            "Authorization missing from the file",
          ],
          mitigation:
            "Never start mitigation until the authorization is on file.",
        },
        confidence: 0.85,
      },
      {
        itemType: "risk_pattern",
        key: "risk_supplement_needed",
        title: "Likely supplement",
        summary:
          "Undocumented conditions discovered mid-job usually mean a supplement is needed.",
        content: {
          signals: [
            "Hidden damage found during demolition",
            "Estimate is older than 90 days",
            "Material price increases",
          ],
          mitigation:
            "Photograph conditions immediately and notify the adjuster in writing.",
        },
        confidence: 0.7,
      },
      {
        itemType: "risk_pattern",
        key: "risk_doc_gap",
        title: "Documentation gap",
        summary:
          "A job missing expected documents (drying logs, photos, authorizations) is at risk of payment delay.",
        content: {
          signals: [
            "Expected documents per workflow stage absent",
            "Invoices without matching job file",
          ],
          mitigation:
            "Run the documentation checklist before invoicing.",
        },
        confidence: 0.8,
      },
      {
        itemType: "document_expectation",
        key: "docs_per_stage",
        title: "Documents expected per stage",
        content: {
          FNOL: ["Loss report", "Policy information"],
          Inspection: ["Inspection photos", "Adjuster notes"],
          Estimate: ["Xactimate estimate", "Scope of work"],
          Approval: ["Signed authorization"],
          Mitigation: ["Drying log", "Equipment invoices"],
          Reconstruction: ["Permits", "Subcontractor invoices"],
          Invoicing: ["Invoice"],
          Closeout: ["Final report"],
        },
        confidence: 0.85,
      },
      {
        itemType: "benchmark",
        key: "benchmark_cycle",
        title: "Cycle-time benchmarks",
        content: {
          inspection_to_estimate_days: "2–4 days",
          estimate_to_approval_days: "5–10 days",
          mitigation_days: "3–7 days",
          payment_days: "30–45 days",
        },
        confidence: 0.6,
      },
      {
        itemType: "role",
        key: "role_ops_manager",
        title: "Operations manager",
        summary:
          "Owns job flow: assignments, documentation completion, and carrier communication.",
        content: { responsibilities: ["Dispatch", "Doc checklists", "Escalation"] },
        confidence: 0.8,
      },
    ],
  },
  {
    key: "us-federal",
    name: "United States — Federal & State Guidance",
    packType: "geographic",
    description:
      "Jurisdictional awareness for US operations: licensing, records, privacy and labor basics.",
    version: "2026.1",
    publisher: "Atlas",
    items: [
      {
        itemType: "regulatory",
        key: "reg_records",
        title: "Records & documentation expectations",
        summary:
          "US service businesses should retain job records — contracts, photos, invoices — consistent with state business-record laws.",
        content: {
          guidance:
            "Keep complete job files (authorization, scope, invoices, photos). Missing documentation can cost payment in disputes.",
          status: "unverified",
          note: "Jurisdiction-specific requirements vary by state; review before acting on this.",
        },
        jurisdiction: "United States",
        confidence: 0.5,
      },
      {
        itemType: "regulatory",
        key: "reg_licensing",
        title: "Contractor licensing",
        summary:
          "Many US states require contractor licensing for restoration and construction work.",
        content: {
          guidance:
            "Confirm state contractor-license requirements and any specialty permits before work begins.",
          status: "unverified",
          note: "License requirements vary by state and trade.",
        },
        jurisdiction: "United States",
        confidence: 0.6,
      },
    ],
  },
  {
    key: "legal",
    name: "Legal Services Pack",
    packType: "industry",
    description: "Matters, billing, courts and timekeeping for law firms.",
    version: "1.0.0",
    publisher: "Atlas",
    items: [
      {
        itemType: "entity_type",
        key: "entity_matter",
        title: "Matter",
        summary: "A legal matter (a unit of client work).",
        content: { attributes: ["matter_number", "client", "type", "status"] },
        confidence: 0.9,
      },
      {
        itemType: "workflow",
        key: "workflow_matter_lifecycle",
        title: "Matter lifecycle",
        content: {
          stages: [
            "Intake",
            "Engagement",
            "Research & drafting",
            "Filing",
            "Hearing / resolution",
            "Close",
          ],
        },
        confidence: 0.8,
      },
    ],
  },
  {
    key: "healthcare",
    name: "Healthcare Services Pack",
    packType: "industry",
    description: "Patients, providers, encounters and service lines.",
    version: "1.0.0",
    publisher: "Atlas",
    items: [
      {
        itemType: "entity_type",
        key: "entity_patient",
        title: "Patient",
        content: { attributes: ["name", "dob", "payer"] },
        confidence: 0.9,
      },
      {
        itemType: "entity_type",
        key: "entity_encounter",
        title: "Encounter",
        content: { attributes: ["date", "provider", "service_line"] },
        confidence: 0.9,
      },
    ],
  },
];

/** Industry → onboarding branch questions (config-driven, not core logic). */
export const INDUSTRY_BRANCHES: Record<string, { question: string; options: string[] }[]> = {
  "insurance restoration": [
    {
      question: "Do you handle mitigation (emergency water / fire work)?",
      options: ["Yes, we do mitigation", "No, reconstruction only", "Both"],
    },
    {
      question: "Do you work directly with insurance carriers?",
      options: ["Yes, most of our work is carrier-paid", "Some", "No, retail only"],
    },
    {
      question: "Do you use Xactimate for estimating?",
      options: ["Yes, Xactimate", "Symbility / CoreLogic", "Other / in-house"],
    },
    {
      question: "Which field & job software do you use?",
      options: ["JobNimbus", "DASH", "CompanyCam", "None yet"],
    },
    {
      question: "Do you manage supplements on most jobs?",
      options: ["Frequently", "Occasionally", "Rarely"],
    },
  ],
  "legal services": [
    {
      question: "Which matter types do you handle most?",
      options: ["Personal injury", "Corporate / transactional", "Family", "Litigation"],
    },
    {
      question: "How do you bill?",
      options: ["Hourly", "Contingency", "Flat fee", "Mixed"],
    },
  ],
  construction: [
    {
      question: "Which project types do you take on?",
      options: ["Residential", "Commercial", "Remodel / renovation", "New build"],
    },
    {
      question: "Do you need to track lien waivers and pay applications?",
      options: ["Yes, regularly", "Occasionally", "No"],
    },
  ],
};
