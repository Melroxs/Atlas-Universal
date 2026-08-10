// ---------------------------------------------------------------------------
// Everest — Insurance Restoration Deep Vertical
//
// Industry knowledge that exists BEFORE any customer uploads a claim: what a
// claim generally involves, what entities it contains, what evidence is
// commonly expected, and what normally happens at each stage. Company-specific
// knowledge remains a separate, tenant-scoped concern.
//
// DOMAIN vs ORGANIZATION: everything here is domain-level knowledge — what is
// generally true in the industry. Atlas never states an organization-specific
// fact (e.g. "this claim is at stage 7") unless evidence supports it.
// ---------------------------------------------------------------------------

// --- Generalized claim lifecycle (17 stages) ---------------------------------

export interface ClaimStage {
  stage: string;
  description: string;
  typicalInputs: string[];
  typicalOutputs: string[];
}

/** Generalized model — tenant workflows may override or specialize it. */
export const CLAIM_LIFECYCLE: ClaimStage[] = [
  { stage: "Lead / Loss", description: "A loss event or incoming lead is captured.", typicalInputs: ["Event report", "Lead intake"], typicalOutputs: ["Loss details"] },
  { stage: "FNOL", description: "First notice of loss filed with the carrier.", typicalInputs: ["Loss report", "Policy info"], typicalOutputs: ["Claim number"] },
  { stage: "Coverage / Claim", description: "Coverage is confirmed and the claim is opened.", typicalInputs: ["Policy", "Claim number"], typicalOutputs: ["Claim file"] },
  { stage: "Inspection", description: "Damage is inspected and documented on site.", typicalInputs: ["Inspection photos", "Adjuster notes"], typicalOutputs: ["Damage documentation"] },
  { stage: "Documentation", description: "Evidence is gathered and organized.", typicalInputs: ["Photos", "Measurements", "Reports"], typicalOutputs: ["Evidence set"] },
  { stage: "Estimate", description: "Scope is priced into an estimate.", typicalInputs: ["Scope of work", "Pricing references"], typicalOutputs: ["Estimate"] },
  { stage: "Scope comparison", description: "Documented scope is compared against the actual work.", typicalInputs: ["Estimate", "Actual scope"], typicalOutputs: ["Scope gaps"] },
  { stage: "Carrier review", description: "The carrier reviews the estimate and evidence.", typicalInputs: ["Estimate", "Supporting docs"], typicalOutputs: ["Carrier response"] },
  { stage: "Supplement identification", description: "Undocumented scope surfaces a potential supplement.", typicalInputs: ["New conditions", "Photos"], typicalOutputs: ["Supplement opportunity"] },
  { stage: "Supplement preparation", description: "The supplement scope and evidence are assembled.", typicalInputs: ["Supplement scope", "Evidence"], typicalOutputs: ["Draft supplement"] },
  { stage: "Submission", description: "The supplement is submitted for review.", typicalInputs: ["Draft supplement", "Evidence"], typicalOutputs: ["Submitted supplement"] },
  { stage: "Carrier response", description: "The carrier responds to the supplement.", typicalInputs: ["Supplement", "Evidence"], typicalOutputs: ["Response / revision request"] },
  { stage: "Negotiation / revision", description: "Disputed items are negotiated or revised.", typicalInputs: ["Response", "Supporting data"], typicalOutputs: ["Agreed scope"] },
  { stage: "Approval", description: "The agreed scope is approved.", typicalInputs: ["Agreed scope"], typicalOutputs: ["Approval"] },
  { stage: "Work completion", description: "Approved work is completed.", typicalInputs: ["Approval", "Job plan"], typicalOutputs: ["Completion docs"] },
  { stage: "Final billing", description: "Final invoice is issued against the approved scope.", typicalInputs: ["Approved scope", "Completion docs"], typicalOutputs: ["Final invoice"] },
  { stage: "Revenue reconciliation", description: "Payments are reconciled against the final billing.", typicalInputs: ["Invoice", "Payments"], typicalOutputs: ["Reconciled revenue"] },
];

// --- Claim evidence model -----------------------------------------------------

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

// --- Claim knowledge before any customer-uploaded claim ------------------------

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
  /** Explicit knowledge-kind labels: domain vs organization vs evidence. */
  knowledgeKinds: {
    domain: [
      "A claim generally progresses through defined operational stages.",
      "Carriers commonly reduce or deny amounts that lack supporting evidence.",
      "Estimates typically expire or need revision beyond 90 days.",
    ],
    organization: [
      "This company's claims, stages, amounts and carriers are organization facts — only ever asserted from actual records.",
    ],
    evidence: [
      "Photographs, inspection notes, measurements, drying logs and pricing references are the evidence that proves organization-specific facts.",
    ],
  },
};

// --- Revenue recovery intelligence ----------------------------------------------

export interface ClaimFacts {
  /** Line items present in the documented/expected scope. */
  expectedScope?: string[];
  /** Line items actually observed or performed. */
  actualScope?: string[];
  /** Evidence-set summary: which evidence categories have material. */
  evidenceSummary?: string[];
  /** The priced estimate amount (dollars). */
  estimateAmount?: number;
  /** The estimate's line-item count (for line-item-level checks). */
  estimateLineItemCount?: number;
  /** Carrier's latest response (approved / partial / denied / pending…). */
  carrierResponse?: string;
  /** Amount the carrier paid (dollars). */
  paymentAmount?: number;
  /** Amount actually invoiced (dollars). */
  invoicedAmount?: number;
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
    | "supplement_opportunity"
    | "estimate_inconsistency"
    | "overlooked_line_item"
    | "billing_reconciliation";
  severity: "high" | "medium" | "low";
  title: string;
  /** The evidence behind the finding — never fabricated. */
  evidence: string[];
  confidence: number;
  explanation: string;
  financialRelevance: string;
  recommendedNextStep: string;
  /** Honest caveat about what this finding cannot claim. */
  limitation: string;
}

const EVIDENCE_CATEGORIES = CLAIM_EVIDENCE_CATEGORIES.map((c) => c.key);

/**
 * Compare expected/documented scope vs actual scope vs evidence vs estimate
 * vs carrier response vs payment, then surface POTENTIAL recovery
 * opportunities. Every finding is deterministic, evidence-labeled, carries a
 * limitation, and is worded as a possibility — never a guarantee.
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
      limitation: "Atlas cannot confirm the work was performed — it only reports the discrepancy between the documented and actual scope records.",
    });
  }

  // Documentation gaps: expected evidence categories with no material.
  const gaps = EVIDENCE_CATEGORIES.filter((c) => !evidenceSet.has(c));
  if (gaps.length > 0) {
    out.push({
      type: "documentation_gap",
      severity: gaps.length >= 3 ? "high" : "medium",
      title: "Documentation gaps",
      evidence: [`Evidence set missing: ${gaps.join(", ")}`],
      confidence: 0.6,
      explanation:
        "Expected evidence categories have no material on file. Carriers commonly reduce or deny amounts that lack supporting evidence.",
      financialRelevance: "Gaps directly weaken every line item they touch.",
      recommendedNextStep: "Close the gaps before the next carrier review or supplement.",
      limitation: "Absence of material in Atlas does not prove the material does not exist elsewhere.",
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
      limitation: "Atlas cannot determine which side of the record is correct without the underlying evidence.",
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
      limitation: "The response text is taken at face value from the record; its full context may require the original correspondence.",
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
      limitation: "The gap may be fully explained by deductible, depreciation or negotiated adjustments not visible in these fields.",
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
      limitation: "Long stage duration may be intentional (waiting on carrier or homeowner); it flags review, not fault.",
    });
  }

  // Supplement opportunity — from missing scope or age drift.
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
        limitation: "Age alone is not proof of a supplement — conditions must be documented.",
      });
    }
  }

  // Estimate inconsistencies: estimate amount vs invoiced amount disagree.
  if (
    typeof facts.estimateAmount === "number" &&
    typeof facts.invoicedAmount === "number" &&
    facts.invoicedAmount !== facts.estimateAmount
  ) {
    out.push({
      type: "estimate_inconsistency",
      severity: "medium",
      title: "Estimate vs billing inconsistency",
      evidence: [`Estimate $${facts.estimateAmount.toLocaleString()}`, `Invoiced $${facts.invoicedAmount.toLocaleString()}`],
      confidence: 0.55,
      explanation:
        "The final invoice differs from the estimate. Differences can be supplements, allowances or deductions — each needs a documented reason.",
      financialRelevance: "Unreconciled estimate-to-billing differences hide both over- and under-collection.",
      recommendedNextStep: "Reconcile invoice line items against the approved estimate and document every variance.",
      limitation: "A difference is not automatically an error — supplements and allowances are legitimate causes.",
    });
  }

  // Overlooked line items: estimate lines vs expected scope concepts.
  if (
    typeof facts.estimateLineItemCount === "number" &&
    expected.length > 0 &&
    facts.estimateLineItemCount < expected.length
  ) {
    out.push({
      type: "overlooked_line_item",
      severity: "medium",
      title: "Potentially overlooked line items",
      evidence: [`Estimate line items: ${facts.estimateLineItemCount}`, `Documented scope items: ${expected.length}`],
      confidence: 0.45,
      explanation:
        "The estimate contains fewer line items than the documented scope suggests — items may have been consolidated or missed.",
      financialRelevance: "Missed line items are unrecovered revenue.",
      recommendedNextStep: "Compare the estimate line-item list against the scope item by item.",
      limitation: "Scope items are often legitimately consolidated into a single estimate line — this is a flag to verify, not a finding of error.",
    });
  }

  // Billing / reconciliation issues: invoiced vs paid mismatch beyond estimate logic.
  if (
    typeof facts.invoicedAmount === "number" &&
    typeof facts.paymentAmount === "number" &&
    facts.paymentAmount < facts.invoicedAmount * 0.95
  ) {
    out.push({
      type: "billing_reconciliation",
      severity: "medium",
      title: "Billing reconciliation gap",
      evidence: [`Invoiced $${facts.invoicedAmount.toLocaleString()}`, `Paid $${facts.paymentAmount.toLocaleString()}`],
      confidence: 0.5,
      explanation:
        "Payment is materially below the final invoice. The difference may be outstanding, disputed, or already adjusted.",
      financialRelevance: "Unreconciled invoice-to-payment gaps are outstanding cash.",
      recommendedNextStep: "Trace the payment to the invoice and chase or write off the difference deliberately.",
      limitation: "Partial payments in progress or agreed adjustments can explain the gap.",
    });
  }

  return out.sort((a, b) =>
    a.severity === b.severity
      ? 0
      : a.severity === "high"
        ? -1
        : b.severity === "high"
          ? 1
          : a.severity === "medium"
            ? -1
            : 1,
  );
}

// --- Restoration concept glossary (Phase 12) ----------------------------------
//
// Domain vocabulary for the restoration vertical. Every concept carries an
// honest "context varies" note — Atlas never encodes carrier-, policy- or
// jurisdiction-specific rules as universal rules. Where a concept varies, the
// relevant context (carrier, policy, jurisdiction, contract, municipality,
// project) is named so the claim/package must resolve it.
// -----------------------------------------------------------------------------

export interface RestorationConcept {
  term: string;
  meaning: string;
  /** Where this concept varies and must be resolved per claim. */
  contextVaries: string;
  isUniversal: boolean;
}

export const RESTORATION_CONCEPTS: RestorationConcept[] = [
  { term: "First notice of loss (FNOL)", meaning: "The initial report of a loss to the carrier that opens the claim record.", contextVaries: "Notification channel and required details vary by carrier and policy.", isUniversal: false },
  { term: "Claim documentation", meaning: "The evidence set — photos, logs, reports, correspondence — that supports the claim and each line item.", contextVaries: "Specific required documents vary by carrier, jurisdiction and loss type.", isUniversal: false },
  { term: "Inspection", meaning: "On-site documentation of damage that feeds the scope and estimate.", contextVaries: "Who inspects and what is recorded varies by carrier and policy.", isUniversal: false },
  { term: "Scope", meaning: "The documented set of damage and required work that a claim or supplement covers.", contextVaries: "Scope boundaries and conventions vary by project, policy and carrier.", isUniversal: false },
  { term: "Estimating", meaning: "Pricing the scope into a line-item estimate (commonly Xactimate in this industry).", contextVaries: "Line-item format and pricing references vary by estimating system and carrier.", isUniversal: false },
  { term: "Mitigation", meaning: "Emergency work that stops further damage (extraction, drying, temporary protection).", contextVaries: "What counts as emergency mitigation varies by policy and carrier guidelines.", isUniversal: false },
  { term: "Remediation", meaning: "Work that returns the property to a safe, habitable condition (mold, contaminants, deodorization).", contextVaries: "Standards and documentation vary by jurisdiction and applicable regulations.", isUniversal: false },
  { term: "Repair / reconstruction", meaning: "Replacing or rebuilding damaged components to the pre-loss condition.", contextVaries: "Rebuild scope and payment terms vary by policy and contract.", isUniversal: false },
  { term: "Depreciation", meaning: "Reduction of payment based on age/wear of damaged items, often recoverable after repairs.", contextVaries: "Depreciation method and recoverability vary by policy, carrier and state.", isUniversal: false },
  { term: "Deductible", meaning: "The policyholder's out-of-pocket amount that is commonly deducted from payment.", contextVaries: "Deductible amount and who pays it vary by policy and jurisdiction.", isUniversal: false },
  { term: "Supplement", meaning: "A formal request for additional scope/amount beyond the original estimate.", contextVaries: "Approval requirements, timing and forms vary by carrier and contract.", isUniversal: false },
  { term: "Change order", meaning: "A contract-level scope change document (project side of a supplement).", contextVaries: "Contract terms define when a change order is required.", isUniversal: false },
  { term: "Invoice", meaning: "The billing document issued against approved scope.", contextVaries: "Format, references and timing vary by carrier and contract (commonly net-30).", isUniversal: false },
  { term: "Proof of work", meaning: "Documentation that the work was performed as billed (photos, logs, sign-offs).", contextVaries: "What constitutes acceptable proof varies by carrier.", isUniversal: false },
  { term: "Proof of loss", meaning: "Formal loss documentation the policyholder submits to the carrier.", contextVaries: "Form and deadline vary by policy and jurisdiction.", isUniversal: false },
  { term: "Payment reconciliation", meaning: "Matching payments to approved scope, invoices and outstanding balances.", contextVaries: "Reconciliation expectations vary by carrier and accounting practice.", isUniversal: false },
  { term: "Recoverable amounts", meaning: "Amounts the company may still be entitled to collect (unpaid approved scope, recoverable depreciation, pending supplements).", contextVaries: "Recoverability is determined per policy, carrier response and evidence — never assumed.", isUniversal: false },
  { term: "Claim closeout", meaning: "Final reconciliation and closure of the claim record after payment.", contextVaries: "Closeout requirements vary by carrier and contract.", isUniversal: false },
];

/**
 * Industry authority references for restoration. These are informational
 * pointers — Atlas keeps SOURCE FACT (what an authority actually says)
 * separate from ATLAS INTERPRETATION and organization-specific evidence, and
 * never presents its own interpretation as law or carrier policy.
 */
export interface AuthorityReference {
  name: string;
  kind: "standards" | "regulator" | "code" | "publication";
  scope: string;
  /** Explicit: what an authority may govern varies by state/jurisdiction. */
  note: string;
  url?: string;
}

export const AUTHORITY_REFERENCES: AuthorityReference[] = [
  {
    name: "IICRC S500 (water damage restoration)",
    kind: "standards",
    scope: "Water damage restoration standard of care — commonly referenced in the industry.",
    note: "Industry standard, not law; its application varies by project and contract.",
    url: "https://iicrc.org/standards/",
  },
  {
    name: "IICRC S520 (mold remediation)",
    kind: "standards",
    scope: "Mold remediation standard of care.",
    note: "Industry standard; local and state regulations may impose additional requirements.",
    url: "https://iicrc.org/standards/",
  },
  {
    name: "State insurance department",
    kind: "regulator",
    scope: "Insurance regulation, claims-handling rules and consumer protections in the applicable state.",
    note: "Each state has its own department and rules — applicable jurisdiction must be resolved per claim.",
  },
  {
    name: "Building codes (applicable municipality/state)",
    kind: "code",
    scope: "Construction and repair must meet applicable codes at the property location.",
    note: "Codes vary by municipality and state; Atlas never asserts a code requirement without the governing source.",
  },
  {
    name: "Contractor licensing authority",
    kind: "regulator",
    scope: "Licensing and records requirements for contractors in the applicable state.",
    note: "Requirements vary by state and trade — verify against the governing authority.",
  },
  {
    name: "EPA RRP rule (lead-safe renovation)",
    kind: "regulator",
    scope: "Federal lead-safe work practice requirements for renovation of pre-1978 housing.",
    note: "Applies where triggered (pre-1978 housing); states may add stricter rules.",
    url: "https://www.epa.gov/lead/renovation-repair-and-painting-program",
  },
];

/** Insurance intelligence bundle served to the UI and Ask Atlas. */
export const INSURANCE_INTELLIGENCE = {
  lifecycle: CLAIM_LIFECYCLE,
  evidenceCategories: CLAIM_EVIDENCE_CATEGORIES,
  baseline: CLAIM_BASELINE,
  /** Phase 12 — restoration vocabulary for the vertical. */
  restorationConcepts: RESTORATION_CONCEPTS,
  /** Phase 12 — informational authority references (never presented as law). */
  authorityReferences: AUTHORITY_REFERENCES,
};
