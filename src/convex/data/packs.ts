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
      {
        itemType: "terminology",
        key: "revenue_timing_stages",
        title: "Revenue timing — bookings, billed, recognized, collected",
        summary:
          "These four numbers are different on different timings; Atlas never collapses them.",
        content: {
          bookings: "Committed future revenue (signed orders/contracts) — not yet earned.",
          billed: "Amounts invoiced in a period — may exceed or trail recognized revenue.",
          recognized: "Revenue earned per accounting rules (e.g. accrual, ASC 606) — may differ from billed.",
          collected: "Cash actually received against receivables — the only number that touches cash.",
          note: "Pipeline → bookings → billed → recognized → collected forms the revenue waterfall. Comparing any two requires labeling which stage each figure refers to.",
        },
        confidence: 0.95,
      },
      {
        itemType: "terminology",
        key: "revenue_concepts",
        title: "Revenue concepts",
        summary: "Gross vs net revenue, recurring revenue, deferred revenue and accounts receivable.",
        content: {
          gross_revenue: "Total revenue before returns, allowances and discounts.",
          net_revenue: "Revenue after returns, allowances and discounts.",
          recurring_revenue: "Revenue expected to repeat (subscriptions, service contracts).",
          deferred_revenue: "Cash collected for work not yet performed — a liability, not revenue yet.",
          accounts_receivable: "Amounts customers owe for delivered work — an asset.",
        },
        confidence: 0.9,
      },
      {
        itemType: "terminology",
        key: "profitability_ladder",
        title: "The profitability ladder",
        summary: "Gross profit → operating profit → EBITDA → net income.",
        content: {
          gross_profit: "Revenue − COGS.",
          gross_margin: "Gross profit ÷ revenue.",
          operating_expenses: "Payroll, rent, marketing, software, insurance, professional fees.",
          operating_profit: "Gross profit − operating expenses (EBIT).",
          ebitda: "Earnings before interest, taxes, depreciation and amortization — a cash-flow proxy, not GAAP net income.",
          net_income: "Bottom line after all expenses, interest and taxes.",
          net_margin: "Net income ÷ revenue.",
          note: "Profit is ambiguous until the level is specified — always label which rung a profit figure refers to.",
        },
        confidence: 0.9,
      },
      {
        itemType: "terminology",
        key: "balance_sheet_concepts",
        title: "Balance sheet concepts",
        summary: "Assets, liabilities, equity, cash, working capital, accounts payable.",
        content: {
          assets: "What the business owns or is owed.",
          liabilities: "What the business owes.",
          equity: "Residual ownership value (assets − liabilities).",
          cash: "Cash and equivalents on hand.",
          accounts_payable: "Owed to suppliers and vendors.",
          working_capital: "Current assets − current liabilities; the short-term operating liquidity buffer.",
          identity: "Assets = Liabilities + Equity — always balances.",
        },
        confidence: 0.9,
      },
      {
        itemType: "kpi",
        key: "kpi_pipeline_coverage",
        title: "Pipeline coverage",
        content: {
          definition: "Open pipeline value ÷ target bookings for the period.",
          benchmark: "3–4× coverage is common for service businesses; below 2× risks revenue gaps.",
        },
        confidence: 0.6,
      },
      {
        itemType: "kpi",
        key: "kpi_days_sales_outstanding",
        title: "Days sales outstanding (DSO)",
        content: {
          definition: "Average days between invoice and cash collection (receivables ÷ daily revenue).",
          benchmark: "Under 30 is strong; over 45 strains working capital.",
        },
        confidence: 0.7,
      },
      {
        itemType: "kpi",
        key: "kpi_collection_rate",
        title: "Collection rate",
        content: {
          definition: "Cash collected ÷ amount invoiced for a period.",
          benchmark: "Above 95% is strong; sustained gaps between billed and collected are a cash-flow warning.",
        },
        confidence: 0.7,
      },
      {
        itemType: "kpi",
        key: "kpi_gross_margin",
        title: "Gross margin",
        content: {
          definition: "(Revenue − COGS) ÷ revenue.",
          benchmark: "Service businesses often run 30–60%; the trend matters more than the level.",
        },
        confidence: 0.6,
      },
      {
        itemType: "kpi",
        key: "kpi_cash_runway",
        title: "Cash runway",
        content: {
          definition: "Cash on hand ÷ average monthly burn (expenses − collections).",
          benchmark: "Under 3 months is a high-severity warning; 6+ months is healthy for most service businesses.",
        },
        confidence: 0.6,
      },
      {
        itemType: "workflow",
        key: "workflow_revenue_waterfall",
        title: "Revenue waterfall",
        content: {
          stages: [
            { stage: "Pipeline", what: "Open opportunities not yet won." },
            { stage: "Bookings", what: "Signed commitments — future revenue." },
            { stage: "Billed", what: "Invoiced amounts." },
            { stage: "Recognized", what: "Earned per accounting rules." },
            { stage: "Collected", what: "Cash received." },
          ],
          note: "Each stage is a different number on a different timing — Atlas labels which one it means.",
        },
        confidence: 0.9,
      },
      {
        itemType: "workflow",
        key: "workflow_customer_lifecycle",
        title: "Customer lifecycle",
        content: {
          stages: ["Acquisition", "Onboarding", "Engagement", "Retention", "Expansion", "At risk", "Churn / winback"],
          note: "Churn and expansion are economic events: an expansion is new bookings; churn reduces recurring revenue.",
        },
        confidence: 0.8,
      },
      {
        itemType: "workflow",
        key: "workflow_employee_lifecycle",
        title: "Employee lifecycle",
        content: {
          stages: ["Candidate", "Hire", "Onboarding", "Employment", "Performance", "Offboarding"],
          note: "Labor efficiency is measured against utilization, not headcount.",
        },
        confidence: 0.8,
      },
      {
        itemType: "workflow",
        key: "workflow_project_lifecycle",
        title: "Project lifecycle",
        content: {
          stages: ["Scoped", "Scheduled", "Delivered", "Invoiced", "Collected", "Closed"],
          note: "A project is not done when the work is done — it is done when it is collected.",
        },
        confidence: 0.8,
      },
      {
        itemType: "risk_pattern",
        key: "risk_underbilling",
        title: "Underbilling / missed billable work",
        summary:
          "Delivered work that is never invoiced, or change orders not added to scope, quietly erodes revenue.",
        content: {
          signals: ["Completed work without a matching invoice", "Change orders not billed", "Invoiced amount below recognized value"],
          mitigation: "Reconcile delivered vs billed per project before closing the job.",
        },
        confidence: 0.7,
      },
      {
        itemType: "risk_pattern",
        key: "risk_cash_flow_strain",
        title: "Cash-flow strain",
        content: {
          signals: ["Billed and collected diverging", "DSO rising", "Payables growing while receivables age"],
          mitigation: "Watch the billed→collected gap and working capital trend; collections lag is the usual culprit.",
        },
        confidence: 0.7,
      },
      {
        itemType: "risk_pattern",
        key: "risk_revenue_mislabeling",
        title: "Revenue mislabeling",
        content: {
          signals: ["'Sales' reported without a timing basis", "Bookings counted as collected", "Deferred revenue treated as earned"],
          mitigation: "Label the timing stage (booked, billed, recognized, collected) before comparing figures.",
        },
        confidence: 0.85,
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
  {
    key: "saas",
    name: "SaaS & Software Pack",
    packType: "industry",
    description:
      "Accounts, subscriptions, support tickets and product metrics for software businesses.",
    version: "1.0.0",
    publisher: "Atlas",
    items: [
      {
        itemType: "terminology",
        key: "term_arr",
        title: "ARR",
        summary: "Annual recurring revenue — the standard growth metric for subscriptions.",
        content: {
          term: "Annual Recurring Revenue",
          definition: "Normalized yearly value of recurring subscription revenue.",
        },
        confidence: 0.95,
      },
      {
        itemType: "entity_type",
        key: "entity_account",
        title: "Account",
        summary: "A paying customer organization.",
        content: { attributes: ["name", "plan", "status", "owner"] },
        confidence: 0.9,
      },
      {
        itemType: "entity_type",
        key: "entity_subscription",
        title: "Subscription",
        summary: "A recurring billing relationship with a customer.",
        content: { attributes: ["plan", "price", "billing_cycle", "status"] },
        confidence: 0.9,
      },
      {
        itemType: "entity_type",
        key: "entity_ticket",
        title: "Support ticket",
        summary: "A customer support request.",
        content: { attributes: ["number", "priority", "status", "assignee"] },
        confidence: 0.9,
      },
      {
        itemType: "workflow",
        key: "workflow_subscription_lifecycle",
        title: "Subscription lifecycle",
        content: {
          stages: ["Trial", "Active", "Expansion", "Renewal", "Churn risk", "Churned"],
        },
        confidence: 0.75,
      },
    ],
  },
  {
    key: "real-estate",
    name: "Real Estate Pack",
    packType: "industry",
    description: "Listings, properties, transactions and deal pipelines for brokerages.",
    version: "1.0.0",
    publisher: "Atlas",
    items: [
      {
        itemType: "entity_type",
        key: "entity_listing",
        title: "Listing",
        summary: "A property offered for sale or rent.",
        content: { attributes: ["address", "price", "status", "agent"] },
        confidence: 0.9,
      },
      {
        itemType: "entity_type",
        key: "entity_property",
        title: "Property",
        summary: "The physical asset at the center of a transaction.",
        content: { attributes: ["address", "type", "sqft", "beds", "baths"] },
        confidence: 0.9,
      },
      {
        itemType: "entity_type",
        key: "entity_transaction",
        title: "Transaction",
        summary: "A purchase, sale or lease deal.",
        content: { attributes: ["type", "status", "parties", "close_date"] },
        confidence: 0.9,
      },
      {
        itemType: "workflow",
        key: "workflow_deal_lifecycle",
        title: "Deal lifecycle",
        content: {
          stages: ["Lead", "Qualified", "Showing", "Offer", "Under contract", "Closed"],
        },
        confidence: 0.8,
      },
    ],
  },
  {
    key: "solar",
    name: "Solar & Renewables Pack",
    packType: "industry",
    description: "Leads, proposals, permits and install pipelines for solar companies.",
    version: "1.0.0",
    publisher: "Atlas",
    items: [
      {
        itemType: "entity_type",
        key: "entity_lead",
        title: "Lead",
        summary: "A prospective homeowner interested in solar.",
        content: { attributes: ["name", "address", "source", "status"] },
        confidence: 0.9,
      },
      {
        itemType: "entity_type",
        key: "entity_proposal",
        title: "Proposal",
        summary: "A priced system design for a customer.",
        content: { attributes: ["system_size_kw", "price", "financing", "status"] },
        confidence: 0.9,
      },
      {
        itemType: "entity_type",
        key: "entity_install_job",
        title: "Install job",
        summary: "An approved solar installation.",
        content: { attributes: ["crew", "permits", "schedule", "status"] },
        confidence: 0.9,
      },
      {
        itemType: "workflow",
        key: "workflow_install_pipeline",
        title: "Install pipeline",
        content: {
          stages: ["Lead", "Proposal", "Contract", "Permit", "Install", "PTO", "Commissioned"],
        },
        confidence: 0.8,
      },
    ],
  },
  {
    key: "manufacturing",
    name: "Manufacturing Pack",
    packType: "industry",
    description: "Work orders, SKUs, suppliers and plant performance for manufacturers.",
    version: "1.0.0",
    publisher: "Atlas",
    items: [
      {
        itemType: "entity_type",
        key: "entity_work_order",
        title: "Work order",
        summary: "A unit of production or maintenance work.",
        content: { attributes: ["number", "sku", "quantity", "status", "due_date"] },
        confidence: 0.9,
      },
      {
        itemType: "entity_type",
        key: "entity_sku",
        title: "SKU / part",
        summary: "A manufactured or stocked product.",
        content: { attributes: ["sku", "name", "category", "cost"] },
        confidence: 0.9,
      },
      {
        itemType: "entity_type",
        key: "entity_supplier",
        title: "Supplier",
        summary: "A vendor providing materials or components.",
        content: { attributes: ["name", "lead_time_days", "status"] },
        confidence: 0.9,
      },
      {
        itemType: "kpi",
        key: "kpi_oee",
        title: "OEE",
        content: {
          definition: "Overall Equipment Effectiveness: availability × performance × quality.",
          benchmark: "World-class is 85%; below 60% signals serious loss.",
        },
        confidence: 0.7,
      },
    ],
  },
  {
    key: "logistics",
    name: "Logistics & Supply Chain Pack",
    packType: "industry",
    description: "Shipments, carriers, warehouses and on-time performance for logistics operators.",
    version: "1.0.0",
    publisher: "Atlas",
    items: [
      {
        itemType: "entity_type",
        key: "entity_shipment",
        title: "Shipment",
        summary: "A unit of freight moving from origin to destination.",
        content: { attributes: ["tracking", "carrier", "origin", "destination", "status"] },
        confidence: 0.9,
      },
      {
        itemType: "entity_type",
        key: "entity_carrier",
        title: "Carrier",
        summary: "A freight or shipping provider.",
        content: { attributes: ["name", "mode", "service_level"] },
        confidence: 0.9,
      },
      {
        itemType: "entity_type",
        key: "entity_warehouse",
        title: "Warehouse",
        summary: "A storage or distribution facility.",
        content: { attributes: ["name", "location", "capacity"] },
        confidence: 0.9,
      },
      {
        itemType: "kpi",
        key: "kpi_otd",
        title: "On-time delivery",
        content: {
          definition: "Share of shipments delivered within the promised window.",
          benchmark: "Above 95% is strong; below 90% needs investigation.",
        },
        confidence: 0.7,
      },
    ],
  },
  {
    key: "financial-services",
    name: "Financial Services Pack",
    packType: "industry",
    description: "Clients, accounts, transactions and regulatory awareness for financial firms.",
    version: "1.0.0",
    publisher: "Atlas",
    items: [
      {
        itemType: "entity_type",
        key: "entity_client",
        title: "Client",
        summary: "An individual or organization served by the firm.",
        content: { attributes: ["name", "type", "relationship_manager", "status"] },
        confidence: 0.9,
      },
      {
        itemType: "entity_type",
        key: "entity_account",
        title: "Account",
        summary: "A custodial or service account for a client.",
        content: { attributes: ["number", "type", "balance", "owner"] },
        confidence: 0.9,
      },
      {
        itemType: "entity_type",
        key: "entity_transaction",
        title: "Transaction",
        summary: "A movement of funds.",
        content: { attributes: ["amount", "date", "direction", "account"] },
        confidence: 0.9,
      },
      {
        itemType: "risk_pattern",
        key: "risk_regulatory_reporting",
        title: "Regulatory reporting risk",
        summary: "Missed or late regulatory filings can trigger penalties and audit exposure.",
        content: {
          signals: ["Filing deadlines missed", "No reporting calendar", "Unreviewed account activity"],
          mitigation: "Maintain a reporting calendar and a second set of eyes on filings.",
        },
        confidence: 0.6,
      },
    ],
  },
  {
    key: "professional-services",
    name: "Professional Services Pack",
    packType: "industry",
    description: "Clients, engagements, deliverables and utilization for consulting and services firms.",
    version: "1.0.0",
    publisher: "Atlas",
    items: [
      {
        itemType: "entity_type",
        key: "entity_client",
        title: "Client",
        summary: "An organization buying services.",
        content: { attributes: ["name", "industry", "account_lead"] },
        confidence: 0.9,
      },
      {
        itemType: "entity_type",
        key: "entity_engagement",
        title: "Engagement",
        summary: "A scoped unit of client work.",
        content: { attributes: ["number", "type", "status", "revenue"] },
        confidence: 0.9,
      },
      {
        itemType: "entity_type",
        key: "entity_deliverable",
        title: "Deliverable",
        summary: "A promised work product for an engagement.",
        content: { attributes: ["name", "type", "due_date", "status"] },
        confidence: 0.9,
      },
      {
        itemType: "workflow",
        key: "workflow_engagement_lifecycle",
        title: "Engagement lifecycle",
        content: {
          stages: ["Pipeline", "Proposal", "Signed", "Delivery", "Billing", "Closed"],
        },
        confidence: 0.8,
      },
    ],
  },
  {
    key: "property-management",
    name: "Property Management Pack",
    packType: "industry",
    description: "Units, tenants, leases and maintenance for property managers.",
    version: "1.0.0",
    publisher: "Atlas",
    items: [
      {
        itemType: "entity_type",
        key: "entity_property_unit",
        title: "Unit",
        summary: "A rentable space within a property.",
        content: { attributes: ["address", "unit", "rent", "status"] },
        confidence: 0.9,
      },
      {
        itemType: "entity_type",
        key: "entity_tenant",
        title: "Tenant",
        summary: "A person or company renting a unit.",
        content: { attributes: ["name", "email", "unit", "lease_start"] },
        confidence: 0.9,
      },
      {
        itemType: "entity_type",
        key: "entity_maintenance_request",
        title: "Maintenance request",
        summary: "A reported issue needing repair or service.",
        content: { attributes: ["unit", "category", "priority", "status"] },
        confidence: 0.9,
      },
      {
        itemType: "workflow",
        key: "workflow_lease_lifecycle",
        title: "Lease lifecycle",
        content: {
          stages: ["Listing", "Showing", "Application", "Lease signed", "Renewal", "Move-out"],
        },
        confidence: 0.8,
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
