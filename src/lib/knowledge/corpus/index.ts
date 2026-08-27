// ---------------------------------------------------------------------------
// Atlas Knowledge Corpus — Barrel Export
//
// Single entry point for all corpus data modules.
// Uses unique export names to avoid conflicts with seed.ts.
// ---------------------------------------------------------------------------

export { CORPUS_MANIFEST } from "./manifest";
export type {
  CorpusKnowledgeRecord,
  CorpusProvenanceRecord,
  CorpusGraphEdge,
} from "./manifest";
export { CORPUS_SOURCES, CORPUS_PROVENANCE } from "./sources";
export { FEDERAL_REGULATIONS } from "./regulations";
export { WORKFLOW_STAGES } from "./workflows";
export { DOCUMENTATION_EVIDENCE } from "./evidence";
export { JURISDICTION_PROFILES } from "./jurisdictions";
export { STANDARDS_METADATA } from "./standards";
export { RISK_PATTERNS as CORPUS_RISKS } from "./risks";
export { REVENUE_RECOVERY as CORPUS_REVENUE } from "./revenue";
export { GRAPH_RELATIONSHIPS } from "./graph";
