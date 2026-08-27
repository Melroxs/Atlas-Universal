// Atlas Knowledge Corpus Ingestion Script
// Usage: bun run scripts/ingest-corpus.ts
//
// Prerequisites:
// 1. Apply migration 20260827b_atlas_knowledge_layer.sql (creates tables)
// 2. Apply migration 20260827c_fix_ingest_corpus.sql (creates fixed function)
// 3. Run this script

import { getSupabaseClient } from '../src/lib/supabase';
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
import { validateCorpus } from '../src/lib/knowledge/corpus/importer';

async function main() {
  console.log("=== Atlas Knowledge Corpus Ingestion ===");
  console.log("Corpus: " + CORPUS_MANIFEST.corpusName + " v" + CORPUS_MANIFEST.version);

  // Step 1: Validate locally
  const validation = validateCorpus();
  console.log("Validation: " + validation.validRecords + "/" + validation.totalRecords + " valid");
  if (!validation.valid) {
    console.error("FATAL: " + validation.errors.join(", "));
    process.exit(1);
  }

  // Step 2: Build payload
  const allKnowledge = [
    ...FEDERAL_REGULATIONS,
    ...WORKFLOW_STAGES,
    ...DOCUMENTATION_EVIDENCE,
    ...JURISDICTION_PROFILES,
    ...STANDARDS_METADATA,
    ...RISK_PATTERNS,
    ...REVENUE_RECOVERY,
  ];
  console.log("Payload: " + allKnowledge.length + " knowledge, " + CORPUS_PROVENANCE.length + " provenance, " + GRAPH_RELATIONSHIPS.length + " relationships");

  // Step 3: Connect
  const supabase = getSupabaseClient();
  if (!supabase) { console.error("No Supabase client"); process.exit(1); }

  // Step 4: Check pre-ingestion counts
  const { count: preK } = await supabase.from("atlasIndustryKnowledge").select("*", { count: "exact", head: true });
  const { count: preP } = await supabase.from("atlasIndustryProvenance").select("*", { count: "exact", head: true });
  console.log("Pre-ingestion: " + (preK ?? 0) + " knowledge, " + (preP ?? 0) + " provenance");

  // Step 5: Try RPC first, fall back to direct inserts
  console.log("\nAttempting RPC: industry_ingest_corpus()...");
  const { data: rpcData, error: rpcError } = await supabase.rpc("industry_ingest_corpus", {
    p_knowledge: allKnowledge,
    p_provenance: CORPUS_PROVENANCE,
    p_relationships: GRAPH_RELATIONSHIPS,
    p_corpus_version: CORPUS_MANIFEST.version,
  });

  if (rpcError) {
    console.log("RPC failed (" + rpcError.message + "), falling back to direct inserts...");
    await directInsert(supabase, allKnowledge, CORPUS_PROVENANCE, GRAPH_RELATIONSHIPS);
  } else {
    console.log("\nIngestion Report:");
    console.log(JSON.stringify(rpcData, null, 2));
  }

  // Step 6: Verify
  console.log("\n=== Post-Ingestion Verification ===");
  const { count: postK } = await supabase.from("atlasIndustryKnowledge").select("*", { count: "exact", head: true });
  const { count: postP } = await supabase.from("atlasIndustryProvenance").select("*", { count: "exact", head: true });
  const { count: postR } = await supabase.from("atlasindustryrelationships").select("*", { count: "exact", head: true });
  console.log("Knowledge: " + postK + " (expected: 168)");
  console.log("Provenance: " + postP + " (expected: 12)");
  console.log("Relationships: " + postR + " (expected: 50+)");

  // Jurisdiction check
  const { count: jC } = await supabase.from("atlasIndustryKnowledge").select("*", { count: "exact", head: true }).eq("knowledgeType", "jurisdiction");
  console.log("Jurisdictions: " + jC + " (expected: 51, all placeholders)");

  // Type distribution
  const { data: stats } = await supabase.rpc("industry_knowledge_stats");
  if (stats) {
    console.log("\nType distribution:");
    if (stats.byType) {
      for (const [t, c] of Object.entries(stats.byType as Record<string, number>)) {
        console.log("  " + t + ": " + c);
      }
    }
  }

  console.log("\n=== Done ===");
}

async function directInsert(supabase: any, knowledge: any[], provenance: any[], relationships: any[]) {
  const BATCH = 20;

  // Provenance
  console.log("Inserting provenance...");
  for (const p of provenance) {
    const { error } = await supabase.from("atlasIndustryProvenance").upsert({
      sourceid: p.sourceId, sourcename: p.sourceName,
      organization: p.organization, authoritytier: p.authorityTier,
      sourcetype: p.sourceType, canonicalurl: p.canonicalUrl ?? null, status: p.status,
    }, { onConflict: "sourceid" });
    if (error) console.error("  Prov error: " + error.message);
  }

  // Knowledge
  console.log("Inserting knowledge...");
  for (let i = 0; i < knowledge.length; i += BATCH) {
    const batch = knowledge.slice(i, i + BATCH);
    const rows = batch.map(k => ({
      title: k.title, statement: k.statement, interpretation: k.interpretation ?? null,
      knowledgetype: k.knowledgeType, sourceclassification: k.sourceClassification,
      industry: k.industry ?? null, jurisdiction: k.jurisdiction ?? null,
      version: k.corpusVersion ?? CORPUS_MANIFEST.version, confidence: k.confidence,
      status: k.status, isinference: k.isInference, tags: k.tags,
    }));
    const { error } = await supabase.from("atlasIndustryKnowledge").upsert(rows, { onConflict: "title,knowledgetype" });
    if (error) console.error("  Knowledge batch error: " + error.message);
  }

  // Relationships
  console.log("Inserting relationships...");
  for (let i = 0; i < relationships.length; i += BATCH) {
    const batch = relationships.slice(i, i + BATCH);
    const rows = batch.map(r => ({
      sourceid: r.sourceId, targetid: r.targetId, relationship: r.relationship,
      metadata: r.metadata ?? {}, corpusversion: CORPUS_MANIFEST.version,
    }));
    const { error } = await supabase.from("atlasindustryrelationships").upsert(rows, { onConflict: "sourceid,targetid,relationship" });
    if (error) console.error("  Rel batch error: " + error.message);
  }
}

main().catch((err) => { console.error("Unhandled error:", err); process.exit(1); });
