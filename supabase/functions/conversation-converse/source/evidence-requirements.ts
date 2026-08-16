// ---------------------------------------------------------------------------
// Atlas Evidence Requirements + Gap Intelligence Engine (canonical, pure).
//
// DEPLOYMENT CONTRACT: this file lives INSIDE the conversation-converse
// function package directory so the Freebuff bundler ships it with the
// function. It contains NO Deno imports and NO repository imports, so the
// project's vitest suite and the browser fallback (src/lib/ask/retrieval.ts)
// can import it directly. It is the single source of truth for:
//
//   - what evidence a workflow REQUIRES (extensible per industry/workflow)
//   - comparing EXPECTED evidence vs AVAILABLE evidence (deterministic)
//   - typed statuses: SATISFIED | PARTIAL | MISSING | UNKNOWN | CONFLICT
//   - gap classification: missing / incomplete / contradictory / unverified
//     / stale / ambiguous / unlinked
//   - CONTEXTUAL severity (a missing signed authorization is CRITICAL for
//     submission readiness but irrelevant for claim identification)
//   - claim readiness verdicts: READY | NEEDS_REVIEW | NOT_READY with
//     blocking issues, warnings and evidence-grounded recommended actions
//
// Everything here is deterministic and evidence-based. No value is invented:
// if the evidence does not establish a requirement, the requirement is
// MISSING / PARTIAL / UNKNOWN — never silently satisfied.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RequirementStatus =
  | "SATISFIED"
  | "PARTIAL"
  | "MISSING"
  | "UNKNOWN"
  | "CONFLICT";

export type GapType =
  | "missing"
  | "incomplete"
  | "contradictory"
  | "unverified"
  | "stale"
  | "ambiguous"
  | "unlinked";

export type GapSeverity =
  | "CRITICAL"
  | "HIGH"
  | "MEDIUM"
  | "LOW"
  | "INFORMATIONAL";

export type ReadinessStatus = "READY" | "NEEDS_REVIEW" | "NOT_READY";

export type WorkflowKey =
  | "claim_readiness"
  | "supplement_readiness"
  | "submission_readiness"
  | "payment_reconciliation";

/** Duck-typed claim facts (subset of the persisted insuranceClaims row). */
export interface RequirementClaimFacts {
  _id?: string;
  claimNumber?: string | null;
  dateOfLoss?: number | null;
  property?: string | null;
  causeOfLoss?: string | null;
  customer?: string | null;
  carrier?: string | null;
  policy?: string | null;
  adjuster?: string | null;
  status?: string | null;
  estimateAmount?: number | null;
  estimateLineItemCount?: number | null;
  invoicedAmount?: number | null;
  paymentAmount?: number | null;
  approvedAmount?: number | null;
  deductible?: number | null;
  policyLimits?: number | null;
  scopeItems?: Array<{ name?: string; inEstimate?: boolean }> | null;
  evidenceSummary?: string[] | null;
  evidenceDocumentIds?: unknown[] | null;
  confidence?: number;
  provenance?: string | null;
  updatedAt?: number | null;
}

/** Duck-typed tenant document (title/classification are always available; text is optional). */
export interface RequirementEvidenceDocument {
  _id?: string;
  title?: string | null;
  classification?: string | null;
  summary?: string | null;
  /** Optional extracted text (chunks joined) — used for content-based checks. */
  text?: string | null;
}

export interface RequirementContext {
  claim?: RequirementClaimFacts | null;
  /** Documents available to the tenant (not necessarily claim-linked). */
  documents: RequirementEvidenceDocument[];
  /** Claim number the assessment is scoped to (derived if not on the claim). */
  claimNumber?: string | null;
}

export interface RequirementAssessment {
  key: string;
  label: string;
  description: string;
  workflow: WorkflowKey;
  status: RequirementStatus;
  gapType: GapType | null;
  severity: GapSeverity;
  /** Honest note on what Atlas actually has. */
  note: string;
  /** Evidence references (document titles / ids) behind the assessment. */
  evidence: string[];
}

export interface ReadinessGap {
  key: string;
  label: string;
  status: RequirementStatus;
  gapType: GapType | null;
  severity: GapSeverity;
  note: string;
  evidence: string[];
}

export interface ReadinessAssessment {
  workflow: WorkflowKey;
  claimNumber: string | null;
  status: ReadinessStatus;
  /** 0..1 — satisfied requirements / total. */
  score: number;
  satisfied: string[];
  blockingIssues: ReadinessGap[];
  warnings: ReadinessGap[];
  contradictions: ReadinessGap[];
  requirements: RequirementAssessment[];
  /** Evidence that exists in the tenant but is not linked to this claim. */
  unlinkedEvidence: string[];
  recommendedActions: string[];
  summary: string;
  assessedAt: number;
}

// ---------------------------------------------------------------------------
// Document classification helpers (deterministic)
// ---------------------------------------------------------------------------

function docText(d: RequirementEvidenceDocument): string {
  return [d.title, d.classification, d.summary, d.text].filter(Boolean).join(" ");
}

function isClass(d: RequirementEvidenceDocument, re: RegExp): boolean {
  const c = `${d.classification ?? ""} ${d.title ?? ""}`;
  return re.test(c);
}

function hasDoc(docs: RequirementEvidenceDocument[], re: RegExp): boolean {
  return docs.some((d) => isClass(d, re));
}

function docTitles(docs: RequirementEvidenceDocument[], re: RegExp): string[] {
  return docs
    .filter((d) => isClass(d, re))
    .map((d) => d.title ?? d.classification ?? "Document")
    .slice(0, 6);
}

const ESTIMATE_RE = /estimate|xactimate|scope of loss|line item/i;
const INSPECTION_RE = /inspection|adjuster.*report|field report|damage assessment/i;
const PHOTO_RE = /photo|image|picture|jpg|jpeg|png|heic|roof.*shot/i;
const SCOPE_RE = /scope|estimate|xactimate/i;
const INVOICE_RE = /invoice|billing|statement/i;
const PAYMENT_RE = /payment|paid|check|acct.*pay|carrier.*pay/i;
const CORRESPONDENCE_RE = /correspond|email|letter|communication|carrier.*(notice|response|request)|fax/i;
const POLICY_RE = /policy|declaration|endorsement|coverage|binder/i;
// \bcontract\b — a signed contract, not the word "contractor" in a filename.
const AUTHORIZATION_RE = /authorization|authoriz|signed.*(contract|scope|agreement)|contract\b|work order|approval/i;
const SUPPLEMENT_RE = /supplement/i;
const FNOL_RE = /fnol|first notice|notice of loss|loss report/i;

function extractMoney(text: string, re: RegExp): number | null {
  const m = text.match(re);
  if (!m) return null;
  const n = Number.parseFloat((m[1] ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

const ESTIMATE_TOTAL_RE = /(?:total\s+)?estimate\s*(?:total)?[:$]\s*\$?\s*([\d,]+(?:\.\d{2})?)/i;
const LINE_ITEM_RE = /line item|@\s*\$|qty|quantity|price|unit\b/i;

/** Priced line-item evidence: a priced estimate with itemization (pricing support). */
function hasPricingSupport(docs: RequirementEvidenceDocument[]): "full" | "partial" | "none" {
  const estimateDocs = docs.filter((d) => isClass(d, ESTIMATE_RE));
  if (estimateDocs.length === 0) return "none";
  let hasTotal = false;
  let hasLines = false;
  for (const d of estimateDocs) {
    const text = docText(d);
    if (extractMoney(text, ESTIMATE_TOTAL_RE) !== null) hasTotal = true;
    if (LINE_ITEM_RE.test(text) && /\$\s?[\d,]+/.test(text)) hasLines = true;
  }
  if (hasTotal && hasLines) return "full";
  if (hasTotal) return "partial";
  return "none";
}

function staleDays(claim: RequirementClaimFacts | null | undefined): number | null {
  if (!claim || typeof claim.updatedAt !== "number" || claim.status === "closed") return null;
  const days = Math.round((Date.now() - claim.updatedAt) / 86_400_000);
  return days > 30 ? days : null;
}

/** A pending reconstruction candidate — identification is not yet confirmed. */
function isPendingCandidate(ctx: RequirementContext): boolean {
  return (ctx.claim?.status ?? "") === "pending" || (ctx.claim?.confidence ?? 1) < 0.5;
}

// ---------------------------------------------------------------------------
// Requirement registry (extensible per workflow / industry)
// ---------------------------------------------------------------------------

interface RequirementSpec {
  key: string;
  label: string;
  description: string;
  /** Baseline severity when this requirement is NOT satisfied in this workflow. */
  severity: GapSeverity;
  /** Deterministic assessment. Must never fabricate a value. */
  assess: (ctx: RequirementContext) => {
    status: RequirementStatus;
    note: string;
    evidence?: string[];
  };
}

function money(n: number | null | undefined): string | null {
  return typeof n === "number" ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : null;
}

const WORKFLOWS: Record<WorkflowKey, { label: string; requirements: RequirementSpec[] }> = {
  claim_readiness: {
    label: "Claim readiness",
    requirements: [
      {
        key: "claim_identification",
        label: "Claim identification",
        description: "A claim number that identifies the record.",
        severity: "CRITICAL",
        assess: (ctx) => {
          const num = ctx.claimNumber ?? ctx.claim?.claimNumber ?? null;
          if (num && num.trim()) {
            return {
              status: isPendingCandidate(ctx) ? "UNKNOWN" : "SATISFIED",
              note: isPendingCandidate(ctx)
                ? `Claim ${num} is a pending reconstruction candidate — identification is not yet confirmed.`
                : `Claim number on file: ${num}.`,
              evidence: [`Claim ${num}`],
            };
          }
          return { status: "MISSING", note: "No claim number recorded — the record cannot be tied to a specific claim." };
        },
      },
      {
        key: "loss_event",
        label: "Loss event",
        description: "Date of loss and cause of loss.",
        severity: "HIGH",
        assess: (ctx) => {
          const c = ctx.claim;
          const dol = typeof c?.dateOfLoss === "number";
          const col = Boolean(c?.causeOfLoss?.trim());
          if (dol && col) {
            return {
              status: "SATISFIED",
              note: `Date of loss ${new Date(c!.dateOfLoss!).toLocaleDateString()}; cause: ${c!.causeOfLoss}.`,
            };
          }
          if (dol || col) {
            return {
              status: "PARTIAL",
              note: dol ? `Date of loss on file; cause of loss missing.` : `Cause of loss on file; date of loss missing.`,
            };
          }
          return { status: "MISSING", note: "Neither a date of loss nor a cause of loss is recorded." };
        },
      },
      {
        key: "property",
        label: "Property",
        description: "The affected property.",
        severity: "HIGH",
        assess: (ctx) => {
          const p = ctx.claim?.property;
          if (p && p.trim()) return { status: "SATISFIED", note: `Property: ${p}.` };
          return { status: "MISSING", note: "No property recorded — required to scope the loss." };
        },
      },
      {
        key: "insured",
        label: "Insured / customer",
        description: "The customer or insured on the claim.",
        severity: "HIGH",
        assess: (ctx) => {
          const c = ctx.claim?.customer;
          if (c && c.trim()) return { status: "SATISFIED", note: `Customer: ${c}.` };
          return { status: "MISSING", note: "No customer / insured recorded." };
        },
      },
      {
        key: "coverage",
        label: "Carrier / policy",
        description: "Carrier and policy context.",
        severity: "HIGH",
        assess: (ctx) => {
          const c = ctx.claim;
          const carrier = c?.carrier?.trim();
          const policy = c?.policy?.trim();
          if (carrier && policy) return { status: "SATISFIED", note: `Carrier ${carrier} · policy ${policy}.` };
          if (carrier || policy) {
            return { status: "PARTIAL", note: carrier ? `Carrier on file; policy number missing.` : `Policy on file; carrier missing.` };
          }
          return { status: "MISSING", note: "No carrier or policy recorded." };
        },
      },
      {
        key: "evidence_documentation",
        label: "Evidence documentation",
        description: "Documents/evidence linked to the claim.",
        severity: "MEDIUM",
        assess: (ctx) => {
          const c = ctx.claim;
          const summary = (c?.evidenceSummary?.length ?? 0) > 0;
          const linked = (c?.evidenceDocumentIds?.length ?? 0) > 0;
          if (summary || linked) {
            const listed =
              (c?.evidenceSummary ?? []).slice(0, 5).join(", ") ||
              `${c?.evidenceDocumentIds?.length ?? 0} linked record(s)`;
            return {
              status: "SATISFIED",
              note: `Evidence on file: ${listed}.`,
            };
          }
          return { status: "MISSING", note: "No evidence material linked to the claim yet." };
        },
      },
      {
        key: "financial_baseline",
        label: "Financial baseline",
        description: "An estimate or approved amount establishing the financial picture.",
        severity: "MEDIUM",
        assess: (ctx) => {
          const c = ctx.claim;
          if (typeof c?.estimateAmount === "number" || typeof c?.approvedAmount === "number") {
            return {
              status: "SATISFIED",
              note: `${money(c.estimateAmount) ? `Estimate ${money(c.estimateAmount)}` : ""}${typeof c.approvedAmount === "number" ? ` Approved ${money(c.approvedAmount)}` : ""}`.trim(),
            };
          }
          return { status: "MISSING", note: "No estimate or approved amount recorded." };
        },
      },
    ],
  },

  supplement_readiness: {
    label: "Supplement readiness",
    requirements: [
      {
        key: "claim_identification",
        label: "Claim identification",
        description: "Claim number that identifies the record.",
        severity: "CRITICAL",
        assess: (ctx) => {
          const num = ctx.claimNumber ?? ctx.claim?.claimNumber ?? null;
          if (num && num.trim()) {
            return {
              status: isPendingCandidate(ctx) ? "UNKNOWN" : "SATISFIED",
              note: isPendingCandidate(ctx)
                ? `Claim ${num} is a pending reconstruction candidate — identification is not yet confirmed.`
                : `Claim number on file: ${num}.`,
              evidence: [`Claim ${num}`],
            };
          }
          return { status: "MISSING", note: "No claim number recorded — cannot scope the supplement." };
        },
      },
      {
        key: "policy_information",
        label: "Policy information",
        description: "Policy number and/or carrier with coverage context.",
        severity: "HIGH",
        assess: (ctx) => {
          const c = ctx.claim;
          const carrier = c?.carrier?.trim();
          const policy = c?.policy?.trim();
          const policyDocs = ctx.documents.filter((d) => isClass(d, POLICY_RE));
          if (policy && carrier) return { status: "SATISFIED", note: `Policy ${policy} · carrier ${carrier}.`, evidence: policyDocs.map((d) => d.title ?? "Document") };
          if (policy || carrier || policyDocs.length > 0) {
            const parts: string[] = [];
            if (policy) parts.push(`policy ${policy}`);
            if (carrier) parts.push(`carrier ${carrier}`);
            if (policyDocs.length > 0) parts.push(`${policyDocs.length} policy document(s) found in the company data`);
            return { status: "PARTIAL", note: `Partial coverage context — ${parts.join("; ")}.`, evidence: policyDocs.map((d) => d.title ?? "Document") };
          }
          return { status: "MISSING", note: "No policy number, carrier or policy document found." };
        },
      },
      {
        key: "original_estimate",
        label: "Original estimate",
        description: "The original (carrier) estimate the supplement builds on.",
        severity: "CRITICAL",
        assess: (ctx) => {
          const c = ctx.claim;
          const estimateDocs = ctx.documents.filter((d) => isClass(d, ESTIMATE_RE));
          const hasAmount = typeof c?.estimateAmount === "number";
          if (hasAmount || estimateDocs.length > 0) {
            const hasLines = (c?.scopeItems?.length ?? 0) > 0 || (c?.estimateLineItemCount ?? 0) > 0;
            return {
              status: hasLines ? "SATISFIED" : "PARTIAL",
              note: hasAmount ? `Estimate on file: ${money(c!.estimateAmount)}.` : `${estimateDocs.length} estimate document(s) found.`,
              evidence: estimateDocs.map((d) => d.title ?? "Document").slice(0, 6),
            };
          }
          return { status: "MISSING", note: "No original estimate recorded or found in the company data — a supplement cannot be priced without it." };
        },
      },
      {
        key: "inspection_evidence",
        label: "Inspection evidence",
        description: "Inspection/adjuster report documenting the damage.",
        severity: "HIGH",
        assess: (ctx) => {
          const docs = ctx.documents.filter((d) => isClass(d, INSPECTION_RE));
          if (docs.length > 0) return { status: "SATISFIED", note: `${docs.length} inspection report(s) found.`, evidence: docs.map((d) => d.title ?? "Document") };
          return { status: "MISSING", note: "No inspection or damage-assessment document found." };
        },
      },
      {
        key: "photographic_evidence",
        label: "Photographic evidence",
        description: "Photos/images documenting the damage.",
        severity: "MEDIUM",
        assess: (ctx) => {
          const docs = ctx.documents.filter((d) => isClass(d, PHOTO_RE));
          if (docs.length >= 2) return { status: "SATISFIED", note: `${docs.length} photo/image record(s) found.`, evidence: docs.slice(0, 6).map((d) => d.title ?? "Document") };
          if (docs.length === 1) return { status: "PARTIAL", note: "1 photo/image record found — more coverage strengthens the supplement.", evidence: docs.map((d) => d.title ?? "Document") };
          return { status: "MISSING", note: "No photographic evidence found in the company data." };
        },
      },
      {
        key: "scope_of_work",
        label: "Scope of work",
        description: "Itemized scope (estimate/supplement line items).",
        severity: "CRITICAL",
        assess: (ctx) => {
          const c = ctx.claim;
          const scopeItems = c?.scopeItems?.length ?? 0;
          const scopeDocs = ctx.documents.filter((d) => isClass(d, SCOPE_RE));
          if (scopeItems > 0 || scopeDocs.length > 0) {
            const itemized = scopeItems > 0 || scopeDocs.some((d) => LINE_ITEM_RE.test(docText(d)));
            return {
              status: itemized ? "SATISFIED" : "PARTIAL",
              note: scopeItems > 0 ? `${scopeItems} scope line item(s) on the claim.` : `${scopeDocs.length} scope/estimate document(s) found.`,
              evidence: scopeDocs.map((d) => d.title ?? "Document").slice(0, 6),
            };
          }
          return { status: "MISSING", note: "No itemized scope of work found — the supplement must identify what changed." };
        },
      },
      {
        key: "pricing_support",
        label: "Pricing support",
        description: "Itemized, priced line items (quantities + unit prices) that justify the requested amount.",
        severity: "CRITICAL",
        assess: (ctx) => {
          const c = ctx.claim;
          const fromClaim =
            (c?.scopeItems?.length ?? 0) > 0 &&
            c!.scopeItems!.some((s) => typeof s?.inEstimate === "boolean" || (s?.name?.length ?? 0) > 0);
          const level = hasPricingSupport(ctx.documents);
          if (level === "full" || (fromClaim && level !== "none")) {
            return { status: "SATISFIED", note: "Itemized pricing support found (priced line items with quantities/unit prices).", evidence: ctx.documents.filter((d) => isClass(d, ESTIMATE_RE)).map((d) => d.title ?? "Document").slice(0, 6) };
          }
          if (level === "partial") {
            return { status: "PARTIAL", note: "An estimate total exists but no itemized pricing (quantities/unit prices) was found — carriers challenge supplements without pricing support.", evidence: ctx.documents.filter((d) => isClass(d, ESTIMATE_RE)).map((d) => d.title ?? "Document").slice(0, 6) };
          }
          return { status: "MISSING", note: "No itemized pricing support found in the available records — the requested amount cannot be substantiated." };
        },
      },
      {
        key: "carrier_correspondence",
        label: "Carrier correspondence",
        description: "Carrier letters/emails relevant to the claim.",
        severity: "MEDIUM",
        assess: (ctx) => {
          const docs = ctx.documents.filter((d) => isClass(d, CORRESPONDENCE_RE));
          if (docs.length > 0) return { status: "SATISFIED", note: `${docs.length} correspondence record(s) found.`, evidence: docs.slice(0, 6).map((d) => d.title ?? "Document") };
          return { status: "MISSING", note: "No carrier correspondence found." };
        },
      },
      {
        key: "payment_information",
        label: "Payment information",
        description: "Recorded payments / payment documents.",
        severity: "MEDIUM",
        assess: (ctx) => {
          const c = ctx.claim;
          const paid = typeof c?.paymentAmount === "number";
          const docs = ctx.documents.filter((d) => isClass(d, PAYMENT_RE));
          if (paid || docs.length > 0) {
            return { status: "SATISFIED", note: paid ? `Payment on file: ${money(c!.paymentAmount)}.` : `${docs.length} payment document(s) found.`, evidence: docs.slice(0, 6).map((d) => d.title ?? "Document") };
          }
          return { status: "UNKNOWN", note: "No payment information in the available records — the carrier ledger (outside Atlas) may hold it." };
        },
      },
      {
        key: "supplement_rationale",
        label: "Supplement rationale",
        description: "A documented reason the original scope/estimate was incomplete.",
        severity: "CRITICAL",
        assess: (ctx) => {
          const docs = ctx.documents.filter((d) => isClass(d, SUPPLEMENT_RE));
          const c = ctx.claim;
          const hasRationale = (c?.evidenceSummary ?? []).some((s) => /supplement|additional|overlooked|not included|change/i.test(s));
          if (docs.length > 0 || hasRationale) {
            return { status: "SATISFIED", note: "Supplement-related evidence found — a rationale can be drafted from it.", evidence: docs.slice(0, 6).map((d) => d.title ?? "Document") };
          }
          return { status: "MISSING", note: "No supplement rationale found — the supplement must explain what was originally missed and why." };
        },
      },
      {
        key: "supporting_documentation",
        label: "Supporting documentation",
        description: "Any other supporting evidence for the claim.",
        severity: "LOW",
        assess: (ctx) => {
          if (ctx.documents.length > 0) return { status: "SATISFIED", note: `${ctx.documents.length} document(s) available in the company data.` };
          return { status: "MISSING", note: "No documents available in the company data." };
        },
      },
    ],
  },

  submission_readiness: {
    label: "Submission readiness",
    // Composed AFTER WORKFLOWS initializes (see the assignment below) because
    // it inherits the supplement requirements — a spread at literal-evaluation
    // time would be a circular reference.
    requirements: [],
  },

  payment_reconciliation: {
    label: "Payment reconciliation",
    requirements: [
      {
        key: "claim_identification",
        label: "Claim identification",
        description: "Claim number that identifies the record.",
        severity: "CRITICAL",
        assess: (ctx) => {
          const num = ctx.claimNumber ?? ctx.claim?.claimNumber ?? null;
          if (num && num.trim()) return { status: "SATISFIED", note: `Claim number on file: ${num}.`, evidence: [`Claim ${num}`] };
          return { status: "MISSING", note: "No claim number recorded." };
        },
      },
      {
        key: "approved_amount",
        label: "Approved amount",
        description: "Carrier-approved amount to reconcile against.",
        severity: "CRITICAL",
        assess: (ctx) => {
          const c = ctx.claim;
          if (typeof c?.approvedAmount === "number" || typeof c?.estimateAmount === "number") {
            return { status: "SATISFIED", note: `Baseline: ${money(c.approvedAmount) ?? money(c.estimateAmount)}.` };
          }
          return { status: "UNKNOWN", note: "No approved amount in the available records — the carrier's decision letter is required." };
        },
      },
      {
        key: "payment_records",
        label: "Payment records",
        description: "Recorded payments received.",
        severity: "CRITICAL",
        assess: (ctx) => {
          const c = ctx.claim;
          const docs = ctx.documents.filter((d) => isClass(d, PAYMENT_RE));
          if (typeof c?.paymentAmount === "number" || docs.length > 0) {
            return { status: "SATISFIED", note: typeof c?.paymentAmount === "number" ? `Payments on file: ${money(c.paymentAmount)}.` : `${docs.length} payment document(s) found.`, evidence: docs.slice(0, 6).map((d) => d.title ?? "Document") };
          }
          return { status: "UNKNOWN", note: "No payment records in the available records — reconcile against the carrier ledger." };
        },
      },
      {
        key: "outstanding_balance",
        label: "Outstanding balance",
        description: "Baseline minus payments, reconciled to a balance.",
        severity: "HIGH",
        assess: (ctx) => {
          const c = ctx.claim;
          const base = c?.approvedAmount ?? c?.estimateAmount;
          const paid = c?.paymentAmount;
          if (typeof base === "number" && typeof paid === "number") {
            const outstanding = Math.max(0, base - paid);
            return { status: outstanding > 0.01 ? "SATISFIED" : "SATISFIED", note: `Outstanding after recorded payments: ${money(outstanding)}.` };
          }
          return { status: "UNKNOWN", note: "Outstanding balance cannot be computed — approved amount and/or payments are not on file." };
        },
      },
      {
        key: "carrier_statement",
        label: "Carrier statement",
        description: "A carrier statement/ledger documenting payments and adjustments.",
        severity: "MEDIUM",
        assess: (ctx) => {
          const docs = ctx.documents.filter((d) => /statement|ledger|remittance|acct.*summary|account statement/i.test(docText(d)));
          if (docs.length > 0) return { status: "SATISFIED", note: `${docs.length} statement/ledger document(s) found.`, evidence: docs.slice(0, 6).map((d) => d.title ?? "Document") };
          return { status: "UNKNOWN", note: "No carrier statement found in the available records — it may exist outside Atlas." };
        },
      },
    ],
  },
};

// Submission readiness inherits the supplement requirements with escalated
// severities, then adds submission-specific gates (authorization + being
// contradiction-free). Assigned post-init to avoid a circular reference.
WORKFLOWS.submission_readiness.requirements = [
  ...WORKFLOWS.supplement_readiness.requirements.map((r) => {
    const escalated: Record<string, GapSeverity> = {
      scope_of_work: "CRITICAL",
      pricing_support: "CRITICAL",
      supplement_rationale: "CRITICAL",
      policy_information: "CRITICAL",
      carrier_correspondence: "MEDIUM",
    };
    return { ...r, severity: escalated[r.key] ?? r.severity };
  }),
  {
    key: "authorization",
    label: "Customer / contractor authorization",
    description: "Signed authorization, contract or approval to proceed.",
    severity: "CRITICAL",
    assess: (ctx) => {
      const docs = ctx.documents.filter((d) => isClass(d, AUTHORIZATION_RE));
      if (docs.length > 0) return { status: "SATISFIED", note: `${docs.length} authorization/contract document(s) found.`, evidence: docs.map((d) => d.title ?? "Document").slice(0, 6) };
      return { status: "MISSING", note: "No signed authorization or contract found — submitting without it risks the carrier rejecting the submission." };
    },
  },
  {
    key: "no_conflicts",
    label: "Contradiction-free",
    description: "No unresolved conflicting values between sources.",
    severity: "CRITICAL",
    assess: () => {
      // Populated by the caller via the contradiction override: the retrieval
      // layer runs the contradiction engine and injects CONFLICT here.
      return { status: "SATISFIED", note: "No unresolved contradictions detected between the available sources." };
    },
  },
];

export const WORKFLOW_KEYS = Object.keys(WORKFLOWS) as WorkflowKey[];

export function workflowLabel(key: WorkflowKey): string {
  return WORKFLOWS[key]?.label ?? key;
}

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: GapSeverity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFORMATIONAL"];

function bumpSeverity(s: GapSeverity, delta: number): GapSeverity {
  const idx = SEVERITY_ORDER.indexOf(s);
  const next = Math.min(SEVERITY_ORDER.length - 1, Math.max(0, idx + delta));
  return SEVERITY_ORDER[next];
}

function claimRefs(ctx: RequirementContext): string[] {
  const docs = ctx.documents;
  const num = ctx.claimNumber ?? ctx.claim?.claimNumber ?? null;
  if (!num) return [];
  const norm = (s: string) => s.replace(/[-\s]/g, "").toUpperCase();
  const target = norm(num);
  return docs
    .filter((d) => {
      const t = norm(`${d.title ?? ""} ${d.summary ?? ""}`);
      return t.includes(target) && target.length >= 5;
    })
    .map((d) => d.title ?? "Document");
}

/** Contradiction overrides (injected by the caller's contradiction engine). */
export interface ContradictionOverride {
  field: string;
  values: string[];
}

function gapTypeFor(status: RequirementStatus, ctx: RequirementContext, key: string): GapType | null {
  if (status === "SATISFIED") return null;
  if (status === "CONFLICT") return "contradictory";
  const stale = staleDays(ctx.claim);
  if (status === "PARTIAL") return stale ? "stale" : "incomplete";
  if (status === "UNKNOWN") return "unverified";
  // MISSING
  if (stale) return "stale";
  if (key === "claim_identification" && (ctx.claim?.status ?? "") === "pending") return "unverified";
  return "missing";
}

/**
 * Compare expected evidence (workflow requirements) against available
 * evidence. Every requirement gets an explicit status; collections of
 * evidence always exist (never undefined).
 */
export function assessEvidenceRequirements(
  ctx: RequirementContext,
  workflow: WorkflowKey,
  overrides: ContradictionOverride[] = [],
): RequirementAssessment[] {
  const spec = WORKFLOWS[workflow];
  if (!spec) return [];
  const contradictions = Array.isArray(overrides) ? overrides : [];
  const claimRef = claimRefs(ctx);

  return spec.requirements.map((req) => {
    let result = req.assess(ctx);
    // Contradiction override: if the caller's engine found conflicts, the
    // submission gate (no_conflicts) goes CONFLICT and any requirement whose
    // subject matches the conflicted field is flagged too. Both sources are
    // preserved — nothing is silently resolved.
    if (contradictions.length > 0) {
      if (req.key === "no_conflicts") {
        result = {
          status: "CONFLICT",
          note: `Conflicting values found: ${contradictions.map((c) => c.values.join(" vs ")).join("; ")} — both sources are preserved for reconciliation.`,
          evidence: [...(result.evidence ?? [])],
        };
      } else {
        const conflict = contradictions.find(
          (c) =>
            c.field.toLowerCase().includes(req.key.replace(/_/g, " ")) ||
            req.key.includes(c.field.toLowerCase().replace(/\s+/g, "_")),
        );
        if (conflict) {
          result = {
            status: "CONFLICT",
            note: `Conflicting values found: ${conflict.values.join(" vs ")} — both sources are preserved for reconciliation.`,
            evidence: [...(result.evidence ?? [])],
          };
        }
      }
    }

    const gapType = gapTypeFor(result.status, ctx, req.key);
    // Contextual severity: conflicts are worse than missing (escalate toward
    // CRITICAL); partials are less severe than missing (downgrade).
    let severity = req.severity;
    if (result.status === "CONFLICT") severity = bumpSeverity(severity, -1);
    else if (result.status === "PARTIAL") severity = bumpSeverity(severity, 1);

    return {
      key: req.key,
      label: req.label,
      description: req.description,
      workflow,
      status: result.status,
      gapType,
      severity,
      note: result.note,
      evidence: [...new Set([...(result.evidence ?? []), ...claimRef])].slice(0, 8),
    };
  });
}

/** Deterministic readiness verdict from the requirement assessments. */
export function assessReadiness(
  ctx: RequirementContext,
  workflow: WorkflowKey,
  overrides: ContradictionOverride[] = [],
): ReadinessAssessment {
  const requirements = assessEvidenceRequirements(ctx, workflow, overrides);
  const blockingIssues: ReadinessGap[] = [];
  const warnings: ReadinessGap[] = [];
  const contradictions: ReadinessGap[] = [];
  const satisfied: string[] = [];

  for (const r of requirements) {
    const gap: ReadinessGap = {
      key: r.key,
      label: r.label,
      status: r.status,
      gapType: r.gapType,
      severity: r.severity,
      note: r.note,
      evidence: r.evidence,
    };
    if (r.status === "SATISFIED") {
      satisfied.push(r.label);
      continue;
    }
    if (r.status === "CONFLICT") contradictions.push(gap);
    const blocking =
      r.status === "CONFLICT" ||
      ((r.status === "MISSING" || r.status === "UNKNOWN") &&
        (r.severity === "CRITICAL" || r.severity === "HIGH"));
    if (blocking) blockingIssues.push(gap);
    else warnings.push(gap);
  }

  // Unlinked evidence: documents that reference this claim number but are not
  // linked to it as evidence (§15 "unlinked" gap type).
  const linkedIds = new Set(
    (ctx.claim?.evidenceDocumentIds ?? []).map((x) => String(x)),
  );
  const unlinkedEvidence = claimRefs(ctx).filter((title) => {
    const doc = ctx.documents.find((d) => (d.title ?? "Document") === title);
    return !doc || !doc._id || !linkedIds.has(doc._id);
  });

  const total = requirements.length || 1;
  const score = Math.round((satisfied.length / total) * 100) / 100;
  const status: ReadinessStatus =
    blockingIssues.length > 0 ? "NOT_READY" : warnings.length > 0 ? "NEEDS_REVIEW" : "READY";

  const recommendedActions: string[] = [];
  for (const b of blockingIssues) {
    if (b.status === "CONFLICT") {
      recommendedActions.push(`Reconcile ${b.label.toLowerCase()}: ${b.note.replace(/^Conflicting values found:\s*/, "")}.`);
    } else {
      recommendedActions.push(`Obtain ${b.label.toLowerCase()} — ${b.note}`);
    }
  }
  for (const w of warnings) {
    recommendedActions.push(`Review ${w.label.toLowerCase()} — ${w.note}`);
  }
  if (unlinkedEvidence.length > 0) {
    recommendedActions.push(`Link ${unlinkedEvidence.length} evidence item(s) that reference this claim number to the claim record.`);
  }

  const summary =
    status === "READY"
      ? `${satisfied.length} of ${requirements.length} required evidence categories are satisfied — no blocking gaps found for ${workflowLabel(workflow).toLowerCase()}.`
      : `${satisfied.length} of ${requirements.length} required evidence categories are satisfied. ${blockingIssues.length} blocking gap(s) and ${warnings.length} warning(s) remain${contradictions.length ? `, including ${contradictions.length} contradiction(s)` : ""}.`;

  return {
    workflow,
    claimNumber: ctx.claimNumber ?? ctx.claim?.claimNumber ?? null,
    status,
    score,
    satisfied,
    blockingIssues,
    warnings,
    contradictions,
    requirements,
    unlinkedEvidence,
    recommendedActions: [...new Set(recommendedActions)].slice(0, 8),
    summary,
    assessedAt: Date.now(),
  };
}

/** Plain-text readiness summary (for answers that read aloud). */
export function summarizeReadiness(a: ReadinessAssessment): string {
  const lines = [
    `Readiness for ${workflowLabel(a.workflow).toLowerCase()}: ${a.status}. ${a.summary}`,
  ];
  if (a.blockingIssues.length > 0) {
    lines.push(
      `Blocking: ${a.blockingIssues.map((g) => `${g.label} (${g.gapType ?? "missing"})`).join("; ")}.`,
    );
  }
  if (a.warnings.length > 0) {
    lines.push(`Warnings: ${a.warnings.map((g) => g.label).join("; ")}.`);
  }
  if (a.contradictions.length > 0) {
    lines.push(
      `Contradictions: ${a.contradictions.map((g) => g.note.replace(/^Conflicting values found:\s*/, "values ")).join("; ")}.`,
    );
  }
  if (a.recommendedActions.length > 0) {
    lines.push(`Recommended actions: ${a.recommendedActions.join(" ")}`);
  }
  return lines.join(" ");
}
