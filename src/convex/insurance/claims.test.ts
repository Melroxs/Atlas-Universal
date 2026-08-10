import { describe, expect, it } from "vitest";
import {
  CLAIM_STATUSES,
  analyzeClaimCompleteness,
  buildClaimFindings,
  buildClaimPackage,
  buildClaimTimeline,
  buildSupplementDocument,
  pipelineIndexFor,
  reconcileClaim,
} from "./claims";

const CLAIM_STATUS_COUNT = CLAIM_STATUSES.length;

describe("analyzeClaimCompleteness", () => {
  it("never invents a percentage — 0 of 9 for an empty claim", () => {
    const c = analyzeClaimCompleteness({});
    expect(c.total).toBe(9);
    expect(c.complete).toBe(0);
    expect(c.score).toBe(0);
    expect(c.summary).toContain("0 of 9");
    expect(c.summary).toContain("9 require attention");
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
      invoicedAmount: 22000,
      provenance: "Confirmed from Carrier estimate.pdf",
    });
    expect(c.total).toBe(9);
    expect(c.complete).toBe(9);
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

describe("buildClaimPackage (Phase 12)", () => {
  const base = {
    _id: "c1",
    claimNumber: "CLM-1",
    customer: "Jane Doe",
    estimateAmount: 25000,
    invoicedAmount: 22000,
    paymentAmount: 5000,
  };

  it("labels source-backed fields verified and empty fields missing", () => {
    const p = buildClaimPackage(base);
    expect(p.fields.find((f) => f.key === "claimNumber")?.state).toBe("verified");
    expect(p.fields.find((f) => f.key === "estimate")?.state).toBe("verified");
    expect(p.fields.find((f) => f.key === "carrier")?.state).toBe("missing");
    expect(p.fields.find((f) => f.key === "adjuster")?.state).toBe("missing");
  });

  it("labels the open balance as derived from verified numbers", () => {
    const p = buildClaimPackage({ estimateAmount: 10000, paymentAmount: 4000 });
    const outstanding = p.fields.find((f) => f.key === "outstanding");
    expect(outstanding?.state).toBe("derived");
    expect(outstanding?.value).toBe("$6,000");
  });

  it("uses an explicitly recorded open balance as verified", () => {
    const p = buildClaimPackage({ openBalance: 1234 });
    expect(p.fields.find((f) => f.key === "outstanding")?.state).toBe("verified");
  });

  it("flags estimate vs invoice disagreement as conflicting", () => {
    const p = buildClaimPackage(base);
    const f = p.fields.find((x) => x.key === "estimateVsInvoice");
    expect(f?.state).toBe("conflicting");
    expect(p.states.conflicting).toBe(1);
  });

  it("never presents a missing value as verified", () => {
    const p = buildClaimPackage({});
    expect(p.states.verified).toBe(0);
    expect(p.fields.filter((f) => f.state === "missing").length).toBeGreaterThan(0);
    // The open balance is always computable — derived, never verified.
    expect(p.fields.find((f) => f.key === "outstanding")?.state).toBe("derived");
  });
});

describe("buildClaimTimeline (Phase 12)", () => {
  const createdAt = 1_700_000_000_000;

  it("composes claim, finding, supplement and payment events in chronological order", () => {
    const tl = buildClaimTimeline(
      { _id: "c1", createdAt, paymentAmount: 5000, updatedAt: createdAt + 900_000 },
      [
        {
          reason: "Extra drying",
          createdAt: createdAt + 100_000,
          status: "approved",
          approvedAmount: 950,
          updatedAt: createdAt + 300_000,
        },
      ],
      [{ title: "Potential missing scope", createdAt: createdAt + 200_000 }],
    );
    expect(tl.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < tl.length; i++) {
      expect(tl[i].ts).toBeGreaterThanOrEqual(tl[i - 1].ts);
    }
  });

  it("labels Atlas-generated events distinctly from source events", () => {
    const tl = buildClaimTimeline({
      _id: "c1",
      createdAt,
      timeline: [
        { ts: createdAt - 1000, kind: "note", label: "Inspection completed", source: "source" },
      ],
    });
    expect(tl.find((e) => e.label === "Inspection completed")?.source).toBe("source");
    expect(tl.find((e) => e.kind === "claim_created")?.source).toBe("atlas");
  });

  it("dedupes identical events", () => {
    const tl = buildClaimTimeline({
      _id: "c1",
      createdAt,
      timeline: [
        { ts: createdAt, kind: "note", label: "Same", source: "source" },
        { ts: createdAt, kind: "note", label: "Same", source: "source" },
      ],
    });
    expect(tl.filter((e) => e.label === "Same").length).toBe(1);
  });

  it("returns empty when no events exist", () => {
    expect(buildClaimTimeline({})).toEqual([]);
  });
});

describe("buildSupplementDocument (Phase 12)", () => {
  it("produces the required structured sections", () => {
    const doc = buildSupplementDocument(
      {
        claimNumber: "CLM-9",
        customer: "A",
        property: "B",
        carrier: "C",
        dateOfLoss: 1_700_000_000_000,
        expectedScope: ["a"],
        actualScope: ["a", "b"],
      },
      {
        reason: "Hidden damage",
        amount: 1200,
        evidence: ["Photos"],
        affectedLineItems: ["Drywall"],
        requestedItems: ["Drywall replacement"],
        justification: "Found during demo",
        status: "draft",
        createdAt: 1_700_000_000_000,
      },
    );
    const titles = doc.sections.map((s) => s.title);
    for (const t of [
      "Claim information",
      "Reason for supplement",
      "Original scope",
      "Revised scope / items requested",
      "Supporting evidence",
      "Affected line items",
      "Justification",
      "Requested amount",
      "Limitations",
      "Reviewer notes",
    ]) {
      expect(titles).toContain(t);
    }
    expect(doc.requestedAmount).toBe(1200);
  });

  it("never invents policy language or hides missing evidence", () => {
    const doc = buildSupplementDocument({}, { reason: "r" });
    const evidence = doc.sections.find((s) => s.title === "Supporting evidence");
    expect(evidence?.body.join(" ")).toContain("No supporting evidence");
    const lim = doc.sections.find((s) => s.title === "Limitations");
    const limText = lim?.body.join(" ").toLowerCase() ?? "";
    // Atlas interpretation is explicitly NOT presented as policy or carrier law.
    expect(limText).toContain("policy language");
    expect(limText).not.toContain("guaranteed");
    expect(doc.disclaimer).toContain("not insurer policy");
  });
});

describe("reconcileClaim — Phase 12 depth", () => {
  it("flags estimate vs invoice mismatches", () => {
    const r = reconcileClaim(
      { estimateAmount: 25000, invoicedAmount: 22000, paymentAmount: 22000 },
      [],
    );
    expect(r.notes.join(" ")).toContain("differ");
    expect(r.hasDiscrepancy).toBe(true);
  });

  it("flags the unpaid portion of an invoice", () => {
    const r = reconcileClaim({ invoicedAmount: 10000, paymentAmount: 4000 }, []);
    expect(r.notes.join(" ")).toContain("$6,000 of the invoiced total remains unpaid");
    expect(r.hasDiscrepancy).toBe(true);
  });
});
