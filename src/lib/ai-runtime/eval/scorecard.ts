// ---------------------------------------------------------------------------
// Atlas AI Runtime — Model Scorecard Generator
//
// Aggregates EvalCaseResults into per-model scorecards and generates
// routing recommendations based on actual benchmark performance.
// ---------------------------------------------------------------------------

import type { ProviderId } from "../types";
import type { AtlasAITask } from "../tasks";
import type {
  EvalCaseResult,
  EvalRun,
  ModelScorecard,
  BenchmarkRecommendation,
} from "./types";

// ---------------------------------------------------------------------------
// Scorecard generation
// ---------------------------------------------------------------------------

/**
 * Generate scorecards for all models evaluated in a run.
 */
export function generateScorecards(
  run: EvalRun & { results: EvalCaseResult[] },
): ModelScorecard[] {
  // Group results by model
  const byModel = new Map<
    string,
    { providerId: ProviderId; results: EvalCaseResult[] }
  >();

  for (const result of run.results) {
    const key = `${result.providerId}:${result.modelId}`;
    if (!byModel.has(key)) {
      byModel.set(key, {
        providerId: result.providerId,
        results: [],
      });
    }
    byModel.get(key)!.results.push(result);
  }

  const scorecards: ModelScorecard[] = [];

  for (const [, { providerId, results }] of byModel) {
    if (results.length === 0) continue;

    const modelId = results[0]!.modelId;
    const successful = results.filter((r) => r.success);
    const passed = successful.filter((r) => r.overallScore >= 70);
    const failed = successful.filter((r) => r.overallScore < 70);

    // Domain scores
    const domainScores = computeDomainScores(results);

    // Task scores
    const taskScores = computeTaskScores(results);

    // Latency
    const latencies = successful.map((r) => r.latencyMs).sort((a, b) => a - b);
    const avgLatency =
      latencies.length > 0
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : 0;
    const p95Index = Math.floor(latencies.length * 0.95);
    const p95Latency = latencies.length > 0 ? (latencies[p95Index] ?? latencies[latencies.length - 1]!) : 0;

    // Cost
    const totalCost = results.reduce((sum, r) => sum + r.estimatedCostUsd, 0);
    const totalTokens = results.reduce(
      (sum, r) => sum + r.inputTokens + r.outputTokens,
      0,
    );

    // Quality averages
    const avgStructural = avg(successful.map((r) => r.structuralScore));
    const avgGrounding = avg(successful.map((r) => r.groundingScore));
    const avgHallucination = avg(successful.map((r) => r.hallucinationScore));
    const avgCompleteness = avg(successful.map((r) => r.completenessScore));
    const avgKeyword = avg(successful.map((r) => r.keywordScore));

    // Overall score
    const overallScore = avg(successful.map((r) => r.overallScore));

    scorecards.push({
      modelId,
      providerId,
      overallScore,
      domainScores,
      taskScores,
      avgLatencyMs: avgLatency,
      p95LatencyMs: typeof p95Latency === "number" ? p95Latency : 0,
      successRate: results.length > 0 ? successful.length / results.length : 0,
      totalCostUsd: Math.round(totalCost * 1_000_000) / 1_000_000,
      costPerCase:
        results.length > 0
          ? Math.round((totalCost / results.length) * 1_000_000) / 1_000_000
          : 0,
      totalTokens,
      avgStructuralScore: avgStructural,
      avgGroundingScore: avgGrounding,
      avgHallucinationRate: 100 - avgHallucination, // Invert: lower hallucination = higher rate
      avgCompletenessScore: avgCompleteness,
      avgKeywordScore: avgKeyword,
      totalCases: results.length,
      passedCases: passed.length,
      failedCases: failed.length + (results.length - successful.length),
    });
  }

  // Sort by overall score descending
  scorecards.sort((a, b) => b.overallScore - a.overallScore);

  return scorecards;
}

// ---------------------------------------------------------------------------
// Routing recommendations
// ---------------------------------------------------------------------------

/**
 * Generate routing recommendations based on scorecards.
 * These are suggestions — they do NOT automatically change production routing.
 */
export function generateRecommendations(
  scorecards: ModelScorecard[],
  currentRouting?: Record<AtlasAITask, string>,
): BenchmarkRecommendation[] {
  if (scorecards.length === 0) return [];

  const recommendations: BenchmarkRecommendation[] = [];
  const allTasks = new Set<AtlasAITask>();

  // Collect all tasks that were evaluated
  for (const sc of scorecards) {
    for (const task of Object.keys(sc.taskScores) as AtlasAITask[]) {
      allTasks.add(task);
    }
  }

  // For each task, find the best model
  for (const task of allTasks) {
    let bestModel: ModelScorecard | null = null;
    let bestScore = -1;

    for (const sc of scorecards) {
      const taskScore = sc.taskScores[task];
      if (taskScore !== undefined && taskScore > bestScore) {
        bestScore = taskScore;
        bestModel = sc;
      }
    }

    if (!bestModel) continue;

    const currentModel = currentRouting?.[task];
    const changeRecommended =
      currentModel !== undefined && currentModel !== bestModel.modelId;

    recommendations.push({
      task,
      recommendedModelId: bestModel.modelId,
      recommendedProviderId: bestModel.providerId,
      currentModelId: currentModel ?? "unknown",
      changeRecommended,
      reason: changeRecommended
        ? `${bestModel.modelId} scored ${bestScore.toFixed(0)} vs current ${currentModel} on ${task}`
        : `Current model ${currentModel} is already the best performer`,
      expectedImprovement: changeRecommended ? bestScore : 0,
    });
  }

  // Overall recommendation
  const bestOverall = scorecards[0]!;
  recommendations.unshift({
    task: "overall",
    recommendedModelId: bestOverall.modelId,
    recommendedProviderId: bestOverall.providerId,
    currentModelId: "varies",
    changeRecommended: false,
    reason: `Best overall performer: ${bestOverall.modelId} (${bestOverall.overallScore.toFixed(0)}/100)`,
    expectedImprovement: 0,
  });

  return recommendations;
}

// ---------------------------------------------------------------------------
// Scorecard formatting (for display)
// ---------------------------------------------------------------------------

/**
 * Format scorecards as a human-readable text table.
 */
export function formatScorecards(scorecards: ModelScorecard[]): string {
  if (scorecards.length === 0) return "No scorecards to display.";

  const lines: string[] = [
    "═══════════════════════════════════════════════════════════════════════════",
    "  ATLAS AI MODEL BENCHMARK SCORECARD",
    "═══════════════════════════════════════════════════════════════════════════",
    "",
  ];

  for (let i = 0; i < scorecards.length; i++) {
    const sc = scorecards[i]!;
    const rank = i + 1;

    lines.push(`  #${rank} ${sc.modelId} (${sc.providerId})`);
    lines.push(`     Overall Score:     ${sc.overallScore}/100`);
    lines.push(`     Success Rate:      ${(sc.successRate * 100).toFixed(0)}%`);
    lines.push(`     Avg Latency:       ${sc.avgLatencyMs}ms`);
    lines.push(`     P95 Latency:       ${sc.p95LatencyMs}ms`);
    lines.push(`     Total Cost:        $${sc.totalCostUsd.toFixed(4)}`);
    lines.push(`     Cases:             ${sc.passedCases}/${sc.totalCases} passed`);
    lines.push("");
    lines.push("     Quality Metrics:");
    lines.push(`       Structural:      ${sc.avgStructuralScore.toFixed(0)}/100`);
    lines.push(`       Grounding:       ${sc.avgGroundingScore.toFixed(0)}/100`);
    lines.push(`       Keyword:         ${sc.avgKeywordScore.toFixed(0)}/100`);
    lines.push(`       Completeness:    ${sc.avgCompletenessScore.toFixed(0)}/100`);
    lines.push(`       Hallucination:   ${(100 - sc.avgHallucinationRate).toFixed(0)}% detected`);
    lines.push("");

    // Task scores
    const taskEntries = Object.entries(sc.taskScores);
    if (taskEntries.length > 0) {
      lines.push("     Task Scores:");
      for (const [task, score] of taskEntries) {
        lines.push(`       ${task.padEnd(25)} ${score.toFixed(0)}/100`);
      }
      lines.push("");
    }

    // Domain scores
    const domainEntries = Object.entries(sc.domainScores);
    if (domainEntries.length > 0) {
      lines.push("     Domain Scores:");
      for (const [domain, score] of domainEntries) {
        lines.push(`       ${domain.padEnd(25)} ${score.toFixed(0)}/100`);
      }
      lines.push("");
    }

    lines.push("  ─────────────────────────────────────────────────────────────────────");
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format recommendations as human-readable text.
 */
export function formatRecommendations(
  recs: BenchmarkRecommendation[],
): string {
  const lines: string[] = [
    "═══════════════════════════════════════════════════════════════════════════",
    "  ROUTING RECOMMENDATIONS",
    "═══════════════════════════════════════════════════════════════════════════",
    "",
    "  NOTE: These are benchmark-derived suggestions, NOT automatic changes.",
    "  Apply manually via updateRoutingConfig() after review.",
    "",
  ];

  for (const rec of recs) {
    const icon = rec.changeRecommended ? "⚡" : "✅";
    lines.push(`  ${icon} ${rec.task}`);
    lines.push(`     Recommended: ${rec.recommendedModelId} (${rec.recommendedProviderId})`);
    lines.push(`     Current:     ${rec.currentModelId}`);
    lines.push(`     ${rec.reason}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function avg(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  return Math.round(numbers.reduce((a, b) => a + b, 0) / numbers.length);
}

function computeDomainScores(
  results: EvalCaseResult[],
): Record<string, number> {
  const byDomain = new Map<string, number[]>();

  // Map task to domain
  const taskToDomain: Record<string, string> = {
    evidence_reasoning: "claims",
    gap_intelligence: "evidence",
    supplement_reasoning: "claims",
    qa_reasoning: "knowledge",
    ask_atlas: "ask_atlas",
    crm_outreach: "crm",
    embedding: "embedding",
  };

  for (const r of results) {
    if (!r.success) continue;
    const domain = taskToDomain[r.task] ?? r.task;
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain)!.push(r.overallScore);
  }

  const scores: Record<string, number> = {};
  for (const [domain, domainScores] of byDomain) {
    scores[domain] = avg(domainScores);
  }
  return scores;
}

function computeTaskScores(
  results: EvalCaseResult[],
): Record<AtlasAITask, number> {
  const byTask = new Map<string, number[]>();

  for (const r of results) {
    if (!r.success) continue;
    if (!byTask.has(r.task)) byTask.set(r.task, []);
    byTask.get(r.task)!.push(r.overallScore);
  }

  const scores = {} as Record<string, number>;
  for (const [task, taskScores] of byTask) {
    scores[task] = avg(taskScores);
  }
  return scores as Record<AtlasAITask, number>;
}
