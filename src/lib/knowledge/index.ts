// ---------------------------------------------------------------------------
// Atlas Knowledge Layer — Public API
//
// Single entry point for all knowledge layer modules.
// ---------------------------------------------------------------------------

export * from "./types";
export {
  getEmbeddingsProvider,
  resetEmbeddingsProvider,
  generateEmbeddings,
  rankBySimilarity,
  cosine,
  keywordScore,
} from "./embeddings";
export {
  retrieveKnowledge,
  classifyIntent,
  buildKnowledgeContext,
  buildKnowledgeContextString,
  getIntentClassification,
} from "./retrieval";
export {
  ATLAS_INDUSTRY_KNOWLEDGE_SEED,
  ATLAS_KNOWLEDGE_PROVENANCE,
  INDUSTRY_TERMS,
  EVIDENCE_REQUIREMENTS,
  CLAIM_LIFECYCLE,
  RISK_PATTERNS,
  REVENUE_CONCEPTS,
  INDUSTRY_ROLES,
} from "./seed";
