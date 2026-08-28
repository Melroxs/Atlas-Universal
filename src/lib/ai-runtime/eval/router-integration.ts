// ---------------------------------------------------------------------------
// Atlas AI Runtime — Router Integration
//
// Translates benchmark scorecards into actionable routing configuration
// suggestions. Maintains a hard separation between benchmark data and
// production routing — benchmark results NEVER auto-switch production models.
// ---------------------------------------------------------------------------

import type { ProviderId } from "../types";
import type { AtlasAITask } from "../tasks";
import type { ModelScorecard, BenchmarkRecommendation } from "./types";
import { getRoutingConfig, updateRoutingConfig } from "../task-router";

// ---------------------------------------------------------------------------
// Routing configuration suggestion
// ---------------------------------------------------------------------------

export interface RoutingSuggestion {
  /** Task this suggestion applies to. */
  task: AtlasAITask | "all";
  /** Current routing model for this task. */
  currentModelId: string;
  /** Current routing provider for this task. */
  currentProviderId: ProviderId;
  /** Suggested model based on benchmark. */
  suggestedModelId: string;
  /** Suggested provider. */
  suggestedProviderId: ProviderId;
  /** Confidence level (0-1) in this suggestion. */
  confidence: number;
  /** Human-readable reason. */
  reason: string;
  /** Expected improvement percentage. */
  expectedImprovement: number;
}

// ---------------------------------------------------------------------------
// Generate routing suggestions from scorecards
// ---------------------------------------------------------------------------

/**
 * Analyze benchmark scorecards and generate routing configuration suggestions.
 *
 * IMPORTANT: These are suggestions only. They do NOT automatically change
 * production routing. An explicit call to applyRoutingSuggestions() is required.
 */
export function generateRoutingSuggestions(
  scorecards: ModelScorecard[],
  currentConfig?: ReturnType<typeof getRoutingConfig>,
): RoutingSuggestion[] {
  if (scorecards.length < 2) {
    return []; // Need at least 2 models to compare
  }

  const config = currentConfig ?? getRoutingConfig();
  const suggestions: RoutingSuggestion[] = [];

  // Collect all tasks across all scorecards
  const allTasks = new Set<AtlasAITask>();
  for (const sc of scorecards) {
    for (const task of Object.keys(sc.taskScores) as AtlasAITask[]) {
      allTasks.add(task);
    }
  }

  for (const task of allTasks) {
    // Find best model for this task
    let bestSc: ModelScorecard | null = null;
    let bestScore = -1;
    let secondBestScore = -1;

    for (const sc of scorecards) {
      const score = sc.taskScores[task];
      if (score === undefined) continue;

      if (score > bestScore) {
        secondBestScore = bestScore;
        bestScore = score;
        bestSc = sc;
      } else if (score > secondBestScore) {
        secondBestScore = score;
      }
    }

    if (!bestSc) continue;

    // Only suggest a change if the improvement is significant (>5 points)
    const improvement = secondBestScore > 0 ? bestScore - secondBestScore : bestScore;
    if (improvement < 5) continue;

    // Determine current model (would need task→model mapping; use generic)
    const currentModelId = "unknown";
    const currentProviderId = "unknown" as ProviderId;

    suggestions.push({
      task,
      currentModelId,
      currentProviderId,
      suggestedModelId: bestSc.modelId,
      suggestedProviderId: bestSc.providerId,
      confidence: Math.min(1, improvement / 30), // Higher improvement = higher confidence
      reason: `${bestSc.modelId} scored ${bestScore.toFixed(0)}/100 on ${task} (next best: ${secondBestScore.toFixed(0)})`,
      expectedImprovement: improvement,
    });
  }

  // Sort by expected improvement descending
  suggestions.sort((a, b) => b.expectedImprovement - a.expectedImprovement);

  return suggestions;
}

// ---------------------------------------------------------------------------
// Apply suggestions (requires explicit confirmation)
// ---------------------------------------------------------------------------

/**
 * Apply routing suggestions to the runtime configuration.
 *
 * This MUST be called explicitly — benchmark results never auto-apply.
 *
 * @param suggestions - The suggestions to apply
 * @param options - Control which suggestions to apply
 */
export function applyRoutingSuggestions(
  suggestions: RoutingSuggestion[],
  options: {
    /** Only apply suggestions with confidence >= this threshold. */
    minConfidence?: number;
    /** Only apply for specific tasks. */
    tasks?: AtlasAITask[];
    /** Dry run — return what would change without applying. */
    dryRun?: boolean;
  } = {},
): {
  applied: RoutingSuggestion[];
  skipped: RoutingSuggestion[];
  configChanges: Record<string, unknown>;
} {
  const minConfidence = options.minConfidence ?? 0.5;
  const applied: RoutingSuggestion[] = [];
  const skipped: RoutingSuggestion[] = [];

  for (const suggestion of suggestions) {
    // Filter by confidence
    if (suggestion.confidence < minConfidence) {
      skipped.push(suggestion);
      continue;
    }

    // Filter by task
    if (options.tasks && options.tasks.length > 0) {
      if (suggestion.task !== "all" && !options.tasks.includes(suggestion.task as AtlasAITask)) {
        skipped.push(suggestion);
        continue;
      }
    }

    applied.push(suggestion);
  }

  const configChanges: Record<string, unknown> = {};

  if (!options.dryRun && applied.length > 0) {
    // In routed mode, the model selection is done by the router's scoring.
    // Benchmark results inform us which models are better, but the actual
    // routing is handled by capability matching.
    //
    // What we CAN do:
    // 1. Ensure routing mode is "routed" (not legacy)
    // 2. Adjust cost limits if a better model is cheaper
    // 3. Log the recommendation for admin review

    const currentConfig = getRoutingConfig();
    if (currentConfig.mode !== "routed") {
      configChanges.mode = "routed";
    }

    // Ensure fallback is enabled for production safety
    if (!currentConfig.enableFallback) {
      configChanges.enableFallback = true;
    }

    if (Object.keys(configChanges).length > 0) {
      updateRoutingConfig(configChanges as Partial<ReturnType<typeof getRoutingConfig>>);
    }
  }

  return {
    applied,
    skipped,
    configChanges,
  };
}

// ---------------------------------------------------------------------------
// Benchmark diff (compare two runs)
// ---------------------------------------------------------------------------

export interface BenchmarkDiff {
  /** Model that was evaluated. */
  modelId: string;
  /** Score change (positive = improved). */
  overallScoreChange: number;
  /** Per-task score changes. */
  taskChanges: Record<string, number>;
  /** Latency change in ms (negative = faster). */
  latencyChangeMs: number;
  /** Cost change (negative = cheaper). */
  costChangeUsd: number;
}

/**
 * Compare two sets of scorecards to detect regressions or improvements.
 */
export function diffScorecards(
  previous: ModelScorecard[],
  current: ModelScorecard[],
): BenchmarkDiff[] {
  const prevMap = new Map(previous.map((sc) => [sc.modelId, sc]));
  const currMap = new Map(current.map((sc) => [sc.modelId, sc]));

  const diffs: BenchmarkDiff[] = [];

  for (const [modelId, curr] of currMap) {
    const prev = prevMap.get(modelId);
    if (!prev) continue; // New model, skip diff

    const taskChanges: Record<string, number> = {};
    const allTasks = new Set([
      ...Object.keys(prev.taskScores),
      ...Object.keys(curr.taskScores),
    ]);

    for (const task of allTasks) {
      const prevScore = prev.taskScores[task as AtlasAITask] ?? 0;
      const currScore = curr.taskScores[task as AtlasAITask] ?? 0;
      if (prevScore !== currScore) {
        taskChanges[task] = currScore - prevScore;
      }
    }

    diffs.push({
      modelId,
      overallScoreChange: curr.overallScore - prev.overallScore,
      taskChanges,
      latencyChangeMs: curr.avgLatencyMs - prev.avgLatencyMs,
      costChangeUsd: curr.totalCostUsd - prev.totalCostUsd,
    });
  }

  return diffs;
}
