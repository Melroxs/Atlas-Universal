// Generate a SQL ingestion script from the TypeScript corpus modules.
// Usage: bun run scripts/generate-ingest-sql.ts > /tmp/ingest.sql
// Then paste the output into Supabase SQL Editor and run it.

import { CORPUS_PROVENANCE } from '../src/lib/knowledge/corpus/sources';
import { FEDERAL_REGULATIONS } from '../src/lib/knowledge/corpus/regulations';
import { WORKFLOW_STAGES } from '../src/lib/knowledge/corpus/workflows';
import { DOCUMENTATION_EVIDENCE } from '../src/lib/knowledge/corpus/evidence';
import { JURISDICTION_PROFILES } from '../src/lib/knowledge/corpus/jurisdictions';
import { STANDARDS_METADATA } from '../src/lib/knowledge/corpus/standards';
import { RISK_PATTERNS } from '../src/lib/knowledge/corpus/risks';
import { REVENUE_RECOVERY } from '../src/lib/knowledge/corpus/revenue';
import { GRAPH_RELATIONSHIPS } from '../src/lib/knowledge/corpus/graph';
import { CORPUS_MANIFEST } from '../src/lib/knowledge/corpus/manifest';

const allKnowledge = [
  ...FEDERAL_REGULATIONS,
  ...WORKFLOW_STAGES,
  ...DOCUMENTATION_EVIDENCE,
  ...JURISDICTION_PROFILES,
  ...STANDARDS_METADATA,
  ...RISK_PATTERNS,
  ...REVENUE_RECOVERY,
];

console.log("-- Atlas Knowledge Corpus Ingestion SQL");
console.log("-- Corpus: " + CORPUS_MANIFEST.corpusName + " v" + CORPUS_MANIFEST.version);
console.log("-- Knowledge: " + allKnowledge.length + " records");
console.log("-- Provenance: " + CORPUS_PROVENANCE.length + " records");
console.log("-- Relationships: " + GRAPH_RELATIONSHIPS.length + " records");
console.log("--");
console.log("-- Paste this into Supabase SQL Editor and run it.");
console.log("-- The function industry_ingest_corpus() must exist (apply migration 20260827e first).");
console.log("");

console.log("SELECT public.industry_ingest_corpus(");
console.log("  " + JSON.stringify(allKnowledge) + "::jsonb,");
console.log("  " + JSON.stringify(CORPUS_PROVENANCE) + "::jsonb,");
console.log("  " + JSON.stringify(GRAPH_RELATIONSHIPS) + "::jsonb,");
console.log("  '" + CORPUS_MANIFEST.version + "'");
console.log(");");
console.log("");
console.log("-- Verification queries:");
console.log("SELECT count(*) AS knowledge_count FROM \"atlasIndustryKnowledge\";");
console.log("SELECT count(*) AS provenance_count FROM \"atlasIndustryProvenance\";");
console.log("SELECT count(*) AS relationships_count FROM atlasIndustryRelationships;");
console.log("SELECT \"knowledgeType\", count(*) FROM \"atlasIndustryKnowledge\" GROUP BY \"knowledgeType\" ORDER BY \"knowledgeType\";");
console.log("SELECT count(*) AS jurisdictions FROM \"atlasIndustryKnowledge\" WHERE \"knowledgeType\" = 'jurisdiction';");
