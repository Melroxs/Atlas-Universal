// ---------------------------------------------------------------------------
// Atlas Knowledge Layer — Embeddings Provider Abstraction
//
// Provides a pluggable embeddings interface that supports:
//   - Local deterministic fallback (hash-based bag-of-words, 256-dim)
//   - External providers (Gemini, OpenAI) via the existing provider config
//
// The local fallback ensures the knowledge system works without any paid API
// key. External providers replace this transparently when configured.
// ---------------------------------------------------------------------------

import type { EmbeddingsProvider } from "./types";

// ---------------------------------------------------------------------------
// Local deterministic embeddings (existing localEmbed module, adapted)
// ---------------------------------------------------------------------------

const LOCAL_DIM = 256;

function hashToken(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % LOCAL_DIM;
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for",
  "with", "at", "by", "from", "as", "is", "are", "was", "were", "be",
  "been", "this", "that", "these", "those", "it", "its", "we", "our",
  "you", "your", "they", "their", "has", "have", "had", "do", "does",
  "did", "not", "no", "yes", "will", "would", "can", "could", "should",
  "may", "might", "must", "per", "each", "all", "any", "some", "more",
  "than", "then", "them", "there", "here", "about", "into", "over",
  "under", "between", "during", "after", "before", "also", "very",
  "just", "only", "new", "other", "such", "which", "who", "whom",
  "what", "when", "where", "how", "why", "via", "etc", "incl", "e.g.",
]);

function tokenize(text: string): string[] {
  const cleaned = text.toLowerCase().replace(/[^a-z0-9\s$]/g, " ");
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  return tokens.filter((t) => t.length >= 2 && t.length <= 24 && !STOP.has(t));
}

/** Build a deterministic embedding vector for a piece of text. */
function localEmbedText(text: string): number[] {
  const vec = new Array<number>(LOCAL_DIM).fill(0);
  for (const token of tokenize(text)) {
    vec[hashToken(token)] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
  for (let i = 0; i < LOCAL_DIM; i++) vec[i] = vec[i] / norm;
  return vec;
}

/** Cosine similarity between two equal-length vectors. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// Local Embeddings Provider
// ---------------------------------------------------------------------------

class LocalEmbeddingsProvider implements EmbeddingsProvider {
  name = "local";
  dimension = LOCAL_DIM;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(localEmbedText);
  }

  isAvailable(): boolean {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Gemini Embeddings Provider (external, requires GEMINI_API_KEY)
// ---------------------------------------------------------------------------

class GeminiEmbeddingsProvider implements EmbeddingsProvider {
  name = "gemini";
  dimension = 768; // text-embedding-004 default

  private apiKey: string;
  private model: string;
  private available: boolean;

  constructor(apiKey: string, model = "text-embedding-004") {
    this.apiKey = apiKey;
    this.model = model;
    this.available = Boolean(apiKey);
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.available) return texts.map(() => new Array(LOCAL_DIM).fill(0));

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: `models/${this.model}`,
          content: { parts: texts.map((t) => ({ text: t })) },
          taskType: "RETRIEVAL_DOCUMENT",
        }),
      },
    );

    if (!response.ok) {
      console.warn(`[atlas] gemini-embeddings: HTTP ${response.status} — falling back to local`);
      return texts.map(localEmbedText);
    }

    const data = await response.json();
    // Gemini returns embeddings in data.embeddings[].values
    const embeddings = data?.embeddings?.map((e: { values: number[] }) => e.values);
    if (Array.isArray(embeddings) && embeddings.length === texts.length) {
      return embeddings;
    }

    // Fallback to local if response is malformed
    return texts.map(localEmbedText);
  }

  isAvailable(): boolean {
    return this.available;
  }
}

// ---------------------------------------------------------------------------
// Provider Factory
// ---------------------------------------------------------------------------

let _instance: EmbeddingsProvider | null = null;

/**
 * Get the configured embeddings provider. Resolution order:
 *   1. GEMINI_API_KEY → Gemini embeddings (text-embedding-004)
 *   2. Fallback → local deterministic embeddings (256-dim bag-of-words)
 *
 * The provider is a singleton — call this once and reuse.
 */
export function getEmbeddingsProvider(): EmbeddingsProvider {
  if (_instance) return _instance;

  // Check for Gemini API key (available in Edge Function context or via env)
  const geminiKey =
    typeof process !== "undefined"
      ? (process.env as Record<string, string | undefined>).GEMINI_API_KEY
      : undefined;

  if (geminiKey) {
    _instance = new GeminiEmbeddingsProvider(geminiKey);
  } else {
    _instance = new LocalEmbeddingsProvider();
  }

  return _instance;
}

/**
 * Reset the provider singleton (for testing or when configuration changes).
 */
export function resetEmbeddingsProvider(): void {
  _instance = null;
}

/**
 * Generate embeddings for an array of texts using the configured provider.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const provider = getEmbeddingsProvider();
  return provider.embed(texts);
}

/**
 * Compute cosine similarity between a query embedding and a list of
 * document embeddings, returning scored results sorted by relevance.
 */
export function rankBySimilarity(
  queryEmbedding: number[],
  documentEmbeddings: Array<{ id: string; embedding: number[]; [k: string]: unknown }>,
  topK = 10,
): Array<{ id: string; score: number; [k: string]: unknown }> {
  return documentEmbeddings
    .map((doc) => ({
      ...doc,
      score: cosine(queryEmbedding, doc.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * BM25-ish keyword overlap score (works on any text, no vectors needed).
 * Used as a retrieval fallback alongside semantic search.
 */
export function keywordScore(query: string, text: string): number {
  const qTokens = new Set(tokenize(query));
  const tTokens = tokenize(text);
  if (qTokens.size === 0 || tTokens.length === 0) return 0;
  let score = 0;
  const counts = new Map<string, number>();
  for (const t of tTokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  for (const qt of qTokens) {
    const c = counts.get(qt) ?? 0;
    if (c > 0) score += 1 + Math.log(1 + c);
  }
  return score / Math.sqrt(tTokens.length);
}
