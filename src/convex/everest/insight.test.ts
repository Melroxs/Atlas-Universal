import { describe, expect, it } from "vitest";
import {
  composeAuthorityInsights,
  composeIndustryInsights,
  composeInsights,
  composeMemoryInsights,
  composeOrganizationInsights,
  composeTemporalInsights,
  evidenceStateFromConfidence,
  insightConfidence,
  type InsightInput,
} from "./insight";

const NOW = Date.UTC(2026, 6, 15, 12, 0, 0); // Wed Jul 15 2026

const baseInput: InsightInput = {
  now: NOW,
  timezone: "America/New_York",
  organizationState: {
    entityCount: 12,
    assertionCount: 3,
    openDecisions: [
      { id: "d1", title: "Approve estimate for claim 45", summary: "Estimate exceeds threshold." },
    ],
    pendingApprovals: [{ id: "a1", title: "Reconstruction authorization", createdAt: NOW - 5 * 86_400_000 }],
    recentEvents: [{ id: "e1", eventType: "drive.file_updated", receivedAt: NOW - 3_600_000 }],
    activeWorkflows: [{ id: "w1", name: "claim_documentation" }],
  },
  industryKnowledge: [
    { key: "term_supplement", title: "Supplement", summary: "Additional scope requested beyond the original estimate." },
  ],
  authorityKnowledge: [
    {
      knowledgeId: "k1",
      title: "Respiratory protection requirements",
      statement: "Employers must provide respiratory protection at or above the exposure limit.",
      interpretation: "Restoration crews should have a respiratory protection program.",
      sourceName: "OSHA",
      authorityTier: "tier1_primary",
      version: "1910.134",
      effectiveDate: NOW + 5 * 86_400_000,
      confidence: 0.85,
      applies: true,
      applicabilityReason: "Applies to this operating context.",
    },
    {
      knowledgeId: "k2",
      title: "Texas contractor regulation",
      statement: "Texas licenses certain trades at the state level.",
      interpretation: "Confirm trade-specific licensing.",
      sourceName: "Texas TDLR",
      authorityTier: "tier1_primary",
      confidence: 0.7,
      applies: false,
      applicabilityReason: "Cannot confirm applicability — missing factors: operates in \"United States\".",
    },
  ],
  memory: [
    { id: "m1", statement: "Employers must provide respiratory protection — Interpretation: crews need a program.", classification: "RULE", confidence: 0.85 },
  ],
  jurisdiction: { path: ["United States", "New York"], industry: "insurance restoration" },
};

describe("composeOrganizationInsights", () => {
  it("flags stale approvals with verified evidence", () => {
    const out = composeOrganizationInsights(baseInput);
    const approval = out.find((i) => i.id === "insight-org-approvals");
    expect(approval).toBeDefined();
    expect(approval!.detail).toContain("3 business days");
    expect(approval!.evidence[0].evidenceState).toBe("verified");
  });

  it("surfaces open decisions", () => {
    const out = composeOrganizationInsights(baseInput);
    expect(out.some((i) => i.id === "insight-org-decisions")).toBe(true);
  });

  it("is honest when the knowledge graph is empty", () => {
    const out = composeOrganizationInsights({
      ...baseInput,
      organizationState: { ...baseInput.organizationState, entityCount: 0, assertionCount: 0 },
    });
    const unknown = out.find((i) => i.id === "insight-org-unknown");
    expect(unknown).toBeDefined();
    expect(unknown!.limitation).toContain("not been ingested");
  });
});

describe("composeAuthorityInsights", () => {
  it("only includes applicable authority knowledge", () => {
    const out = composeAuthorityInsights(baseInput);
    expect(out.some((i) => i.title.includes("Respiratory"))).toBe(true);
    expect(out.some((i) => i.title.includes("Texas"))).toBe(false);
  });

  it("labels authority insights as not legal advice", () => {
    const out = composeAuthorityInsights(baseInput);
    expect(out[0].limitation).toContain("not legal advice");
  });

  it("says when no authority knowledge applies", () => {
    const out = composeAuthorityInsights({
      ...baseInput,
      authorityKnowledge: [{ ...baseInput.authorityKnowledge[1] }],
    });
    expect(out.some((i) => i.id === "insight-authority-none")).toBe(true);
  });

  it("returns nothing when no authority knowledge exists at all", () => {
    expect(composeAuthorityInsights({ ...baseInput, authorityKnowledge: [] })).toEqual([]);
  });
});

describe("composeIndustryInsights", () => {
  it("labels domain knowledge as not organization-specific", () => {
    const out = composeIndustryInsights(baseInput);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].limitation).toContain("domain-level knowledge");
  });
});

describe("composeMemoryInsights", () => {
  it("surfaces approved memory with provenance-backed evidence", () => {
    const out = composeMemoryInsights(baseInput);
    expect(out.length).toBe(1);
    expect(out[0].evidence[0].evidenceState).toBe("verified");
  });
});

describe("composeTemporalInsights", () => {
  it("flags approvals waiting past the review window", () => {
    const out = composeTemporalInsights(baseInput);
    expect(out.some((i) => i.id === "insight-temporal-approval")).toBe(true);
  });

  it("flags applicable requirements becoming effective soon", () => {
    const out = composeTemporalInsights(baseInput);
    const eff = out.find((i) => i.id === "insight-temporal-effective-k1");
    expect(eff).toBeDefined();
    expect(eff!.title).toContain("in 5 days");
    expect(eff!.detail).toContain("2026-07-20");
  });
});

describe("composeInsights", () => {
  it("combines all layers into one list", () => {
    const out = composeInsights(baseInput);
    const layers = new Set(out.map((i) => i.layer));
    expect(layers.has("organization")).toBe(true);
    expect(layers.has("authority")).toBe(true);
    expect(layers.has("industry")).toBe(true);
    expect(layers.has("memory")).toBe(true);
    expect(layers.has("temporal")).toBe(true);
  });
});

describe("evidenceStateFromConfidence / insightConfidence", () => {
  it("maps confidence to honest evidence states", () => {
    expect(evidenceStateFromConfidence(0.9)).toBe("verified");
    expect(evidenceStateFromConfidence(0.7)).toBe("inferred");
    expect(evidenceStateFromConfidence(0.5)).toBe("uncertain");
    expect(evidenceStateFromConfidence(0.2)).toBe("unavailable");
  });

  it("never inflates aggregate confidence beyond 0.95", () => {
    const out = composeInsights(baseInput);
    const c = insightConfidence(out);
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThanOrEqual(0.95);
  });
});
