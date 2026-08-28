// ---------------------------------------------------------------------------
// Atlas Knowledge Layer — Embeddings Provider Abstraction
//
// Provides a pluggable embeddings interface that supports:
//   - Local deterministic fallback (hash-based bag-of-words, 256-dim)
//   - External providers via the Atlas AI Runtime (Gemini, NVIDIA NIM, etc.)
//
// The local fallback ensures the knowledge system works without any paid API
// key. External providers replace this transparently when configured.
//
// Phase 2: Migrated from direct Gemini fetch() to ai-runtime embed().
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
// AI Runtime Embeddings Provider (external, via Atlas AI Runtime)
//
// Uses the provider-agnostic ai-runtime embed() function instead of direct
// Gemini API calls. Supports Gemini, NVIDIA NIM, or any future provider
// registered in the ai-runtime registry.
// ---------------------------------------------------------------------------

class AIRuntimeEmbeddingsProvider implements EmbeddingsProvider {
  name = "ai-runtime";
  dimension = 768; // default for text-embedding-004; adjusted per provider

  private _available = false;

  async initialize(): Promise<void> {
    try {
      const { initializeRegistry, getAvailableProviders } = await import("@/lib/ai-runtime");
      await initializeRegistry();
      const providers = getAvailableProviders();
      this._available = providers.some((p) => p.getModel("text-embedding-004")?.capabilities.embeddings || false);
    } catch {
      this._available = false;
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this._available) return texts.map(() => new Array(LOCAL_DIM).fill(0));

    try {
      const { embed } = await import("@/lib/ai-runtime");
      const result = await embed({
        texts,
        model: "text-embedding-004",
        timeoutMs: 15_000,
      });
      this.dimension = result.dimension;
      return result.embeddings;
    } catch (err) {
      console.warn(`[atlas] ai-runtime-embeddings: falling back to local —`,
        err instanceof Error ? err.message : err);
      return texts.map(localEmbedText);
    }
  }

  isAvailable(): boolean {
    return this._available;
  }
}

// ---------------------------------------------------------------------------
// Provider Factory
// ---------------------------------------------------------------------------

let _instance: EmbeddingsProvider | null = null;
let _initPromise: Promise<void> | null = null;

/**
 * Get the configured embeddings provider. Resolution order:
 *   1. Atlas AI Runtime embeddings (Gemini, NVIDIA NIM, etc.)
 *   2. Fallback → local deterministic embeddings (256-dim bag-of-words)
 *
 * The provider is a singleton — call this once and reuse.
 */
export async function getEmbeddingsProvider(): Promise<EmbeddingsProvider> {
  if (_instance) return _instance;

  // Try ai-runtime first
  const aiProvider = new AIRuntimeEmbeddingsProvider();
  _initPromise = aiProvider.initialize();
  await _initPromise;

  if (aiProvider.isAvailable()) {
    _instance = aiProvider;
  } else {
    _instance = new LocalEmbeddingsProvider();
  }

  return _instance;
}

/**
 * Get the embeddings provider synchronously (returns local if ai-runtime
 * is not yet initialized). Use the async version when possible.
 */
export function getEmbeddingsProviderSync(): EmbeddingsProvider {
  if (_instance) return _instance;
  // If nothing initialized yet, return local as safe default
  return new LocalEmbeddingsProvider();
}

/**
 * Reset the provider singleton (for testing or when configuration changes).
 */
export function resetEmbeddingsProvider(): void {
  _instance = null;
  _initPromise = null;
}

/**
 * Generate embeddings for an array of texts using the configured provider.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const provider = await getEmbeddingsProvider();
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
