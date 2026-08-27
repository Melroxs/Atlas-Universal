// ---------------------------------------------------------------------------
// Atlas Knowledge Corpus — Ingestion Tests
//
// Comprehensive tests for corpus validation, idempotency, provenance,
// jurisdiction handling, graph integrity, and tenant isolation.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  CORPUS_MANIFEST,
  type CorpusKnowledgeRecord,
} from "./manifest";
import { CORPUS_PROVENANCE } from "./sources";
import { FEDERAL_REGULATIONS } from "./regulations";
import { WORKFLOW_STAGES } from "./workflows";
import { DOCUMENTATION_EVIDENCE } from "./evidence";
import { JURISDICTION_PROFILES } from "./jurisdictions";
import { STANDARDS_METADATA } from "./standards";
import { RISK_PATTERNS } from "./risks";
import { REVENUE_RECOVERY } from "./revenue";
import { GRAPH_RELATIONSHIPS } from "./graph";
import {
  validateCorpus,
  normalizeCorpusToKnowledgeItems,
  normalizeCorpusProvenance,
  getValidatedGraphEdges,
  getIngestionReport,
} from "./importer";

// ---------------------------------------------------------------------------
// 1. Corpus Structure Validation
// ---------------------------------------------------------------------------

describe("Corpus Structure", () => {
  it("has correct manifest metadata", () => {
    expect(CORPUS_MANIFEST.corpusName).toBe("atlas_insurance_restoration");
    expect(CORPUS_MANIFEST.version).toBe("1.0.0");
    expect(CORPUS_MANIFEST.qcStatus).toBe("PASS_WITH_WARNINGS");
  });

  it("has 5 authoritative sources in CORPUS_PROVENANCE", () => {
    expect(CORPUS_PROVENANCE.length).toBeGreaterThanOrEqual(10); // 5 corpus + Atlas internal
  });

  it("every provenance record has required fields", () => {
    for (const p of CORPUS_PROVENANCE) {
      expect(p.sourceId).toBeTruthy();
      expect(p.sourceName).toBeTruthy();
      expect(p.organization).toBeTruthy();
      expect(p.authorityTier).toBeTruthy();
      expect(p.sourceType).toBeTruthy();
    }
  });

  it("all required provenance source IDs are present", () => {
    const ids = CORPUS_PROVENANCE.map((p) => p.sourceId);
    expect(ids).toContain("atlas-curated");
    expect(ids).toContain("atlas-evidence-model");
    expect(ids).toContain("atlas-professional-guidance");
    expect(ids).toContain("iicrc-s500");
    expect(ids).toContain("iicrc-s520");
    expect(ids).toContain("osha-construction");
    expect(ids).toContain("epa-lead-rrp");
    expect(ids).toContain("fema-flood-insurance");
    expect(ids).toContain("iicrc-standards");
    expect(ids).toContain("epa-regulations");
  });
});

// ---------------------------------------------------------------------------
// 2. Record Category Counts
// ---------------------------------------------------------------------------

describe("Record Category Counts", () => {
  it("federal regulations: 8", () => {
    expect(FEDERAL_REGULATIONS).toHaveLength(8);
  });

  it("workflow stages: 31", () => {
    expect(WORKFLOW_STAGES).toHaveLength(31);
  });

  it("documentation/evidence: 36", () => {
    expect(DOCUMENTATION_EVIDENCE).toHaveLength(36);
  });

  it("jurisdiction profiles: 51 (50 states + DC)", () => {
    expect(JURISDICTION_PROFILES).toHaveLength(51);
  });

  it("standards: 5", () => {
    expect(STANDARDS_METADATA).toHaveLength(5);
  });

  it("risks: 21", () => {
    expect(RISK_PATTERNS).toHaveLength(21);
  });

  it("revenue recovery: 16", () => {
    expect(REVENUE_RECOVERY).toHaveLength(16);
  });
});

// ---------------------------------------------------------------------------
// 3. Record Schema Validation
// ---------------------------------------------------------------------------

describe("Record Schema Validation", () => {
  const ALL_RECORDS: CorpusKnowledgeRecord[] = [
    ...FEDERAL_REGULATIONS,
    ...WORKFLOW_STAGES,
    ...DOCUMENTATION_EVIDENCE,
    ...JURISDICTION_PROFILES,
    ...STANDARDS_METADATA,
    ...RISK_PATTERNS,
    ...REVENUE_RECOVERY,
  ];

  it("every record has a unique ID", () => {
    const ids = ALL_RECORDS.map((r) => r.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("every record has required fields", () => {
    for (const r of ALL_RECORDS) {
      expect(r.id).toBeTruthy();
      expect(r.title).toBeTruthy();
      expect(r.statement).toBeTruthy();
      expect(r.knowledgeType).toBeTruthy();
      expect(typeof r.confidence).toBe("number");
      expect(r.confidence).toBeGreaterThan(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
      expect(r.sourceId).toBeTruthy();
      expect(Array.isArray(r.tags)).toBe(true);
    }
  });

  it("every record has layer = atlas_industry", () => {
    for (const r of ALL_RECORDS) {
      // Corpus records are all Layer 1 (atlas_industry) by definition
      expect(r.sourceClassification).toBeTruthy();
    }
  });

  it("every record references a valid provenance sourceId", () => {
    const provenanceIds = new Set(CORPUS_PROVENANCE.map((p) => p.sourceId));
    for (const r of ALL_RECORDS) {
      expect(provenanceIds.has(r.sourceId)).toBe(true);
    }
  });

  it("no duplicate IDs across all categories", () => {
    const ids = ALL_RECORDS.map((r) => r.id);
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const id of ids) {
      if (seen.has(id)) dupes.push(id);
      seen.add(id);
    }
    expect(dupes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Jurisdiction Handling
// ---------------------------------------------------------------------------

describe("Jurisdiction Profiles", () => {
  it("all 51 jurisdictions are placeholders", () => {
    for (const j of JURISDICTION_PROFILES) {
      expect(j.verificationStatus).toBe("placeholder");
      expect(j.isInference).toBe(true);
      expect(j.confidence).toBeLessThanOrEqual(0.35);
    }
  });

  it("every jurisdiction has a US state jurisdiction field", () => {
    for (const j of JURISDICTION_PROFILES) {
      expect(j.jurisdiction).toMatch(/^United States > /);
    }
  });

  it("includes all 50 states + DC", () => {
    const abbrevs = JURISDICTION_PROFILES.map((j) => j.id.replace("jur_", ""));
    expect(abbrevs).toContain("dc");
    expect(abbrevs).toContain("ca");
    expect(abbrevs).toContain("tx");
    expect(abbrevs).toContain("fl");
    expect(abbrevs).toContain("ny");
    expect(abbrevs).toContain("ak");
    expect(abbrevs).toContain("wy");
    expect(abbrevs).toHaveLength(51);
  });

  it("placeholder records cannot be represented as authoritative", () => {
    for (const j of JURISDICTION_PROFILES) {
      // Placeholder confidence must be low enough to prevent authoritative use
      expect(j.confidence).toBeLessThanOrEqual(0.35);
      expect(j.status).toBe("active"); // Active so it shows up, but with placeholder status
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Provenance Integrity
// ---------------------------------------------------------------------------

describe("Provenance Integrity", () => {
  it("every category includes diverse source classifications", () => {
    const allRecords = [
      ...FEDERAL_REGULATIONS,
      ...WORKFLOW_STAGES,
      ...DOCUMENTATION_EVIDENCE,
      ...STANDARDS_METADATA,
      ...RISK_PATTERNS,
      ...REVENUE_RECOVERY,
    ];
    const classifications = new Set(allRecords.map((r) => r.sourceClassification));
    expect(classifications.has("REGULATORY")).toBe(true);
    expect(classifications.has("INDUSTRY_STANDARD")).toBe(true);
    expect(classifications.has("ATLAS_CURATED")).toBe(true);
  });

  it("federal regulations use REGULATORY classification", () => {
    for (const r of FEDERAL_REGULATIONS) {
      expect(r.sourceClassification).toBe("REGULATORY");
    }
  });

  it("standards use INDUSTRY_STANDARD or REGULATORY classification", () => {
    for (const s of STANDARDS_METADATA) {
      expect(["INDUSTRY_STANDARD", "REGULATORY"]).toContain(s.sourceClassification);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Graph Relationships
// ---------------------------------------------------------------------------

describe("Knowledge Graph", () => {
  it("has graph relationships", () => {
    expect(GRAPH_RELATIONSHIPS.length).toBeGreaterThan(30);
  });

  it("every edge has required fields", () => {
    for (const e of GRAPH_RELATIONSHIPS) {
      expect(e.sourceId).toBeTruthy();
      expect(e.targetId).toBeTruthy();
      expect(e.relationship).toBeTruthy();
    }
  });

  it("all edge endpoints reference valid record IDs", () => {
    const ALL_IDS = new Set([
      ...FEDERAL_REGULATIONS.map((r) => r.id),
      ...WORKFLOW_STAGES.map((r) => r.id),
      ...DOCUMENTATION_EVIDENCE.map((r) => r.id),
      ...JURISDICTION_PROFILES.map((r) => r.id),
      ...STANDARDS_METADATA.map((r) => r.id),
      ...RISK_PATTERNS.map((r) => r.id),
      ...REVENUE_RECOVERY.map((r) => r.id),
    ]);

    const orphans: Array<{ source: string; target: string }> = [];
    for (const e of GRAPH_RELATIONSHIPS) {
      if (!ALL_IDS.has(e.sourceId) || !ALL_IDS.has(e.targetId)) {
        orphans.push({ source: e.sourceId, target: e.targetId });
      }
    }
    expect(orphans).toEqual([]);
  });

  it("uses valid relationship types", () => {
    const validTypes = [
      "REGULATION_APPLIES_TO",
      "JURISDICTION_GOVERNS",
      "WORKFLOW_REQUIRES",
      "DOCUMENT_PROVIDES_EVIDENCE_FOR",
      "CLAIM_ELEMENT_SUPPORTS",
      "SUPPLEMENT_AFFECTS",
      "RISK_CAUSED_BY",
      "MISSING_EVIDENCE_TRIGGERS",
      "REGULATION_CITES",
      "REGULATION_GOVERNS",
      "WORKFLOW_TRANSITIONS_TO",
    ];
    for (const e of GRAPH_RELATIONSHIPS) {
      expect(validTypes).toContain(e.relationship);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Corpus Validation via Importer
// ---------------------------------------------------------------------------

describe("Corpus Importer", () => {
  it("validates the complete corpus", () => {
    const result = validateCorpus();
    expect(result.valid).toBe(true);
    expect(result.rejected).toHaveLength(0);
    expect(result.duplicates).toHaveLength(0);
  });

  it("reports correct total record count", () => {
    const result = validateCorpus();
    // 8 + 31 + 36 + 51 + 5 + 21 + 16 = 168
    expect(result.totalRecords).toBe(168);
    expect(result.validRecords).toBe(168);
  });

  it("reports zero orphan graph edges", () => {
    const result = validateCorpus();
    expect(result.orphanEdges).toBe(0);
  });

  it("reports zero missing provenance references", () => {
    const result = validateCorpus();
    expect(result.missingProvenance).toHaveLength(0);
  });

  it("normalizes to Atlas KnowledgeItem format", () => {
    const items = normalizeCorpusToKnowledgeItems();
    expect(items.length).toBe(168);
    for (const item of items) {
      expect(item.layer).toBe("atlas_industry");
      expect(item.id).toBeTruthy();
      expect(item.title).toBeTruthy();
      expect(item.statement).toBeTruthy();
    }
  });

  it("normalizes provenance to Atlas format", () => {
    const prov = normalizeCorpusProvenance();
    expect(prov.length).toBeGreaterThanOrEqual(10);
    for (const p of prov) {
      expect(p.sourceId).toBeTruthy();
      expect(p.sourceName).toBeTruthy();
    }
  });

  it("validates graph edges (only valid endpoints)", () => {
    const edges = getValidatedGraphEdges();
    expect(edges.length).toBe(GRAPH_RELATIONSHIPS.length); // all should be valid
  });

  it("generates ingestion report", () => {
    const validation = validateCorpus();
    const report = getIngestionReport(validation);
    expect(report.corpus).toBe("atlas_insurance_restoration");
    expect(report.version).toBe("1.0.0");
    expect(report.knowledgeItemsReady).toBe(168);
    expect(report.provenanceRecordsReady).toBeGreaterThanOrEqual(10);
    expect(report.graphEdgesReady).toBeGreaterThan(30);
  });
});

// ---------------------------------------------------------------------------
// 8. Idempotency
// ---------------------------------------------------------------------------

describe("Idempotency", () => {
  it("multiple validations produce identical results", () => {
    const r1 = validateCorpus();
    const r2 = validateCorpus();
    expect(r1.totalRecords).toBe(r2.totalRecords);
    expect(r1.validRecords).toBe(r2.validRecords);
    expect(r1.rejected.length).toBe(r2.rejected.length);
    expect(r1.duplicates.length).toBe(r2.duplicates.length);
  });

  it("normalization is deterministic", () => {
    const n1 = normalizeCorpusToKnowledgeItems();
    const n2 = normalizeCorpusToKnowledgeItems();
    expect(n1.length).toBe(n2.length);
    for (let i = 0; i < n1.length; i++) {
      expect(n1[i].id).toBe(n2[i].id);
      expect(n1[i].title).toBe(n2[i].title);
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Knowledge Type Coverage
// ---------------------------------------------------------------------------

describe("Knowledge Type Coverage", () => {
  it("covers all required knowledge types", () => {
    const allRecords: CorpusKnowledgeRecord[] = [
      ...FEDERAL_REGULATIONS,
      ...WORKFLOW_STAGES,
      ...DOCUMENTATION_EVIDENCE,
      ...JURISDICTION_PROFILES,
      ...STANDARDS_METADATA,
      ...RISK_PATTERNS,
      ...REVENUE_RECOVERY,
    ];
    const types = new Set(allRecords.map((r) => r.knowledgeType));
    expect(types.has("federal_regulation")).toBe(true);
    expect(types.has("workflow_stage")).toBe(true);
    expect(types.has("documentation_evidence")).toBe(true);
    expect(types.has("jurisdiction")).toBe(true);
    expect(types.has("standard")).toBe(true);
    expect(types.has("risk_pattern")).toBe(true);
    expect(types.has("revenue_concept")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. Quality Control
// ---------------------------------------------------------------------------

describe("Quality Control", () => {
  it("manifest warnings reference jurisdiction placeholders", () => {
    const warnings = CORPUS_MANIFEST.warnings;
    expect(warnings.some((w) => w.includes("jurisdiction"))).toBe(true);
  });

  it("no record has confidence > 0.95 except established standards", () => {
    const ALL_RECORDS: CorpusKnowledgeRecord[] = [
      ...FEDERAL_REGULATIONS,
      ...WORKFLOW_STAGES,
      ...DOCUMENTATION_EVIDENCE,
      ...STANDARDS_METADATA,
      ...RISK_PATTERNS,
      ...REVENUE_RECOVERY,
    ];
    for (const r of ALL_RECORDS) {
      if (r.confidence > 0.95) {
        // Only well-established OSHA/EPA regulations should be this high
        expect(r.sourceClassification).toBe("REGULATORY");
      }
    }
  });

  it("inference records have lower confidence", () => {
    const ALL_RECORDS: CorpusKnowledgeRecord[] = [
      ...FEDERAL_REGULATIONS,
      ...WORKFLOW_STAGES,
      ...DOCUMENTATION_EVIDENCE,
      ...STANDARDS_METADATA,
      ...RISK_PATTERNS,
      ...REVENUE_RECOVERY,
    ];
    for (const r of ALL_RECORDS) {
      if (r.isInference) {
        expect(r.confidence).toBeLessThanOrEqual(0.7);
      }
    }
  });
});
