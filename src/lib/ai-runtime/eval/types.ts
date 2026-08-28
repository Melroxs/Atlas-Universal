// ---------------------------------------------------------------------------
// Atlas AI Runtime — Evaluation Types
//
// Data structures for benchmark runs, individual case results, and scorecards.
// ---------------------------------------------------------------------------

import type { ProviderId } from "../types";
import type { AtlasAITask } from "../tasks";

// ---------------------------------------------------------------------------
// Evaluation case (a single test scenario)
// ---------------------------------------------------------------------------

export interface EvalCase {
  /** Unique identifier for this case. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Task category this case tests. */
  task: AtlasAITask;
  /** Domain category for grouping. */
  domain:
    | "claims"
    | "evidence"
    | "knowledge"
    | "decision_engine"
    | "ask_atlas"
    | "crm"
    | "embedding";
  /** The prompt/input for the model. */
  prompt: string;
  /** System prompt (if any). */
  systemPrompt?: string;
  /** Expected output structure (JSON schema for structured tasks). */
  expectedSchema?: Record<string, unknown>;
  /** Expected keywords/phrases that MUST appear in the response. */
  expectedKeywords?: string[];
  /** Expected phrases that must NOT appear (hallucination markers). */
  forbiddenPhrases?: string[];
  /** Ground-truth reference for accuracy scoring. */
  groundTruth?: string;
  /** Whether structured output is required for this case. */
  requiresStructuredOutput: boolean;
  /** Maximum acceptable latency in ms (for benchmarking). */
  maxLatencyMs?: number;
  /** Difficulty level. */
  difficulty: "easy" | "medium" | "hard";
}

// ---------------------------------------------------------------------------
// Evaluation result (per-case outcome)
// ---------------------------------------------------------------------------

export interface EvalCaseResult {
  /** Case that was evaluated. */
  caseId: string;
  /** Task tested. */
  task: AtlasAITask;
  /** Model that was tested. */
  modelId: string;
  /** Provider used. */
  providerId: ProviderId;

  // Scores (0-100 each)
  /** Overall score for this case. */
  overallScore: number;
  /** Structural validity of output (valid JSON matching schema = 100). */
  structuralScore: number;
  /** Keyword coverage score. */
  keywordScore: number;
  /** Grounding accuracy (how well response matches ground truth). */
  groundingScore: number;
  /** Hallucination score (100 = no hallucination, 0 = severe). */
  hallucinationScore: number;
  /** Required field completeness. */
  completenessScore: number;

  // Performance
  /** Latency in ms. */
  latencyMs: number;
  /** Input tokens (if reported by provider). */
  inputTokens: number;
  /** Output tokens (if reported by provider). */
  outputTokens: number;
  /** Estimated cost in USD. */
  estimatedCostUsd: number;

  // Outcome
  /** Whether the call succeeded. */
  success: boolean;
  /** Error message if failed. */
  errorMessage?: string;
  /** Error code if failed. */
  errorCode?: string;
  /** The raw model output (for review). */
  actualOutput?: string;
  /** Parsed structured output (if applicable). */
  actualParsed?: Record<string, unknown>;
  /** Whether fallback was used. */
  fallbackFrom?: ProviderId;
  /** Review status (for human review). */
  reviewStatus: "pending" | "approved" | "rejected" | "needs_review";
}

// ---------------------------------------------------------------------------
// Evaluation run (a complete benchmark session)
// ---------------------------------------------------------------------------

export interface EvalRun {
  /** Unique run identifier. */
  runId: string;
  /** When the run started. */
  startedAt: string;
  /** When the run completed. */
  completedAt?: string;
  /** Models that were evaluated. */
  modelsEvaluated: Array<{
    providerId: ProviderId;
    modelId: string;
  }>;
  /** Total cases evaluated. */
  totalCases: number;
  /** Total individual results. */
  totalResults: number;
  /** Cases that passed. */
  passed: number;
  /** Cases that failed. */
  failed: number;
  /** Cases that errored. */
  errored: number;
  /** Total estimated cost. */
  totalCostUsd: number;
  /** Average latency across all results. */
  avgLatencyMs: number;
  /** Whether the run completed fully. */
  completed: boolean;
  /** Error message if run was interrupted. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Model scorecard
// ---------------------------------------------------------------------------

export interface ModelScorecard {
  /** Model identifier. */
  modelId: string;
  /** Provider identifier. */
  providerId: ProviderId;

  // Aggregate scores (0-100)
  /** Overall score across all tasks. */
  overallScore: number;
  /** Score by domain. */
  domainScores: Record<string, number>;
  /** Score by task. */
  taskScores: Record<AtlasAITask, number>;

  // Performance metrics
  /** Average latency. */
  avgLatencyMs: number;
  /** P95 latency. */
  p95LatencyMs: number;
  /** Success rate (0-1). */
  successRate: number;
  /** Total cost. */
  totalCostUsd: number;
  /** Cost per case. */
  costPerCase: number;
  /** Total tokens used. */
  totalTokens: number;

  // Quality metrics
  /** Average structural validity. */
  avgStructuralScore: number;
  /** Average grounding accuracy. */
  avgGroundingScore: number;
  /** Average hallucination rate (lower = better). */
  avgHallucinationRate: number;
  /** Average completeness. */
  avgCompletenessScore: number;
  /** Average keyword coverage. */
  avgKeywordScore: number;

  // Case counts
  /** Total cases evaluated. */
  totalCases: number;
  /** Cases that passed (score >= 70). */
  passedCases: number;
  /** Cases that failed. */
  failedCases: number;
}

// ---------------------------------------------------------------------------
// Benchmark recommendation
// ---------------------------------------------------------------------------

export interface BenchmarkRecommendation {
  /** Task or domain this recommendation applies to. */
  task: AtlasAITask | "overall";
  /** Recommended model. */
  recommendedModelId: string;
  /** Recommended provider. */
  recommendedProviderId: ProviderId;
  /** Current routing model (what Phase 3 would use). */
  currentModelId: string;
  /** Whether a change is recommended. */
  changeRecommended: boolean;
  /** Reason for recommendation. */
  reason: string;
  /** Expected improvement score (0-100). */
  expectedImprovement: number;
}
