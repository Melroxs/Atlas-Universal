// ---------------------------------------------------------------------------
// Atlas AI Runtime — Benchmark Runner
//
// Runs the evaluation dataset against configured models/providers.
// Supports multiple models, graceful degradation when a provider is
// unavailable, and comprehensive result storage.
// ---------------------------------------------------------------------------

import type {
  ProviderId,
  GenerateRequest,
  StructuredOutputRequest,
} from "../types";
import type { EvalCase, EvalCaseResult, EvalRun } from "./types";
import { EVAL_DATASET, getAllCases } from "./dataset";
import { scoreCaseResult } from "./criteria";
import { loadProviderConfigs } from "../config";
import {
  initializeRegistry,
  getProvider,
  getAvailableProviders,
} from "../registry";

// ---------------------------------------------------------------------------
// Benchmark configuration
// ---------------------------------------------------------------------------

export interface BenchmarkConfig {
  /** Models to evaluate. If empty, evaluates all available models. */
  models?: Array<{ providerId: ProviderId; modelId: string }>;
  /** Specific cases to run. If empty, runs all cases. */
  caseIds?: string[];
  /** Specific tasks to include. If empty, runs all tasks. */
  tasks?: string[];
  /** Specific domains to include. If empty, runs all domains. */
  domains?: string[];
  /** Request timeout per case in ms. */
  timeoutMs?: number;
  /** Whether to skip cases that require structured output. */
  skipStructured?: boolean;
  /** Concurrency limit (how many cases to run in parallel). */
  concurrency?: number;
}

// ---------------------------------------------------------------------------
// Benchmark runner
// ---------------------------------------------------------------------------

/**
 * Run a complete evaluation benchmark.
 *
 * This function:
 * 1. Resolves which models and cases to evaluate
 * 2. Runs each case against each model
 * 3. Scores results using evaluation criteria
 * 4. Returns a complete EvalRun with all results
 *
 * Does NOT automatically update production routing — results must be
 * explicitly reviewed and applied via router integration.
 */
export async function runBenchmark(
  config: BenchmarkConfig = {},
): Promise<EvalRun & { results: EvalCaseResult[] }> {
  const runId = `eval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date().toISOString();

  // Resolve cases
  let cases = resolveCases(config);

  // Resolve models
  const models = resolveModels(config);

  // Initialize registry
  initializeRegistry();

  const results: EvalCaseResult[] = [];
  let totalCost = 0;
  let totalLatency = 0;
  let successCount = 0;
  let failCount = 0;
  let errorCount = 0;

  // Run cases against each model
  for (const model of models) {
    const provider = getProvider(model.providerId);

    for (const evalCase of cases) {
      // Skip structured cases if requested
      if (config.skipStructured && evalCase.requiresStructuredOutput) {
        continue;
      }

      // Skip embedding cases for non-embedding models
      if (
        evalCase.task === "embedding" &&
        !isEmbeddingModel(model.modelId)
      ) {
        continue;
      }

      try {
        const result = await runCase(evalCase, model, provider, config);
        results.push(result);

        totalCost += result.estimatedCostUsd;
        totalLatency += result.latencyMs;

        if (result.success && result.overallScore >= 70) {
          successCount++;
        } else if (result.success) {
          failCount++;
        } else {
          errorCount++;
        }
      } catch (err) {
        // Error running this case — record as error
        const errorResult: EvalCaseResult = {
          caseId: evalCase.id,
          task: evalCase.task,
          modelId: model.modelId,
          providerId: model.providerId,
          overallScore: 0,
          structuralScore: 0,
          keywordScore: 0,
          groundingScore: 0,
          hallucinationScore: 0,
          completenessScore: 0,
          latencyMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0,
          success: false,
          errorMessage: err instanceof Error ? err.message : "Unknown error",
          errorCode: "provider_error",
          reviewStatus: "rejected",
        };
        results.push(errorResult);
        errorCount++;
      }
    }
  }

  const completedAt = new Date().toISOString();
  const validLatencies = results.filter((r) => r.success).map((r) => r.latencyMs);
  const avgLatency =
    validLatencies.length > 0
      ? Math.round(validLatencies.reduce((a, b) => a + b, 0) / validLatencies.length)
      : 0;

  return {
    runId,
    startedAt,
    completedAt,
    modelsEvaluated: models,
    totalCases: cases.length,
    totalResults: results.length,
    passed: successCount,
    failed: failCount,
    errored: errorCount,
    totalCostUsd: Math.round(totalCost * 1_000_000) / 1_000_000,
    avgLatencyMs: avgLatency,
    completed: true,
    results,
  };
}

// ---------------------------------------------------------------------------
// Single case runner
// ---------------------------------------------------------------------------

async function runCase(
  evalCase: EvalCase,
  model: { providerId: ProviderId; modelId: string },
  provider: ReturnType<typeof getProvider>,
  config: BenchmarkConfig,
): Promise<EvalCaseResult> {
  if (!provider || !provider.isAvailable()) {
    return {
      caseId: evalCase.id,
      task: evalCase.task,
      modelId: model.modelId,
      providerId: model.providerId,
      overallScore: 0,
      structuralScore: 0,
      keywordScore: 0,
      groundingScore: 0,
      hallucinationScore: 0,
      completenessScore: 0,
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      success: false,
      errorMessage: `Provider ${model.providerId} is not available`,
      errorCode: "provider_unavailable",
      reviewStatus: "rejected",
    };
  }

  const timeoutMs = config.timeoutMs ?? 30_000;
  const startTime = Date.now();

  try {
    let output: string;
    let inputTokens = 0;
    let outputTokens = 0;

    if (evalCase.requiresStructuredOutput) {
      const request: StructuredOutputRequest = {
        prompt: evalCase.prompt,
        systemPrompt: evalCase.systemPrompt,
        model: model.modelId,
        provider: model.providerId,
        schema: evalCase.expectedSchema ?? {},
        strict: false,
        timeoutMs,
        maxTokens: 4096,
        temperature: 0.1,
      };

      const result = await provider.generateStructured(request);
      output = typeof result.data === "string"
        ? result.data
        : JSON.stringify(result.data, null, 2);
      inputTokens = result.usage.promptTokens;
      outputTokens = result.usage.completionTokens;
    } else {
      const request: GenerateRequest = {
        prompt: evalCase.prompt,
        systemPrompt: evalCase.systemPrompt,
        model: model.modelId,
        provider: model.providerId,
        timeoutMs,
        maxTokens: 2048,
        temperature: 0.3,
      };

      const result = await provider.generate(request);
      output = result.text;
      inputTokens = result.usage.promptTokens;
      outputTokens = result.usage.completionTokens;
    }

    const latencyMs = Date.now() - startTime;

    // Estimate cost
    const totalTokens = inputTokens + outputTokens;
    const estimatedCostUsd = estimateModelCost(model.modelId, totalTokens);

    // Score the result
    return scoreCaseResult({
      case_: evalCase,
      output,
      modelId: model.modelId,
      providerId: model.providerId,
      latencyMs,
      inputTokens,
      outputTokens,
      estimatedCostUsd,
      success: true,
    });
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    const error = err as { code?: string; message?: string; retryable?: boolean };

    return scoreCaseResult({
      case_: evalCase,
      output: "",
      modelId: model.modelId,
      providerId: model.providerId,
      latencyMs,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      success: false,
      errorMessage: error.message ?? "Unknown error",
      errorCode: error.code ?? "provider_error",
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveCases(config: BenchmarkConfig): EvalCase[] {
  let cases = getAllCases();

  if (config.caseIds && config.caseIds.length > 0) {
    cases = cases.filter((c) => config.caseIds!.includes(c.id));
  }

  if (config.tasks && config.tasks.length > 0) {
    cases = cases.filter((c) => config.tasks!.includes(c.task));
  }

  if (config.domains && config.domains.length > 0) {
    cases = cases.filter((c) => config.domains!.includes(c.domain));
  }

  return cases;
}

function resolveModels(
  config: BenchmarkConfig,
): Array<{ providerId: ProviderId; modelId: string }> {
  if (config.models && config.models.length > 0) {
    return config.models;
  }

  // Auto-discover from configured providers
  const configs = loadProviderConfigs();
  const models: Array<{ providerId: ProviderId; modelId: string }> = [];

  for (const providerConfig of configs) {
    if (!providerConfig.enabled) continue;

    for (const model of providerConfig.models) {
      // Skip embedding-only models for general benchmark
      if (!model.capabilities.generate) continue;

      models.push({
        providerId: providerConfig.id,
        modelId: model.id,
      });
    }
  }

  return models;
}

function isEmbeddingModel(modelId: string): boolean {
  return modelId.includes("embedding");
}

function estimateModelCost(modelId: string, totalTokens: number): number {
  // Rough cost estimates per 1K tokens
  const costMap: Record<string, number> = {
    "gemini-2.5-flash": 0.0001,
    "gemini-2.5-pro": 0.00125,
    "gemini-2.0-flash": 0.0001,
    "deepseek-ai/deepseek-v4-pro-0813": 0.003,
    "deepseek-ai/deepseek-v4-flash-0731": 0.0003,
    "nvidia/nemotron-3-super-120b-a12b": 0.001,
    "nvidia/nemotron-3-ultra-550b-a55b": 0.005,
  };

  const costPer1k = costMap[modelId] ?? 0.001;
  return Math.round((totalTokens / 1000) * costPer1k * 1_000_000) / 1_000_000;
}
