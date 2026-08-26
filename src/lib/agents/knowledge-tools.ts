// ---------------------------------------------------------------------------
// Atlas Agent Runtime — Knowledge Tool Executors
//
// Wires the knowledge tools into the Agent Runtime with actual execution
// handlers. Tools return structured results with provenance.
// ---------------------------------------------------------------------------

import { registerTools, type ToolExecutor } from "./tool-registry";
import { retrieveKnowledge, buildKnowledgeContextString } from "../knowledge/retrieval";
import type { KnowledgeLayer, KnowledgeRetrievalResult } from "../knowledge/types";
import type { JobExecutionContext } from "../jobs/types";

// ---------------------------------------------------------------------------
// Search Industry Knowledge — executor
// ---------------------------------------------------------------------------

const searchIndustryKnowledgeExecutor: ToolExecutor = async (
  ctx: JobExecutionContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const query = String(input.query ?? "").trim();
  if (!query) {
    return { results: [], totalResults: 0, error: "Query is required" };
  }

  const supabase = ctx.supabase as any;
  const limit = typeof input.limit === "number" ? Math.min(input.limit, 20) : 10;
  const industry = input.industry ? String(input.industry) : undefined;
  const sourceClassification = input.sourceClassification
    ? String(input.sourceClassification)
    : undefined;

  const context = await retrieveKnowledge(supabase, query, {
    layers: ["atlas_industry" as KnowledgeLayer],
    industry,
    sourceClassifications: sourceClassification
      ? [sourceClassification as any]
      : undefined,
    limit,
    publishedOnly: true,
  });

  const items: KnowledgeRetrievalResult[] = context.items;

  return {
    results: items.map((r) => ({
      id: r.item.id,
      title: r.item.title,
      statement: r.item.statement,
      interpretation: r.item.interpretation,
      knowledgeType: r.item.knowledgeType,
      sourceClassification: r.sourceClassification,
      layer: r.layer,
      relevance: r.relevance,
      confidence: r.item.confidence,
      industry: r.item.industry,
      jurisdiction: r.item.jurisdiction,
      sourceId: r.item.sourceId,
      tags: r.item.tags,
      provenance: r.provenance
        ? {
            sourceId: r.provenance.sourceId,
            sourceName: r.provenance.sourceName,
            organization: r.provenance.organization,
            authorityTier: r.provenance.authorityTier,
            canonicalUrl: r.provenance.canonicalUrl,
          }
        : undefined,
    })),
    totalResults: items.length,
    query,
    knowledgeContext: buildKnowledgeContextString({ items, layerCounts: { customer: 0, atlas_industry: 0, live_evidence: 0 }, totalItems: items.length, hasProvenance: items.some(r => !!r.provenance), industries: [], jurisdictions: [] }),
  };
};

// ---------------------------------------------------------------------------
// Search Evidence Requirements — executor
// ---------------------------------------------------------------------------

const searchEvidenceRequirementsExecutor: ToolExecutor = async (
  ctx: JobExecutionContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const claimElement = String(input.claimElement ?? "").trim();
  if (!claimElement) {
    return { requirements: [], totalRequirements: 0, error: "claimElement is required" };
  }

  const workflow = input.workflow ? String(input.workflow) : undefined;
  const supabase = ctx.supabase as any;

  const context = await retrieveKnowledge(supabase, claimElement, {
    layers: ["atlas_industry" as KnowledgeLayer],
    limit: 10,
    publishedOnly: true,
  });

  const allItems: KnowledgeRetrievalResult[] = context.items;

  // Filter for requirement-type knowledge items
  const requirements = allItems.filter(
    (r) =>
      r.item.knowledgeType === "requirement" ||
      r.item.knowledgeType === "standard_reference" ||
      r.sourceClassification === "INDUSTRY_STANDARD" ||
      r.sourceClassification === "REGULATORY",
  );

  return {
    requirements: requirements.map((r) => ({
      id: r.item.id,
      title: r.item.title,
      statement: r.item.statement,
      interpretation: r.item.interpretation,
      sourceClassification: r.sourceClassification,
      relevance: r.relevance,
      confidence: r.item.confidence,
      industry: r.item.industry,
      jurisdiction: r.item.jurisdiction,
      provenance: r.provenance
        ? {
            sourceId: r.provenance.sourceId,
            sourceName: r.provenance.sourceName,
            organization: r.provenance.organization,
          }
        : undefined,
    })),
    allResults: allItems.map((r) => ({
      id: r.item.id,
      title: r.item.title,
      statement: r.item.statement,
      knowledgeType: r.item.knowledgeType,
      sourceClassification: r.sourceClassification,
      relevance: r.relevance,
    })),
    totalRequirements: requirements.length,
    totalResults: allItems.length,
    claimElement,
    workflow: workflow ?? "general",
  };
};

// ---------------------------------------------------------------------------
// Register all knowledge tools
// ---------------------------------------------------------------------------

export function registerKnowledgeTools(): void {
  registerTools([
    {
      name: "atlas.search_industry_knowledge",
      description:
        "Search Atlas industry knowledge for construction/restoration/insurance concepts, evidence requirements, standards, and guidance.",
      risk_level: "read",
      readOnly: true,
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          industry: { type: "string", description: "Restrict to a specific industry" },
          sourceClassification: {
            type: "string",
            enum: [
              "INDUSTRY_STANDARD",
              "REGULATORY",
              "CARRIER_OR_INSURANCE",
              "MANUFACTURER",
              "PROFESSIONAL_GUIDANCE",
              "ATLAS_CURATED",
            ],
          },
          limit: { type: "number", minimum: 1, maximum: 20 },
        },
        required: ["query"],
      },
      tenant_isolated: false,
      execute: searchIndustryKnowledgeExecutor,
    },
    {
      name: "atlas.search_evidence_requirements",
      description:
        "Search for evidence requirements related to a claim element, supplement, or workflow.",
      risk_level: "read",
      readOnly: true,
      input_schema: {
        type: "object",
        properties: {
          claimElement: {
            type: "string",
            description: "The claim element to find evidence requirements for",
          },
          workflow: {
            type: "string",
            enum: ["claim_readiness", "supplement_readiness", "submission_readiness"],
          },
        },
        required: ["claimElement"],
      },
      tenant_isolated: false,
      execute: searchEvidenceRequirementsExecutor,
    },
  ]);
}
