// ---------------------------------------------------------------------------
// Phase 11 — Insurance Restoration · Claims, supplements & revenue recovery
//
// First commercial Atlas vertical. Everything here is deterministic and
// evidence-labeled: Atlas never invents claim data, never claims a recovery is
// guaranteed, and never auto-submits a supplement. Discovery → Draft → Human
// review → Approval → Submission. Every write is tenant-scoped and audited.
//
// The pure analyzers (completeness, findings, reconciliation) are unit tested
// in claims.test.ts and reused by the UI and the conversational brain.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { mutation, query, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { isEditor, requireTenant, requireUser } from "../helpers";
import { analyzeRecoveryOpportunities, type ClaimFacts } from "../everest/insurance";
import { extractClaimNumber } from "./reconstruct";

// ---------------------------------------------------------------------------
// Domain vocabulary (exists BEFORE any customer uploads a claim)
// ---------------------------------------------------------------------------

export const CLAIM_STATUSES = [
  "lead",
  "opened",
  "documenting",
  "estimating",
  "carrier_review",
  "supplement_identified",
  "supplement_prepared",
  "ready_for_submission",
  "submitted",
  "response_received",
  "negotiating",
  "approved",
  "work_completed",
  "billing",
  "reconciling",
  "closed",
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const SUPPLEMENT_STATUSES = [
  "draft",
  "ready_for_submission",
  "submitted",
  "carrier_review",
  "approved",
  "partially_approved",
  "denied",
  "additional_docs_requested",
  "payment_received",
  "closed",
] as const;
export type SupplementStatus = (typeof SUPPLEMENT_STATUSES)[number];

/** The 20-stage revenue recovery pipeline (workflow the company runs). */
export const RECOVERY_PIPELINE = [
  "Claim identified",
  "Claim package assembled",
  "Evidence collected",
  "Estimate ingested",
  "Scope normalized",
  "Coverage / context reviewed",
  "Gap analysis performed",
  "Potential supplement items identified",
  "Evidence matched",
  "Supplement drafted",
  "Human review",
  "Customer / contractor approval",
  "Submission prepared",
  "Submission sent",
  "Carrier response tracked",
  "Approved / denied items reconciled",
  "Payment reconciled",
  "Outstanding recovery identified",
  "Follow-up scheduled",
  "Claim closed",
] as const;

export const STATUS_LABELS: Record<string, string> = {
  lead: "Lead / Loss",
  opened: "Opened",
  documenting: "Documentation",
  estimating: "Estimate",
  carrier_review: "Carrier review",
  supplement_identified: "Supplement identified",
  supplement_prepared: "Supplement prepared",
  ready_for_submission: "Ready for submission",
  submitted: "Submitted",
  response_received: "Carrier response",
  negotiating: "Negotiation / revision",
  approved: "Approved",
  work_completed: "Work completed",
  billing: "Final billing",
  reconciling: "Revenue reconciliation",
  closed: "Closed",
};

/** Honest stage-progress helper for the pipeline view. */
export function pipelineIndexFor(status?: string | null): number {
  if (!status) return 0;
  const idx = CLAIM_STATUSES.indexOf(status as ClaimStatus);
  return idx < 0 ? 0 : idx;
}

// ---------------------------------------------------------------------------
// Pure analyzers (unit tested)
// ---------------------------------------------------------------------------

export type CompletenessStatus =
  | "verified"
  | "extracted"
  | "inferred"
  | "missing"
  | "needs_review"
  | "conflicted"
  | "stale";

export interface CompletenessCategory {
  key: string;
  label: string;
  status: CompletenessStatus;
  /** What Atlas actually has / the source it came from. Never fabricated. */
  note: string;
}

export interface ClaimCompleteness {
  categories: CompletenessCategory[];
  /** Verified + extracted (usable) count. */
  complete: number;
  total: number;
  /** 0..1 — computed strictly from the rules below. */
  score: number;
  /** Deterministic summary sentence. */
  summary: string;
}

export interface ClaimSnapshot {
  /** Internal id (present when analyzing a persisted claim). */
  _id?: string;
  claimNumber?: string | null;
  dateOfLoss?: number | null;
  property?: string | null;
  causeOfLoss?: string | null;
  lossDescription?: string | null;
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
  collectedAmount?: number | null;
  openBalance?: number | null;
  deductible?: number | null;
  policyLimits?: number | null;
  scopeItems?: Array<{ name?: string; inEstimate?: boolean }> | null;
  expectedScope?: string[] | null;
  actualScope?: string[] | null;
  evidenceSummary?: string[] | null;
  evidenceDocumentIds?: unknown[] | null;
  timeline?: Array<Record<string, unknown>> | null;
  confidence?: number;
  provenance?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
}

const COMPLETENESS_RULES: Array<{
  key: string;
  label: string;
  has: (c: ClaimSnapshot) => boolean;
  note: (c: ClaimSnapshot) => string;
  /** Phase 14 — state override: conflicted/stale detection, evidence-based. */
  statusOverride?: (c: ClaimSnapshot) => CompletenessStatus | undefined;
}> = [
  {
    key: "claimNumber",
    label: "Claim number",
    has: (c) => Boolean(c.claimNumber?.trim()),
    note: (c) => (c.claimNumber ? `On file: ${c.claimNumber}` : "No claim number recorded."),
  },
  {
    key: "dateOfLoss",
    label: "Date of loss",
    has: (c) => typeof c.dateOfLoss === "number",
    note: (c) => (typeof c.dateOfLoss === "number" ? new Date(c.dateOfLoss).toLocaleDateString() : "No date of loss recorded."),
  },
  {
    key: "property",
    label: "Property",
    has: (c) => Boolean(c.property?.trim()),
    note: (c) => (c.property ? c.property : "No property recorded."),
  },
  {
    key: "causeOfLoss",
    label: "Cause of loss",
    has: (c) => Boolean(c.causeOfLoss?.trim()),
    note: (c) => (c.causeOfLoss ? c.causeOfLoss : "No cause of loss recorded."),
  },
  {
    key: "customer",
    label: "Customer / insured",
    has: (c) => Boolean(c.customer?.trim()),
    note: (c) => (c.customer ? c.customer : "No customer recorded."),
  },
  {
    key: "coverage",
    label: "Carrier / policy",
    has: (c) => Boolean(c.carrier?.trim() || c.policy?.trim()),
    note: (c) =>
      [c.carrier && `Carrier: ${c.carrier}`, c.policy && `Policy: ${c.policy}`]
        .filter(Boolean)
        .join(" · ") || "No carrier or policy on file.",
  },
  {
    key: "estimate",
    label: "Estimate",
    has: (c) =>
      typeof c.estimateAmount === "number" || (c.scopeItems?.length ?? 0) > 0,
    note: (c) =>
      typeof c.estimateAmount === "number"
        ? `Estimate: $${c.estimateAmount.toLocaleString()}${c.estimateLineItemCount ? ` · ${c.estimateLineItemCount} line items` : ""}`
        : "No estimate ingested yet.",
  },
  {
    key: "evidence",
    label: "Evidence documentation",
    has: (c) => (c.evidenceSummary?.length ?? 0) > 0 || (c.evidenceDocumentIds?.length ?? 0) > 0,
    note: (c) =>
      (c.evidenceSummary?.length ?? 0) > 0
        ? `Evidence categories on file: ${c.evidenceSummary!.join(", ")}`
        : "No evidence material linked yet.",
  },
  {
    key: "invoices",
    label: "Invoices / payments",
    has: (c) => typeof c.invoicedAmount === "number" || typeof c.paymentAmount === "number",
    note: (c) =>
      [
        typeof c.invoicedAmount === "number" && `Invoiced $${c.invoicedAmount.toLocaleString()}`,
        typeof c.paymentAmount === "number" && `Paid $${c.paymentAmount.toLocaleString()}`,
      ]
        .filter(Boolean)
        .join(" · ") || "No invoice or payment recorded.",
  },
  {
    // Phase 14 — financial reconciliation state. Contradictory records are
    // labeled CONFLICTED, never silently resolved.
    key: "financialState",
    label: "Financial reconciliation",
    has: (c) =>
      typeof c.invoicedAmount === "number" ||
      typeof c.paymentAmount === "number" ||
      typeof c.approvedAmount === "number" ||
      typeof c.estimateAmount === "number",
    note: (c) => {
      const parts: string[] = [];
      if (typeof c.estimateAmount === "number") parts.push(`Estimate $${c.estimateAmount.toLocaleString()}`);
      if (typeof c.approvedAmount === "number") parts.push(`Approved $${c.approvedAmount.toLocaleString()}`);
      if (typeof c.invoicedAmount === "number") parts.push(`Invoiced $${c.invoicedAmount.toLocaleString()}`);
      if (typeof c.paymentAmount === "number") parts.push(`Paid $${c.paymentAmount.toLocaleString()}`);
      return parts.length > 0 ? parts.join(" · ") : "No financial amounts recorded.";
    },
    statusOverride: (c) => {
      const inv = c.invoicedAmount;
      const paid = c.paymentAmount;
      const approved = c.approvedAmount;
      const base = c.estimateAmount ?? approved;
      if (typeof inv === "number" && typeof approved === "number" && inv > approved + 0.01) {
        return "conflicted";
      }
      if (typeof inv === "number" && typeof base === "number" && inv > base + 0.01) {
        return "conflicted";
      }
      if (typeof inv === "number" && typeof paid === "number" && paid > inv + 0.01) {
        return "conflicted";
      }
      return undefined;
    },
  },
  {
    // Phase 14 — freshness. An open claim with no activity for 30+ days is
    // STALE (may be stalled). Never treated as current.
    key: "freshness",
    label: "Freshness",
    has: () => true,
    note: (c) => {
      if (c.status === "closed") return "Claim is closed.";
      if (typeof c.updatedAt === "number") {
        const days = Math.round((Date.now() - c.updatedAt) / 86_400_000);
        return days <= 0
          ? "Updated today."
          : `Last updated ${days} day${days === 1 ? "" : "s"} ago.`;
      }
      return "No update timestamp on file.";
    },
    statusOverride: (c) => {
      if (c.status === "closed") return "verified";
      // No timestamp means freshness cannot be established — never call it verified.
      if (typeof c.updatedAt !== "number") return "missing";
      if (Date.now() - c.updatedAt > 30 * 86_400_000) {
        return "stale";
      }
      return "verified";
    },
  },
];

/** Deterministic claim-package completeness. Never invents a percentage. */
export function analyzeClaimCompleteness(claim: ClaimSnapshot): ClaimCompleteness {
  const categories: CompletenessCategory[] = COMPLETENESS_RULES.map((rule) => {
    const present = rule.has(claim);
    const provenance = (claim.provenance ?? "").toLowerCase();
    let status: CompletenessStatus;
    if (rule.statusOverride) {
      const overridden = rule.statusOverride(claim);
      if (overridden) {
        status = overridden;
        return { key: rule.key, label: rule.label, status, note: rule.note(claim) };
      }
    }
    if (!present) status = "missing";
    else if (provenance.includes("confirmed") || provenance.includes("user-entered") || provenance.includes("created via"))
      status = "verified";
    else if (typeof claim.confidence === "number" && claim.confidence < 0.5) status = "needs_review";
    else status = "extracted";
    return { key: rule.key, label: rule.label, status, note: rule.note(claim) };
  });
  const usable = categories.filter((c) => c.status === "verified" || c.status === "extracted").length;
  const total = categories.length;
  const score = total === 0 ? 0 : usable / total;
  const missing = categories.filter(
    (c) =>
      c.status === "missing" ||
      c.status === "needs_review" ||
      c.status === "conflicted" ||
      c.status === "stale",
  ).length;
  const issues: string[] = [];
  const conflicts = categories.filter((c) => c.status === "conflicted");
  const stale = categories.filter((c) => c.status === "stale");
  if (conflicts.length > 0) {
    issues.push(
      `${conflicts.length} conflicted record${conflicts.length === 1 ? "" : "s"} (contradictory values need reconciliation)`,
    );
  }
  if (stale.length > 0) {
    issues.push(`${stale.length} stale item${stale.length === 1 ? "" : "s"} (no activity for 30+ days)`);
  }
  return {
    categories,
    complete: usable,
    total,
    score,
    summary:
      missing === 0
        ? `${usable} of ${total} required information categories are complete.`
        : `${usable} of ${total} required information categories are complete. ${missing} require${missing === 1 ? "s" : ""} attention${issues.length ? ` — ${issues.join("; ")}` : ""}.`,
  };
}

export interface ClaimFindingDraft {
  findingKey: string;
  category: string;
  title: string;
  description: string;
  affectedEstimateItem?: string;
  evidence: string[];
  source?: string;
  confidence: number;
  estimatedAmount?: number;
  limitation: string;
  recommendedNextStep: string;
}

const OPPORTUNITY_CATEGORY: Record<string, string> = {
  missing_scope: "missing_scope",
  documentation_gap: "documentation_gap",
  scope_inconsistency: "scope_inconsistency",
  unresolved_carrier_response: "unresolved_carrier_response",
  potential_underpayment: "potential_underpayment",
  workflow_delay: "workflow_delay",
  supplement_opportunity: "supplement_opportunity",
  estimate_inconsistency: "estimate_inconsistency",
  overlooked_line_item: "overlooked_line_item",
  billing_reconciliation: "billing_reconciliation",
};

/**
 * Deterministic supplement/revenue-recovery analyzer. Compares available
 * evidence against the estimate, documented scope, line items and carrier
 * response, then surfaces POTENTIAL opportunities — every finding carries
 * evidence, a confidence and an honest limitation.
 */
export function buildClaimFindings(claim: ClaimSnapshot): ClaimFindingDraft[] {
  const facts: ClaimFacts = {
    expectedScope: claim.expectedScope as string[] | undefined,
    actualScope: claim.actualScope as string[] | undefined,
    evidenceSummary: claim.evidenceSummary as string[] | undefined,
    estimateAmount: claim.estimateAmount ?? undefined,
    estimateLineItemCount: claim.estimateLineItemCount ?? undefined,
    carrierResponse: undefined,
    paymentAmount: claim.paymentAmount ?? undefined,
    invoicedAmount: claim.invoicedAmount ?? undefined,
  };

  const opportunities = analyzeRecoveryOpportunities(facts);
  const drafts: ClaimFindingDraft[] = opportunities.map((o) => {
    const category = OPPORTUNITY_CATEGORY[o.type] ?? o.type;
    let estimatedAmount: number | undefined;
    if (o.type === "potential_underpayment" && typeof claim.estimateAmount === "number" && typeof claim.paymentAmount === "number") {
      estimatedAmount = Math.max(0, claim.estimateAmount - claim.paymentAmount);
    }
    if (o.type === "billing_reconciliation" && typeof claim.invoicedAmount === "number" && typeof claim.paymentAmount === "number") {
      estimatedAmount = Math.max(0, claim.invoicedAmount - claim.paymentAmount);
    }
    return {
      findingKey: `claim:${claim._id ?? "?"}:${o.type}`,
      category,
      title: o.title,
      description: o.explanation,
      evidence: o.evidence,
      source: o.type,
      confidence: o.confidence,
      estimatedAmount,
      limitation: o.limitation,
      recommendedNextStep: o.recommendedNextStep,
    };
  });

  // Line-item level check: scope items documented but not priced into the estimate.
  const scopeItems = (claim.scopeItems ?? []).filter(Boolean) as Array<{ name?: string; inEstimate?: boolean }>;
  const unpriced = scopeItems.filter((i) => i.inEstimate === false);
  if (unpriced.length > 0) {
    const names = unpriced.map((i) => i.name ?? "an item").join(", ");
    drafts.push({
      findingKey: `claim:${claim._id ?? "?"}:overlooked_line_item`,
      category: "overlooked_line_item",
      title: "Potential overlooked line item",
      description: `Scope items are documented but not priced into the current estimate: ${names}.`,
      evidence: [`Documented scope not in estimate: ${names}`],
      source: "scope_items",
      confidence: 0.55,
      limitation: "The item may be legitimately covered elsewhere in the estimate — this flags verification, not error.",
      recommendedNextStep: "Compare each unpriced scope item against the estimate line by line before drafting a supplement.",
    });
  }

  return drafts.sort((a, b) => b.confidence - a.confidence);
}

export interface ClaimReconciliation {
  estimate?: number;
  invoiced?: number;
  paid: number;
  requested: number;
  approved: number;
  denied: number;
  outstanding: number;
  notes: string[];
  hasDiscrepancy: boolean;
}

/** Estimate vs supplements vs approved vs payment vs expected recovery. */
export function reconcileClaim(
  claim: ClaimSnapshot,
  supplements: Array<{
    amount?: number | null;
    approvedAmount?: number | null;
    deniedAmount?: number | null;
    status?: string | null;
  }>,
): ClaimReconciliation {
  const notes: string[] = [];
  const paid = claim.paymentAmount ?? 0;
  const requested = supplements.reduce((s, x) => s + (x.amount ?? 0), 0);
  const approved = supplements.reduce((s, x) => s + (x.approvedAmount ?? 0), 0);
  const denied = supplements.reduce((s, x) => s + (x.deniedAmount ?? 0), 0);

  const baseline = approved > 0 ? approved : (claim.estimateAmount ?? 0);
  const outstanding = Math.max(0, baseline - paid);

  if (typeof claim.estimateAmount === "number" && requested > 0) {
    notes.push(`The supplement requested $${requested.toLocaleString()}.`);
  }
  if (approved > 0) {
    notes.push(`The carrier approved $${approved.toLocaleString()}${denied > 0 ? ` and denied $${denied.toLocaleString()}` : ""}.`);
  }
  if (paid > 0 && baseline > 0) {
    notes.push(`Payment received is $${paid.toLocaleString()}.`);
  }
  if (outstanding > 0) {
    notes.push(`$${outstanding.toLocaleString()} remains potentially outstanding.`);
  }
  // Estimate vs invoice mismatch (Phase 12 — reconciliation intelligence).
  if (
    typeof claim.estimateAmount === "number" &&
    typeof claim.invoicedAmount === "number" &&
    Math.abs(claim.estimateAmount - claim.invoicedAmount) > 0.01
  ) {
    notes.push(
      `The estimate ($${claim.estimateAmount.toLocaleString()}) and invoiced amount ($${claim.invoicedAmount.toLocaleString()}) differ — review the billing line items.`,
    );
  }
  // Billed vs paid gap (Phase 12).
  if (
    typeof claim.invoicedAmount === "number" &&
    paid > 0 &&
    claim.invoicedAmount - paid > 0.01
  ) {
    notes.push(
      `$${(claim.invoicedAmount - paid).toLocaleString()} of the invoiced total remains unpaid.`,
    );
  }
  const hasDiscrepancy =
    outstanding > 0 ||
    (approved > 0 && denied > 0 && approved + denied !== requested) ||
    notes.some((n) => /differ|remains unpaid/i.test(n));
  if (hasDiscrepancy && notes.length === 0) {
    notes.push("Recorded amounts do not fully reconcile to a zero balance.");
  }
  return {
    estimate: claim.estimateAmount ?? undefined,
    invoiced: claim.invoicedAmount ?? undefined,
    paid,
    requested,
    approved,
    denied,
    outstanding,
    notes,
    hasDiscrepancy,
  };
}

// ---------------------------------------------------------------------------
// Phase 14 — Revenue Recovery Command Center analytics (pure, unit tested)
// ---------------------------------------------------------------------------
// Every number here is derived from actual claim records. Trends are bucketed
// by real timestamps; carrier and status views aggregate the same figures the
// claims table shows — nothing is simulated or projected.

export interface RecoveryTrendPoint {
  /** "YYYY-MM" bucket key. */
  month: string;
  /** Human label, e.g. "Aug 25". */
  label: string;
  claimsCreated: number;
  findingsOpened: number;
  supplementsSubmitted: number;
}

export function monthKey(ts?: number | null): string {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return "";
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  return `${new Date(Date.UTC(2000, m - 1, 1)).toLocaleString("en-US", { month: "short" })} ${String(y).slice(2)}`;
}

/**
 * Last `months` calendar months (zero-filled) of recovery activity:
 *  claimsCreated      — claims whose createdAt falls in the bucket
 *  findingsOpened     — claimFindings whose createdAt falls in the bucket
 *  supplementsSubmitted — supplements with a submissionDate in the bucket
 * Payments are intentionally absent: there is no payment history table, so a
 * per-month payment series could not be honest. Submitted supplements use the
 * submission date, not last-update, so the series stays evidence-grounded.
 */
export function buildRecoveryTrend(
  claims: Array<{ createdAt?: number | null }>,
  findings: Array<{ createdAt?: number | null }>,
  supplements: Array<{ submissionDate?: number | null }>,
  months = 12,
): RecoveryTrendPoint[] {
  const now = new Date();
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return keys.map((key) => ({
    month: key,
    label: monthLabel(key),
    claimsCreated: claims.filter((c) => monthKey(c.createdAt) === key).length,
    findingsOpened: findings.filter((f) => monthKey(f.createdAt) === key).length,
    supplementsSubmitted: supplements.filter(
      (s) => typeof s.submissionDate === "number" && monthKey(s.submissionDate) === key,
    ).length,
  }));
}

export interface CarrierRecoveryBreakdown {
  carrier: string;
  claimCount: number;
  outstanding: number;
  potential: number;
}

/**
 * Outstanding + potential recovery grouped by carrier. Outstanding uses the
 * same reconcileClaim definition as the claims table (approved/estimate minus
 * payments); potential is the sum of open findings' estimated amounts. Claims
 * without a carrier are grouped under "Unknown carrier" rather than dropped.
 */
export function buildCarrierBreakdown(
  claims: Array<{
    _id?: unknown;
    carrier?: string | null;
    paymentAmount?: number | null;
    estimateAmount?: number | null;
    invoicedAmount?: number | null;
    approvedAmount?: number | null;
  }>,
  supplements: Array<{
    claimId: unknown;
    amount?: number | null;
    approvedAmount?: number | null;
    deniedAmount?: number | null;
    status?: string | null;
  }>,
  findings: Array<{
    claimId: unknown;
    status?: string | null;
    estimatedAmount?: number | null;
  }>,
): CarrierRecoveryBreakdown[] {
  const byClaim = new Map<
    string,
    {
      claim: (typeof claims)[number];
      carrier: string;
      supplements: typeof supplements;
      findings: typeof findings;
    }
  >();
  for (const c of claims) {
    const id = String(c._id);
    byClaim.set(id, {
      claim: c,
      carrier: c.carrier?.trim() ? c.carrier : "Unknown carrier",
      supplements: [],
      findings: [],
    });
  }
  for (const s of supplements) {
    const bucket = byClaim.get(String(s.claimId));
    if (bucket) bucket.supplements.push(s);
  }
  for (const f of findings) {
    const bucket = byClaim.get(String(f.claimId));
    if (bucket) bucket.findings.push(f);
  }

  const perCarrier = new Map<string, CarrierRecoveryBreakdown>();
  for (const bucket of byClaim.values()) {
    // The SAME reconcile definition as the claims table: pass the actual
    // claim record (not the bucket wrapper) so estimate/payment/approval
    // fields are honored.
    const rec = reconcileClaim(bucket.claim as never, bucket.supplements);
    const potential = bucket.findings
      .filter((f) => f.status === "open")
      .reduce((sum, f) => sum + (f.estimatedAmount ?? 0), 0);
    const current = perCarrier.get(bucket.carrier) ?? {
      carrier: bucket.carrier,
      claimCount: 0,
      outstanding: 0,
      potential: 0,
    };
    current.claimCount += 1;
    current.outstanding += rec.outstanding;
    current.potential += potential;
    perCarrier.set(bucket.carrier, current);
  }
  return [...perCarrier.values()]
    .sort((a, b) => b.outstanding + b.potential - (a.outstanding + a.potential))
    .slice(0, 8);
}

export interface RecoveryStatusDistribution {
  status: string;
  label: string;
  count: number;
}

/** Claim lifecycle distribution — counts per status, highest first. */
export function buildStatusDistribution(
  claims: Array<{ status?: string | null }>,
): RecoveryStatusDistribution[] {
  const counts = new Map<string, number>();
  for (const c of claims) {
    const status = c.status ?? "opened";
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([status, count]) => ({
      status,
      label: STATUS_LABELS[status] ?? status.replace(/_/g, " "),
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Phase 12 — Claim package, timeline & supplement document builders (pure)
// ---------------------------------------------------------------------------

export type PackageFieldState =
  | "verified"
  | "derived"
  | "inferred"
  | "missing"
  | "conflicting";

export interface PackageField {
  key: string;
  label: string;
  value?: string | number | null;
  state: PackageFieldState;
  note: string;
}

export interface ClaimPackageModel {
  fields: PackageField[];
  states: Record<PackageFieldState, number>;
}

/**
 * Canonical claim package. Every material field is labeled:
 *  verified  — directly supported by source evidence / user entry
 *  derived   — calculated from verified information
 *  inferred  — reasonable interpretation that requires review
 *  missing   — not available
 *  conflicting — recorded sources disagree
 * Atlas never presents an inferred or missing value as fact.
 */
export function buildClaimPackage(
  claim: ClaimSnapshot,
  supplements: Array<{ amount?: number | null; approvedAmount?: number | null }> = [],
): ClaimPackageModel {
  const fields: PackageField[] = [];
  const num = (n?: number | null) =>
    typeof n === "number" ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : undefined;
  const date = (n?: number | null) =>
    typeof n === "number" ? new Date(n).toLocaleDateString() : undefined;
  const push = (key: string, label: string, value: string | number | undefined, state: PackageFieldState, note: string) =>
    fields.push({ key, label, value, state, note });

  push("claimNumber", "Claim number", claim.claimNumber ?? undefined, claim.claimNumber ? "verified" : "missing", claim.claimNumber ? "From claim records." : "No claim number recorded.");
  push("insured", "Insured / customer", claim.customer ?? undefined, claim.customer ? "verified" : "missing", claim.customer ? "From claim records." : "No insured recorded.");
  push("property", "Property", claim.property ?? undefined, claim.property ? "verified" : "missing", claim.property ? "From claim records." : "No property recorded.");
  push("carrier", "Carrier", claim.carrier ?? undefined, claim.carrier ? "verified" : "missing", claim.carrier ? "From claim records." : "No carrier recorded.");
  push("policy", "Policy", claim.policy ?? undefined, claim.policy ? "verified" : "missing", claim.policy ? "From claim records." : "No policy recorded.");
  push("adjuster", "Adjuster", claim.adjuster ?? undefined, claim.adjuster ? "verified" : "missing", claim.adjuster ? "From claim records." : "No adjuster recorded.");
  push("dateOfLoss", "Date of loss", date(claim.dateOfLoss), typeof claim.dateOfLoss === "number" ? "verified" : "missing", typeof claim.dateOfLoss === "number" ? "From claim records." : "No date of loss recorded.");
  push("causeOfLoss", "Cause of loss", claim.causeOfLoss ?? undefined, claim.causeOfLoss ? "verified" : "missing", claim.causeOfLoss ? "From claim records." : "No cause of loss recorded.");
  push("estimate", "Estimate", num(claim.estimateAmount), typeof claim.estimateAmount === "number" ? "verified" : "missing", typeof claim.estimateAmount === "number" ? "From the priced estimate." : "No estimate ingested yet.");
  push("approved", "Approved by carrier", num(claim.approvedAmount), typeof claim.approvedAmount === "number" ? "verified" : "missing", typeof claim.approvedAmount === "number" ? "Carrier-approved total on record." : "No carrier approval amount recorded.");
  push("invoiced", "Invoiced", num(claim.invoicedAmount), typeof claim.invoicedAmount === "number" ? "verified" : "missing", typeof claim.invoicedAmount === "number" ? "From invoice records." : "No invoice recorded.");
  push("paid", "Payment received", num(claim.paymentAmount), typeof claim.paymentAmount === "number" ? "verified" : "missing", typeof claim.paymentAmount === "number" ? "From recorded payments." : "No payment recorded.");
  push("collected", "Collected", num(claim.collectedAmount), typeof claim.collectedAmount === "number" ? "verified" : "missing", typeof claim.collectedAmount === "number" ? "Cash collected on record." : "Not separately recorded.");
  push("deductible", "Deductible", num(claim.deductible), typeof claim.deductible === "number" ? "verified" : "missing", typeof claim.deductible === "number" ? "From policy context." : "Deductible not recorded — varies by policy.");
  push("policyLimits", "Policy limits", num(claim.policyLimits), typeof claim.policyLimits === "number" ? "verified" : "missing", typeof claim.policyLimits === "number" ? "From policy context." : "Policy limits not recorded.");

  // Derived: outstanding balance = approved baseline − payments.
  const approvedBaseline = supplements.reduce((s, x) => s + (x.approvedAmount ?? 0), 0);
  const baseline = approvedBaseline > 0 ? approvedBaseline : (claim.approvedAmount ?? claim.estimateAmount ?? 0);
  const outstanding =
    typeof claim.openBalance === "number"
      ? claim.openBalance
      : Math.max(0, baseline - (claim.paymentAmount ?? 0));
  push(
    "outstanding",
    "Open balance",
    num(outstanding),
    typeof claim.openBalance === "number" ? "verified" : "derived",
    typeof claim.openBalance === "number"
      ? "Recorded on the claim."
      : "Computed as approved/estimate baseline minus payments — verify against the carrier statement.",
  );

  // Conflicting: estimate vs invoice disagree.
  if (
    typeof claim.estimateAmount === "number" &&
    typeof claim.invoicedAmount === "number" &&
    Math.abs(claim.estimateAmount - claim.invoicedAmount) > 0.01
  ) {
    push(
      "estimateVsInvoice",
      "Estimate vs invoice",
      undefined,
      "conflicting",
      `Estimate ${num(claim.estimateAmount)} differs from invoiced ${num(claim.invoicedAmount)} — sources disagree; review before billing.`,
    );
  }

  const states: Record<PackageFieldState, number> = {
    verified: 0,
    derived: 0,
    inferred: 0,
    missing: 0,
    conflicting: 0,
  };
  for (const f of fields) states[f.state] += 1;
  return { fields, states };
}

export interface ClaimTimelineEvent {
  ts: number;
  kind:
    | "claim_created"
    | "claim_updated"
    | "document"
    | "analysis"
    | "finding"
    | "supplement_drafted"
    | "supplement_submitted"
    | "supplement_response"
    | "payment"
    | "note";
  label: string;
  detail?: string;
  /** source = happened outside Atlas; atlas = Atlas-generated event. */
  source: "source" | "atlas";
}

export interface TimelineSupplementInput {
  _id?: string;
  reason?: string | null;
  status?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
  submissionDate?: number | null;
  approvedAmount?: number | null;
  deniedAmount?: number | null;
}

export interface TimelineFindingInput {
  _id?: string;
  title?: string | null;
  status?: string | null;
  createdAt?: number | null;
  estimatedAmount?: number | null;
}

/**
 * Chronological, evidence-grounded claim timeline composed from actual
 * records: persisted source events, claims, findings, supplements and
 * payments. Atlas-generated events are explicitly labeled vs source events.
 */
export function buildClaimTimeline(
  claim: ClaimSnapshot,
  supplements: TimelineSupplementInput[] = [],
  findings: TimelineFindingInput[] = [],
): ClaimTimelineEvent[] {
  const events: ClaimTimelineEvent[] = [];
  if (typeof claim.createdAt === "number") {
    events.push({
      ts: claim.createdAt,
      kind: "claim_created",
      label: "Claim created",
      detail: claim.provenance ?? undefined,
      source: "atlas",
    });
  }
  // Persisted source/workspace events recorded on the claim.
  for (const raw of claim.timeline ?? []) {
    const t = raw as Record<string, unknown>;
    if (typeof t.ts !== "number") continue;
    events.push({
      ts: t.ts as number,
      kind: (t.kind as ClaimTimelineEvent["kind"]) ?? "note",
      label: String(t.label ?? "Event"),
      detail: typeof t.detail === "string" ? t.detail : undefined,
      source: t.source === "source" ? "source" : "atlas",
    });
  }
  for (const f of findings) {
    if (typeof f.createdAt !== "number") continue;
    events.push({
      ts: f.createdAt,
      kind: "finding",
      label: `Finding: ${f.title ?? "analysis item"}`,
      detail:
        typeof f.estimatedAmount === "number"
          ? `Potential amount $${f.estimatedAmount.toLocaleString()} — not guaranteed.`
          : undefined,
      source: "atlas",
    });
  }
  for (const s of supplements) {
    if (typeof s.createdAt === "number") {
      events.push({
        ts: s.createdAt,
        kind: "supplement_drafted",
        label: `Supplement drafted: ${s.reason ?? "no reason recorded"}`,
        detail: "Draft requires human review before submission.",
        source: "atlas",
      });
    }
    if (typeof s.submissionDate === "number") {
      events.push({
        ts: s.submissionDate,
        kind: "supplement_submitted",
        label: "Supplement marked for submission",
        detail: s.status ?? undefined,
        source: "source",
      });
    }
    if (
      typeof s.updatedAt === "number" &&
      (s.approvedAmount != null || s.deniedAmount != null) &&
      ["approved", "partially_approved", "denied"].includes(s.status ?? "")
    ) {
      const parts: string[] = [];
      if (s.approvedAmount != null) parts.push(`approved $${s.approvedAmount.toLocaleString()}`);
      if (s.deniedAmount != null) parts.push(`denied $${s.deniedAmount.toLocaleString()}`);
      events.push({
        ts: s.updatedAt,
        kind: "supplement_response",
        label: "Carrier response recorded",
        detail: parts.join(" · ") || undefined,
        source: "source",
      });
    }
  }
  if (typeof claim.paymentAmount === "number" && claim.paymentAmount > 0 && typeof claim.updatedAt === "number") {
    events.push({
      ts: claim.updatedAt,
      kind: "payment",
      label: `Payment recorded: $${claim.paymentAmount.toLocaleString()}`,
      detail: "Total recorded payments on the claim.",
      source: "source",
    });
  }
  // Dedupe (same ts + label) and sort chronologically.
  const seen = new Set<string>();
  return events
    .filter((e) => {
      const key = `${e.ts}:${e.kind}:${e.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.ts - b.ts);
}

export interface SupplementDocument {
  claimNumber: string | null;
  customer: string | null;
  property: string | null;
  carrier: string | null;
  reason: string;
  status: string;
  requestedAmount?: number;
  sections: Array<{ title: string; body: string[] }>;
  preparedAt: number;
  disclaimer: string;
}

/**
 * Structured supplement document. Never invents policy language or carrier
 * requirements — missing information is stated as missing and the document
 * always requires human review before submission.
 */
export function buildSupplementDocument(
  claim: ClaimSnapshot,
  supplement: {
    reason?: string | null;
    amount?: number | null;
    affectedLineItems?: string[] | null;
    requestedItems?: string[] | null;
    evidence?: string[] | null;
    justification?: string | null;
    status?: string | null;
    createdAt?: number | null;
  },
): SupplementDocument {
  const sec = (title: string, body: string[]): { title: string; body: string[] } => ({ title, body });
  const money = (n?: number | null) =>
    typeof n === "number" ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : undefined;
  const sections: Array<{ title: string; body: string[] }> = [];

  sections.push(
    sec("Claim information", [
      `Claim number: ${claim.claimNumber ?? "—"}`,
      `Insured: ${claim.customer ?? "—"}`,
      `Property: ${claim.property ?? "—"}`,
      `Carrier: ${claim.carrier ?? "—"}`,
      `Date of loss: ${typeof claim.dateOfLoss === "number" ? new Date(claim.dateOfLoss).toLocaleDateString() : "—"}`,
      `Adjuster: ${claim.adjuster ?? "—"}`,
    ]),
  );
  sections.push(
    sec("Reason for supplement", [
      supplement.reason ?? "Reason not recorded — requires review before submission.",
    ]),
  );
  sections.push(
    sec("Original scope", [
      (claim.expectedScope?.length ?? 0) > 0
        ? claim.expectedScope!.join("; ")
        : "Original scope not documented in Atlas.",
    ]),
  );
  sections.push(
    sec("Revised scope / items requested", [
      (supplement.requestedItems?.length ?? 0) > 0
        ? supplement.requestedItems!.join("; ")
        : (claim.actualScope?.length ?? 0) > 0
          ? `Performed scope observed: ${claim.actualScope!.join("; ")}`
          : "Revised scope not documented — requires review.",
    ]),
  );
  sections.push(
    sec("Supporting evidence", [
      (supplement.evidence?.length ?? 0) > 0
        ? supplement.evidence!.join("; ")
        : "No supporting evidence attached yet — add dated photos, logs and documentation.",
    ]),
  );
  sections.push(
    sec("Affected line items", [
      (supplement.affectedLineItems?.length ?? 0) > 0
        ? supplement.affectedLineItems!.join("; ")
        : "Line items not itemized — requires review against the estimate.",
    ]),
  );
  sections.push(
    sec("Justification", [
      supplement.justification ?? "No justification recorded — requires human review.",
    ]),
  );
  sections.push(
    sec("Requested amount", [
      typeof supplement.amount === "number"
        ? `${money(supplement.amount)} — calculated only where the evidence supports it; verify before submission.`
        : "Not calculated — the evidence does not yet support a defensible amount.",
    ]),
  );
  sections.push(
    sec("Limitations", [
      "This document is an Atlas draft assembled from available records. It does not constitute policy language or carrier requirements.",
      "Coverage, depreciation, deductible and jurisdiction-specific rules are NOT asserted here — they must be confirmed against the actual policy and carrier before submission.",
    ]),
  );
  sections.push(
    sec("Reviewer notes", [
      "Required before submission: confirm scope accuracy, attach proof of work, verify amounts, and obtain required approvals.",
    ]),
  );

  return {
    claimNumber: claim.claimNumber ?? null,
    customer: claim.customer ?? null,
    property: claim.property ?? null,
    carrier: claim.carrier ?? null,
    reason: supplement.reason ?? "Reason not recorded",
    status: supplement.status ?? "draft",
    requestedAmount: supplement.amount ?? undefined,
    sections,
    preparedAt: supplement.createdAt ?? Date.now(),
    disclaimer:
      "Atlas-generated draft for human review — not insurer policy, not a submission.",
  };
}

// ---------------------------------------------------------------------------
// Convex — queries
// ---------------------------------------------------------------------------

export const listClaims = query({
  args: { status: v.optional(v.string()) },
  handler: async (ctx, { status }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const claims = await ctx.db
      .query("insuranceClaims")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(200);
    const filtered = status ? claims.filter((c) => c.status === status) : claims;
    return Promise.all(
      filtered.map(async (claim) => {
        const supplements = await ctx.db
          .query("claimSupplements")
          .withIndex("by_claim", (q) => q.eq("claimId", claim._id))
          .collect();
        const findings = await ctx.db
          .query("claimFindings")
          .withIndex("by_claim", (q) => q.eq("claimId", claim._id))
          .collect();
        const completeness = analyzeClaimCompleteness(claim);
        const openFindings = findings.filter((f) => f.status === "open");
        const reconciliation = reconcileClaim(claim, supplements);
        const readySupplements = supplements.filter((s) => s.status === "ready_for_submission");
        return {
          _id: claim._id,
          claimNumber: claim.claimNumber,
          customer: claim.customer,
          property: claim.property,
          carrier: claim.carrier,
          status: claim.status,
          estimateAmount: claim.estimateAmount,
          invoicedAmount: claim.invoicedAmount,
          approvedAmount: claim.approvedAmount,
          paymentAmount: claim.paymentAmount,
          createdAt: claim.createdAt,
          updatedAt: claim.updatedAt,
          completeness: completeness.complete,
          completenessTotal: completeness.total,
          openFindings: openFindings.length,
          draftSupplements: supplements.filter((s) => s.status === "draft").length,
          readySupplements: readySupplements.length,
          outstanding: reconciliation.outstanding,
          hasDiscrepancy: reconciliation.hasDiscrepancy,
          isDemo: claim.isDemo ?? false,
          stalled:
            claim.status !== "closed" &&
            typeof claim.updatedAt === "number" &&
            Date.now() - claim.updatedAt > 30 * 86_400_000,
          needsAttention:
            completeness.categories.some(
              (x) =>
                x.status === "missing" ||
                x.status === "needs_review" ||
                x.status === "conflicted" ||
                x.status === "stale",
            ) ||
            openFindings.length > 0 ||
            reconciliation.hasDiscrepancy ||
            readySupplements.length > 0,
        };
      }),
    );
  },
});

export const getClaimPackage = query({
  args: { claimId: v.id("insuranceClaims") },
  handler: async (ctx, { claimId }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const claim = await ctx.db.get(claimId);
    if (!claim || claim.tenantId !== tenantId) throw new Error("Claim not found.");
    const supplements = await ctx.db
      .query("claimSupplements")
      .withIndex("by_claim", (q) => q.eq("claimId", claimId))
      .order("desc")
      .collect();
    const findings = await ctx.db
      .query("claimFindings")
      .withIndex("by_claim", (q) => q.eq("claimId", claimId))
      .order("desc")
      .collect();
    const evidenceDocs = await Promise.all(
      (claim.evidenceDocumentIds ?? []).map(async (id) => {
        const doc = await ctx.db.get(id as Id<"documents">);
        return doc ? { _id: doc._id, title: doc.title, classification: doc.classification } : null;
      }),
    );
    const completeness = analyzeClaimCompleteness(claim);
    const reconciliation = reconcileClaim(claim, supplements);
    const timeline = buildClaimTimeline(claim, supplements, findings);
    const packageModel = buildClaimPackage(claim, supplements);
    return {
      claim,
      supplements,
      findings,
      evidenceDocs,
      completeness,
      reconciliation,
      timeline,
      packageModel,
    };
  },
});

/** Evidence-grounded chronological claim history (Phase 12). */
export const getClaimTimeline = query({
  args: { claimId: v.id("insuranceClaims") },
  handler: async (ctx, { claimId }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const claim = await ctx.db.get(claimId);
    if (!claim || claim.tenantId !== tenantId) throw new Error("Claim not found.");
    const supplements = await ctx.db
      .query("claimSupplements")
      .withIndex("by_claim", (q) => q.eq("claimId", claimId))
      .collect();
    const findings = await ctx.db
      .query("claimFindings")
      .withIndex("by_claim", (q) => q.eq("claimId", claimId))
      .collect();
    return buildClaimTimeline(claim, supplements, findings);
  },
});

/** Structured supplement document for review (Phase 12). */
export const getSupplementDocument = query({
  args: { claimId: v.id("insuranceClaims"), supplementId: v.id("claimSupplements") },
  handler: async (ctx, { claimId, supplementId }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const claim = await ctx.db.get(claimId);
    if (!claim || claim.tenantId !== tenantId) throw new Error("Claim not found.");
    const sup = await ctx.db.get(supplementId);
    if (!sup || sup.tenantId !== tenantId || sup.claimId !== claimId) {
      throw new Error("Supplement not found.");
    }
    return buildSupplementDocument(claim, sup);
  },
});

/** Dashboard metrics — every number from actual records. */
export const claimCounts = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const claims = await ctx.db
      .query("insuranceClaims")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const findings = await ctx.db
      .query("claimFindings")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const supplements = await ctx.db
      .query("claimSupplements")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();

    const openFindings = findings.filter((f) => f.status === "open");
    const drafts = supplements.filter((s) => s.status === "draft");
    const ready = supplements.filter((s) => s.status === "ready_for_submission");
    const submitted = supplements.filter((s) =>
      ["submitted", "carrier_review", "response_received"].includes(s.status),
    );
    const approvedAmount = supplements.reduce((s, x) => s + (x.approvedAmount ?? 0), 0);
    const deniedAmount = supplements.reduce((s, x) => s + (x.deniedAmount ?? 0), 0);
    const requestedAmount = supplements.reduce((s, x) => s + (x.amount ?? 0), 0);
    const paidAmount = claims.reduce((s, c) => s + (c.paymentAmount ?? 0), 0);
    const outstanding = supplements
      .map((s) => s.outstandingAmount ?? 0)
      .reduce((a, b) => a + b, 0);
    const potential = findings
      .filter((f) => f.status === "open")
      .reduce((s, f) => s + (f.estimatedAmount ?? 0), 0);

    // Claims needing attention: missing key info, open findings, drafts/ready
    // supplements, or a reconciliation discrepancy.
    const attention = claims.filter((c) => {
      const comp = analyzeClaimCompleteness(c);
      const cs = supplements.filter((s) => s.claimId === c._id);
      const fs = findings.filter((f) => f.claimId === c._id && f.status === "open");
      const rec = reconcileClaim(c, cs);
      return comp.categories.some(
        (x) =>
          x.status === "missing" ||
          x.status === "needs_review" ||
          x.status === "conflicted" ||
          x.status === "stale",
      ) ||
        fs.length > 0 ||
        rec.hasDiscrepancy;
    });

    return {
      activeClaims: claims.length,
      openClaims: claims.filter((c) => c.status !== "closed").length,
      attentionClaims: attention.length,
      openFindings: openFindings.length,
      drafts: drafts.length,
      readyForSubmission: ready.length,
      submitted: submitted.length,
      approvedAmount,
      deniedAmount,
      requestedAmount,
      paidAmount,
      outstanding,
      potential,
      recoveryPipeline: RECOVERY_PIPELINE,
    };
  },
});

/**
 * Phase 14 — Revenue Recovery Command Center analytics. Trend, carrier and
 * lifecycle views derived from actual claim records (same figures as the
 * claims table). Payments are intentionally absent from the monthly series
 * because no payment history table exists — a per-month payment line could
 * not be honest.
 */
export const recoveryAnalytics = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const claims = await ctx.db
      .query("insuranceClaims")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const findings = await ctx.db
      .query("claimFindings")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const supplements = await ctx.db
      .query("claimSupplements")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    return {
      trend: buildRecoveryTrend(claims, findings, supplements),
      carriers: buildCarrierBreakdown(claims, supplements, findings),
      statusDistribution: buildStatusDistribution(claims),
    };
  },
});

/** Per-claim analysis used by the “What am I leaving on the table?” flow. */
export const analyzeAllClaims = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const claims = await ctx.db
      .query("insuranceClaims")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(100);
    return Promise.all(
      claims.map(async (claim) => {
        const supplements = await ctx.db
          .query("claimSupplements")
          .withIndex("by_claim", (q) => q.eq("claimId", claim._id))
          .collect();
        const findings = await ctx.db
          .query("claimFindings")
          .withIndex("by_claim", (q) => q.eq("claimId", claim._id))
          .collect();
        const completeness = analyzeClaimCompleteness(claim);
        const reconciliation = reconcileClaim(claim, supplements);
        const open = findings.filter((f) => f.status === "open");
        return {
          _id: claim._id,
          claimNumber: claim.claimNumber,
          customer: claim.customer,
          property: claim.property,
          status: claim.status,
          estimateAmount: claim.estimateAmount,
          invoicedAmount: claim.invoicedAmount,
          approvedAmount: claim.approvedAmount,
          paymentAmount: claim.paymentAmount,
          completeness,
          reconciliation,
          openFindings: open.map((f) => ({
            category: f.category,
            title: f.title,
            confidence: f.confidence,
            estimatedAmount: f.estimatedAmount,
            recommendedNextStep: f.recommendedNextStep,
            limitation: f.limitation,
          })),
        };
      }),
    );
  },
});

export const insuranceIntelligence = query({
  args: {},
  handler: async () => {
    const { INSURANCE_INTELLIGENCE } = await import("../everest/insurance");
    return INSURANCE_INTELLIGENCE;
  },
});

// ---------------------------------------------------------------------------
// Convex — mutations (editor-gated, audited)
// ---------------------------------------------------------------------------

async function audit(
  ctx: { db: { insert: Function } },
  tenantId: Id<"tenants">,
  actorId: Id<"users"> | undefined,
  actionType: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown>,
) {
  await ctx.db.insert("auditLogs", {
    tenantId,
    actorType: actorId ? "user" : "system",
    actorId: actorId ?? undefined,
    actionType,
    targetType,
    targetId,
    metadata,
  });
}

const CLAIM_FIELDS = {
  claimNumber: v.optional(v.string()),
  customer: v.optional(v.string()),
  property: v.optional(v.string()),
  carrier: v.optional(v.string()),
  policy: v.optional(v.string()),
  adjuster: v.optional(v.string()),
  dateOfLoss: v.optional(v.number()),
  causeOfLoss: v.optional(v.string()),
  lossDescription: v.optional(v.string()),
  status: v.optional(v.string()),
  estimateAmount: v.optional(v.number()),
  estimateLineItemCount: v.optional(v.number()),
  invoicedAmount: v.optional(v.number()),
  paymentAmount: v.optional(v.number()),
  approvedAmount: v.optional(v.number()),
  collectedAmount: v.optional(v.number()),
  openBalance: v.optional(v.number()),
  deductible: v.optional(v.number()),
  policyLimits: v.optional(v.number()),
  timeline: v.optional(v.array(v.any())),
  scopeItems: v.optional(v.array(v.any())),
  expectedScope: v.optional(v.array(v.string())),
  actualScope: v.optional(v.array(v.string())),
};

/** Create a claim with provenance. Never fabricates fields. */
export const createClaim = mutation({
  args: {
    claimNumber: v.optional(v.string()),
    customer: v.optional(v.string()),
    property: v.optional(v.string()),
    carrier: v.optional(v.string()),
    policy: v.optional(v.string()),
    adjuster: v.optional(v.string()),
    dateOfLoss: v.optional(v.number()),
    causeOfLoss: v.optional(v.string()),
    lossDescription: v.optional(v.string()),
    status: v.optional(v.string()),
    estimateAmount: v.optional(v.number()),
    estimateLineItemCount: v.optional(v.number()),
    invoicedAmount: v.optional(v.number()),
    paymentAmount: v.optional(v.number()),
    approvedAmount: v.optional(v.number()),
    collectedAmount: v.optional(v.number()),
    openBalance: v.optional(v.number()),
    deductible: v.optional(v.number()),
    policyLimits: v.optional(v.number()),
    scopeItems: v.optional(v.array(v.any())),
    expectedScope: v.optional(v.array(v.string())),
    actualScope: v.optional(v.array(v.string())),
    provenance: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    if (!(await isEditor(ctx, userId, tenantId))) {
      throw new Error("Only editors and above can create claims.");
    }
    const label = args.customer?.trim() || args.property?.trim() || args.claimNumber?.trim();
    if (!label) {
      throw new Error("A claim needs at least a customer, property or claim number.");
    }
    const now = Date.now();
    const id = await ctx.db.insert("insuranceClaims", {
      tenantId,
      claimNumber: args.claimNumber,
      customer: args.customer,
      property: args.property,
      carrier: args.carrier,
      policy: args.policy,
      adjuster: args.adjuster,
      dateOfLoss: args.dateOfLoss,
      causeOfLoss: args.causeOfLoss,
      lossDescription: args.lossDescription,
      status: args.status ?? "opened",
      currentStage: STATUS_LABELS[args.status ?? "opened"],
      estimateAmount: args.estimateAmount,
      estimateLineItemCount: args.estimateLineItemCount,
      invoicedAmount: args.invoicedAmount,
      paymentAmount: args.paymentAmount,
      approvedAmount: args.approvedAmount,
      collectedAmount: args.collectedAmount,
      openBalance: args.openBalance,
      deductible: args.deductible,
      policyLimits: args.policyLimits,
      scopeItems: args.scopeItems,
      expectedScope: args.expectedScope,
      actualScope: args.actualScope,
      evidenceSummary: [],
      evidenceDocumentIds: [],
      provenance:
        args.provenance ??
        "Created by a workspace member; fields are recorded only as provided.",
      confidence: 0.7,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    await audit(ctx, tenantId, userId, "claim_created", "insuranceClaim", String(id), {
      claimNumber: args.claimNumber,
      customer: args.customer,
      property: args.property,
    });
    return { claimId: id, completeness: analyzeClaimCompleteness({ ...args, confidence: 0.7 }) };
  },
});

export const updateClaim = mutation({
  args: { claimId: v.id("insuranceClaims"), patch: v.any(), provenance: v.optional(v.string()) },
  handler: async (ctx, { claimId, patch, provenance }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const claim = await ctx.db.get(claimId);
    if (!claim || claim.tenantId !== tenantId) throw new Error("Claim not found.");
    if (!(await isEditor(ctx, userId, tenantId))) {
      throw new Error("Only editors and above can update claims.");
    }
    const safe: Record<string, unknown> = {};
    for (const key of Object.keys(CLAIM_FIELDS) as Array<keyof typeof CLAIM_FIELDS>) {
      if (patch[key] !== undefined) safe[key] = patch[key];
    }
    if (Object.keys(safe).length === 0) {
      throw new Error("Nothing to update.");
    }
    safe.updatedAt = Date.now();
    if (provenance) safe.provenance = provenance;
    await ctx.db.patch(claimId, safe);
    await audit(ctx, tenantId, userId, "claim_updated", "insuranceClaim", String(claimId), {
      fields: Object.keys(safe).filter((k) => k !== "updatedAt"),
    });
    const updated = await ctx.db.get(claimId);
    return { claimId, completeness: analyzeClaimCompleteness(updated ?? claim) };
  },
});

/** Link a document as claim evidence. Deterministically updates the summary. */
export const attachClaimEvidence = mutation({
  args: { claimId: v.id("insuranceClaims"), documentId: v.id("documents") },
  handler: async (ctx, { claimId, documentId }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const claim = await ctx.db.get(claimId);
    if (!claim || claim.tenantId !== tenantId) throw new Error("Claim not found.");
    const doc = await ctx.db.get(documentId);
    if (!doc || doc.tenantId !== tenantId) throw new Error("Document not found.");
    if (!(await isEditor(ctx, userId, tenantId))) {
      throw new Error("Only editors and above can attach evidence.");
    }
    const ids = [...new Set([...(claim.evidenceDocumentIds ?? []), documentId])];
    const classification = doc.classification.toLowerCase();
    const categories: string[] = [];
    if (/estimate|scope/.test(classification)) categories.push("estimate");
    if (/invoice|financial/.test(classification)) categories.push("invoice");
    if (/photo|image/.test(classification)) categories.push("photos");
    if (/report|meeting|communication|regulatory/.test(classification)) categories.push("documentation");
    const summary = [...new Set([...(claim.evidenceSummary ?? []), ...categories])];
    await ctx.db.patch(claimId, {
      evidenceDocumentIds: ids,
      evidenceSummary: summary,
      updatedAt: Date.now(),
    });
    await audit(ctx, tenantId, userId, "claim_evidence_attached", "insuranceClaim", String(claimId), {
      documentId: String(documentId),
      categories,
    });
    return { claimId, evidenceSummary: summary };
  },
});

/**
 * Phase 14 — auto-link evidence documents whose claim number matches this
 * claim (deterministic). Answers "why do you believe this document belongs
 * to this claim?": the linked doc carries the same claim identifier.
 */
async function autoLinkClaimEvidence(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  claim: ClaimSnapshot,
): Promise<{ ids: Id<"documents">[]; reasons: string[] }> {
  const num = normalizeClaimNumber(claim.claimNumber);
  if (!num) return { ids: [], reasons: [] };
  const docs = (await ctx.runQuery(internal.internal.listDocsByTenant, {
    tenantId,
  })) as Array<{ _id: Id<"documents">; title: string; classification: string }>;
  const already = new Set((claim.evidenceDocumentIds ?? []).map(String));
  const linked: Id<"documents">[] = [];
  const reasons: string[] = [];

  for (const doc of docs.slice(0, 300)) {
    if (already.has(String(doc._id))) continue;
    const titleNum = normalizeClaimNumber(extractClaimNumber(doc.title));
    let matched = titleNum === num;
    if (!matched) {
      const chunks = (await ctx.runQuery(internal.internal.listChunksByDocument, {
        documentId: doc._id,
      })) as Array<{ content: string }> | null;
      const sample = chunks?.[0]?.content?.slice(0, 400) ?? "";
      matched = normalizeClaimNumber(extractClaimNumber(sample)) === num;
    }
    if (matched) {
      linked.push(doc._id);
      reasons.push(doc.title);
    }
  }
  return { ids: linked, reasons };
}

function normalizeClaimNumber(n?: string | null): string | null {
  if (!n) return null;
  const normalized = n.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalized.length >= 3 ? normalized : null;
}

/** Re-run the deterministic analyzers and upsert persisted findings. */
export const runClaimAnalysis = mutation({
  args: { claimId: v.id("insuranceClaims") },
  handler: async (ctx, { claimId }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const claim = await ctx.db.get(claimId);
    if (!claim || claim.tenantId !== tenantId) throw new Error("Claim not found.");
    const now = Date.now();
    const drafts = buildClaimFindings(claim);
    const ids: string[] = [];
    for (const d of drafts) {
      const existing = await ctx.db
        .query("claimFindings")
        .withIndex("by_finding_key", (q) => q.eq("findingKey", d.findingKey))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          title: d.title,
          description: d.description,
          evidence: d.evidence,
          confidence: d.confidence,
          estimatedAmount: d.estimatedAmount,
          limitation: d.limitation,
          recommendedNextStep: d.recommendedNextStep,
          updatedAt: now,
        });
        ids.push(String(existing._id));
      } else {
        const id = await ctx.db.insert("claimFindings", {
          tenantId,
          claimId,
          findingKey: d.findingKey,
          category: d.category,
          title: d.title,
          description: d.description,
          affectedEstimateItem: d.affectedEstimateItem,
          evidence: d.evidence,
          source: d.source,
          confidence: d.confidence,
          estimatedAmount: d.estimatedAmount,
          limitation: d.limitation,
          recommendedNextStep: d.recommendedNextStep,
          status: "open",
          createdAt: now,
          updatedAt: now,
        });
        ids.push(String(id));
      }
    }
    // Phase 14 — auto-link evidence documents sharing the claim number.
    const linked = await autoLinkClaimEvidence(ctx, tenantId, claim);
    if (linked.ids.length > 0) {
      const current = await ctx.db.get(claimId);
      if (current) {
        const mergedIds = [
          ...new Set([...(current.evidenceDocumentIds ?? []), ...linked.ids]),
        ];
        await ctx.db.patch(claimId, {
          evidenceDocumentIds: mergedIds,
          updatedAt: Date.now(),
        });
      }
    }

    await audit(ctx, tenantId, userId, "claim_analysis_run", "insuranceClaim", String(claimId), {
      findings: ids.length,
      evidenceAutoLinked: linked.ids.length,
      linkedTitles: linked.reasons.slice(0, 5),
    });
    return { claimId, findings: ids.length, evidenceLinked: linked.ids.length };
  },
});

export const updateFindingStatus = mutation({
  args: { findingId: v.id("claimFindings"), status: v.string() },
  handler: async (ctx, { findingId, status }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const finding = await ctx.db.get(findingId);
    if (!finding || finding.tenantId !== tenantId) throw new Error("Finding not found.");
    if (!(await isEditor(ctx, userId, tenantId))) {
      throw new Error("Only editors and above can update findings.");
    }
    await ctx.db.patch(findingId, { status, updatedAt: Date.now() });
    await audit(ctx, tenantId, userId, "claim_finding_status", "claimFinding", String(findingId), {
      status,
    });
    return { findingId, status };
  },
});

/** Create a supplement DRAFT. Never submitted automatically. */
export const createSupplement = mutation({
  args: {
    claimId: v.id("insuranceClaims"),
    reason: v.string(),
    amount: v.optional(v.number()),
    affectedLineItems: v.optional(v.array(v.string())),
    requestedItems: v.optional(v.array(v.string())),
    evidence: v.optional(v.array(v.string())),
    justification: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const claim = await ctx.db.get(args.claimId);
    if (!claim || claim.tenantId !== tenantId) throw new Error("Claim not found.");
    if (!(await isEditor(ctx, userId, tenantId))) {
      throw new Error("Only editors and above can create supplements.");
    }
    const now = Date.now();
    const id = await ctx.db.insert("claimSupplements", {
      tenantId,
      claimId: args.claimId,
      reason: args.reason,
      affectedLineItems: args.affectedLineItems,
      requestedItems: args.requestedItems,
      evidence: args.evidence,
      estimateDifference: args.amount,
      amount: args.amount,
      justification: args.justification,
      status: "draft",
      provenance: "Draft prepared by Atlas from verified evidence — requires human review before submission.",
      confidence: 0.6,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    await audit(ctx, tenantId, userId, "supplement_drafted", "claimSupplement", String(id), {
      claimId: String(args.claimId),
      amount: args.amount,
    });
    return { supplementId: id };
  },
});

export const updateSupplementStatus = mutation({
  args: {
    supplementId: v.id("claimSupplements"),
    status: v.string(),
    carrierResponse: v.optional(v.string()),
    approvedAmount: v.optional(v.number()),
    deniedAmount: v.optional(v.number()),
    outstandingAmount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const sup = await ctx.db.get(args.supplementId);
    if (!sup || sup.tenantId !== tenantId) throw new Error("Supplement not found.");
    if (!(await isEditor(ctx, userId, tenantId))) {
      throw new Error("Only editors and above can update supplements.");
    }
    const now = Date.now();
    const patch: Record<string, unknown> = {
      status: args.status,
      carrierResponse: args.carrierResponse,
      approvedAmount: args.approvedAmount,
      deniedAmount: args.deniedAmount,
      outstandingAmount: args.outstandingAmount,
      updatedAt: now,
    };
    if (args.status === "submitted" || args.status === "ready_for_submission") {
      patch.submissionDate = sup.submissionDate ?? now;
    }
    if (args.status === "approved" || args.status === "partially_approved") {
      // Approved-but-not-yet-paid is potentially outstanding until a payment
      // is recorded on the claim.
      patch.outstandingAmount = args.outstandingAmount ?? Math.max(0, args.approvedAmount ?? 0);
    }
    await ctx.db.patch(args.supplementId, patch);
    await audit(ctx, tenantId, userId, "supplement_status", "claimSupplement", String(args.supplementId), {
      status: args.status,
      approvedAmount: args.approvedAmount,
      deniedAmount: args.deniedAmount,
    });
    return { supplementId: args.supplementId, status: args.status };
  },
});

export const recordClaimPayment = mutation({
  args: { claimId: v.id("insuranceClaims"), amount: v.number() },
  handler: async (ctx, { claimId, amount }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const claim = await ctx.db.get(claimId);
    if (!claim || claim.tenantId !== tenantId) throw new Error("Claim not found.");
    if (!(await isEditor(ctx, userId, tenantId))) {
      throw new Error("Only editors and above can record payments.");
    }
    const total = (claim.paymentAmount ?? 0) + amount;
    await ctx.db.patch(claimId, { paymentAmount: total, updatedAt: Date.now() });
    await audit(ctx, tenantId, userId, "claim_payment_recorded", "insuranceClaim", String(claimId), {
      amount,
      total,
    });
    return { claimId, paymentAmount: total };
  },
});
