/**
 * Phase 14 §17 — deterministic synthetic restoration-company demo dataset.
 *
 * Atlas can load a clearly-marked demo workspace so the Revenue Recovery
 * command center, claim detail, findings, supplements, reconciliation and
 * conversation intents can be exercised with realistic — but entirely
 * SYNTHETIC — restoration data.
 *
 * Safety rules:
 *  - The generator is PURE and DETERMINISTIC: the same anchor produces the
 *    exact same dataset, so tests can pin expectations.
 *  - Every record is marked `isDemo: true` and carries a provenance string
 *    that says the data is synthetic. Demo records are never mixed with real
 *    tenant data: the loader replaces the tenant's previous demo records and
 *    `removeDemoData` deletes them, so a tenant can always return to a clean
 *    workspace.
 *  - No value is fabricated in the "analysis" sense: financial numbers are
 *    explicit inputs of the fixture, and findings are produced by the SAME
 *    deterministic analyzers the product uses (runClaimAnalysis), so demo
 *    findings are exactly as evidence-grounded as real ones.
 */

import { getSupabaseClient } from "@/lib/supabase";
import { rpcCall } from "@/lib/actions/rpc";
import { buildClaimFindings, analyzeClaimCompleteness, reconcileClaim, type ClaimSnapshot } from "./logic";
import { extractClaimNumber } from "./reconstruct";

export const DEMO_PROVENANCE =
  "SYNTHETIC DEMO DATA — created by the Atlas demo loader to exercise the restoration workflow. This is not real tenant data and must not be treated as authoritative.";

export const DEMO_CLAIM_COUNT = 4;

export interface DemoScopeItem {
  name: string;
  quantity?: number;
  unit?: string;
  amount?: number;
  inEstimate: boolean;
  documented: boolean;
}

export interface DemoClaimSpec {
  claimNumber: string;
  customer: string;
  property: string;
  carrier: string;
  policy: string;
  adjuster?: string;
  causeOfLoss: string;
  lossDescription: string;
  status: string;
  estimateAmount?: number;
  estimateLineItemCount?: number;
  approvedAmount?: number;
  invoicedAmount?: number;
  paymentAmount?: number;
  scopeItems: DemoScopeItem[];
  expectedScope: string[];
  actualScope: string[];
  evidenceSummary: string[];
  /** Days before the anchor the claim was created. */
  createdDaysAgo: number;
  /** Days before the anchor the claim was last touched (freshness). */
  updatedDaysAgo: number;
  dateOfLossDaysAgo: number;
  timeline: Array<{ kind: string; label: string; detail: string; daysAgo: number }>;
  /** What the fixture is meant to demonstrate (drives the test suite). */
  demonstrates: string[];
}

export function buildDemoRestorationDataset(anchor: number = Date.now()): DemoClaimSpec[] {
  const day = 86_400_000;
  const at = (daysAgo: number) => anchor - daysAgo * day;
  const D = (daysAgo: number) => Math.round(at(daysAgo));

  return [
    {
      claimNumber: "88210044",
      customer: "Johnson",
      property: "482 Harbor Lane, Tampa FL",
      carrier: "Statewide Insurance",
      policy: "POL-7721",
      adjuster: "D. Reyes",
      causeOfLoss: "Burst water heater — second floor",
      lossDescription: "Water heater supply line failed, flooding the second floor and seeping into the first-floor ceiling.",
      status: "opened",
      estimateAmount: 42000,
      estimateLineItemCount: 34,
      approvedAmount: 38000,
      invoicedAmount: 41500,
      paymentAmount: 38000,
      scopeItems: [
        { name: "Water extraction", quantity: 1, unit: "job", amount: 2400, inEstimate: true, documented: true },
        { name: "Structural dry-out", quantity: 1, unit: "job", amount: 3900, inEstimate: true, documented: true },
        { name: "Demolition — affected drywall", quantity: 1, unit: "job", amount: 2100, inEstimate: true, documented: true },
        { name: "Reconstruction — bedroom 1 & 2", quantity: 1, unit: "job", amount: 21400, inEstimate: true, documented: true },
        { name: "First-floor ceiling repair", quantity: 1, unit: "job", amount: 5400, inEstimate: true, documented: true },
        { name: "Mold remediation — affected drywall", quantity: 1, unit: "job", amount: 5200, inEstimate: false, documented: true },
        { name: "Subfloor replacement (bedroom 2)", quantity: 1, unit: "job", amount: 4100, inEstimate: false, documented: true },
      ],
      expectedScope: ["water extraction", "dry-out", "demolition", "reconstruction", "ceiling repair"],
      actualScope: ["water extraction", "dry-out", "demolition", "reconstruction", "ceiling repair", "mold remediation", "subfloor replacement"],
      evidenceSummary: ["estimate", "invoice", "photos", "documentation"],
      createdDaysAgo: 62,
      updatedDaysAgo: 6,
      dateOfLossDaysAgo: 68,
      timeline: [
        { kind: "document", label: "Estimate received", detail: "Initial restoration estimate (demo data)", daysAgo: 58 },
        { kind: "document", label: "Invoice generated", detail: "Invoice for performed work (demo data)", daysAgo: 9 },
        { kind: "payment", label: "Payment received", detail: "Carrier payment recorded (demo data)", daysAgo: 6 },
      ],
      demonstrates: ["billing_gap", "estimate_vs_invoice_mismatch", "supplement_opportunity", "scope_change"],
    },
    {
      claimNumber: "CL88110023",
      customer: "Martinez",
      property: "118 Cypress Court, Orlando FL",
      carrier: "Guardian National",
      policy: "GN-1104",
      adjuster: "S. Cho",
      causeOfLoss: "Kitchen fire — unattended cooking",
      lossDescription: "Small kitchen fire; smoke and soot throughout the first floor, kitchen cabinets and counters replaced.",
      status: "opened",
      estimateAmount: 18500,
      estimateLineItemCount: 21,
      approvedAmount: 18500,
      invoicedAmount: 18500,
      paymentAmount: 12000,
      scopeItems: [
        { name: "Kitchen demolition", quantity: 1, unit: "job", amount: 1800, inEstimate: true, documented: true },
        { name: "Cabinetry & counter replacement", quantity: 1, unit: "job", amount: 9600, inEstimate: true, documented: true },
        { name: "Soot cleaning — first floor", quantity: 1, unit: "job", amount: 3100, inEstimate: true, documented: true },
        { name: "Repaint — kitchen & hallway", quantity: 1, unit: "job", amount: 4000, inEstimate: true, documented: true },
        { name: "Hardwired smoke detectors (code upgrade)", quantity: 4, unit: "each", amount: 900, inEstimate: false, documented: true },
      ],
      expectedScope: ["kitchen demolition", "cabinetry", "soot cleaning", "repaint"],
      actualScope: ["kitchen demolition", "cabinetry", "soot cleaning", "repaint", "hardwired smoke detectors"],
      evidenceSummary: ["estimate", "invoice", "photos"],
      createdDaysAgo: 47,
      updatedDaysAgo: 3,
      dateOfLossDaysAgo: 52,
      timeline: [
        { kind: "document", label: "Estimate received", detail: "Fire restoration estimate (demo data)", daysAgo: 44 },
        { kind: "document", label: "Invoice generated", detail: "Invoice for performed work (demo data)", daysAgo: 6 },
        { kind: "payment", label: "Partial payment received", detail: "Carrier partial payment (demo data)", daysAgo: 3 },
      ],
      demonstrates: ["partial_payment", "outstanding", "supplement_opportunity", "code_upgrade"],
    },
    {
      claimNumber: "99210008",
      customer: "Chen",
      property: "77 Pine Ridge Dr, Gainesville FL",
      carrier: "Coastal Mutual",
      policy: "CM-5520",
      causeOfLoss: "Wind damage — roof and gutters",
      lossDescription: "Storm wind tore shingles and gutters from the rear roof slope; interior water staining in the attic.",
      status: "opened",
      estimateAmount: 9200,
      estimateLineItemCount: 12,
      scopeItems: [
        { name: "Roof tear-off & replacement", quantity: 1, unit: "job", amount: 7800, inEstimate: true, documented: true },
        { name: "Gutter replacement", quantity: 1, unit: "job", amount: 1400, inEstimate: true, documented: true },
      ],
      expectedScope: ["roof replacement", "gutters"],
      actualScope: ["roof replacement", "gutters"],
      // No invoice, no payment, no evidence linked — the demo shows a claim
      // that is stalled and missing documentation.
      evidenceSummary: [],
      createdDaysAgo: 95,
      updatedDaysAgo: 45,
      dateOfLossDaysAgo: 100,
      timeline: [{ kind: "document", label: "Estimate received", detail: "Wind/roof estimate (demo data)", daysAgo: 92 }],
      demonstrates: ["stale", "missing_evidence", "missing_invoices", "stalled"],
    },
    {
      claimNumber: "CL77220031",
      customer: "Peterson",
      property: "204 Maple Ave, Jacksonville FL",
      carrier: "Atlantic Ridge",
      policy: "AR-3319",
      adjuster: "K. Okafor",
      causeOfLoss: "Lightning strike — electrical panel",
      lossDescription: "Lightning surge damaged the main electrical panel and three appliances; panel replaced.",
      status: "opened",
      estimateAmount: 22000,
      estimateLineItemCount: 18,
      approvedAmount: 22000,
      invoicedAmount: 22000,
      paymentAmount: 24500,
      scopeItems: [
        { name: "Electrical panel replacement", quantity: 1, unit: "job", amount: 12400, inEstimate: true, documented: true },
        { name: "Appliance replacement", quantity: 3, unit: "each", amount: 6600, inEstimate: true, documented: true },
        { name: "Rewiring — affected circuits", quantity: 1, unit: "job", amount: 3000, inEstimate: true, documented: true },
      ],
      expectedScope: ["panel replacement", "appliances", "rewiring"],
      actualScope: ["panel replacement", "appliances", "rewiring"],
      evidenceSummary: ["estimate", "invoice", "payment"],
      createdDaysAgo: 32,
      updatedDaysAgo: 3,
      dateOfLossDaysAgo: 36,
      timeline: [
        { kind: "document", label: "Estimate received", detail: "Electrical estimate (demo data)", daysAgo: 30 },
        { kind: "payment", label: "Payment received", detail: "Payment exceeds invoiced total — flagged for review (demo data)", daysAgo: 3 },
      ],
      demonstrates: ["payment_discrepancy", "conflicted"],
    },
  ];
}

/** Convert a spec into the ClaimSnapshot shape used by the pure analyzers. */
export function demoClaimSnapshot(spec: DemoClaimSpec, anchor: number = Date.now()): ClaimSnapshot {
  const day = 86_400_000;
  return {
    claimNumber: spec.claimNumber,
    customer: spec.customer,
    property: spec.property,
    carrier: spec.carrier,
    policy: spec.policy,
    adjuster: spec.adjuster,
    dateOfLoss: anchor - spec.dateOfLossDaysAgo * day,
    causeOfLoss: spec.causeOfLoss,
    status: spec.status,
    estimateAmount: spec.estimateAmount,
    estimateLineItemCount: spec.estimateLineItemCount,
    approvedAmount: spec.approvedAmount,
    invoicedAmount: spec.invoicedAmount,
    paymentAmount: spec.paymentAmount,
    scopeItems: spec.scopeItems,
    expectedScope: spec.expectedScope,
    actualScope: spec.actualScope,
    evidenceSummary: spec.evidenceSummary,
    provenance: DEMO_PROVENANCE,
    confidence: 0.7,
    createdAt: anchor - spec.createdDaysAgo * day,
    updatedAt: anchor - spec.updatedDaysAgo * day,
  };
}

export interface DemoDatasetReport {
  claims: number;
  stale: string[];
  conflicted: string[];
  missingEvidence: string[];
  supplementOpportunities: string[];
  outstandingTotal: number;
  discrepancyTotal: number;
}

/** Deterministic summary of what the dataset demonstrates — for tests + UI. */
export function summarizeDemoDataset(anchor: number = Date.now()): DemoDatasetReport {
  const specs = buildDemoRestorationDataset(anchor);
  const stale: string[] = [];
  const conflicted: string[] = [];
  const missingEvidence: string[] = [];
  const supplementOpportunities: string[] = [];
  let outstandingTotal = 0;
  let discrepancyTotal = 0;
  for (const spec of specs) {
    const snap = demoClaimSnapshot(spec, anchor);
    const completeness = analyzeClaimCompleteness(snap);
    if (completeness.categories.some((c) => c.status === "stale")) stale.push(spec.customer);
    if (completeness.categories.some((c) => c.status === "conflicted")) conflicted.push(spec.customer);
    if ((spec.evidenceSummary ?? []).length === 0) missingEvidence.push(spec.customer);
    if (spec.scopeItems.some((s) => !s.inEstimate && s.documented)) supplementOpportunities.push(spec.customer);
    const rec = reconcileClaim(snap, []);
    if (rec.hasDiscrepancy) discrepancyTotal += 1;
    outstandingTotal += rec.outstanding ?? 0;
  }
  return {
    claims: specs.length,
    stale,
    conflicted,
    missingEvidence,
    supplementOpportunities,
    outstandingTotal,
    discrepancyTotal,
  };
}

/** Deterministic demo claim-number → customer map (used by UI badges). */
export function demoClaimNumbers(): string[] {
  return buildDemoRestorationDataset(0).map((s) => extractClaimNumber(s.claimNumber) ?? s.claimNumber);
}

// ---------------------------------------------------------------------------
// Client-side loaders (persist the dataset through Supabase RPCs)
// ---------------------------------------------------------------------------

/** Load the deterministic demo dataset into the caller's tenant. Idempotent. */
export async function loadDemoDataClient(): Promise<{ claims: number; demo: true }> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  // Replace previous demo records.
  await rpcCall(supabase, "insurance_demo_remove");

  const specs = buildDemoRestorationDataset();
  const now = Date.now();
  const day = 86_400_000;
  let claims = 0;

  for (const spec of specs) {
    const data = await rpcCall(supabase, "insurance_create_claim", {
      claimNumber: spec.claimNumber,
      p_customer: spec.customer,
      p_property: spec.property,
      p_carrier: spec.carrier,
      p_policy: spec.policy,
      p_adjuster: spec.adjuster,
      p_dateOfLoss: now - spec.dateOfLossDaysAgo * day,
      p_causeOfLoss: spec.causeOfLoss,
      p_lossDescription: spec.lossDescription,
      p_status: spec.status,
      p_estimateAmount: spec.estimateAmount ?? null,
      p_estimateLineItemCount: spec.estimateLineItemCount ?? null,
      p_invoicedAmount: spec.invoicedAmount ?? null,
      p_paymentAmount: spec.paymentAmount ?? null,
      p_approvedAmount: spec.approvedAmount ?? null,
      p_scopeItems: spec.scopeItems ?? null,
      p_expectedScope: spec.expectedScope ?? null,
      actualScope: spec.actualScope ?? null,
      provenance: DEMO_PROVENANCE,
    });
    const claimId = (data as { claimId?: string })?.claimId;
    if (!claimId) throw new Error("Demo loader could not create a claim.");

    // Demo claims carry their created/updated timestamps so freshness
    // analysis is realistic.
    await rpcCall(supabase, "insurance_update_claim", {
      claimId,
      patch: {
        createdAt: now - spec.createdDaysAgo * day,
        updatedAt: now - spec.updatedDaysAgo * day,
        isDemo: true,
        timeline: spec.timeline.map((t) => ({
          ts: now - t.daysAgo * day,
          kind: t.kind,
          label: t.label,
          detail: t.detail,
          source: "source",
        })),
        evidenceSummary: spec.evidenceSummary,
        currentStage: spec.status,
      },
    });

    // Demo supplements stay drafts — never submission-ready without review.
    if (spec.demonstrates.includes("supplement_opportunity")) {
      const omitted = spec.scopeItems.filter((s) => !s.inEstimate && s.documented);
      const amount = omitted.reduce((s, o) => s + (o.amount ?? 0), 0) || undefined;
      await rpcCall(supabase, "insurance_create_supplement", {
        claimId,
        reason: "Recovering documented scope not represented in the original estimate.",
        affectedLineItems: omitted.map((o) => o.name),
        requestedItems: omitted.map((o) => o.name),
        evidence: spec.actualScope
          .filter((s) => omitted.some((o) => o.name.toLowerCase().includes(s.toLowerCase())))
          .concat("Demo scope notes"),
        amount: amount ?? null,
        justification:
          "Draft assembled from the deterministic demo dataset — requires human review.",
      });
    }

    // Reuse the REAL analyzer so findings match what production computes.
    const claimSnap: ClaimSnapshot = demoClaimSnapshot(spec, now);
    const findings = buildClaimFindings(claimSnap).map((f) => ({
      ...f,
      findingKey: `claim:${claimId}:${f.source ?? f.category}`,
    }));
    await rpcCall(supabase, "insurance_upsert_findings", {
      claimId,
      findings,
    });
    claims++;
  }

  return { claims, demo: true };
}

/** Delete all demo records for the caller's tenant. */
export async function removeDemoDataClient(): Promise<{ removed: number }> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "insurance_demo_remove");
  return (data ?? { removed: 0 }) as { removed: number };
}
