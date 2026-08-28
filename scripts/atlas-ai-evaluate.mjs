#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Atlas AI Runtime — Model Evaluation CLI
//
// Usage:
//   node scripts/atlas-ai-evaluate.mjs [options]
//
// Options:
//   --models <provider/model,...>    Specific models to evaluate
//   --tasks <task1,task2,...>        Only evaluate specific tasks
//   --domains <domain1,domain2,...>  Only evaluate specific domains
//   --timeout <ms>                  Request timeout per case (default: 30000)
//   --dry-run                       Show what would be evaluated without running
//   --output <path>                 Write results to JSON file
//   --diff <path>                   Compare with previous run results
//
// Environment:
//   GEMINI_API_KEY       Google Gemini API key
//   NVIDIA_NIM_API_KEY   NVIDIA NIM API key
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync } from "node:fs";

// Dynamically import the TypeScript modules via the project's ts resolution
async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") {
      flags.dryRun = true;
    } else if (arg === "--models" && args[i + 1]) {
      flags.models = args[++i].split(",").map((m) => {
        const [providerId, modelId] = m.includes("/") ? m.split("/", 2) : [undefined, m];
        return { providerId, modelId };
      });
    } else if (arg === "--tasks" && args[i + 1]) {
      flags.tasks = args[++i].split(",");
    } else if (arg === "--domains" && args[i + 1]) {
      flags.domains = args[++i].split(",");
    } else if (arg === "--timeout" && args[i + 1]) {
      flags.timeoutMs = parseInt(args[++i], 10);
    } else if (arg === "--output" && args[i + 1]) {
      flags.output = args[++i];
    } else if (arg === "--diff" && args[i + 1]) {
      flags.diff = args[++i];
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  ATLAS AI MODEL EVALUATION");
  console.log("═══════════════════════════════════════════════════════════");
  console.log();

  // Import the evaluation modules
  const { getDatasetSummary } = await import("../src/lib/ai-runtime/eval/dataset.ts");
  const { runBenchmark } = await import("../src/lib/ai-runtime/eval/runner.ts");
  const { generateScorecards, generateRecommendations, formatScorecards, formatRecommendations } = await import("../src/lib/ai-runtime/eval/scorecard.ts");

  // Show dataset summary
  const summary = getDatasetSummary();
  console.log("  Dataset Summary:");
  console.log(`    Total cases:    ${summary.totalCases}`);
  console.log(`    By domain:      ${Object.entries(summary.byDomain).map(([d, c]) => `${d}(${c})`).join(", ")}`);
  console.log(`    By difficulty:  ${Object.entries(summary.byDifficulty).map(([d, c]) => `${d}(${c})`).join(", ")}`);
  console.log();

  if (flags.dryRun) {
    console.log("  DRY RUN — would evaluate:");
    if (flags.models) {
      console.log(`    Models: ${flags.models.map((m) => m.modelId).join(", ")}`);
    } else {
      console.log("    Models: all configured");
    }
    if (flags.tasks) {
      console.log(`    Tasks:  ${flags.tasks.join(", ")}`);
    }
    if (flags.domains) {
      console.log(`    Domains: ${flags.domains.join(", ")}`);
    }
    console.log(`    Timeout: ${flags.timeoutMs ?? 30000}ms`);
    process.exit(0);
  }

  // Check for API keys
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasNvidia = !!process.env.NVIDIA_NIM_API_KEY;

  if (!hasGemini && !hasNvidia) {
    console.log("  ⚠️  No AI provider API keys configured.");
    console.log("     Set GEMINI_API_KEY or NVIDIA_NIM_API_KEY to run live benchmarks.");
    console.log("     Framework is ready — live benchmark requires credentials.");
    console.log();
    console.log("  To run with dry-run mode: node scripts/atlas-ai-evaluate.mjs --dry-run");
    process.exit(1);
  }

  console.log(`  Providers: ${hasGemini ? "Gemini ✓" : "Gemini ✗"} | ${hasNvidia ? "NVIDIA NIM ✓" : "NVIDIA NIM ✗"}`);
  console.log();

  // Run benchmark
  console.log("  Running benchmark...");
  const startTime = Date.now();

  const run = await runBenchmark({
    models: flags.models,
    tasks: flags.tasks,
    domains: flags.domains,
    timeoutMs: flags.timeoutMs,
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  Completed in ${elapsed}s`);
  console.log();

  // Generate scorecards
  const scorecards = generateScorecards(run);
  console.log(formatScorecards(scorecards));

  // Generate recommendations
  const recs = generateRecommendations(scorecards);
  console.log(formatRecommendations(recs));

  // Run summary
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  RUN SUMMARY");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Run ID:       ${run.runId}`);
  console.log(`  Models:       ${run.modelsEvaluated.length}`);
  console.log(`  Cases:        ${run.totalCases}`);
  console.log(`  Results:      ${run.totalResults}`);
  console.log(`  Passed:       ${run.passed}`);
  console.log(`  Failed:       ${run.failed}`);
  console.log(`  Errors:       ${run.errored}`);
  console.log(`  Total Cost:   $${run.totalCostUsd.toFixed(4)}`);
  console.log(`  Avg Latency:  ${run.avgLatencyMs}ms`);
  console.log("═══════════════════════════════════════════════════════════");

  // Write output if requested
  if (flags.output) {
    const output = {
      run: {
        runId: run.runId,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        modelsEvaluated: run.modelsEvaluated,
        totalCases: run.totalCases,
        totalResults: run.totalResults,
        passed: run.passed,
        failed: run.failed,
        errored: run.errored,
        totalCostUsd: run.totalCostUsd,
        avgLatencyMs: run.avgLatencyMs,
      },
      scorecards,
      recommendations: recs,
      results: run.results,
    };
    writeFileSync(flags.output, JSON.stringify(output, null, 2));
    console.log(`\n  Results written to ${flags.output}`);
  }

  // Diff with previous run if requested
  if (flags.diff) {
    try {
      const prevData = JSON.parse(readFileSync(flags.diff, "utf-8"));
      const { diffScorecards } = await import("../src/lib/ai-runtime/eval/router-integration.ts");
      const diffs = diffScorecards(prevData.scorecards ?? [], scorecards);

      console.log("\n═══════════════════════════════════════════════════════════");
      console.log("  DIFF WITH PREVIOUS RUN");
      console.log("═══════════════════════════════════════════════════════════");

      for (const diff of diffs) {
        const icon = diff.overallScoreChange > 0 ? "📈" : diff.overallScoreChange < 0 ? "📉" : "➡️";
        console.log(`  ${icon} ${diff.modelId}: ${diff.overallScoreChange > 0 ? "+" : ""}${diff.overallScoreChange.toFixed(1)} overall`);
        if (diff.latencyChangeMs !== 0) {
          console.log(`     Latency: ${diff.latencyChangeMs > 0 ? "+" : ""}${diff.latencyChangeMs}ms`);
        }
        if (diff.costChangeUsd !== 0) {
          console.log(`     Cost: ${diff.costChangeUsd > 0 ? "+" : ""}$${diff.costChangeUsd.toFixed(4)}`);
        }
      }

      console.log("═══════════════════════════════════════════════════════════");
    } catch (err) {
      console.error(`  Failed to read previous run: ${err.message}`);
    }
  }

  console.log("\n  NOTE: Benchmark results do NOT automatically change production routing.");
  console.log("  Apply recommendations manually via applyRoutingSuggestions() after review.");
}

function printUsage() {
  console.log(`
Atlas AI Model Evaluation

Usage:
  node scripts/atlas-ai-evaluate.mjs [options]

Options:
  --models <provider/model,...>    Specific models to evaluate
  --tasks <task1,task2,...>        Only evaluate specific tasks
  --domains <domain1,domain2,...>  Only evaluate specific domains
  --timeout <ms>                  Request timeout per case (default: 30000)
  --dry-run                       Show what would be evaluated without running
  --output <path>                 Write results to JSON file
  --diff <path>                   Compare with previous run results
  --help, -h                      Show this help

Environment:
  GEMINI_API_KEY       Google Gemini API key
  NVIDIA_NIM_API_KEY   NVIDIA NIM API key

Examples:
  # Dry run (no API calls)
  node scripts/atlas-ai-evaluate.mjs --dry-run

  # Evaluate all models on all tasks
  node scripts/atlas-ai-evaluate.mjs

  # Evaluate specific models on claims tasks
  node scripts/atlas-ai-evaluate.mjs --models gemini/gemini-2.5-flash --tasks evidence_reasoning,supplement_reasoning

  # Run and save results for future diffing
  node scripts/atlas-ai-evaluate.mjs --output eval-results.json

  # Compare with previous results
  node scripts/atlas-ai-evaluate.mjs --diff previous-results.json --output new-results.json
`);
}

main().catch((err) => {
  console.error("Evaluation failed:", err);
  process.exit(1);
});
