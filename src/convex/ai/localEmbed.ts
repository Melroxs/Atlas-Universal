// ---------------------------------------------------------------------------
// Local, deterministic embeddings — used when no AI gateway is available.
// Token-hash bag-of-words vectors with L2 normalization. Good enough for
// MVP-scale semantic-ish retrieval; AI embeddings replace this transparently.
// ---------------------------------------------------------------------------

const DIM = 256;

function hashToken(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % DIM;
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
  const filtered: string[] = [];
  for (const t of tokens) {
    if (t.length < 2 || t.length > 24) continue;
    if (STOP.has(t)) continue;
    filtered.push(t);
  }
  return filtered;
}

/** Build a deterministic embedding vector for a piece of text. */
export function localEmbed(text: string): number[] {
  const vec = new Array<number>(DIM).fill(0);
  for (const token of tokenize(text)) {
    vec[hashToken(token)] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
  for (let i = 0; i < DIM; i++) vec[i] = vec[i] / norm;
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

/** Simple BM25-ish keyword overlap score (works on any text, no vectors). */
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
