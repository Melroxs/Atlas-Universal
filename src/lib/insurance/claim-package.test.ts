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
  matchCandidateEvidenceDocs,
  normalizeClaimListResponse,
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

describe("normalizeClaimListResponse", () => {
  it("returns [] for a null/malformed response (pages render empty, never crash)", () => {
    for (const raw of [null, undefined, {}, "nope", { claim: {} }, 42]) {
      expect(normalizeClaimListResponse(raw)).toEqual([]);
    }
  });

  it("unwraps the deployed { claim, findings, supplements } wrapper into flat rows", () => {
    const rows = normalizeClaimListResponse([
      {
        claim: {
          _id: "c1",
          claimNumber: "GAP-26-51847",
          customer: "NPP Roofing & Restoration",
          property: "123 Maple St",
          status: "opened",
          isDemo: true,
          estimateAmount: 25000,
          paymentAmount: 10000,
          createdAt: Date.now() - 86_400_000,
          updatedAt: Date.now() - 3_600_000,
        },
        findings: [
          { _id: "f1", status: "open" },
          { _id: "f2", status: "resolved" },
        ],
        supplements: [{ _id: "s1", status: "draft" }],
      },
    ]);
    expect(rows.length).toBe(1);
    const row = rows[0];
    // The persisted id is preserved verbatim — list rows and the detail route
    // resolve the SAME claim (the production defect navigated to "undefined").
    expect(row._id).toBe("c1");
    expect(row.customer).toBe("NPP Roofing & Restoration");
    expect(row.claimNumber).toBe("GAP-26-51847");
    expect(row.status).toBe("opened");
    expect(row.isDemo).toBe(true);
    // Derived aggregates the Claims table / Dashboard render.
    expect(row.completeness).toBeGreaterThanOrEqual(0);
    expect(row.completenessTotal).toBeGreaterThan(0);
    expect(row.openFindings).toBe(1);
    expect(row.draftSupplements).toBe(1);
    expect(row.readySupplements).toBe(0);
    expect(typeof row.outstanding).toBe("number");
    expect(typeof row.hasDiscrepancy).toBe("boolean");
    expect(row.needsAttention).toBe(true);
    // Fresh activity → never flagged stalled.
    expect(row.stalled).toBe(false);
  });

  it("passes already-flat rows through and skips rows without a claim id", () => {
    const rows = normalizeClaimListResponse([
      { _id: "flat-1", customer: "Flat Co", claimNumber: "F-1", status: "opened" },
      { customer: "No id row", claimNumber: "F-2" },
      null,
      "junk",
      ["array-row"],
    ]);
    expect(rows.length).toBe(1);
    expect(rows[0]._id).toBe("flat-1");
    expect(rows[0].customer).toBe("Flat Co");
  });

  it("flags only stale open claims as stalled (terminal statuses never stall)", () => {
    const old = Date.now() - 60 * 86_400_000;
    const rows = normalizeClaimListResponse([
      { claim: { _id: "open-stale", status: "opened", createdAt: old, updatedAt: old } },
      { claim: { _id: "closed-old", status: "closed", createdAt: old, updatedAt: old } },
      { claim: { _id: "open-fresh", status: "opened", createdAt: Date.now() } },
    ]);
    expect(rows.find((r) => r._id === "open-stale")?.stalled).toBe(true);
    expect(rows.find((r) => r._id === "closed-old")?.stalled).toBe(false);
    expect(rows.find((r) => r._id === "open-fresh")?.stalled).toBe(false);
  });
});

describe("matchCandidateEvidenceDocs", () => {
  const docs = [
    { _id: "d1", title: "2026-05-01_carrier_estimate.pdf", sourceId: null },
    { _id: "d2", title: "2026-05-01_inspection_report.pdf", sourceId: null },
    { _id: "d3", title: "policy.pdf", sourceId: "archive/x/policy.pdf" },
    { _id: "d4", title: "Another Folder\\nested\\estimate.xlsx", sourceId: null },
  ];

  it("matches candidate evidence paths to real document titles (basename, date-prefix aware)", () => {
    const ids = matchCandidateEvidenceDocs(
      {
        filePaths: ["2026-05-01_carrier_estimate.pdf", "archive/x/inspection_report.pdf"],
        evidence: ["policy.pdf"],
      },
      docs as unknown as Array<Record<string, unknown>>,
    );
    expect(ids.sort()).toEqual(["d1", "d2", "d3"]);
  });

  it("matches backslash paths and returns unique ids only", () => {
    const ids = matchCandidateEvidenceDocs(
      { filePaths: ["Another Folder\\nested\\estimate.xlsx"], evidence: ["estimate.xlsx"] },
      docs as unknown as Array<Record<string, unknown>>,
    );
    expect(ids).toEqual(["d4"]);
  });

  it("returns [] when nothing matches (never fabricates a link)", () => {
    expect(
      matchCandidateEvidenceDocs({ filePaths: ["totally-unrelated.pdf"] }, docs as unknown as Array<Record<string, unknown>>),
    ).toEqual([]);
    expect(
      matchCandidateEvidenceDocs({}, docs as unknown as Array<Record<string, unknown>>),
    ).toEqual([]);
    expect(matchCandidateEvidenceDocs({ evidence: ["x.pdf"] }, [])).toEqual([]);
  });

  it("is conservative: short/ambiguous names never match via the contains-fallback", () => {
    const short = matchCandidateEvidenceDocs(
      { filePaths: ["ab"] },
      [{ _id: "d9", title: "xabz", sourceId: null }],
    );
    expect(short).toEqual([]);
  });
});
