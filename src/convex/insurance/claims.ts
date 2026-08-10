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
import { mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { isEditor, requireTenant, requireUser } from "../helpers";
import { analyzeRecoveryOpportunities, type ClaimFacts } from "../everest/insurance";

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
  | "needs_review";

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
  customer?: string | null;
  carrier?: string | null;
  policy?: string | null;
  adjuster?: string | null;
  estimateAmount?: number | null;
  estimateLineItemCount?: number | null;
  invoicedAmount?: number | null;
  paymentAmount?: number | null;
  scopeItems?: Array<{ name?: string; inEstimate?: boolean }> | null;
  expectedScope?: string[] | null;
  actualScope?: string[] | null;
  evidenceSummary?: string[] | null;
  evidenceDocumentIds?: unknown[] | null;
  confidence?: number;
  provenance?: string | null;
}

const COMPLETENESS_RULES: Array<{
  key: string;
  label: string;
  has: (c: ClaimSnapshot) => boolean;
  note: (c: ClaimSnapshot) => string;
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
];

/** Deterministic claim-package completeness. Never invents a percentage. */
export function analyzeClaimCompleteness(claim: ClaimSnapshot): ClaimCompleteness {
  const categories: CompletenessCategory[] = COMPLETENESS_RULES.map((rule) => {
    const present = rule.has(claim);
    const provenance = (claim.provenance ?? "").toLowerCase();
    let status: CompletenessStatus;
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
  const missing = categories.filter((c) => c.status === "missing" || c.status === "needs_review").length;
  return {
    categories,
    complete: usable,
    total,
    score,
    summary:
      missing === 0
        ? `${usable} of ${total} required information categories are complete.`
        : `${usable} of ${total} required information categories are complete. ${missing} require${missing === 1 ? "s" : ""} attention.`,
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
  const hasDiscrepancy = outstanding > 0 || (approved > 0 && denied > 0 && approved + denied !== requested);
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
        return {
          _id: claim._id,
          claimNumber: claim.claimNumber,
          customer: claim.customer,
          property: claim.property,
          carrier: claim.carrier,
          status: claim.status,
          estimateAmount: claim.estimateAmount,
          paymentAmount: claim.paymentAmount,
          createdAt: claim.createdAt,
          completeness: completeness.complete,
          completenessTotal: completeness.total,
          openFindings: openFindings.length,
          draftSupplements: supplements.filter((s) => s.status === "draft").length,
          readySupplements: supplements.filter((s) => s.status === "ready_for_submission").length,
          outstanding: reconciliation.outstanding,
          hasDiscrepancy: reconciliation.hasDiscrepancy,
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
    return { claim, supplements, findings, evidenceDocs, completeness, reconciliation };
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
      return comp.categories.some((x) => x.status === "missing" || x.status === "needs_review") ||
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
  status: v.optional(v.string()),
  estimateAmount: v.optional(v.number()),
  estimateLineItemCount: v.optional(v.number()),
  invoicedAmount: v.optional(v.number()),
  paymentAmount: v.optional(v.number()),
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
    status: v.optional(v.string()),
    estimateAmount: v.optional(v.number()),
    estimateLineItemCount: v.optional(v.number()),
    invoicedAmount: v.optional(v.number()),
    paymentAmount: v.optional(v.number()),
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
      status: args.status ?? "opened",
      currentStage: STATUS_LABELS[args.status ?? "opened"],
      estimateAmount: args.estimateAmount,
      estimateLineItemCount: args.estimateLineItemCount,
      invoicedAmount: args.invoicedAmount,
      paymentAmount: args.paymentAmount,
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
    await audit(ctx, tenantId, userId, "claim_analysis_run", "insuranceClaim", String(claimId), {
      findings: ids.length,
    });
    return { claimId, findings: ids.length };
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
