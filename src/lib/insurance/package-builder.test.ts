// ---------------------------------------------------------------------------
// Regression tests — Claim / Supplement Package Builder
//
// Verifies the complete package generation pipeline:
// 1. buildPackageModel produces a valid PackageModel from real claim data
// 2. generatePackageHtml produces valid HTML with all required sections
// 3. Package handles missing/null/empty data gracefully (never crashes)
// 4. Supplement packages differ from claim packages
// 5. Evidence items are properly categorized
// 6. Missing information is honestly labeled
// 7. Discrepancies are detected
// 8. Findings are included with confidence
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { buildPackageModel, type PackageBuildInput } from "./package-types";
import { generatePackageHtml } from "./package-html";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FULL_CLAIM = {
  _id: "c1",
  claimNumber: "GAP-26-51847",
  customer: "NPP Roofing & Restoration",
  property: "123 Maple Street",
  carrier: "StateFarm",
  policy: "SF-2026-88421",
  adjuster: "Jane Smith",
  dateOfLoss: 1_700_000_000_000,
  causeOfLoss: "Water damage from roof failure",
  status: "opened",
  estimateAmount: 25000,
  estimateLineItemCount: 12,
  invoicedAmount: 28000,
  paymentAmount: 10000,
  approvedAmount: 22000,
  deductible: 2000,
  expectedScope: ["Roof repair", "Drywall replacement", "Flooring"],
  actualScope: ["Roof repair", "Drywall replacement"],
  evidenceSummary: ["estimate", "invoice", "photos"],
  provenance: "Created from ingested archive",
  confidence: 0.85,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_001_000_000,
};

const FINDINGS = [
  {
    _id: "f1",
    findingKey: "claim:c1:potential_underpayment",
    title: "Potential underpayment",
    category: "potential_underpayment",
    description: "The estimate exceeds the payment received.",
    confidence: 0.82,
    estimatedAmount: 15000,
    evidence: ["Estimate document", "Payment record"],
    limitation: "Requires carrier statement verification.",
    recommendedNextStep: "Request carrier payment breakdown.",
    status: "open",
  },
  {
    _id: "f2",
    findingKey: "claim:c1:missing_scope",
    title: "Missing scope item",
    category: "missing_scope",
    description: "Flooring replacement is documented but not priced.",
    confidence: 0.65,
    estimatedAmount: 3000,
    evidence: ["Scope document"],
    limitation: "May be covered under a different line item.",
    recommendedNextStep: "Review estimate line by line.",
    status: "open",
  },
  {
    _id: "f3",
    findingKey: "claim:c1:resolved",
    title: "Resolved finding",
    category: "documentation_gap",
    description: "This was addressed.",
    confidence: 0.9,
    evidence: [],
    limitation: "None.",
    recommendedNextStep: "None.",
    status: "resolved",
  },
];

const EVIDENCE_DOCS = [
  { _id: "d1", title: "Estimate_Xactimate.pdf", classification: "Estimate", createdAt: 1_700_000_100_000 },
  { _id: "d2", title: "Invoice_Final.pdf", classification: "Invoice", createdAt: 1_700_000_200_000 },
  { _id: "d3", title: "Photo_Evidence.zip", classification: "Photo Evidence", createdAt: 1_700_000_300_000 },
];

const SUPPLEMENTS = [
  {
    _id: "s1",
    reason: "Additional drying days",
    status: "draft",
    amount: 4000,
    justification: "Moisture readings exceeded standard drying timeline.",
  },
];

const TIMELINE = [
  { ts: 1_700_000_000_000, kind: "claim_created", label: "Claim created", source: "atlas" },
  { ts: 1_700_000_500_000, kind: "document", label: "Estimate uploaded", source: "source" },
  { ts: 1_700_001_000_000, kind: "finding", label: "Finding: underpayment", source: "atlas" },
];

const COMPLETENESS = {
  score: 0.65,
  complete: 7,
  total: 10,
  summary: "7 of 10 categories complete.",
  categories: [
    { key: "claimNumber", label: "Claim number", status: "verified", note: "On file" },
    { key: "evidence", label: "Evidence", status: "extracted", note: "3 docs" },
    { key: "financialState", label: "Financial", status: "conflicted", note: "Estimate vs invoice differ" },
    { key: "freshness", label: "Freshness", status: "stale", note: "No activity for 30+ days" },
    { key: "missing_field", label: "Missing item", status: "missing", note: "Not available" },
  ],
};

const RECONCILIATION = {
  estimate: 25000,
  paid: 10000,
  outstanding: 12000,
  notes: ["The estimate ($25,000) and invoiced amount ($28,000) differ."],
};

// ---------------------------------------------------------------------------
// buildPackageModel tests
// ---------------------------------------------------------------------------

describe("buildPackageModel", () => {
  const baseInput: PackageBuildInput = {
    claim: FULL_CLAIM,
    findings: FINDINGS,
    evidenceDocs: EVIDENCE_DOCS,
    supplements: SUPPLEMENTS,
    completeness: COMPLETENESS,
    reconciliation: RECONCILIATION,
    timeline: TIMELINE,
  };

  it("produces a valid claim package model", () => {
    const pkg = buildPackageModel(baseInput);

    expect(pkg.packageType).toBe("claim");
    expect(pkg.status).toBe("draft");
    expect(pkg.claimId).toBe("c1");
    expect(pkg.coverPage.claimNumber).toBe("GAP-26-51847");
    expect(pkg.coverPage.customer).toBe("NPP Roofing & Restoration");
    expect(pkg.coverPage.property).toBe("123 Maple Street");
    expect(pkg.coverPage.carrier).toBe("StateFarm");
    expect(pkg.coverPage.packageType).toBe("claim");
  });

  it("includes all claim information fields", () => {
    const pkg = buildPackageModel(baseInput);

    expect(pkg.claimInformation.length).toBeGreaterThanOrEqual(10);
    const claimNum = pkg.claimInformation.find((f) => f.label === "Claim Number");
    expect(claimNum?.value).toBe("GAP-26-51847");
    expect(claimNum?.state).toBe("verified");
  });

  it("includes only non-resolved findings", () => {
    const pkg = buildPackageModel(baseInput);

    expect(pkg.scopeFindings.length).toBe(2);
    expect(pkg.scopeFindings.every((f) => f.status !== "resolved")).toBe(true);
    expect(pkg.scopeFindings.some((f) => f.title === "Potential underpayment")).toBe(true);
  });

  it("includes evidence items with classification", () => {
    const pkg = buildPackageModel(baseInput);

    expect(pkg.evidenceItems.length).toBe(3);
    expect(pkg.evidenceItems[0].title).toBe("Estimate_Xactimate.pdf");
    expect(pkg.evidenceItems[0].classification).toBe("Estimate");
  });

  it("detects estimate vs invoice discrepancy", () => {
    const pkg = buildPackageModel(baseInput);

    expect(pkg.discrepancies.length).toBeGreaterThanOrEqual(1);
    const estVsInv = pkg.discrepancies.find((d) => d.field === "Estimate vs Invoice");
    expect(estVsInv).toBeDefined();
  });

  it("includes missing information from completeness", () => {
    const pkg = buildPackageModel(baseInput);

    // Missing field from completeness + the financial state conflict
    expect(pkg.missingInformation.length).toBeGreaterThanOrEqual(1);
  });

  it("generates a deterministic executive summary", () => {
    const pkg = buildPackageModel(baseInput);

    expect(pkg.executiveSummary).toContain("GAP-26-51847");
    expect(pkg.executiveSummary).toContain("NPP Roofing");
    expect(pkg.executiveSummary).toContain("supporting document");
  });

  it("includes timeline events", () => {
    const pkg = buildPackageModel(baseInput);

    expect(pkg.claimTimeline.length).toBeGreaterThanOrEqual(3);
    expect(pkg.claimTimeline.some((e) => e.event === "Claim created")).toBe(true);
  });

  it("includes reconciliation notes", () => {
    const pkg = buildPackageModel(baseInput);

    expect(pkg.reconciliationNotes.length).toBeGreaterThan(0);
    expect(pkg.reconciliationNotes[0]).toContain("estimate");
  });

  it("always has a disclaimer", () => {
    const pkg = buildPackageModel(baseInput);

    expect(pkg.disclaimer).toContain("documented sources");
    expect(pkg.disclaimer).toContain("human review");
  });
});

// ---------------------------------------------------------------------------
// Supplement package tests
// ---------------------------------------------------------------------------

describe("buildPackageModel (supplement)", () => {
  it("produces a supplement package when a recommendation is provided", () => {
    const pkg = buildPackageModel({
      claim: FULL_CLAIM,
      findings: FINDINGS,
      evidenceDocs: EVIDENCE_DOCS,
      supplements: SUPPLEMENTS,
      recommendation: {
        _id: "rec1",
        title: "Additional drying equipment",
        summary: "Request 3 additional drying days",
        reason: "Moisture readings exceeded standard timeline",
        expectedImpact: "$4,000 recovery",
        confidence: 0.78,
        evidence: [
          { title: "Moisture Report", kind: "document", snippet: " readings above threshold", relevance: 0.9 },
        ],
      },
    });

    expect(pkg.packageType).toBe("supplement");
    expect(pkg.coverPage.packageType).toBe("supplement");
    expect(pkg.coverPage.packageName).toContain("Supplement");
    expect(pkg.whyThisScopeIsRequired).toContain("Moisture readings");
    expect(pkg.requestedAdditionalScope.length).toBeGreaterThan(0);
  });

  it("uses supplementaryNarrative when provided", () => {
    const pkg = buildPackageModel({
      claim: FULL_CLAIM,
      findings: [],
      evidenceDocs: [],
      supplements: [],
      recommendation: {
        _id: "rec2",
        title: "Test",
        summary: "Test supplement",
        reason: "Original reason",
      },
      supplementaryNarrative: "Custom narrative for this supplement.",
    });

    expect(pkg.whyThisScopeIsRequired).toBe("Custom narrative for this supplement.");
  });
});

// ---------------------------------------------------------------------------
// Supplement from recommendation only (no real claim)
// ---------------------------------------------------------------------------

describe("buildPackageModel (supplement from recommendation only)", () => {
  it("builds a valid supplement package with only a recommendation", () => {
    const pkg = buildPackageModel({
      claim: {
        _id: "rec-only",
        claimNumber: "Demo Supplement Opportunity",
        customer: null,
        property: null,
        carrier: null,
        policy: null,
        status: "pending",
      },
      findings: [],
      evidenceDocs: [],
      supplements: [],
      recommendation: {
        _id: "rec-100",
        title: "Additional drying scope",
        summary: "3 additional drying days required due to moisture readings",
        reason: "Moisture readings exceeded standard drying timeline by 48 hours",
        expectedImpact: "$4,200 additional recovery",
        confidence: 0.82,
        evidence: [
          { title: "Moisture Report.pdf", kind: "document", snippet: "readings at 28% vs 16% threshold", relevance: 0.92 },
          { title: "Drying Log.pdf", kind: "document", snippet: "Day 5 moisture still elevated", relevance: 0.85 },
        ],
      },
    });

    expect(pkg.packageType).toBe("supplement");
    expect(pkg.coverPage.packageType).toBe("supplement");
    expect(pkg.coverPage.packageName).toContain("Supplement");
    expect(pkg.recommendationId).toBe("rec-100");

    expect(pkg.requestedAdditionalScope.length).toBeGreaterThan(0);
    expect(pkg.requestedAdditionalScope.some((s) => s.includes("3 additional drying days"))).toBe(true);
    expect(pkg.whyThisScopeIsRequired).toContain("Moisture readings exceeded");
    expect(pkg.coverPage.claimNumber).toBe("Demo Supplement Opportunity");
    expect(pkg.coverPage.customer).toBeNull();
  });

  it("generates a valid HTML supplement package from recommendation only", () => {
    const pkg = buildPackageModel({
      claim: { _id: "rec-only-2" },
      findings: [],
      evidenceDocs: [],
      supplements: [],
      recommendation: {
        _id: "rec-200",
        title: "Scope discrepancy recovery",
        summary: "Additional roofing scope identified",
        reason: "Contractor estimate exceeds carrier estimate by $8,450",
        expectedImpact: "$8,450 potential recovery",
        evidence: [
          { title: "Contractor Estimate.pdf", kind: "document", relevance: 0.95 },
          { title: "Carrier Estimate.pdf", kind: "document", relevance: 0.90 },
        ],
      },
    });

    const html = generatePackageHtml(pkg);

    expect(html).toContain("Supplement Package");
    expect(html).toContain("Requested Additional Scope");
    expect(html).toContain("Why This Scope Is Required");
    expect(html).toContain("Scope discrepancy recovery");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
  });
});

// ---------------------------------------------------------------------------
// Supplement with findings
// ---------------------------------------------------------------------------

describe("buildPackageModel (supplement with findings)", () => {
  it("includes supplement-specific sections alongside findings", () => {
    const pkg = buildPackageModel({
      claim: {
        _id: "c-sup",
        claimNumber: "SUP-2026-100",
        customer: "Test Corp",
        property: "456 Industrial Blvd",
        carrier: "Nationwide",
        estimateAmount: 35000,
        paymentAmount: 22000,
        invoicedAmount: 35000,
      },
      findings: [
        {
          _id: "f-sup-1",
          title: "Scope discrepancy: roofing",
          category: "potential_underpayment",
          description: "Contractor scope exceeds carrier scope by 8 squares",
          confidence: 0.88,
          estimatedAmount: 8450,
          evidence: ["Contractor Estimate.pdf", "Carrier Estimate.pdf", "Inspection Report.pdf"],
          limitation: "Carrier scope may include items not yet documented.",
          recommendedNextStep: "Prepare supplement with contractor documentation.",
          status: "open",
        },
      ],
      evidenceDocs: [
        { _id: "d1", title: "Contractor Estimate.pdf", classification: "Estimate", createdAt: 1_700_000_100_000 },
        { _id: "d2", title: "Carrier Estimate.pdf", classification: "Estimate", createdAt: 1_700_000_200_000 },
        { _id: "d3", title: "Inspection Report.pdf", classification: "Inspection", createdAt: 1_700_000_300_000 },
      ],
      supplements: [],
      recommendation: {
        _id: "rec-sup-1",
        title: "Roofing scope supplement",
        summary: "Recover additional $8,450 for 8 extra roofing squares",
        reason: "Contractor documented 32 squares vs carrier's 24 squares",
        expectedImpact: "$8,450",
        confidence: 0.88,
      },
    });

    expect(pkg.packageType).toBe("supplement");
    expect(pkg.scopeFindings.length).toBe(1);
    expect(pkg.scopeFindings[0].estimatedAmount).toBe(8450);
    expect(pkg.scopeFindings[0].evidence.length).toBe(3);
    expect(pkg.evidenceItems.length).toBe(3);
    expect(pkg.requestedAdditionalScope.some((s) => s.includes("$8,450"))).toBe(true);
    expect(pkg.whyThisScopeIsRequired).toContain("32 squares vs carrier's 24");
  });
});

// ---------------------------------------------------------------------------
// Evidence linked to findings
// ---------------------------------------------------------------------------

describe("buildPackageModel (evidence-finding linkage)", () => {
  it("links evidence items to the findings they support", () => {
    const pkg = buildPackageModel({
      claim: { _id: "c-link", claimNumber: "LINK-001" },
      findings: [
        {
          _id: "f-link-1",
          title: "Potential underpayment",
          category: "potential_underpayment",
          description: "Estimate exceeds payment",
          confidence: 0.82,
          estimatedAmount: 15000,
          evidence: ["Estimate_Xactimate.pdf", "Payment Record.pdf"],
          limitation: "Requires carrier verification",
          recommendedNextStep: "Request payment breakdown",
          status: "open",
        },
      ],
      evidenceDocs: [
        { _id: "d-link-1", title: "Estimate_Xactimate.pdf", classification: "Estimate" },
        { _id: "d-link-2", title: "Payment Record.pdf", classification: "Payment" },
        { _id: "d-link-3", title: "Photos.zip", classification: "Photos" },
      ],
      supplements: [],
    });

    const estimateDoc = pkg.evidenceItems.find((e) => e.title === "Estimate_Xactimate.pdf");
    expect(estimateDoc?.supportsFinding).toBe("Potential underpayment");

    const paymentDoc = pkg.evidenceItems.find((e) => e.title === "Payment Record.pdf");
    expect(paymentDoc?.supportsFinding).toBe("Potential underpayment");

    const photosDoc = pkg.evidenceItems.find((e) => e.title === "Photos.zip");
    expect(photosDoc?.supportsFinding).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Edge cases: missing data
// ---------------------------------------------------------------------------

describe("buildPackageModel (edge cases)", () => {
  it("handles a completely sparse claim", () => {
    const pkg = buildPackageModel({
      claim: { _id: "empty" },
      findings: [],
      evidenceDocs: [],
      supplements: [],
    });

    expect(pkg.packageType).toBe("claim");
    expect(pkg.claimInformation.length).toBeGreaterThan(0);
    const nonStatusFields = pkg.claimInformation.filter((f) => f.label !== "Status");
    expect(nonStatusFields.every((f) => f.state === "missing")).toBe(true);
    expect(pkg.evidenceItems.length).toBe(0);
    expect(pkg.scopeFindings.length).toBe(0);
    expect(pkg.missingInformation.length).toBeGreaterThan(0);
    expect(pkg.executiveSummary).toBeTruthy();
  });

  it("handles empty arrays gracefully", () => {
    const pkg = buildPackageModel({
      claim: FULL_CLAIM,
      findings: [],
      evidenceDocs: [],
      supplements: [],
    });

    expect(pkg.scopeFindings.length).toBe(0);
    expect(pkg.evidenceItems.length).toBe(0);
    expect(pkg.claimTimeline.length).toBeGreaterThanOrEqual(1);
  });

  it("handles no recommendation for supplement gracefully", () => {
    const pkg = buildPackageModel({
      claim: FULL_CLAIM,
      findings: [],
      evidenceDocs: [],
      supplements: [],
      recommendation: undefined,
    });

    expect(pkg.packageType).toBe("claim");
    expect(pkg.whyThisScopeIsRequired).toBe("");
  });
});

// ---------------------------------------------------------------------------
// generatePackageHtml tests
// ---------------------------------------------------------------------------

describe("generatePackageHtml", () => {
  it("generates valid HTML with all required sections", () => {
    const pkg = buildPackageModel({
      claim: FULL_CLAIM,
      findings: FINDINGS,
      evidenceDocs: EVIDENCE_DOCS,
      supplements: SUPPLEMENTS,
      completeness: COMPLETENESS,
      reconciliation: RECONCILIATION,
      timeline: TIMELINE,
    });

    const html = generatePackageHtml(pkg);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("GAP-26-51847");
    expect(html).toContain("NPP Roofing");
    expect(html).toContain("Executive Summary");
    expect(html).toContain("Claim Information");
    expect(html).toContain("Findings");
    expect(html).toContain("Supporting Evidence Index");
    expect(html).toContain("Claim Timeline");
    expect(html).toContain("Print / Save as PDF");
    expect(html).toContain("Atlas Insurance Intelligence");
  });

  it("generates supplement-specific sections", () => {
    const pkg = buildPackageModel({
      claim: FULL_CLAIM,
      findings: FINDINGS,
      evidenceDocs: EVIDENCE_DOCS,
      supplements: SUPPLEMENTS,
      recommendation: {
        _id: "rec1",
        title: "Additional drying",
        summary: "Request 3 more days",
        reason: "Moisture readings high",
      },
    });

    const html = generatePackageHtml(pkg);

    expect(html).toContain("Supplement Package");
    expect(html).toContain("Requested Additional Scope");
    expect(html).toContain("Why This Scope Is Required");
  });

  it("includes missing information section when missing", () => {
    const pkg = buildPackageModel({
      claim: { _id: "sparse" },
      findings: [],
      evidenceDocs: [],
      supplements: [],
    });

    const html = generatePackageHtml(pkg);

    expect(html).toContain("Missing Information");
    expect(html).toContain("Missing");
  });

  it("includes discrepancy section when discrepancies exist", () => {
    const pkg = buildPackageModel({
      claim: FULL_CLAIM,
      findings: [],
      evidenceDocs: [],
      supplements: [],
    });

    const html = generatePackageHtml(pkg);

    expect(html).toContain("Discrepancies");
  });

  it("includes 'Why Atlas Included This' section", () => {
    const pkg = buildPackageModel({
      claim: FULL_CLAIM,
      findings: FINDINGS,
      evidenceDocs: EVIDENCE_DOCS,
      supplements: [],
    });

    const html = generatePackageHtml(pkg);

    expect(html).toContain("Why Atlas Included This");
  });

  it("generates self-contained HTML (no external resources)", () => {
    const pkg = buildPackageModel({
      claim: FULL_CLAIM,
      findings: [],
      evidenceDocs: [],
      supplements: [],
    });

    const html = generatePackageHtml(pkg);

    expect(html).not.toContain("<link rel=\"stylesheet\"");
    expect(html).not.toContain("<script src=");
    expect(html).toContain("<style>");
  });

  it("renders timeline events in the HTML", () => {
    const pkg = buildPackageModel({
      claim: { _id: "c-tl", claimNumber: "TL-001", createdAt: 1_700_000_000_000 },
      findings: [],
      evidenceDocs: [],
      supplements: [],
      timeline: [
        { ts: 1_700_000_000_000, label: "Claim created", source: "atlas" },
        { ts: 1_700_000_500_000, label: "Estimate uploaded", source: "source" },
        { ts: 1_700_001_000_000, label: "Finding identified", source: "atlas" },
      ],
    });

    const html = generatePackageHtml(pkg);

    expect(html).toContain("Claim Timeline");
    expect(html).toContain("Claim created");
    expect(html).toContain("Estimate uploaded");
    expect(html).toContain("Finding identified");
  });

  it("renders reconciliation notes in the HTML", () => {
    const pkg = buildPackageModel({
      claim: { _id: "c-rec", claimNumber: "REC-001" },
      findings: [],
      evidenceDocs: [],
      supplements: [],
      reconciliation: {
        estimate: 25000,
        paid: 10000,
        outstanding: 15000,
        notes: ["Estimate and invoiced amounts differ by $3,000"],
      },
    });

    const html = generatePackageHtml(pkg);

    expect(html).toContain("Financial Reconciliation");
    expect(html).toContain("Estimate and invoiced amounts differ");
  });

  it("renders finding evidence lists in the HTML", () => {
    const pkg = buildPackageModel({
      claim: { _id: "c-ev", claimNumber: "EV-001" },
      findings: [
        {
          _id: "f-ev-1",
          title: "Scope gap",
          category: "missing_scope",
          description: "Flooring not priced",
          confidence: 0.72,
          estimatedAmount: 3000,
          evidence: ["Flooring Estimate.pdf", "Scope Document.pdf"],
          limitation: "May be under different line item",
          recommendedNextStep: "Review estimate line by line",
          status: "open",
        },
      ],
      evidenceDocs: [],
      supplements: [],
    });

    const html = generatePackageHtml(pkg);

    expect(html).toContain("Flooring Estimate.pdf");
    expect(html).toContain("Scope Document.pdf");
  });
});
