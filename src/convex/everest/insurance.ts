// ---------------------------------------------------------------------------
// Everest — Insurance Restoration Deep Vertical
//
// Industry knowledge that exists BEFORE any customer uploads a claim: what a
// claim generally involves, what entities it contains, what evidence is
// commonly expected, and what normally happens at each stage. Company-specific
// knowledge remains a separate, tenant-scoped concern.
// ---------------------------------------------------------------------------

// --- 37. Generalized claim lifecycle -----------------------------------------

export interface ClaimStage {
  stage: string;
  description: string;
  typicalInputs: string[];
  typicalOutputs: string[];
}

/** Generalized model — tenant workflows may override or specialize it. */
export const CLAIM_LIFECYCLE: ClaimStage[] = [
  { stage: "Loss", description: "A loss event occurs (water, fire, wind, storm…).", typicalInputs: ["Event report"], typicalOutputs: ["Loss details"] },
  { stage: "FNOL", description: "First notice of loss filed with the carrier.", typicalInputs: ["Loss report", "Policy info"], typicalOutputs: ["Claim number"] },
  { stage: "Claim setup", description: "The claim is opened and assigned.", typicalInputs: ["Claim number", "Policy"], typicalOutputs: ["Claim file", "Assignee"] },
  { stage: "Inspection", description: "Damage is inspected and documented.", typicalInputs: ["Inspection photos", "Adjuster notes"], typicalOutputs: ["Damage documentation"] },
  { stage: "Documentation", description: "Evidence is gathered and organized.", typicalInputs: ["Photos", "Measurements", "Reports"], typicalOutputs: ["Evidence set"] },
  { stage: "Estimate", description: "Scope is priced into an estimate.", typicalInputs: ["Scope of work", "Pricing references"], typicalOutputs: ["Estimate"] },
  { stage: "Scope review", description: "Scope is reviewed for completeness and accuracy.", typicalInputs: ["Estimate", "Inspection docs"], typicalOutputs: ["Reviewed scope"] },
  { stage: "Carrier / adjuster review", description: "The carrier reviews and responds.", typicalInputs: ["Estimate", "Supporting docs"], typicalOutputs: ["Carrier response"] },
  { stage: "Payment", description: "Approved amounts are paid.", typicalInputs: ["Approval", "Invoices"], typicalOutputs: ["Payment"] },
  { stage: "Supplement opportunity", description: "Undocumented scope surfaces a potential supplement.", typicalInputs: ["New conditions", "Photos"], typicalOutputs: ["Supplement opportunity"] },
  { stage: "Supplement submission", description: "Supplement is submitted for review.", typicalInputs: ["Supplement scope", "Evidence"], typicalOutputs: ["Submitted supplement"] },
  { stage: "Review", description: "Carrier reviews the supplement.", typicalInputs: ["Supplement", "Evidence"], typicalOutputs: ["Review decision"] },
  { stage: "Approval / partial / denial", description: "The claim is approved, partially approved or denied.", typicalInputs: ["Review decision"], typicalOutputs: ["Approval / denial"] },
  { stage: "Recovery", description: "Outstanding legitimate amounts are pursued.", typicalInputs: ["Denial / underpayment", "Evidence"], typicalOutputs: ["Recovery actions"] },
  { stage: "Closure", description: "The claim is closed.", typicalInputs: ["Final payment", "Closeout docs"], typicalOutputs: ["Closed file"] },
];

// --- 38. Claim evidence model -------------------------------------------------

export interface EvidenceCategory {
  key: string;
  name: string;
  description: string;
  examples: string[];
  /** Examples are illustrative, never universal requirements. */
  note: string;
}

export const CLAIM_EVIDENCE_CATEGORIES: EvidenceCategory[] = [
  {
    key: "damage",
    name: "Damage evidence",
    description: "What the loss actually did to the property.",
    examples: ["Photographs", "Inspections", "Measurements", "Reports"],
    note: "The right damage evidence varies by loss type — these are common forms, not a fixed list.",
  },
  {
    key: "scope",
    name: "Scope evidence",
    description: "The observed damage, affected materials and required work.",
    examples: ["Observed damage", "Affected materials", "Required work", "Supporting standards"],
    note: "Scope evidence must tie each line of work back to a documented condition — the specific form varies by project, so this is never a fixed list.",
  },
  {
    key: "quantity",
    name: "Quantity evidence",
    description: "The measured amounts behind line items.",
    examples: ["Measurements", "Diagrams", "Takeoffs", "Documentation"],
    note: "Quantities should be reproducible from the evidence set (e.g. room dimensions, square footage).",
  },
  {
    key: "pricing",
    name: "Pricing evidence",
    description: "Why a price is what it is.",
    examples: ["Applicable pricing references", "Invoices", "Documented costs", "Supported pricing rationale"],
    note: "Pricing without a reference is the most commonly disputed item in supplements.",
  },
  {
    key: "necessity",
    name: "Necessity evidence",
    description: "Why the work is required at all.",
    examples: ["Documented conditions", "Reason work is required", "Applicable standards"],
    note: "Necessity is what separates an approved item from a disputed one; what counts as necessary varies by loss, contract and jurisdiction.",
  },
];

// --- 39. Claim knowledge before any customer-uploaded claim --------------------

export const CLAIM_BASELINE = {
  entities: [
    "policy", "claim", "loss", "insured", "carrier", "adjuster", "contractor",
    "inspection", "damage", "scope", "estimate", "line item", "supplement",
    "payment", "depreciation", "recoverable depreciation", "deductible",
  ],
  evidenceExpectations: {
    damage: ["Photographs", "Inspection notes", "Measurements"],
    scope: ["Observed damage", "Affected materials", "Required work"],
    quantity: ["Measurements", "Diagrams", "Takeoffs"],
    pricing: ["Pricing references", "Invoices", "Documented costs"],
    necessity: ["Documented conditions", "Applicable standards"],
  },
  workflows: CLAIM_LIFECYCLE.map((s) => s.stage),
  regulatoryContext:
    "Official requirements may apply (licensing, records, lead/RRP, workplace safety). Applicability is evaluated per jurisdiction and industry — Atlas never presents unverified guidance as law.",
  companySpecific:
    "What this particular company does (roles, pricing, software, carrier relationships) is tenant-scoped knowledge — never assumed from the baseline.",
};

// --- 40. Insurance revenue recovery intelligence ------------------------------

export interface ClaimFacts {
  /** Line items present in the documented/expected scope. */
  expectedScope?: string[];
  /** Line items actually observed or performed. */
  actualScope?: string[];
  /** Evidence-set summary: which evidence categories have material. */
  evidenceSummary?: string[];
  /** The priced estimate amount (dollars). */
  estimateAmount?: number;
  /** Carrier's latest response (approved / partial / denied / pending…). */
  carrierResponse?: string;
  /** Amount the carrier paid (dollars). */
  paymentAmount?: number;
  /** Stage the claim currently sits in. */
  currentStage?: string;
  /** How long the claim has been at the current stage (days). */
  stageAgeDays?: number;
}

export interface RecoveryOpportunity {
  type:
    | "missing_scope"
    | "documentation_gap"
    | "scope_inconsistency"
    | "unresolved_carrier_response"
    | "potential_underpayment"
    | "workflow_delay"
    | "supplement_opportunity";
  severity: "high" | "medium" | "low";
  title: string;
  /** The evidence behind the finding — never fabricated. */
  evidence: string[];
  confidence: number;
  explanation: string;
  financialRelevance: string;
  recommendedNextStep: string;
}

const EVIDENCE_CATEGORIES = CLAIM_EVIDENCE_CATEGORIES.map((c) => c.key);

/**
 * Compare expected/documented scope vs actual scope vs evidence vs estimate
 * vs carrier response vs payment, then surface POTENTIAL recovery
 * opportunities. Every finding is deterministic, evidence-labeled, and worded
 * as a possibility — never a guarantee.
 */
export function analyzeRecoveryOpportunities(facts: ClaimFacts): RecoveryOpportunity[] {
  const out: RecoveryOpportunity[] = [];
  const expected = facts.expectedScope ?? [];
  const actual = facts.actualScope ?? [];
  const evidence = facts.evidenceSummary ?? [];
  const evidenceSet = new Set(evidence.map((e) => e.toLowerCase()));

  // Missing scope: actual work not reflected in the expected/documented scope.
  const missing = actual.filter((a) => !expected.includes(a));
  if (missing.length > 0) {
    out.push({
      type: "missing_scope",
      severity: "high",
      title: "Potential missing scope",
      evidence: [`Actual scope includes: ${missing.join(", ")}`],
      confidence: 0.7,
      explanation:
        "Work appears to have been performed or observed that is not present in the documented scope.",
      financialRelevance: "Unbilled work is unrecovered revenue if not documented and submitted.",
      recommendedNextStep: "Document the additional items with evidence and submit a supplement.",
    });
  }

  // Documentation gaps: expected evidence categories with no material.
  const gaps = EVIDENCE_CATEGORIES.filter((c) => !evidenceSet.has(c));
  if (gaps.length > 0 && evidence.length >= 0) {
    const gapList = gaps.join(", ");
    out.push({
      type: "documentation_gap",
      severity: gaps.length >= 3 ? "high" : "medium",
      title: "Documentation gaps",
      evidence: [`Evidence set missing: ${gapList}`],
      confidence: 0.6,
      explanation:
        "Expected evidence categories have no material on file. Carriers commonly reduce or deny amounts that lack supporting evidence.",
      financialRelevance: "Gaps directly weaken every line item they touch.",
      recommendedNextStep: "Close the gaps before the next carrier review or supplement.",
    });
  }

  // Scope inconsistencies: expected scope lists items with no actual counterpart.
  const inconsistent = expected.filter((e) => !actual.includes(e));
  if (inconsistent.length > 0 && actual.length > 0) {
    out.push({
      type: "scope_inconsistency",
      severity: "medium",
      title: "Scope inconsistencies",
      evidence: [`Documented scope includes: ${inconsistent.join(", ")}`],
      confidence: 0.5,
      explanation:
        "Items in the documented scope have no corresponding record in the actual scope — either work wasn't performed or it wasn't documented.",
      financialRelevance: "Unreconciled scope items can be paid, disputed or written off depending on the record.",
      recommendedNextStep: "Reconcile the documented scope against actual work and evidence.",
    });
  }

  // Unresolved carrier response.
  const response = (facts.carrierResponse ?? "").toLowerCase();
  if (response && !["approved", "paid", "accepted", "closed"].some((w) => response.includes(w))) {
    out.push({
      type: "unresolved_carrier_response",
      severity: "high",
      title: "Unresolved carrier response",
      evidence: [`Carrier response: ${facts.carrierResponse}`],
      confidence: 0.7,
      explanation:
        "The carrier's latest response is not an approval or payment — an open response that needs action or escalation.",
      financialRelevance: "Every open response is outstanding revenue.",
      recommendedNextStep: "Review the response, respond in writing, and track the follow-up deadline.",
    });
  }

  // Potential underpayment (estimate vs payment, with documented reason check).
  if (
    typeof facts.estimateAmount === "number" &&
    typeof facts.paymentAmount === "number" &&
    facts.paymentAmount < facts.estimateAmount * 0.95
  ) {
    out.push({
      type: "potential_underpayment",
      severity: "medium",
      title: "Potential underpayment",
      evidence: [`Estimate $${facts.estimateAmount.toLocaleString()}`, `Paid $${facts.paymentAmount.toLocaleString()}`],
      confidence: 0.5,
      explanation:
        "Payment is materially below the estimate. This can be legitimate (deductible, depreciation, negotiated cuts) — it must be reconciled before any claim.",
      financialRelevance: "Recoverable depreciation and deducted amounts are commonly recoverable.",
      recommendedNextStep: "Reconcile the payment against the estimate; document the difference and recover what is legitimate.",
    });
  }

  // Workflow delay.
  if (typeof facts.stageAgeDays === "number" && facts.stageAgeDays >= 14) {
    out.push({
      type: "workflow_delay",
      severity: facts.stageAgeDays >= 30 ? "high" : "low",
      title: "Workflow delay",
      evidence: [`Current stage: ${facts.currentStage ?? "unknown"}`, `${facts.stageAgeDays} days in stage`],
      confidence: 0.6,
      explanation:
        "The claim has been in the same stage unusually long, which typically signals an unhandled dependency.",
      financialRelevance: "Delays push revenue out and can cause supplements to be missed entirely.",
      recommendedNextStep: "Identify the blocking step and assign an owner with a deadline.",
    });
  }

  // Supplement opportunity — from either missing scope or price/condition drift.
  if (missing.length > 0 || (typeof facts.stageAgeDays === "number" && facts.stageAgeDays > 90)) {
    const already = out.some((o) => o.type === "supplement_opportunity" || o.type === "missing_scope");
    if (!already) {
      out.push({
        type: "supplement_opportunity",
        severity: "medium",
        title: "Potential supplement opportunity",
        evidence: [`Estimate age in stage: ${facts.stageAgeDays ?? "unknown"} days`],
        confidence: 0.5,
        explanation:
          "Conditions (hidden damage, price movement, elapsed time) may mean the original estimate no longer covers the actual scope.",
        financialRelevance: "Supplements are typically 15–40% of original scope when properly documented.",
        recommendedNextStep: "Review conditions against the original estimate and prepare a documented supplement.",
      });
    }
  }

  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : b.severity === "high" ? 1 : a.severity === "medium" ? -1 : 1));
}

/** Insurance intelligence bundle served to the UI and Ask Atlas. */
export const INSURANCE_INTELLIGENCE = {
  lifecycle: CLAIM_LIFECYCLE,
  evidenceCategories: CLAIM_EVIDENCE_CATEGORIES,
  baseline: CLAIM_BASELINE,
};
