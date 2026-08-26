// ---------------------------------------------------------------------------
// Server-side knowledge retrieval — runs inside conversation-converse Edge
// Function. Queries atlasIndustryKnowledge directly via the service-role
// Supabase client so customer knowledge never leaves the server boundary.
//
// This extends the EXISTING conversation-converse flow — it does NOT create
// a parallel retrieval system. The retrieved knowledge is injected into the
// evidence context that Gemini (or the deterministic fallback) reasons over.
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

type Supabase = ReturnType<typeof createClient>;

// ---------------------------------------------------------------------------
// Types — minimal, matching the knowledge_layer / source_classification
// enums defined in supabase/migrations/20260826_atlas_knowledge_layer.sql
// ---------------------------------------------------------------------------

export type KnowledgeLayer = "atlas_industry" | "customer" | "live_evidence";

export type SourceClassification =
  | "INDUSTRY_STANDARD"
  | "REGULATORY"
  | "CARRIER_OR_INSURANCE"
  | "MANUFACTURER"
  | "PROFESSIONAL_GUIDANCE"
  | "ATLAS_CURATED"
  | "CUSTOMER_PROVIDED"
  | "CUSTOMER_GENERATED"
  | "MODEL_INFERENCE";

export interface KnowledgeItem {
  id: string;
  layer: KnowledgeLayer;
  sourceClassification: SourceClassification;
  title: string;
  statement: string;
  interpretation?: string;
  knowledgeType: string;
  industry?: string;
  jurisdiction?: string;
  confidence: number;
  status: string;
  sourceId?: string;
  documentId?: string;
  tags?: string[];
}

export interface KnowledgeRetrievalResult {
  item: KnowledgeItem;
  relevance: number;
  retrievalMethod: "keyword" | "metadata";
  layer: KnowledgeLayer;
  sourceClassification: SourceClassification;
  snippet?: string;
}

export interface KnowledgeRetrievalOptions {
  layers?: KnowledgeLayer[];
  sourceClassifications?: SourceClassification[];
  industry?: string;
  jurisdiction?: string;
  limit?: number;
  publishedOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Keyword scoring — lightweight server-side (no embeddings dependency)
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "shall", "can", "need",
  "dare", "ought", "used", "this", "that", "these", "those", "i", "me",
  "my", "myself", "we", "our", "ours", "ourselves", "you", "your",
  "yours", "yourself", "yourselves", "he", "him", "his", "himself", "she",
  "her", "hers", "herself", "it", "its", "itself", "they", "them",
  "their", "theirs", "themselves", "what", "which", "who", "whom",
  "when", "where", "why", "how", "all", "each", "every", "both", "few",
  "more", "most", "other", "some", "such", "no", "nor", "not", "only",
  "own", "same", "so", "than", "too", "very", "s", "t", "just", "don",
  "now",
]);

/** Tokenize text into lowercase words, stripping punctuation. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/** Simple BM25-style keyword score between query and document text. */
function keywordScore(query: string, document: string): number {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0;
  const docTokens = tokenize(document);
  if (docTokens.length === 0) return 0;

  const docTermFreq = new Map<string, number>();
  for (const t of docTokens) {
    docTermFreq.set(t, (docTermFreq.get(t) ?? 0) + 1);
  }

  let score = 0;
  for (const qt of queryTokens) {
    const tf = docTermFreq.get(qt) ?? 0;
    if (tf > 0) {
      // Term frequency with saturation (BM25-like)
      score += tf / (tf + 1.5);
    }
  }
  return score / queryTokens.length;
}

// ---------------------------------------------------------------------------
// RPC-based retrieval — queries atlasIndustryKnowledge via service-role
// ---------------------------------------------------------------------------

function normalizeRpcArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    const key = k.startsWith("p_") ? k : `p_${k}`;
    out[key.toLowerCase()] = v;
  }
  return out;
}

async function rpcCall(
  supabase: Supabase,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn, normalizeRpcArgs(args));
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Knowledge retrieval — the main server-side function
// ---------------------------------------------------------------------------

/**
 * Retrieve Atlas Industry Knowledge server-side, using the service-role
 * client so customer knowledge never leaves the server boundary.
 *
 * This is called from conversation-converse BEFORE the Gemini prompt is
 * constructed, and the results are injected into the evidence context.
 */
export async function retrieveIndustryKnowledge(
  supabase: Supabase,
  query: string,
  options: KnowledgeRetrievalOptions = {},
): Promise<KnowledgeRetrievalResult[]> {
  const {
    layers = ["atlas_industry"],
    sourceClassifications,
    industry,
    jurisdiction,
    limit = 10,
    publishedOnly = true,
  } = options;

  // Strategy 1: Try the deployed RPC if it exists
  try {
    const rpcArgs: Record<string, unknown> = {
      p_query: query,
      p_limit: limit,
    };
    if (publishedOnly) rpcArgs.p_published_only = true;
    if (layers.length === 1) rpcArgs.p_layer = layers[0];
    if (industry) rpcArgs.p_industry = industry;
    if (jurisdiction) rpcArgs.p_jurisdiction = jurisdiction;

    const raw = await rpcCall(supabase, "industry_search_knowledge", rpcArgs);
    if (Array.isArray(raw) && raw.length > 0) {
      return raw.map((row: Record<string, unknown>) => ({
        item: {
          id: String(row.id ?? ""),
          layer: (row.layer ?? row.knowledge_layer ?? "atlas_industry") as KnowledgeLayer,
          sourceClassification: (row.source_classification ?? row.sourceClassification ?? "ATLAS_CURATED") as SourceClassification,
          title: String(row.title ?? ""),
          statement: String(row.statement ?? row.content ?? ""),
          interpretation: row.interpretation ? String(row.interpretation) : undefined,
          knowledgeType: String(row.knowledge_type ?? row.knowledgeType ?? "general"),
          industry: row.industry ? String(row.industry) : undefined,
          jurisdiction: row.jurisdiction ? String(row.jurisdiction) : undefined,
          confidence: typeof row.confidence === "number" ? row.confidence : 0.7,
          status: String(row.status ?? "published"),
          sourceId: row.source_id ? String(row.source_id) : undefined,
          documentId: row.document_id ? String(row.document_id) : undefined,
          tags: Array.isArray(row.tags) ? row.tags.map(String) : undefined,
        },
        relevance: typeof row.relevance === "number" ? row.relevance : 0.5,
        retrievalMethod: "keyword" as const,
        layer: (row.layer ?? row.knowledge_layer ?? "atlas_industry") as KnowledgeLayer,
        sourceClassification: (row.source_classification ?? row.sourceClassification ?? "ATLAS_CURATED") as SourceClassification,
        snippet: row.statement ? String(row.statement).slice(0, 300) : undefined,
      }));
    }
  } catch {
    // RPC may not exist yet — fall through to direct query
  }

  // Strategy 2: Direct table query via service-role (RLS is bypassed)
  try {
    let q = supabase
      .from("atlasIndustryKnowledge")
      .select("*")
      .eq("status", "published")
      .limit(limit);

    // Apply layer filter
    if (layers.length === 1) {
      q = q.eq("layer", layers[0]);
    } else if (layers.length > 1) {
      q = q.in("layer", layers);
    }

    if (industry) q = q.eq("industry", industry);
    if (jurisdiction) q = q.eq("jurisdiction", jurisdiction);

    const { data, error } = await q;
    if (error || !data || data.length === 0) return [];

    // Score by keyword relevance
    const scored = data.map((row: Record<string, unknown>) => {
      const textToSearch = [
        row.title,
        row.statement,
        row.interpretation,
        row.knowledge_type,
        row.industry,
      ]
        .filter(Boolean)
        .join(" ");

      const relevance = keywordScore(query, textToSearch);

      return {
        item: {
          id: String(row._id ?? row.id ?? ""),
          layer: (row.layer ?? "atlas_industry") as KnowledgeLayer,
          sourceClassification: (row.source_classification ?? "ATLAS_CURATED") as SourceClassification,
          title: String(row.title ?? ""),
          statement: String(row.statement ?? ""),
          interpretation: row.interpretation ? String(row.interpretation) : undefined,
          knowledgeType: String(row.knowledge_type ?? "general"),
          industry: row.industry ? String(row.industry) : undefined,
          jurisdiction: row.jurisdiction ? String(row.jurisdiction) : undefined,
          confidence: typeof row.confidence === "number" ? row.confidence : 0.7,
          status: String(row.status ?? "published"),
          sourceId: row.source_id ? String(row.source_id) : undefined,
          documentId: row.document_id ? String(row.document_id) : undefined,
          tags: Array.isArray(row.tags) ? row.tags.map(String) : undefined,
        },
        relevance,
        retrievalMethod: "keyword" as const,
        layer: (row.layer ?? "atlas_industry") as KnowledgeLayer,
        sourceClassification: (row.source_classification ?? "ATLAS_CURATED") as SourceClassification,
        snippet: String(row.statement ?? "").slice(0, 300),
      };
    });

    // Sort by relevance, return top results
    return scored
      .sort((a, b) => b.relevance - a.relevance)
      .filter((r) => r.relevance > 0.05);
  } catch {
    // Table may not exist yet — return empty
    return [];
  }
}

// ---------------------------------------------------------------------------
// Build knowledge context string for the Gemini prompt
// ---------------------------------------------------------------------------

/**
 * Build a structured knowledge context string for inclusion in the Gemini
 * system prompt. This is server-side only — never sent to the client.
 */
export function buildKnowledgeContextString(
  results: KnowledgeRetrievalResult[],
): string {
  if (results.length === 0) return "";

  const sections: string[] = [];

  // Group by layer
  const byLayer = new Map<string, KnowledgeRetrievalResult[]>();
  for (const r of results) {
    const existing = byLayer.get(r.layer) ?? [];
    existing.push(r);
    byLayer.set(r.layer, existing);
  }

  const layerLabels: Record<string, string> = {
    atlas_industry: "ATLAS INDUSTRY KNOWLEDGE",
    customer: "COMPANY KNOWLEDGE",
    live_evidence: "LIVE COMPANY EVIDENCE",
  };

  for (const [layer, items] of byLayer) {
    const label = layerLabels[layer] ?? layer.toUpperCase();
    sections.push(`\n### ${label}`);
    for (const r of items.slice(0, 5)) {
      const source = r.sourceClassification
        ? ` [${r.sourceClassification}]`
        : "";
      const confidence = r.item.confidence
        ? ` (confidence: ${r.item.confidence})`
        : "";
      sections.push(`- **${r.item.title}**${source}${confidence}`);
      if (r.item.statement) {
        sections.push(`  ${r.item.statement.slice(0, 200)}`);
      }
      if (r.item.interpretation) {
        sections.push(`  *Interpretation: ${r.item.interpretation.slice(0, 150)}*`);
      }
    }
  }

  return sections.join("\n");
}
