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
export {
  CORPUS_MANIFEST,
  CORPUS_PROVENANCE,
  FEDERAL_REGULATIONS,
  WORKFLOW_STAGES,
  DOCUMENTATION_EVIDENCE,
  JURISDICTION_PROFILES,
  STANDARDS_METADATA,
  CORPUS_RISKS,
  CORPUS_REVENUE,
  GRAPH_RELATIONSHIPS,
} from "./corpus";
export type {
  CorpusKnowledgeRecord,
  CorpusProvenanceRecord,
  CorpusGraphEdge,
} from "./corpus";
export {
  validateCorpus,
  normalizeCorpusToKnowledgeItems,
  normalizeCorpusProvenance,
  getValidatedGraphEdges,
  getIngestionReport,
} from "./corpus/importer";
export type { CorpusValidationResult } from "./corpus/importer";
