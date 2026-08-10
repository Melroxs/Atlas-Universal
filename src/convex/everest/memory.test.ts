import { describe, expect, it } from "vitest";
import {
  applicabilityLabel,
  memoryProvenance,
  memoryRecordFromApproval,
} from "./memory";

describe("memoryRecordFromApproval", () => {
  const base = {
    tenantId: "tenant_1",
    statement: "Employers must provide respiratory protection at or above the exposure limit.",
    interpretation:
      "Restoration crews doing sanding should have a respiratory protection program.",
    confidence: 0.85,
    source: {
      sourceId: "osha-general-industry",
      sourceName: "OSHA — General Industry Standards (29 CFR 1910)",
      authorityTier: "tier1_primary",
      tierLabel: "Primary authority",
      version: "1910.134",
      publicationDate: Date.UTC(2020, 0, 1),
      effectiveDate: Date.UTC(2021, 0, 1),
      canonicalUrl: "https://www.osha.gov/example",
    },
    changeType: "new_requirement",
    reviewNote: "Applicable to our restoration crews.",
    decidedBy: "user_1",
    decidedAt: Date.now(),
  };

  it("produces a RULE assertion with the interpretation attached", () => {
    const r = memoryRecordFromApproval(base);
    expect(r.classification).toBe("RULE");
    expect(r.status).toBe("confirmed");
    expect(r.statement).toContain(base.statement);
    expect(r.statement).toContain("Interpretation");
    expect(r.statement).toContain("respiratory protection program");
  });

  it("retains full provenance in evidence", () => {
    const r = memoryRecordFromApproval(base);
    expect(r.evidence).toContain("Source: OSHA — General Industry Standards (29 CFR 1910)");
    expect(r.evidence).toContain("Tier: Primary authority");
    expect(r.evidence).toContain("Version: 1910.134");
    expect(r.evidence).toContain("Effective: 2021-01-01");
    expect(r.evidence).toContain("Reference: https://www.osha.gov/example");
    expect(r.evidence).toContain("Change: new requirement");
    expect(r.provenance).toBe(r.evidence);
  });

  it("clamps confidence into a sane range", () => {
    expect(memoryRecordFromApproval({ ...base, confidence: 0.1 }).confidence).toBe(0.4);
    expect(memoryRecordFromApproval({ ...base, confidence: 2 }).confidence).toBe(0.99);
  });

  it("does not fabricate provenance when fields are absent", () => {
    const r = memoryRecordFromApproval({
      ...base,
      source: {
        sourceId: "minimal",
        sourceName: "Minimal Source",
        authorityTier: "tier5_general",
        tierLabel: "General web",
      },
      interpretation: undefined,
      changeType: undefined,
      reviewNote: undefined,
    });
    expect(r.evidence).toContain("Source: Minimal Source");
    expect(r.evidence).not.toContain("undefined");
    expect(r.statement).toBe(base.statement);
  });
});

describe("memoryProvenance", () => {
  it("joins provenance parts deterministically", () => {
    const p = memoryProvenance({
      tenantId: "t",
      statement: "s",
      confidence: 0.5,
      source: {
        sourceId: "x",
        sourceName: "X",
        authorityTier: "tier2_standard",
        tierLabel: "Recognized standard",
      },
    });
    expect(p).toContain("Source: X");
    expect(p).toContain("Tier: Recognized standard");
  });
});

describe("applicabilityLabel", () => {
  it("is honest when applicability cannot be determined", () => {
    const label = applicabilityLabel(
      false,
      "Cannot confirm applicability: operates in \"United States\"",
    );
    expect(label).toContain("Applicability cannot be determined");
    expect(label).toContain("Cannot confirm applicability");
  });

  it("passes through the confirmed reason", () => {
    expect(applicabilityLabel(true, "Applies to this operating context.")).toContain(
      "Applies to this operating context.",
    );
  });
});
