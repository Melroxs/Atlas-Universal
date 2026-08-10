import { describe, expect, it } from "vitest";
import { buildImpactAssessment, conflictAssessment } from "./impact";
import type { ChangeType } from "./ingest";

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    source: {
      sourceId: "osha-1910",
      name: "OSHA 29 CFR 1910",
      authorityTier: "tier1_primary",
      industry: "general industry",
      jurisdiction: "US",
    },
    knowledge: {
      knowledgeId: "osha-hazcom",
      title: "Hazard Communication Standard update",
      statement: "Employers must update hazard communication training.",
      industry: "general industry",
      jurisdiction: "US",
      effectiveDate: 1_800_000_000_000,
    },
    changeType: "new_requirement" as ChangeType,
    affectedTenants: [{ tenantId: "t1", matchedBy: ["industry matches"] }],
    workflows: [
      { id: "wf-chemical-safety", name: "Chemical safety review", industry: "general industry" },
      { id: "wf-billing", name: "Billing run", industry: "universal" },
    ],
    registeredIndustries: ["General Industry", "Insurance Restoration"],
    subjects: ["hazcom", "hazard communication"],
    ...overrides,
  } as Parameters<typeof buildImpactAssessment>[0];
}

describe("impact assessment structure", () => {
  it("builds a pending_review assessment with evidence and a disclaimer", () => {
    const a = buildImpactAssessment(baseInput());
    expect(a.status).toBe("pending_review");
    expect(a.evidence.length).toBeGreaterThan(2);
    expect(a.disclaimer).toContain("not a legal or compliance determination");
    expect(a.affectedWorkflowIds).toContain("wf-chemical-safety");
    expect(a.affectedWorkflowIds).not.toContain("wf-billing");
    expect(a.affectedTenantIds).toEqual(["t1"]);
  });

  it("never uses compliance language", () => {
    const a = buildImpactAssessment(baseInput({ changeType: "new_requirement" }));
    const text = [a.recommendedAction, ...a.evidence, a.disclaimer].join(" ").toLowerCase();
    expect(text).not.toContain("non-compliant");
    expect(text).not.toContain("you are required to");
    expect(a.recommendedAction).toContain("Review");
  });
});

describe("severity & urgency", () => {
  it("treats new requirements from primary sources as high severity", () => {
    const a = buildImpactAssessment(baseInput({ changeType: "new_requirement" }));
    expect(a.severity).toBe("high");
    expect(a.urgency).toBe("immediate");
    expect(a.requiresHumanReview).toBe(true);
  });

  it("treats supersession as high severity", () => {
    const a = buildImpactAssessment(baseInput({ changeType: "supersession" }));
    expect(a.severity).toBe("high");
  });

  it("treats formatting-only changes as low impact", () => {
    const a = buildImpactAssessment(baseInput({ changeType: "formatting_only" }));
    expect(a.severity).toBe("low");
    expect(a.requiresHumanReview).toBe(false);
    expect(a.urgency).toBe("scheduled");
  });
});

describe("workflow linking", () => {
  it("links workflows by declared industry match", () => {
    const a = buildImpactAssessment(
      baseInput({ knowledge: { ...baseInput().knowledge, industry: "general industry" } }),
    );
    expect(a.affectedWorkflowIds).toContain("wf-chemical-safety");
  });

  it("links workflows by subject keyword when industry is unknown", () => {
    const a = buildImpactAssessment(
      baseInput({
        knowledge: { ...baseInput().knowledge, industry: null },
        subjects: ["chemical"],
      }),
    );
    expect(a.affectedWorkflowIds).toContain("wf-chemical-safety");
  });

  it("reports no workflow mapping rather than fabricating one", () => {
    const a = buildImpactAssessment(
      baseInput({
        knowledge: { ...baseInput().knowledge, industry: null },
        subjects: [],
      }),
    );
    expect(a.affectedWorkflowIds).toEqual([]);
    expect(a.evidence.join(" ")).toContain("No registered workflow");
  });
});

describe("evidence grounding", () => {
  it("quotes the authoritative source statement", () => {
    const a = buildImpactAssessment(baseInput());
    expect(a.evidence[0]).toContain("Authoritative source states");
    expect(a.evidence[0]).toContain("hazard communication training");
  });

  it("states when the effective date is not available", () => {
    const a = buildImpactAssessment(
      baseInput({ knowledge: { ...baseInput().knowledge, effectiveDate: null } }),
    );
    expect(a.evidence.join(" ")).toContain("Effective date not stated");
  });

  it("reports applicability honestly when no tenant matches", () => {
    const a = buildImpactAssessment(baseInput({ affectedTenants: [] }));
    expect(a.evidence.join(" ")).toContain("No tenant workspace currently matches");
  });
});

describe("conflict assessment", () => {
  it("resolves conflicts deterministically by tier when possible", () => {
    const c = conflictAssessment([
      { name: "OSHA", tier: "tier1_primary" },
      { name: "An Industry Blog", tier: "tier4_secondary" },
    ]);
    expect(c.conflict).toBe(true);
    expect(c.resolution).toContain("takes precedence by tier");
  });

  it("requires review when the hierarchy cannot resolve", () => {
    const c = conflictAssessment([
      { name: "Source A", tier: "tier1_primary" },
      { name: "Source B", tier: "tier1_primary" },
    ]);
    expect(c.resolution).toBe("Authority conflict requires review.");
    expect(c.requiresReview).toBe(true);
  });
});
