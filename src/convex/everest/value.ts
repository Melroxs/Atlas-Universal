// ---------------------------------------------------------------------------
// Everest — Industry Value Engines & Discovery
//
// Every industry pack defines the primary economic/operational pain point it
// exists to improve — the answer to "why would this industry pay for Atlas?"
// Implementation status is honest: insurance restoration is the reference
// vertical; adjacent industries are declared drafts, never claimed complete.
// ---------------------------------------------------------------------------

export interface IndustryValueEngine {
  id: string;
  industryPack: string;
  problem: string;
  affectedEntities: string[];
  detectionSignals: string[];
  evidenceRequirements: string[];
  calculationMethod: string;
  recommendedActions: string[];
  measurableOutcome: string;
  confidence: number;
  limitations: string[];
  /** implemented | draft — never claim value delivery without the engine. */
  implementationStatus: "implemented" | "draft";
}

export const VALUE_ENGINES: IndustryValueEngine[] = [
  {
    id: "value-insurance-recovery",
    industryPack: "insurance-restoration",
    problem:
      "Restoration contractors regularly leave legitimate revenue on the table — missing scope, documentation gaps and unreconciled carrier responses.",
    affectedEntities: ["claim", "estimate", "supplement", "carrier_response", "payment"],
    detectionSignals: [
      "Actual scope items absent from the documented scope",
      "Expected evidence categories with no material on file",
      "Carrier responses that are not approvals or payments",
      "Payments materially below the estimate without reconciliation",
      "Claims stalled in a stage beyond typical cycle time",
    ],
    evidenceRequirements: ["damage", "scope", "quantity", "pricing", "necessity"],
    calculationMethod:
      "Deterministic comparison of expected scope vs actual scope vs evidence vs estimate vs carrier response vs payment; each finding is evidence-labeled and reported as potential, never as a guarantee.",
    recommendedActions: [
      "Close evidence gaps before the next carrier review",
      "Document and submit supplements for verified additional scope",
      "Reconcile payments against estimates and recover legitimate amounts",
      "Assign owners and deadlines to stalled stages",
    ],
    measurableOutcome:
      "Share of claims with complete evidence sets and reconciled payments, and the count of documented supplement opportunities surfaced per period.",
    confidence: 0.75,
    limitations: [
      "Amounts are only stated when supported by verified evidence",
      "Carrier behavior and policy language vary — findings require review",
      "No guarantee of recovery is ever made",
    ],
    implementationStatus: "implemented",
  },
  {
    id: "value-roofing-home-services",
    industryPack: "roofing",
    problem:
      "Roofing and home-services operators lose margin to unreconciled insurance scopes, missed supplements and incomplete documentation.",
    affectedEntities: ["roof_claim", "estimate", "supplement", "documentation"],
    detectionSignals: ["Scope vs actual mismatch", "Missing photo logs", "Unreconciled carrier payment"],
    evidenceRequirements: ["damage", "scope", "pricing"],
    calculationMethod:
      "Reuse the insurance recovery analyzer with roofing-specific evidence expectations (photo logs, shingle counts, drip-edge and underlayment line items).",
    recommendedActions: ["Run the documentation checklist", "Reconcile final payment vs estimate"],
    measurableOutcome: "Reduced unreconciled-payment count per quarter.",
    confidence: 0.6,
    limitations: ["Requires the roofing evidence model to be finalized."],
    implementationStatus: "draft",
  },
  {
    id: "value-solar",
    industryPack: "solar",
    problem:
      "Solar companies lose deals and margin to slow permitting, missed change orders and stalled install-to-PTO handoffs.",
    affectedEntities: ["lead", "proposal", "permit", "install_job", "pto"],
    detectionSignals: ["Permit stage age beyond typical", "Proposal-to-contract delay", "PTO queue backlog"],
    evidenceRequirements: ["permit docs", "contract", "install sign-off"],
    calculationMethod:
      "Pipeline stage-age analysis against the install lifecycle with permit and PTO SLA windows.",
    recommendedActions: ["Escalate stalled permits", "Track change orders against the proposal"],
    measurableOutcome: "Reduced average days from contract to commissioned system.",
    confidence: 0.6,
    limitations: ["Permit timelines vary widely by jurisdiction."],
    implementationStatus: "draft",
  },
  {
    id: "value-property-management",
    industryPack: "property-management",
    problem:
      "Property managers leak revenue through vacancy, missed rent, unpaid maintenance bill-backs and slow turn times.",
    affectedEntities: ["unit", "tenant", "maintenance_request", "lease"],
    detectionSignals: ["Unit vacancy days", "Overdue rent", "Unbilled maintenance"],
    evidenceRequirements: ["lease", "maintenance records", "rent roll"],
    calculationMethod:
      "Vacancy and receivables analysis against the lease lifecycle with maintenance bill-back tracking.",
    recommendedActions: ["Escalate overdue accounts", "Close unbilled work orders"],
    measurableOutcome: "Reduced vacancy days and unbilled maintenance per period.",
    confidence: 0.55,
    limitations: ["Requires rent roll data from a connected accounting system."],
    implementationStatus: "draft",
  },
  {
    id: "value-construction",
    industryPack: "construction",
    problem:
      "Contractors leak margin to unapproved change work, missing lien waivers and slow pay applications.",
    affectedEntities: ["project", "change_order", "pay_application", "lien_waiver"],
    detectionSignals: ["Change work without approval", "Pay applications without lien waivers"],
    evidenceRequirements: ["contract", "change orders", "pay apps"],
    calculationMethod:
      "Project documentation completeness scoring against the construction lifecycle.",
    recommendedActions: ["Gate pay applications on lien waivers", "Approve change orders before work"],
    measurableOutcome: "Share of pay applications issued with complete waiver documentation.",
    confidence: 0.55,
    limitations: ["State-specific lien rules vary."],
    implementationStatus: "draft",
  },
  {
    id: "value-professional-services",
    industryPack: "professional-services",
    problem:
      "Services firms leak revenue through unbilled time, write-offs and engagement scope creep.",
    affectedEntities: ["engagement", "deliverable", "time_entry", "invoice"],
    detectionSignals: ["Unbilled time over 30 days", "Deliverables past due", "Scope creep without change orders"],
    evidenceRequirements: ["timesheets", "engagement contract"],
    calculationMethod:
      "Utilization and unbilled-time analysis against the engagement lifecycle.",
    recommendedActions: ["Billing cadence check", "Scope change review"],
    measurableOutcome: "Reduced unbilled-time days and write-off share.",
    confidence: 0.55,
    limitations: ["Requires time tracking data."],
    implementationStatus: "draft",
  },
];

export function valueEngineFor(packKey: string): IndustryValueEngine | undefined {
  return VALUE_ENGINES.find((v) => v.industryPack === packKey);
}

// --- Discovery engine --------------------------------------------------------

export type OpportunityCategory =
  | "revenue_leakage"
  | "cost_leakage"
  | "compliance_risk"
  | "operational_bottleneck"
  | "missed_deadline"
  | "uncollected_revenue"
  | "underbilling"
  | "missed_opportunity"
  | "documentation_failure"
  | "workflow_failure"
  | "customer_churn"
  | "labor_inefficiency";

export interface IndustryOpportunity {
  category: OpportunityCategory;
  rank: number;
  title: string;
  description: string;
  /** "domain" = industry knowledge; anything else must cite org evidence. */
  evidenceKind: "domain" | "organization";
  relevance: string;
  confidence: number;
}

const CATEGORY_WEIGHTS: Array<{ category: OpportunityCategory; weight: number }> = [
  { category: "uncollected_revenue", weight: 0.95 },
  { category: "underbilling", weight: 0.9 },
  { category: "revenue_leakage", weight: 0.85 },
  { category: "documentation_failure", weight: 0.8 },
  { category: "missed_deadline", weight: 0.7 },
  { category: "operational_bottleneck", weight: 0.6 },
  { category: "workflow_failure", weight: 0.55 },
  { category: "compliance_risk", weight: 0.5 },
  { category: "cost_leakage", weight: 0.45 },
  { category: "missed_opportunity", weight: 0.4 },
  { category: "customer_churn", weight: 0.35 },
  { category: "labor_inefficiency", weight: 0.3 },
];

/** Ranked industry opportunities. Every opportunity is explicitly labeled
 *  domain-level knowledge unless organization-specific evidence is supplied. */
export function discoverOpportunities(
  packKey: string,
  orgEvidence?: Record<OpportunityCategory, string | null> | null,
): IndustryOpportunity[] {
  const engine = valueEngineFor(packKey);
  const categories = CATEGORY_WEIGHTS.map((c, i) => ({
    ...c,
    rank: i + 1,
    evidenceKind: orgEvidence?.[c.category] ? ("organization" as const) : ("domain" as const),
    evidence: orgEvidence?.[c.category] ?? null,
  }));
  return categories.map((c) => ({
    category: c.category,
    rank: c.rank,
    title: opportunityTitle(c.category),
    description: opportunityDescription(c.category, engine?.problem),
    evidenceKind: c.evidenceKind,
    relevance:
      c.evidenceKind === "organization" && c.evidence
        ? c.evidence
        : "Domain-level knowledge — organization-specific evidence is required before Atlas reports this as present in this workspace.",
    confidence: c.evidenceKind === "organization" ? 0.7 : 0.4,
  }));
}

function opportunityTitle(c: OpportunityCategory): string {
  const map: Record<OpportunityCategory, string> = {
    revenue_leakage: "Revenue leakage",
    cost_leakage: "Cost leakage",
    compliance_risk: "Compliance risk",
    operational_bottleneck: "Operational bottleneck",
    missed_deadline: "Missed deadlines",
    uncollected_revenue: "Uncollected revenue",
    underbilling: "Underbilling",
    missed_opportunity: "Missed opportunities",
    documentation_failure: "Documentation failures",
    workflow_failure: "Workflow failures",
    customer_churn: "Customer churn",
    labor_inefficiency: "Labor inefficiency",
  };
  return map[c];
}

function opportunityDescription(c: OpportunityCategory, problem?: string): string {
  const map: Record<OpportunityCategory, string> = {
    revenue_leakage: "Work performed or delivered without a matching billing record.",
    cost_leakage: "Expenses incurred without purchase control or documentation.",
    compliance_risk: "Operational steps that may fall outside applicable requirements.",
    operational_bottleneck: "Stages where work predictably stalls and delays cascade.",
    missed_deadline: "Time-bound obligations (approvals, filings, expirations) with no owner.",
    uncollected_revenue: "Approved or delivered work awaiting payment beyond cycle norms.",
    underbilling: "Scope documented but not fully reflected in billing.",
    missed_opportunity: "Valid additional scope never submitted for approval.",
    documentation_failure: "Expected evidence absent at decision points.",
    workflow_failure: "Processes with no defined owner, handoff or completion check.",
    customer_churn: "At-risk relationships with no retention signal.",
    labor_inefficiency: "High-value labor consumed by avoidable manual work.",
  };
  return problem ? `${map[c]} ${problem}` : map[c];
}
