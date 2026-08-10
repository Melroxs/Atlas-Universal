import { describe, expect, it } from "vitest";
import {
  CLAIM_STATUSES,
  analyzeClaimCompleteness,
  buildClaimFindings,
  pipelineIndexFor,
  reconcileClaim,
} from "./claims";

const CLAIM_STATUS_COUNT = CLAIM_STATUSES.length;

describe("analyzeClaimCompleteness", () => {
  it("never invents a percentage — 0 of 8 for an empty claim", () => {
    const c = analyzeClaimCompleteness({});
    expect(c.total).toBe(8);
    expect(c.complete).toBe(0);
    expect(c.score).toBe(0);
    expect(c.summary).toContain("0 of 8");
    expect(c.summary).toContain("8 require attention");
  });

  it("counts verified and extracted fields as complete", () => {
    const c = analyzeClaimCompleteness({
      claimNumber: "CLM-12345",
      dateOfLoss: 1700000000000,
      property: "123 Main St",
      causeOfLoss: "Water",
      customer: "Sarah Johnson",
      carrier: "StateFarm",
      estimateAmount: 25000,
      estimateLineItemCount: 12,
      evidenceSummary: ["estimate", "photos"],
      provenance: "Confirmed from Carrier estimate.pdf",
    });
    expect(c.total).toBe(8);
    expect(c.complete).toBe(8);
    expect(c.score).toBe(1);
    expect(c.summary).not.toContain("require attention");
  });

  it("labels confirmed provenance as verified and low confidence as needs review", () => {
    const verified = analyzeClaimCompleteness({
      claimNumber: "CLM-1",
      provenance: "User-entered via workspace",
    });
    expect(verified.categories.find((x) => x.key === "claimNumber")?.status).toBe("verified");

    const review = analyzeClaimCompleteness({
      claimNumber: "CLM-1",
      confidence: 0.3,
      provenance: "extracted from a scan",
    });
    expect(review.categories.find((x) => x.key === "claimNumber")?.status).toBe("needs_review");
  });

  it("flags missing invoices and coverage separately", () => {
    const c = analyzeClaimCompleteness({ customer: "A", property: "B" });
    const statuses = Object.fromEntries(c.categories.map((x) => [x.key, x.status]));
    expect(statuses.invoices).toBe("missing");
    expect(statuses.coverage).toBe("missing");
    expect(statuses.claimNumber).toBe("missing");
  });
});

describe("buildClaimFindings", () => {
  it("flags scope items documented but not priced into the estimate", () => {
    const f = buildClaimFindings({
      _id: "c1",
      scopeItems: [
        { name: "Demo", inEstimate: true },
        { name: "Drywall", inEstimate: false },
      ],
    });
    const hit = f.find((x) => x.category === "overlooked_line_item");
    expect(hit).toBeTruthy();
    expect(hit?.title).toContain("Potential overlooked line item");
    expect(hit?.description).toContain("Drywall");
    expect(hit?.limitation.length).toBeGreaterThan(10);
  });

  it("flags potential underpayment with a computed amount and honest limitation", () => {
    const f = buildClaimFindings({
      _id: "c1",
      estimateAmount: 25000,
      paymentAmount: 18000,
      evidenceSummary: [],
      actualScope: ["demo", "drywall"],
    });
    const hit = f.find((x) => x.category === "potential_underpayment");
    expect(hit).toBeTruthy();
    expect(hit?.estimatedAmount).toBe(7000);
    expect(hit?.evidence.length).toBeGreaterThan(0);
    expect(hit?.limitation.length).toBeGreaterThan(10);
  });

  it("every finding is labeled potential, carries evidence and a recommended next step", () => {
    const f = buildClaimFindings({
      _id: "c1",
      expectedScope: ["a"],
      actualScope: ["a", "b"],
      evidenceSummary: [],
      estimateAmount: 10000,
      paymentAmount: 5000,
    });
    expect(f.length).toBeGreaterThan(0);
    for (const x of f) {
      expect(x.title.toLowerCase()).not.toContain("guaranteed");
      expect(x.category).toBeTruthy();
      expect(x.evidence.length).toBeGreaterThan(0);
      expect(x.confidence).toBeGreaterThan(0);
      expect(x.confidence).toBeLessThan(1);
      expect(x.recommendedNextStep.length).toBeGreaterThan(10);
    }
  });
});

describe("reconcileClaim", () => {
  it("computes outstanding = approved - paid", () => {
    const r = reconcileClaim(
      { estimateAmount: 25000, paymentAmount: 4900 },
      [{ amount: 8400, approvedAmount: 5700, status: "approved" }],
    );
    expect(r.requested).toBe(8400);
    expect(r.approved).toBe(5700);
    expect(r.outstanding).toBe(800);
    expect(r.hasDiscrepancy).toBe(true);
    expect(r.notes.join(" ")).toContain("$8,400");
    expect(r.notes.join(" ")).toContain("$5,700");
    expect(r.notes.join(" ")).toContain("$800");
  });

  it("reports no discrepancy when paid equals approved", () => {
    const r = reconcileClaim(
      { estimateAmount: 10000, paymentAmount: 10000 },
      [{ amount: 0, approvedAmount: 10000, status: "approved" }],
    );
    expect(r.outstanding).toBe(0);
    expect(r.hasDiscrepancy).toBe(false);
  });

  it("uses the estimate as baseline when nothing is approved yet", () => {
    const r = reconcileClaim(
      { estimateAmount: 20000, paymentAmount: 12000 },
      [{ amount: 0, status: "draft" }],
    );
    expect(r.outstanding).toBe(8000);
  });
});

describe("pipelineIndexFor", () => {
  it("maps claim status to its stage index without ever exceeding the list", () => {
    expect(pipelineIndexFor("opened")).toBe(1);
    expect(pipelineIndexFor("closed")).toBe(CLAIM_STATUS_COUNT - 1);
    expect(pipelineIndexFor(undefined)).toBe(0);
    expect(pipelineIndexFor("bogus")).toBe(0);
  });
});

