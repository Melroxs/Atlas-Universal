import { describe, expect, it } from "vitest";
import {
  AUTHORITATIVE_KNOWLEDGE_SEEDS,
  AUTHORITATIVE_SOURCE_SEEDS,
  AUTHORITY_TIERS,
  TIER_ORDER,
  applySupersession,
  buildProvenance,
  compareTiers,
  provenanceAnswer,
  tierLabel,
  tierWeight,
} from "./authority";

describe("authority tiers", () => {
  it("orders tiers from primary authority to general web", () => {
    expect(TIER_ORDER).toEqual([
      "tier1_primary",
      "tier2_standard",
      "tier3_industry",
      "tier4_secondary",
      "tier5_general",
    ]);
    expect(tierWeight("tier1_primary")).toBe(1);
    expect(tierWeight("tier5_general")).toBeLessThan(0.5);
    expect(compareTiers("tier1_primary", "tier5_general")).toBeGreaterThan(0);
    expect(compareTiers("tier4_secondary", "tier1_primary")).toBeLessThan(0);
    expect(compareTiers("tier2_standard", "tier2_standard")).toBe(0);
    expect(tierLabel("tier3_industry")).toBe("Industry authority");
  });

  it("gives every tier a description", () => {
    for (const t of TIER_ORDER) {
      expect(AUTHORITY_TIERS[t].description.length).toBeGreaterThan(10);
    }
  });
});

describe("source registry", () => {
  it("registers a substantive set of real authoritative sources", () => {
    expect(AUTHORITATIVE_SOURCE_SEEDS.length).toBeGreaterThanOrEqual(15);
  });

  it("classifies every source explicitly", () => {
    const ids = new Set<string>();
    for (const s of AUTHORITATIVE_SOURCE_SEEDS) {
      expect(TIER_ORDER).toContain(s.authorityTier);
      expect(s.sourceType.length).toBeGreaterThan(0);
      expect(ids.has(s.sourceId)).toBe(false);
      ids.add(s.sourceId);
    }
  });

  it("includes primary authorities with canonical urls", () => {
    const osha = AUTHORITATIVE_SOURCE_SEEDS.find((s) => s.sourceId === "osha-construction");
    expect(osha?.authorityTier).toBe("tier1_primary");
    expect(osha?.canonicalUrl).toContain("osha.gov");
    const iicrc = AUTHORITATIVE_SOURCE_SEEDS.find((s) => s.sourceId === "iicrc-s500");
    expect(iicrc?.authorityTier).toBe("tier3_industry");
  });
});

describe("knowledge seeds", () => {
  it("registers versioned knowledge referencing registered sources", () => {
    const sourceIds = new Set(AUTHORITATIVE_SOURCE_SEEDS.map((s) => s.sourceId));
    const kIds = new Set<string>();
    for (const k of AUTHORITATIVE_KNOWLEDGE_SEEDS) {
      expect(sourceIds.has(k.sourceId)).toBe(true);
      expect(kIds.has(k.knowledgeId)).toBe(false);
      kIds.add(k.knowledgeId);
      expect(k.statement.length).toBeGreaterThan(20);
      expect(k.confidence).toBeGreaterThan(0);
      expect(k.confidence).toBeLessThanOrEqual(1);
    }
    expect(AUTHORITATIVE_KNOWLEDGE_SEEDS.length).toBeGreaterThanOrEqual(8);
  });

  it("keeps source fact and interpretation separate", () => {
    for (const k of AUTHORITATIVE_KNOWLEDGE_SEEDS) {
      expect(k.statement).toBeTruthy();
      if (k.interpretation) {
        expect(k.statement).not.toBe(k.interpretation);
      }
    }
  });
});

describe("provenance", () => {
  it("builds a provenance record from knowledge + source", () => {
    const p = buildProvenance(
      { sourceId: "iicrc-s500", version: "S500 6th ed.", status: "active" },
      { name: "S500", organization: "IICRC", authorityTier: "tier3_industry", sourceType: "standard" },
      1750000000000,
    );
    expect(p.sourceName).toBe("S500");
    expect(p.authorityTier).toBe("tier3_industry");
    expect(p.retrievalDate).toBe(1750000000000);
    expect(p.version).toBe("S500 6th ed.");
  });

  it("answers 'where did you get this' honestly", () => {
    const p = buildProvenance(
      { sourceId: "x", status: "active" },
      { name: "OSHA Standards", organization: "OSHA", authorityTier: "tier1_primary", sourceType: "regulation" },
      1750000000000,
    );
    const answer = provenanceAnswer(p);
    expect(answer).toContain("OSHA Standards");
    expect(answer).toContain("Primary authority");
    expect(answer).toContain("Retrieved");
  });
});

describe("supersession", () => {
  it("marks only active rows superseded by a new version", () => {
    const rows = [
      { knowledgeId: "v1", status: "active" as const, supersededBy: [] },
      { knowledgeId: "v2", status: "active" as const },
      { knowledgeId: "v3", status: "expired" as const },
    ];
    const patches = applySupersession(rows, { knowledgeId: "v4", supersedes: ["v1", "v3"] });
    expect(patches.map((p) => p.knowledgeId)).toEqual(["v1"]);
    expect(patches[0].patch.status).toBe("superseded");
    expect(patches[0].patch.supersededBy).toContain("v4");
  });

  it("does nothing without supersedes declarations", () => {
    expect(applySupersession([{ knowledgeId: "v1", status: "active" }], { knowledgeId: "v2" })).toEqual([]);
  });
});
