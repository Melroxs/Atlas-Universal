// ---------------------------------------------------------------------------
// Regression tests — Claim Package + Revenue Recovery boundary normalization.
//
// Production defects guarded:
//  1. insurance_get_claim_package returns only { claim, supplements, findings,
//     evidenceDocs }. ClaimDetail destructured completeness / packageModel /
//     timeline / reconciliation and crashed on the undefined sections
//     ("Cannot read properties of undefined (reading 'score')" etc.).
//  2. insurance_recovery_analytics returns raw { claims, findings,
//     supplements }. RevenueRecovery consumed analytics.trend / carriers /
//     statusDistribution directly and crashed ("Cannot read properties of
//     undefined (reading 'flatMap')").
// The transforms below enrich/normalize at the data boundary so the pages
// always receive the derived shapes or an honest empty state.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  buildRecoveryAnalytics,
  defaultClaimCounts,
  normalizeClaimPackageResponse,
  toClaimSnapshot,
  RECOVERY_PIPELINE,
} from "./logic";

const RAW_CLAIM = {
  _id: "c1",
  claimNumber: "GAP-26-51847",
  customer: "NPP Roofing & Restoration",
  property: "123 Maple St",
  carrier: "StateFarm",
  status: "opened",
  estimateAmount: 25000,
  paymentAmount: 10000,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_100_000,
};

describe("normalizeClaimPackageResponse", () => {
  it("returns null for a null/missing response (page shows not-found)", () => {
    expect(normalizeClaimPackageResponse(null)).toBeNull();
    expect(normalizeClaimPackageResponse(undefined)).toBeNull();
    expect(normalizeClaimPackageResponse("nope")).toBeNull();
    expect(normalizeClaimPackageResponse({})).toBeNull();
  });

  it("fills every derived section the page renders from a raw RPC response", () => {
    const pkg = normalizeClaimPackageResponse({
      claim: RAW_CLAIM,
      supplements: [{ _id: "s1", reason: "Line item 12", status: "draft", amount: 4000 }],
      findings: [{ _id: "f1", title: "Missing line item", status: "open", estimatedAmount: 4000 }],
      evidenceDocs: [{ _id: "d1", title: "Invoice.pdf" }],
    });
    expect(pkg).not.toBeNull();
    expect(Array.isArray(pkg!.supplements)).toBe(true);
    expect(Array.isArray(pkg!.findings)).toBe(true);
    expect(Array.isArray(pkg!.evidenceDocs)).toBe(true);
    // Derived sections are ALWAYS present (the production crash sites).
    expect(pkg!.completeness.score).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(pkg!.completeness.categories)).toBe(true);
    expect(typeof pkg!.completeness.summary).toBe("string");
    expect(Array.isArray(pkg!.packageModel.fields)).toBe(true);
    expect(pkg!.packageModel.fields.length).toBeGreaterThan(0);
    expect(Array.isArray(pkg!.timeline)).toBe(true);
    expect(typeof pkg!.reconciliation.outstanding).toBe("number");
    expect(Array.isArray(pkg!.reconciliation.notes)).toBe(true);
    // Claim-created event lands in the timeline from the claim row.
    expect(pkg!.timeline.some((e) => e.kind === "claim_created")).toBe(true);
  });

  it("never throws when the RPC returns null sub-arrays (missing data)", () => {
    const pkg = normalizeClaimPackageResponse({
      claim: RAW_CLAIM,
      supplements: null,
      findings: null,
      evidenceDocs: null,
    });
    expect(pkg).not.toBeNull();
    expect(pkg!.supplements).toEqual([]);
    expect(pkg!.findings).toEqual([]);
    expect(pkg!.evidenceDocs).toEqual([]);
    expect(Array.isArray(pkg!.timeline)).toBe(true);
  });

  it("handles a sparse claim row (no financials, no timestamps)", () => {
    const pkg = normalizeClaimPackageResponse({ claim: { _id: "c2" } });
    expect(pkg).not.toBeNull();
    expect(pkg!.reconciliation.outstanding).toBe(0);
    expect(pkg!.completeness.complete).toBeGreaterThanOrEqual(0);
    expect(pkg!.timeline).toEqual([]);
  });
});

describe("buildRecoveryAnalytics", () => {
  it("builds the full derived shape from the raw RPC result", () => {
    const now = Date.now();
    const a = buildRecoveryAnalytics({
      claims: [{ ...RAW_CLAIM, _id: "c1", carrier: "StateFarm", createdAt: now }],
      findings: [{ _id: "f1", claimId: "c1", status: "open", estimatedAmount: 4000, createdAt: now }],
      supplements: [{ _id: "s1", claimId: "c1", status: "draft", amount: 4000, submissionDate: null }],
    });
    expect(a.recoveryPipeline).toEqual([...RECOVERY_PIPELINE]);
    expect(Array.isArray(a.trend)).toBe(true);
    expect(a.trend.length).toBe(12);
    expect(a.trend.some((t) => t.claimsCreated > 0)).toBe(true);
    expect(a.carriers.some((c) => c.carrier === "StateFarm")).toBe(true);
    expect(a.statusDistribution.some((s) => s.status === "opened")).toBe(true);
  });

  it("returns an honest zero-state (never a crash) for null/missing data", () => {
    for (const raw of [null, undefined, {}, { claims: null, findings: null, supplements: null }]) {
      const a = buildRecoveryAnalytics(raw);
      // The trend is 12 zero-filled calendar months (the chart renders an
      // explicit "no activity" state); nothing else is ever null/undefined.
      expect(a.trend.length).toBe(12);
      expect(a.trend.every((t) => t.claimsCreated === 0 && t.findingsOpened === 0 && t.supplementsSubmitted === 0)).toBe(true);
      expect(a.carriers).toEqual([]);
      expect(a.statusDistribution).toEqual([]);
      expect(a.recoveryPipeline).toEqual([...RECOVERY_PIPELINE]);
    }
  });
});

describe("defaultClaimCounts + toClaimSnapshot", () => {
  it("returns a complete zero-state with the pipeline", () => {
    const c = defaultClaimCounts();
    expect(c.openClaims).toBe(0);
    expect(c.recoveryPipeline).toEqual([...RECOVERY_PIPELINE]);
  });

  it("maps raw claim rows into the analyzer snapshot without throwing", () => {
    const s = toClaimSnapshot(RAW_CLAIM);
    expect(s.claimNumber).toBe("GAP-26-51847");
    expect(s.estimateAmount).toBe(25000);
    expect(s.createdAt).toBe(1_700_000_000_000);
    const sparse = toClaimSnapshot({ _id: "x" });
    expect(sparse.estimateAmount).toBeNull();
    expect(sparse.updatedAt).toBeNull();
  });
});
