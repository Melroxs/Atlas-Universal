/**
 * Phase 14 §17 — demo dataset tests.
 *
 * The fixture must be deterministic, self-consistent and unmistakably marked
 * as synthetic. Findings are produced by the SAME pure analyzers the product
 * uses, so these tests pin what the dataset demonstrates without hand-writing
 * any "expected finding" that the analyzers wouldn't actually produce.
 */
import { describe, expect, it } from "vitest";
import {
  DEMO_CLAIM_COUNT,
  DEMO_PROVENANCE,
  buildDemoRestorationDataset,
  demoClaimSnapshot,
  summarizeDemoDataset,
} from "./demoData";
import {
  analyzeClaimCompleteness,
  buildClaimFindings,
  reconcileClaim,
} from "./claims";

const ANCHOR = Date.UTC(2026, 0, 15); // fixed — no wall-clock dependence

describe("buildDemoRestorationDataset — determinism", () => {
  it("produces the identical dataset for the same anchor", () => {
    expect(buildDemoRestorationDataset(ANCHOR)).toEqual(
      buildDemoRestorationDataset(ANCHOR),
    );
  });

  it("has exactly the documented claim count", () => {
    expect(buildDemoRestorationDataset(ANCHOR)).toHaveLength(DEMO_CLAIM_COUNT);
  });

  it("is a restoration dataset — every claim is identifiable", () => {
    for (const spec of buildDemoRestorationDataset(ANCHOR)) {
      expect(spec.customer.length).toBeGreaterThan(0);
      expect(spec.property.length).toBeGreaterThan(0);
      expect(spec.claimNumber.length).toBeGreaterThan(0);
      expect(spec.carrier.length).toBeGreaterThan(0);
      expect(spec.causeOfLoss.length).toBeGreaterThan(0);
    }
  });

  it("never mixes financial fields with missing markers", () => {
    for (const spec of buildDemoRestorationDataset(ANCHOR)) {
      if (spec.estimateAmount !== undefined) {
        expect(spec.estimateAmount).toBeGreaterThan(0);
      }
      if (spec.invoicedAmount !== undefined) {
        expect(spec.invoicedAmount).toBeGreaterThan(0);
      }
      if (spec.paymentAmount !== undefined) {
        expect(spec.paymentAmount).toBeGreaterThan(0);
      }
    }
  });
});

describe("summarizeDemoDataset — what the fixture demonstrates", () => {
  // Staleness is anchor-relative (updatedDaysAgo vs the 30-day rule), so the
  // OUTCOME below is deterministic even though the anchor is “now”.
  const report = summarizeDemoDataset(Date.now());

  it("flags exactly the claim that has had no activity for 30+ days", () => {
    expect(report.stale).toEqual(["Chen"]);
  });

  it("flags conflicted financial records (payment above invoice / invoice above approved)", () => {
    expect(report.conflicted).toContain("Peterson");
  });

  it("flags claims with no linked evidence as missing evidence", () => {
    expect(report.missingEvidence).toContain("Chen");
  });

  it("identifies supplement opportunities from documented-but-unpriced scope", () => {
    expect(report.supplementOpportunities).toContain("Johnson");
    expect(report.supplementOpportunities).toContain("Martinez");
  });

  it("computes a potentially outstanding total only from actual numbers", () => {
    expect(report.outstandingTotal).toBeGreaterThan(0);
    expect(Number.isFinite(report.outstandingTotal)).toBe(true);
  });
});

describe("demo data is never fabricated — analyzers agree with the fixture", () => {
  it("Johnson: invoice above approved estimate is CONFLICTED, never silently resolved", () => {
    const spec = buildDemoRestorationDataset(ANCHOR).find((s) => s.customer === "Johnson")!;
    const snap = demoClaimSnapshot(spec, ANCHOR);
    const c = analyzeClaimCompleteness(snap);
    expect(c.categories.find((x) => x.key === "financialState")?.status).toBe("conflicted");
    const rec = reconcileClaim(snap, []);
    expect(rec.hasDiscrepancy).toBe(true);
    expect(rec.notes.join(" ")).toMatch(/estimate.*invoiced amount.*differ/i);
  });

  it("Johnson: documented scope not in the estimate becomes an evidence-labeled finding", () => {
    const spec = buildDemoRestorationDataset(ANCHOR).find((s) => s.customer === "Johnson")!;
    const snap = demoClaimSnapshot(spec, ANCHOR);
    const findings = buildClaimFindings(snap);
    const overlooked = findings.find((f) => f.category === "overlooked_line_item");
    expect(overlooked).toBeTruthy();
    expect(overlooked?.description).toMatch(/Mold remediation/);
    expect(overlooked?.limitation.length).toBeGreaterThan(10);
    expect(overlooked?.evidence?.length ?? 0).toBeGreaterThan(0);
  });

  it("Peterson: payment above invoiced is CONFLICTED, with the source values shown", () => {
    const spec = buildDemoRestorationDataset(ANCHOR).find((s) => s.customer === "Peterson")!;
    expect(spec.invoicedAmount).toBe(22000);
    expect(spec.paymentAmount).toBe(24500);
    const snap = demoClaimSnapshot(spec, ANCHOR);
    const c = analyzeClaimCompleteness(snap);
    // The payment-above-invoice conflict is labeled by completeness analysis —
    // never silently resolved.
    expect(c.categories.find((x) => x.key === "financialState")?.status).toBe("conflicted");
    const rec = reconcileClaim(snap, []);
    expect(rec.notes.join(" ")).toContain("$24,500");
  });

  it("Chen: missing invoices/evidence are flagged; outstanding derives only from the estimate baseline", () => {
    const spec = buildDemoRestorationDataset(ANCHOR).find((s) => s.customer === "Chen")!;
    const snap = demoClaimSnapshot(spec, ANCHOR);
    const c = analyzeClaimCompleteness(snap);
    const statuses = Object.fromEntries(c.categories.map((x) => [x.key, x.status]));
    expect(statuses.invoices).toBe("missing");
    expect(statuses.evidence).toBe("missing");
    const rec = reconcileClaim(snap, []);
    // Honest derivation: with no payments recorded, the potentially
    // outstanding figure IS the estimate — a real number, not an invention.
    expect(rec.outstanding).toBe(spec.estimateAmount);
    expect(rec.notes.join(" ")).toContain("$9,200 remains potentially outstanding");
  });

  it("every claim carries the unmistakable synthetic provenance", () => {
    for (const spec of buildDemoRestorationDataset(ANCHOR)) {
      expect(spec.demonstrates.length).toBeGreaterThan(0);
      expect(DEMO_PROVENANCE).toMatch(/SYNTHETIC DEMO DATA/);
      expect(DEMO_PROVENANCE).toMatch(/not real tenant data/);
    }
  });
});
