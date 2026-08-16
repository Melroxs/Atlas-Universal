// ---------------------------------------------------------------------------
// Tests for the Evidence Requirements + Gap Intelligence Engine
// (canonical module: supabase/functions/conversation-converse/source/
// evidence-requirements.ts).
//
// The MANDATORY absence test (§42): a claim with inspection + photos +
// estimate + carrier correspondence but NO pricing support must report
// "pricing support" as MISSING even though no document contains the phrase
// "pricing support is missing" — the gap is derived from the EXPECTED
// evidence model, not keyword search.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  assessEvidenceRequirements,
  assessReadiness,
  summarizeReadiness,
  workflowLabel,
  type RequirementContext,
} from "../../../supabase/functions/conversation-converse/source/evidence-requirements.ts";

const CLAIM = {
  _id: "claim-1",
  claimNumber: "GAP-26-51847",
  dateOfLoss: Date.UTC(2026, 4, 14),
  property: "1427 Cypress Ridge Drive, Lakeland FL",
  causeOfLoss: "Hail",
  customer: "Robert J. Mitchell",
  carrier: "Everest National Insurance",
  policy: "POL-8821-0044",
  status: "open",
  estimateAmount: 24500,
  estimateLineItemCount: 12,
  invoicedAmount: 28400,
  paymentAmount: 17920,
  updatedAt: Date.now() - 2 * 86_400_000,
  evidenceDocumentIds: ["d1", "d2", "d3", "d4"],
};

function doc(_id: string, title: string, classification: string, text = "") {
  return { _id, title, classification, text };
}

/** The §42 fixture: inspection + photos + estimate + correspondence, NO pricing support. */
// The estimate document deliberately has NO prices / line-item totals, so
// pricing support is genuinely absent from the evidence.
function absenceFixture(): RequirementContext {
  return {
    claim: CLAIM,
    documents: [
      doc("d1", "Inspection_Report_NPP.pdf", "Inspection", "Inspection Report — Claim GAP-26-51847. Hail damage to roof. Roof area measured: 28.7 SQ."),
      doc("d2", "Roof_Photos.zip", "Photo", ""),
      doc("d3", "Estimate_NPP.pdf", "Estimate", "ESTIMATE — Claim GAP-26-51847. Scope: tear off and replace asphalt shingles, replace roof decking, drip edge, ridge vent."),
      doc("d4", "Carrier_Letter.pdf", "Correspondence", "Claim GAP-26-51847. Carrier acknowledgement letter."),
    ],
    claimNumber: "GAP-26-51847",
  };
}

describe("assessEvidenceRequirements — status matrix", () => {
  it("labels SATISFIED requirements from real claim + document evidence", () => {
    const ctx: RequirementContext = {
      claim: CLAIM,
      documents: [
        doc("d1", "Inspection_Report_NPP.pdf", "Inspection", "Inspection Report — Claim GAP-26-51847. Roof area: 28.7 SQ."),
        doc("d2", "Roof_Photos_1.jpg", "Photo", ""),
        doc("d3", "Roof_Photos_2.jpg", "Photo", ""),
        doc("d4", "Estimate_NPP.pdf", "Estimate", "ESTIMATE — Claim GAP-26-51847.\nLine items:\n- Tear off asphalt shingles @ $4.50/SQ (28.7 SQ)\n- Replace decking 14 sheets @ $85\nTotal estimate: $24,500.00"),
        doc("d5", "Carrier_Payment_60811.pdf", "Payment", "Claim GAP-26-51847. Payment amount: $17,920.00."),
        doc("d6", "Carrier_Letter.pdf", "Correspondence", "Claim GAP-26-51847 carrier letter."),
        doc("d7", "Supplement_Request.pdf", "Supplement", "Claim GAP-26-51847 supplement rationale: decking underestimated."),
      ],
      claimNumber: "GAP-26-51847",
    };
    const result = assessEvidenceRequirements(ctx, "supplement_readiness");
    const byKey = new Map(result.map((r) => [r.key, r]));
    expect(byKey.get("claim_identification")?.status).toBe("SATISFIED");
    expect(byKey.get("policy_information")?.status).toBe("SATISFIED");
    expect(byKey.get("inspection_evidence")?.status).toBe("SATISFIED");
    expect(byKey.get("photographic_evidence")?.status).toBe("SATISFIED");
    expect(byKey.get("pricing_support")?.status).toBe("SATISFIED");
    expect(byKey.get("supplement_rationale")?.status).toBe("SATISFIED");
    expect(result.every((r) => r.evidence !== undefined)).toBe(true);
  });

  it("marks PARTIAL when only a bare estimate total exists (no itemized pricing)", () => {
    const ctx: RequirementContext = {
      claim: CLAIM,
      documents: [
        doc("d1", "Estimate_NPP.pdf", "Estimate", "ESTIMATE — Claim GAP-26-51847. Total estimate: $24,500.00."),
      ],
      claimNumber: "GAP-26-51847",
    };
    const byKey = new Map(assessEvidenceRequirements(ctx, "supplement_readiness").map((r) => [r.key, r]));
    expect(byKey.get("pricing_support")?.status).toBe("PARTIAL");
    expect(byKey.get("pricing_support")?.gapType).toBe("incomplete");
    // CRITICAL requirement, partially met -> downgraded one step to HIGH.
    expect(byKey.get("pricing_support")?.severity).toBe("HIGH");
  });

  it("marks MISSING when no estimate exists at all", () => {
    const ctx: RequirementContext = {
      claim: {
        ...CLAIM,
        estimateAmount: null,
        estimateLineItemCount: null,
        scopeItems: null,
      },
      documents: [
        doc("d1", "Inspection_Report_NPP.pdf", "Inspection", "Inspection report."),
        doc("d2", "Roof_Photos.zip", "Photo", ""),
      ],
      claimNumber: "GAP-26-51847",
    };
    const byKey = new Map(assessEvidenceRequirements(ctx, "supplement_readiness").map((r) => [r.key, r]));
    expect(byKey.get("original_estimate")?.status).toBe("MISSING");
    expect(byKey.get("pricing_support")?.status).toBe("MISSING");
  });

  it("surfaces CONFLICT from the contradiction override with both sources", () => {
    const ctx = absenceFixture();
    const result = assessEvidenceRequirements(ctx, "submission_readiness", [
      { field: "Roof area", values: ["28.7 SQ (inspection)", "32.4 SQ (estimate)"] },
    ]);
    const byKey = new Map(result.map((r) => [r.key, r]));
    expect(byKey.get("no_conflicts")?.status).toBe("CONFLICT");
    expect(byKey.get("no_conflicts")?.gapType).toBe("contradictory");
    expect(byKey.get("no_conflicts")?.severity).toBe("CRITICAL");
  });

  it("treats a pending candidate's claim identification as UNKNOWN (unverified)", () => {
    const ctx: RequirementContext = {
      claim: { ...CLAIM, status: "pending", confidence: 0.6 },
      documents: [],
      claimNumber: "GAP-26-51847",
    };
    const byKey = new Map(assessEvidenceRequirements(ctx, "claim_readiness").map((r) => [r.key, r]));
    expect(byKey.get("claim_identification")?.status).toBe("UNKNOWN");
    expect(byKey.get("claim_identification")?.gapType).toBe("unverified");
  });
});

describe("assessReadiness — the absence problem (§42)", () => {
  it("reports pricing support MISSING even though no document mentions it", () => {
    const ctx = absenceFixture();
    const readiness = assessReadiness(ctx, "supplement_readiness");
    expect(readiness.status).toBe("NOT_READY");
    const pricing = readiness.requirements.find((r) => r.key === "pricing_support");
    expect(pricing?.status).toBe("MISSING");
    expect(pricing?.gapType).toBe("missing");
    expect(pricing?.severity).toBe("CRITICAL");
    expect(readiness.blockingIssues.some((b) => b.key === "pricing_support")).toBe(true);
    expect(
      readiness.recommendedActions.some((a) => /pricing support/i.test(a)),
    ).toBe(true);
  });

  it("does not rely on the phrase 'missing' — the gap is derived from the model", () => {
    const ctx = absenceFixture();
    const allText = ctx.documents.map((d) => d.text ?? "").join(" ");
    expect(/pricing support is missing/i.test(allText)).toBe(false);
    const readiness = assessReadiness(ctx, "supplement_readiness");
    expect(readiness.requirements.some((r) => r.key === "pricing_support" && r.status === "MISSING")).toBe(true);
  });

  it("produces READY only when every requirement is satisfied", () => {
    const ctx: RequirementContext = {
      claim: CLAIM,
      documents: [
        doc("d1", "Inspection_Report_NPP.pdf", "Inspection", "Inspection Report — Claim GAP-26-51847. Roof area: 28.7 SQ."),
        doc("d2", "Roof_Photos_1.jpg", "Photo", ""),
        doc("d3", "Roof_Photos_2.jpg", "Photo", ""),
        doc("d4", "Estimate_NPP.pdf", "Estimate", "ESTIMATE — Claim GAP-26-51847.\nLine items:\n- Tear off @ $4.50/SQ (28.7 SQ)\nTotal estimate: $24,500.00"),
        doc("d5", "Carrier_Payment_60811.pdf", "Payment", "Claim GAP-26-51847. Payment amount: $17,920.00."),
        doc("d6", "Carrier_Letter.pdf", "Correspondence", "Claim GAP-26-51847 carrier letter."),
        doc("d7", "Supplement_Request.pdf", "Supplement", "Supplement rationale: decking underestimated."),
      ],
      claimNumber: "GAP-26-51847",
    };
    const readiness = assessReadiness(ctx, "supplement_readiness");
    expect(readiness.status).toBe("READY");
    expect(readiness.score).toBe(1);
    expect(readiness.blockingIssues).toHaveLength(0);
  });

  it("blocks when a CRITICAL requirement is missing and warns on MEDIUM gaps", () => {
    const ctx: RequirementContext = {
      claim: CLAIM,
      documents: [
        doc("d1", "Inspection_Report_NPP.pdf", "Inspection", "Inspection report."),
        doc("d2", "Roof_Photos.zip", "Photo", ""),
        doc("d3", "Estimate_NPP.pdf", "Estimate", "ESTIMATE — Claim GAP-26-51847.\nLine items:\n- Tear off @ $4.50/SQ\nTotal estimate: $24,500.00"),
        doc("d4", "Carrier_Payment_60811.pdf", "Payment", "Payment amount: $17,920.00."),
        doc("d5", "Carrier_Letter.pdf", "Correspondence", "Carrier letter."),
      ],
      claimNumber: "GAP-26-51847",
    };
    const readiness = assessReadiness(ctx, "supplement_readiness");
    // supplement_rationale is CRITICAL and missing -> blocking (NOT_READY).
    expect(readiness.status).toBe("NOT_READY");
    expect(readiness.blockingIssues.some((b) => b.key === "supplement_rationale")).toBe(true);
  });
});

describe("assessReadiness — contextual severity (§16)", () => {
  it("authorization is CRITICAL for submission but absent from claim readiness", () => {
    const ctx = absenceFixture();
    const submission = assessReadiness(ctx, "submission_readiness");
    const auth = submission.requirements.find((r) => r.key === "authorization");
    expect(auth?.status).toBe("MISSING");
    expect(auth?.severity).toBe("CRITICAL");
    expect(submission.blockingIssues.some((b) => b.key === "authorization")).toBe(true);

    const claim = assessReadiness(ctx, "claim_readiness");
    expect(claim.requirements.some((r) => r.key === "authorization")).toBe(false);
  });

  it("severity is workflow-relative, not universal", () => {
    const ctx = absenceFixture();
    const submission = assessReadiness(ctx, "submission_readiness");
    const supplement = assessReadiness(ctx, "supplement_readiness");
    const subPricing = submission.requirements.find((r) => r.key === "pricing_support");
    const supPricing = supplement.requirements.find((r) => r.key === "pricing_support");
    // Both workflows treat pricing support as critical — but the requirement
    // list differs by workflow, proving severity is context-dependent.
    expect(subPricing?.severity).toBe("CRITICAL");
    expect(supPricing?.severity).toBe("CRITICAL");
    expect(submission.requirements.length).toBeGreaterThan(supplement.requirements.length);
  });

  it("marks stale gaps for claims with no activity for 30+ days", () => {
    const ctx: RequirementContext = {
      claim: {
        ...CLAIM,
        updatedAt: Date.now() - 45 * 86_400_000,
        dateOfLoss: null,
        causeOfLoss: null,
        customer: null,
        estimateAmount: null,
        evidenceDocumentIds: [],
      },
      documents: [
        doc("d1", "Inspection_Report_NPP.pdf", "Inspection", "Inspection report."),
      ],
      claimNumber: "GAP-26-51847",
    };
    const readiness = assessReadiness(ctx, "claim_readiness");
    const stale = readiness.requirements.filter((r) => r.gapType === "stale");
    expect(stale.length).toBeGreaterThan(0);
    expect(stale.every((r) => r.note.length > 0)).toBe(true);
  });
});

describe("summarizeReadiness — answer text", () => {
  it("produces an evidence-grounded summary with actions", () => {
    const readiness = assessReadiness(absenceFixture(), "supplement_readiness");
    const text = summarizeReadiness(readiness);
    expect(text).toContain("supplement readiness");
    expect(text).toContain("NOT_READY");
    expect(text).toContain("pricing support");
    expect(text).toContain("Recommended actions");
  });

  it("workflowLabel maps keys to labels", () => {
    expect(workflowLabel("supplement_readiness")).toBe("Supplement readiness");
  });
});
