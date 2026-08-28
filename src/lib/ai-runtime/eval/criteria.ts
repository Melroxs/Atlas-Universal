// ---------------------------------------------------------------------------
// Atlas AI Runtime — Evaluation Criteria
//
// Scoring functions that evaluate model outputs against expected results.
// Each function returns a 0-100 score.
// ---------------------------------------------------------------------------

import type { EvalCase, EvalCaseResult } from "./types";

// ---------------------------------------------------------------------------
// Structural validity scoring
// ---------------------------------------------------------------------------

/**
 * Score how well the output matches the expected JSON schema.
 * Returns 0-100.
 */
export function scoreStructuralValidity(
  output: string,
  expectedSchema?: Record<string, unknown>,
): { score: number; parsed?: Record<string, unknown> } {
  if (!expectedSchema) {
    // No schema required — structural scoring is N/A, return neutral
    return { score: 100 };
  }

  // Try to parse as JSON
  let parsed: Record<string, unknown>;
  try {
    const trimmed = output.trim();
    // Handle markdown code blocks wrapping JSON
    const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1]!.trim() : trimmed;
    parsed = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    return { score: 0 };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { score: 0 };
  }

  let score = 100;
  const required = (expectedSchema.required as string[]) ?? [];

  // Check required fields
  for (const field of required) {
    if (!(field in parsed) || parsed[field] === undefined || parsed[field] === null) {
      score -= 15; // Penalty for missing required field
    }
  }

  // Bonus for having extra well-structured fields
  const fieldCount = Object.keys(parsed).length;
  if (fieldCount >= 3) {
    score = Math.min(100, score + 5);
  }

  return { score: Math.max(0, Math.min(100, score)), parsed };
}

// ---------------------------------------------------------------------------
// Keyword coverage scoring
// ---------------------------------------------------------------------------

/**
 * Score how many expected keywords appear in the output.
 * Returns 0-100.
 */
export function scoreKeywordCoverage(
  output: string,
  expectedKeywords?: string[],
): number {
  if (!expectedKeywords || expectedKeywords.length === 0) {
    return 100; // No keywords required
  }

  const lowerOutput = output.toLowerCase();
  let found = 0;

  for (const keyword of expectedKeywords) {
    if (lowerOutput.includes(keyword.toLowerCase())) {
      found++;
    }
  }

  return Math.round((found / expectedKeywords.length) * 100);
}

// ---------------------------------------------------------------------------
// Grounding accuracy scoring
// ---------------------------------------------------------------------------

/**
 * Score how well the output matches the ground truth.
 * Uses keyword overlap as a proxy for semantic similarity.
 * Returns 0-100.
 */
export function scoreGrounding(
  output: string,
  groundTruth?: string,
): number {
  if (!groundTruth) {
    return 100; // No ground truth to compare against
  }

  const outputWords = new Set(
    output
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 3), // Only meaningful words
  );

  const truthWords = new Set(
    groundTruth
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );

  if (truthWords.size === 0) return 100;

  let overlap = 0;
  for (const word of truthWords) {
    if (outputWords.has(word)) {
      overlap++;
    }
  }

  // Jaccard-like similarity, but biased toward coverage of ground truth
  const coverageScore = (overlap / truthWords.size) * 100;

  // Also check if key concepts from ground truth appear
  const truthPhrases = groundTruth
    .toLowerCase()
    .split(/[.;,]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 5);

  let phraseHits = 0;
  for (const phrase of truthPhrases) {
    if (output.toLowerCase().includes(phrase)) {
      phraseHits++;
    }
  }

  const phraseBonus =
    truthPhrases.length > 0
      ? (phraseHits / truthPhrases.length) * 20
      : 0;

  return Math.round(Math.min(100, coverageScore * 0.8 + phraseBonus + 10));
}

// ---------------------------------------------------------------------------
// Hallucination detection
// ---------------------------------------------------------------------------

/**
 * Score hallucination rate. 100 = no hallucination detected.
 * Checks for forbidden phrases and obvious fabrication markers.
 * Returns 0-100.
 */
export function scoreHallucination(
  output: string,
  forbiddenPhrases?: string[],
): number {
  let score = 100;

  // Check forbidden phrases
  if (forbiddenPhrases) {
    const lowerOutput = output.toLowerCase();
    for (const phrase of forbiddenPhrases) {
      if (lowerOutput.includes(phrase.toLowerCase())) {
        score -= 20;
      }
    }
  }

  // Check for common hallucination markers
  const hallucinationMarkers = [
    /I\s+(?:don't|cannot|can't)\s+(?:have|access|see)\s+(?:any\s+)?(?:data|information|context)/i,
    /there\s+(?:is|are)\s+no\s+(?:evidence|data|information)/i,
    /I\s+(?:was|am)\s+(?:not|unable)\s+provided/i,
    /based\s+on\s+(?:the\s+)?(?:limited|no|insufficient)\s+information/i,
  ];

  for (const marker of hallucinationMarkers) {
    if (marker.test(output)) {
      score -= 10;
    }
  }

  return Math.max(0, Math.min(100, score));
}

// ---------------------------------------------------------------------------
// Completeness scoring
// ---------------------------------------------------------------------------

/**
 * Score how complete the output is based on expected structure.
 * Returns 0-100.
 */
export function scoreCompleteness(
  output: string,
  case_: EvalCase,
): number {
  let score = 50; // Base score for producing any output

  // Length heuristic — very short responses are likely incomplete
  const wordCount = output.split(/\s+/).length;
  if (wordCount < 20) {
    score -= 20;
  } else if (wordCount < 50) {
    score -= 10;
  } else if (wordCount >= 100) {
    score += 10;
  }

  // For structured tasks, check if response has multiple sections
  if (case_.requiresStructuredOutput) {
    // Check for list-like structure
    if (output.includes("\n") || output.includes("- ") || output.includes("1.")) {
      score += 10;
    }

    // Check for reasonable response length for structured output
    if (wordCount >= 100) {
      score += 10;
    }
  }

  // Check keyword coverage as proxy for addressing the prompt
  if (case_.expectedKeywords && case_.expectedKeywords.length > 0) {
    const kwScore = scoreKeywordCoverage(output, case_.expectedKeywords);
    score += Math.round(kwScore * 0.2); // Up to +20
  }

  return Math.max(0, Math.min(100, score));
}

// ---------------------------------------------------------------------------
// Overall score computation
// ---------------------------------------------------------------------------

/**
 * Compute the overall score from individual dimension scores.
 * Weights are based on Atlas workload priorities.
 */
export function computeOverallScore(scores: {
  structural: number;
  keyword: number;
  grounding: number;
  hallucination: number;
  completeness: number;
}): number {
  // Weighted average
  const weights = {
    structural: 0.25,
    keyword: 0.15,
    grounding: 0.25,
    hallucination: 0.20,
    completeness: 0.15,
  };

  return Math.round(
    scores.structural * weights.structural +
      scores.keyword * weights.keyword +
      scores.grounding * weights.grounding +
      scores.hallucination * weights.hallucination +
      scores.completeness * weights.completeness,
  );
}

// ---------------------------------------------------------------------------
// Build complete case result
// ---------------------------------------------------------------------------

/**
 * Score a model's output against an evaluation case.
 */
export function scoreCaseResult(params: {
  case_: EvalCase;
  output: string;
  modelId: string;
  providerId: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  success: boolean;
  errorMessage?: string;
  errorCode?: string;
  fallbackFrom?: string;
}): EvalCaseResult {
  const { case_: c, output } = params;

  if (!params.success) {
    return {
      caseId: c.id,
      task: c.task,
      modelId: params.modelId,
      providerId: params.providerId as any,
      overallScore: 0,
      structuralScore: 0,
      keywordScore: 0,
      groundingScore: 0,
      hallucinationScore: 0,
      completenessScore: 0,
      latencyMs: params.latencyMs,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      estimatedCostUsd: params.estimatedCostUsd,
      success: false,
      errorMessage: params.errorMessage,
      errorCode: params.errorCode,
      reviewStatus: "rejected",
      fallbackFrom: params.fallbackFrom as any,
    };
  }

  const structural = scoreStructuralValidity(output, c.expectedSchema);
  const keyword = scoreKeywordCoverage(output, c.expectedKeywords);
  const grounding = scoreGrounding(output, c.groundTruth);
  const hallucination = scoreHallucination(output, c.forbiddenPhrases);
  const completeness = scoreCompleteness(output, c);

  const overall = computeOverallScore({
    structural: structural.score,
    keyword,
    grounding,
    hallucination,
    completeness,
  });

  // Determine review status
  let reviewStatus: EvalCaseResult["reviewStatus"] = "pending";
  if (overall >= 80) {
    reviewStatus = "approved";
  } else if (overall < 40) {
    reviewStatus = "rejected";
  } else {
    reviewStatus = "needs_review";
  }

  return {
    caseId: c.id,
    task: c.task,
    modelId: params.modelId,
    providerId: params.providerId as any,
    overallScore: overall,
    structuralScore: structural.score,
    keywordScore: keyword,
    groundingScore: grounding,
    hallucinationScore: hallucination,
    completenessScore: completeness,
    latencyMs: params.latencyMs,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    estimatedCostUsd: params.estimatedCostUsd,
    success: true,
    actualOutput: output,
    actualParsed: structural.parsed,
    reviewStatus,
    fallbackFrom: params.fallbackFrom as any,
  };
}
