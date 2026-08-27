// Atlas Knowledge Corpus — Table Diagnostic Script
import { getSupabaseClient } from '../src/lib/supabase';

async function main() {
  const supabase = getSupabaseClient();
  if (!supabase) { console.error("No Supabase client"); process.exit(1); }

  // Try all possible table name variants
  const variants = [
    "atlasIndustryProvenance",
    "atlasindustryprovenance",
    "atlasIndustryKnowledge",
    "atlasindustryknowledge",
    "atlasIndustryDocuments",
    "atlasindustrydocuments",
    "atlasIndustryChunks",
    "atlasindustrychunks",
    "atlasIndustryRelationships",
    "atlasindustryrelationships",
  ];

  console.log("=== Table Name Resolution Test ===");
  for (const name of variants) {
    const { count, error } = await supabase
      .from(name)
      .select("*", { count: "exact", head: true });
    if (error) {
      console.log(name + ": ERROR - " + error.message);
    } else {
      console.log(name + ": OK (" + count + " rows)");
    }
  }

  // Test calling a simpler RPC to check connectivity
  console.log("\n=== RPC Connectivity Test ===");
  const { data: stats, error: statsErr } = await supabase.rpc("industry_knowledge_stats");
  if (statsErr) {
    console.log("industry_knowledge_stats: ERROR - " + statsErr.message);
  } else {
    console.log("industry_knowledge_stats: OK");
    console.log(JSON.stringify(stats, null, 2));
  }

  // Check if the ingest function exists at all
  console.log("\n=== Function Existence Test ===");
  // Try calling with minimal args to see if function exists
  const { data: fnTest, error: fnErr } = await supabase.rpc("industry_ingest_corpus", {
    p_knowledge: [],
    p_provenance: [],
    p_relationships: [],
    p_corpus_version: "0.0.0-test",
  });
  if (fnErr) {
    console.log("industry_ingest_corpus: ERROR - " + fnErr.message);
    console.log("Code: " + fnErr.code);
  } else {
    console.log("industry_ingest_corpus: OK");
    console.log(JSON.stringify(fnTest, null, 2));
  }
}

main().catch(console.error);
