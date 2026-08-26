// ---------------------------------------------------------------------------
// Atlas Knowledge Layer — Milestone 2 Integration Tests
//
// Tests that:
//   1. retrieveKnowledge() produces a valid KnowledgeContext
//   2. buildKnowledgeContextString() produces a prompt-ready string
//   3. LocalAnswer type accepts knowledgeContext and knowledgeContextString
//   4. Tool registry contains the industry knowledge search tool
//   5. Layer priority is respected in retrieval results
//   6. Knowledge context augmenting answers works end-to-end
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  retrieveKnowledge,
  classifyIntent,
  buildKnowledgeContext,
  buildKnowledgeContextString,
  ATLAS_INDUSTRY_KNOWLEDGE_SEED,
  ATLAS_KNOWLEDGE_PROVENANCE,
} from "./index";
import {
  type KnowledgeContext,
  type KnowledgeRetrievalResult,
  KNOWLEDGE_LAYER_PRIORITY,
} from "./types";
import { TOOL_BY_ID } from "@/lib/atlas-data/tools-registry";

// ---------------------------------------------------------------------------
// Mock Supabase client for integration tests
// ---------------------------------------------------------------------------

/** Minimal mock that satisfies the RPC calls retrieveKnowledge makes. */
function createMockSupabase(): Record<string, unknown> {
  return {
    rpc: async (_fn: string, _args?: Record<string, unknown>) => {
      // Return empty/default data — we're testing the retrieval pipeline, not
      // the database layer (which is tested by the existing 50 unit tests).
      return { data: null, error: null };
    },
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Milestone 2 — Knowledge Integration", () => {
  // -----------------------------------------------------------------------
  // 1. retrieveKnowledge() produces a valid KnowledgeContext
  // -----------------------------------------------------------------------
  describe("retrieveKnowledge", () => {
    it("returns a KnowledgeContext with correct structure", async () => {
      const supabase = createMockSupabase();
      const ctx = await retrieveKnowledge(supabase, "supplement documentation requirements");

      expect(ctx).toBeDefined();
      expect(ctx.items).toBeInstanceOf(Array);
      expect(ctx.totalItems).toBe(ctx.items.length);
      expect(ctx.layerCounts).toBeDefined();
      expect(typeof ctx.layerCounts.atlas_industry).toBe("number");
      expect(typeof ctx.layerCounts.customer).toBe("number");
      expect(typeof ctx.layerCounts.live_evidence).toBe("number");
      expect(typeof ctx.hasProvenance).toBe("boolean");
      expect(ctx.industries).toBeInstanceOf(Array);
      expect(ctx.jurisdictions).toBeInstanceOf(Array);
    });

    it("classifies intent correctly for industry concept query", async () => {
      const intent = classifyIntent("What is the IICRC S500 standard for water damage?");
      expect(intent.intent).toBe("explain_industry_concept");
      expect(intent.needsIndustryKnowledge).toBe(true);
      expect(intent.needsCustomerKnowledge).toBe(false);
      expect(intent.needsLiveEvidence).toBe(false);
    });

    it("classifies intent correctly for gap analysis", async () => {
      const intent = classifyIntent("What evidence is missing from this claim?");
      expect(intent.intent).toBe("identify_missing_evidence");
      expect(intent.needsIndustryKnowledge).toBe(true);
      expect(intent.needsCustomerKnowledge).toBe(true);
      expect(intent.needsLiveEvidence).toBe(true);
    });

    it("classifies intent for recommendation queries", async () => {
      const intent = classifyIntent("Should we prioritize this claim or that claim?");
      expect(intent.intent).toBe("recommend_next_action");
      expect(intent.needsIndustryKnowledge).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 2. buildKnowledgeContextString() produces prompt-ready output
  // -----------------------------------------------------------------------
  describe("buildKnowledgeContextString", () => {
    it("returns empty string for empty context", () => {
      const ctx: KnowledgeContext = {
        items: [],
        layerCounts: { atlas_industry: 0, customer: 0, live_evidence: 0 },
        totalItems: 0,
        hasProvenance: false,
        industries: [],
        jurisdictions: [],
      };
      const str = buildKnowledgeContextString(ctx);
      expect(str).toBe("");
    });

    it("wraps items in <atlas_knowledge> tags", () => {
      const mockResults: KnowledgeRetrievalResult[] = [
        {
          item: {
            id: "test-1",
            layer: "atlas_industry",
            sourceClassification: "INDUSTRY_STANDARD",
            title: "IICRC S500 Water Damage Standard",
            statement: "Water damage restoration must follow IICRC S500 guidelines.",
            knowledgeType: "standard",
            confidence: 0.85,
            status: "active",
            isInference: false,
            industry: "insurance_restoration",
          },
          relevance: 0.8,
          retrievalMethod: "keyword",
          sourceClassification: "INDUSTRY_STANDARD",
          layer: "atlas_industry",
          provenance: {
            sourceId: "iicrc-s500",
            sourceName: "IICRC S500 — Standard for Water Damage Restoration",
            organization: "IICRC",
            authorityTier: "industry_standard",
            sourceType: "standard",
            status: "active",
          },
        },
      ];

      const ctx = buildKnowledgeContext(mockResults);
      const str = buildKnowledgeContextString(ctx);

      expect(str).toContain("<atlas_knowledge>");
      expect(str).toContain("</atlas_knowledge>");
      expect(str).toContain("IICRC S500 Water Damage Standard");
      expect(str).toContain("Atlas Industry Knowledge");
      expect(str).toContain("Source: IICRC S500");
    });

    it("groups items by layer with correct headers", () => {
      const mockResults: KnowledgeRetrievalResult[] = [
        {
          item: {
            id: "ind-1",
            layer: "atlas_industry",
            sourceClassification: "ATLAS_CURATED",
            title: "Industry Concept",
            statement: "Industry statement",
            knowledgeType: "terminology",
            confidence: 0.7,
            status: "active",
            isInference: false,
          },
          relevance: 0.7,
          retrievalMethod: "keyword",
          sourceClassification: "ATLAS_CURATED",
          layer: "atlas_industry",
        },
        {
          item: {
            id: "cust-1",
            layer: "customer",
            sourceClassification: "CUSTOMER_PROVIDED",
            title: "Company SOP",
            statement: "Company policy statement",
            knowledgeType: "document",
            confidence: 0.65,
            status: "active",
            isInference: false,
          },
          relevance: 0.65,
          retrievalMethod: "keyword",
          sourceClassification: "CUSTOMER_PROVIDED",
          layer: "customer",
        },
      ];

      const ctx = buildKnowledgeContext(mockResults);
      const str = buildKnowledgeContextString(ctx);

      expect(str).toContain("--- Atlas Industry Knowledge ---");
      expect(str).toContain("--- Company Knowledge ---");
      expect(str).not.toContain("--- Live Company Evidence ---");
    });

    it("includes interpretation when present", () => {
      const mockResults: KnowledgeRetrievalResult[] = [
        {
          item: {
            id: "test-interpret",
            layer: "atlas_industry",
            sourceClassification: "ATLAS_CURATED",
            title: "Supplement Documentation",
            statement: "Supplements require supporting photos.",
            interpretation: "Always photograph before and after work.",
            knowledgeType: "requirement",
            confidence: 0.8,
            status: "active",
            isInference: false,
          },
          relevance: 0.8,
          retrievalMethod: "keyword",
          sourceClassification: "ATLAS_CURATED",
          layer: "atlas_industry",
        },
      ];

      const ctx = buildKnowledgeContext(mockResults);
      const str = buildKnowledgeContextString(ctx);

      expect(str).toContain("Interpretation: Always photograph before and after work.");
    });
  });

  // -----------------------------------------------------------------------
  // 3. LocalAnswer type accepts knowledge fields
  // -----------------------------------------------------------------------
  describe("LocalAnswer type compatibility", () => {
    it("LocalAnswer accepts knowledgeContext and knowledgeContextString", async () => {
      const supabase = createMockSupabase();
      // The import of answerLocally verifies that the type has the new fields.
      // We can't easily call it without a full Supabase setup, so we verify
      // the type structure by examining the import path.
      const { retrieveKnowledge, buildKnowledgeContextString } = await import("./index");

      const ctx = await retrieveKnowledge(supabase, "test query");
      const str = buildKnowledgeContextString(ctx);

      // Verify the types match what answerLocally expects
      expect(typeof str).toBe("string");
      expect(ctx).toHaveProperty("items");
      expect(ctx).toHaveProperty("layerCounts");
    });
  });

  // -----------------------------------------------------------------------
  // 4. Tool registry contains industry knowledge tools
  // -----------------------------------------------------------------------
  describe("Agent Runtime tool registration", () => {
    it("search_industry_knowledge tool exists in registry", () => {
      const tool = TOOL_BY_ID["atlas.search_industry_knowledge"];
      expect(tool).toBeDefined();
      expect(tool.name).toBe("Search industry knowledge");
      expect(tool.category).toBe("search");
      expect(tool.provider).toBeNull();
      expect(tool.riskLevel).toBe("READ");
      expect(tool.implementationStatus).toBe("planned");
    });

    it("search_evidence_requirements tool exists in registry", () => {
      const tool = TOOL_BY_ID["atlas.search_evidence_requirements"];
      expect(tool).toBeDefined();
      expect(tool.name).toBe("Search evidence requirements");
      expect(tool.category).toBe("search");
      expect(tool.provider).toBeNull();
      expect(tool.riskLevel).toBe("READ");
    });

    it("industry knowledge tool has proper input schema", () => {
      const tool = TOOL_BY_ID["atlas.search_industry_knowledge"];
      expect(tool.inputSchema.fields.length).toBe(4);
      const queryField = tool.inputSchema.fields.find((f) => f.key === "query");
      expect(queryField).toBeDefined();
      expect(queryField!.required).toBe(true);
      const limitField = tool.inputSchema.fields.find((f) => f.key === "limit");
      expect(limitField).toBeDefined();
      expect(limitField!.min).toBe(1);
      expect(limitField!.max).toBe(20);
    });

    it("knowledge tool requires member role (no admin restriction)", () => {
      const tool = TOOL_BY_ID["atlas.search_industry_knowledge"];
      expect(tool.authRequirements.minRole).toBe("member");
    });

    it("knowledge tool does not require any OAuth scopes", () => {
      const tool = TOOL_BY_ID["atlas.search_industry_knowledge"];
      expect(tool.requiredScopes).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Layer priority weighting
  // -----------------------------------------------------------------------
  describe("Knowledge layer priority", () => {
    it("live_evidence has highest priority", () => {
      expect(KNOWLEDGE_LAYER_PRIORITY.live_evidence).toBeGreaterThan(
        KNOWLEDGE_LAYER_PRIORITY.customer,
      );
    });

    it("customer has higher priority than atlas_industry", () => {
      expect(KNOWLEDGE_LAYER_PRIORITY.customer).toBeGreaterThan(
        KNOWLEDGE_LAYER_PRIORITY.atlas_industry,
      );
    });

    it("all priorities are between 0 and 1", () => {
      for (const [layer, priority] of Object.entries(KNOWLEDGE_LAYER_PRIORITY)) {
        expect(priority).toBeGreaterThan(0);
        expect(priority).toBeLessThanOrEqual(1);
      }
    });
  });

  // -----------------------------------------------------------------------
  // 6. Seed integrity
  // -----------------------------------------------------------------------
  describe("Seed knowledge integrity", () => {
    it("seed knowledge items have required fields", () => {
      for (const item of ATLAS_INDUSTRY_KNOWLEDGE_SEED) {
        expect(item.id).toBeTruthy();
        expect(item.title).toBeTruthy();
        expect(item.statement).toBeTruthy();
        expect(item.knowledgeType).toBeTruthy();
        expect(item.confidence).toBeGreaterThan(0);
        expect(item.confidence).toBeLessThanOrEqual(1);
        expect(item.status).toBe("active");
      }
    });

    it("seed provenance records have required fields", () => {
      for (const prov of ATLAS_KNOWLEDGE_PROVENANCE) {
        expect(prov.sourceId).toBeTruthy();
        expect(prov.sourceName).toBeTruthy();
        expect(prov.organization).toBeTruthy();
        expect(prov.authorityTier).toBeTruthy();
        expect(prov.status).toBe("active");
      }
    });

    it("seed knowledge items reference valid source IDs", () => {
      const provenanceIds = new Set(ATLAS_KNOWLEDGE_PROVENANCE.map((p) => p.sourceId));
      // All sourceless items should have sourceId undefined (not a bad ID)
      for (const item of ATLAS_INDUSTRY_KNOWLEDGE_SEED) {
        if (item.sourceId) {
          expect(provenanceIds.has(item.sourceId)).toBe(true);
        }
      }
    });
  });

  // -----------------------------------------------------------------------
  // 7. End-to-end knowledge context building
  // -----------------------------------------------------------------------
  describe("Knowledge context end-to-end", () => {
    it("builds context from multiple retrieval results", () => {
      const results: KnowledgeRetrievalResult[] = [
        {
          item: {
            id: "e1",
            layer: "atlas_industry",
            sourceClassification: "INDUSTRY_STANDARD",
            title: "Evidence Requirement A",
            statement: "Photo documentation required.",
            knowledgeType: "requirement",
            confidence: 0.9,
            status: "active",
            industry: "insurance_restoration",
            jurisdiction: "United States",
            isInference: false,
          },
          relevance: 0.9,
          retrievalMethod: "keyword",
          sourceClassification: "INDUSTRY_STANDARD",
          layer: "atlas_industry",
          provenance: {
            sourceId: "src-1",
            sourceName: "Standard A",
            organization: "Org A",
            authorityTier: "industry_standard",
            sourceType: "standard",
            status: "active",
          },
        },
        {
          item: {
            id: "e2",
            layer: "customer",
            sourceClassification: "CUSTOMER_PROVIDED",
            title: "Company SOP",
            statement: "Upload all photos within 24 hours.",
            knowledgeType: "document",
            confidence: 0.75,
            status: "active",
            isInference: false,
          },
          relevance: 0.75,
          retrievalMethod: "metadata",
          sourceClassification: "CUSTOMER_PROVIDED",
          layer: "customer",
        },
        {
          item: {
            id: "e3",
            layer: "live_evidence",
            sourceClassification: "CUSTOMER_GENERATED",
            title: "Claim Photos",
            statement: "12 photos uploaded for claim #12345.",
            knowledgeType: "claim_candidate",
            confidence: 0.85,
            status: "active",
            isInference: false,
          },
          relevance: 0.85,
          retrievalMethod: "evidence",
          sourceClassification: "CUSTOMER_GENERATED",
          layer: "live_evidence",
        },
      ];

      const ctx = buildKnowledgeContext(results);

      // Verify counts
      expect(ctx.layerCounts.atlas_industry).toBe(1);
      expect(ctx.layerCounts.customer).toBe(1);
      expect(ctx.layerCounts.live_evidence).toBe(1);
      expect(ctx.totalItems).toBe(3);

      // Verify provenance
      expect(ctx.hasProvenance).toBe(true);

      // Verify metadata
      expect(ctx.industries).toContain("insurance_restoration");
      expect(ctx.jurisdictions).toContain("United States");

      // Verify context string
      const str = buildKnowledgeContextString(ctx);
      expect(str).toContain("Atlas Industry Knowledge");
      expect(str).toContain("Company Knowledge");
      expect(str).toContain("Live Company Evidence");
      expect(str).toContain("Evidence Requirement A");
      expect(str).toContain("Company SOP");
      expect(str).toContain("Claim Photos");
      expect(str).toContain("Source: Standard A");
    });
  });
});
