// ---------------------------------------------------------------------------
// Atlas AI Runtime — Task-Aware Runtime
//
// Extends the base runtime with task-based model routing. When a task
// is specified, the router selects the optimal model before the provider
// fallback chain handles errors.
// ---------------------------------------------------------------------------

import type {
  GenerateRequest,
  GenerateResult,
  StructuredOutputRequest,
  StructuredOutputResult,
  EmbedRequest,
  EmbedResult,
  ProviderId,
} from "./types";
import type { AtlasAITask } from "./tasks";
import type { RoutingDecision } from "./task-router";
import {
  routeTask,
  reportTaskSuccess,
  reportTaskFailure,
  getRoutingConfig,
} from "./task-router";
import { getProvider, getAvailableProviders } from "./registry";
import { getModelProfile } from "./model-registry";
import { recordUsage } from "./usage-tracker";
import { createAIRuntimeError } from "./errors";

// ---------------------------------------------------------------------------
// Task-aware request types
// ---------------------------------------------------------------------------

export interface TaskGenerateRequest extends GenerateRequest {
  /** Atlas task identifier for intelligent routing. */
  task: AtlasAITask;
}

export interface TaskStructuredRequest extends StructuredOutputRequest {
  /** Atlas task identifier for intelligent routing. */
  task: AtlasAITask;
}

export interface TaskEmbedRequest extends EmbedRequest {
  /** Atlas task identifier for intelligent routing. */
  task: AtlasAITask;
}

// ---------------------------------------------------------------------------
// Task-aware generation
// ---------------------------------------------------------------------------

/**
 * Generate text with task-based model routing.
 *
 * Flow:
 * 1. Route task → select optimal model + provider
 * 2. Try primary model/provider
 * 3. On failure → try fallback chain (from routing decision + provider fallback)
 * 4. Report success/failure for model health tracking
 */
export async function taskGenerate(
  request: TaskGenerateRequest,
): Promise<GenerateResult & { routing: RoutingDecision }> {
  const config = getRoutingConfig();

  // In legacy mode, skip routing and use base generate
  if (config.mode === "legacy") {
    const { generate } = await import("./runtime");
    const result = await generate(request);
    return { ...result, routing: routeTask(request.task) };
  }

  // Route to optimal model
  const decision = routeTask(request.task);

  // Build provider chain: routed model first, then fallbacks
  const chain = buildProviderChain(decision, request.provider);

  let lastError: Error | undefined;

  for (let i = 0; i < chain.length; i++) {
    const { providerId, modelId } = chain[i];
    const provider = getProvider(providerId);

    if (!provider || !provider.isAvailable()) continue;

    try {
      const result = await provider.generate({
        ...request,
        model: modelId,
        provider: providerId,
        timeoutMs: request.timeoutMs ?? 30_000,
      });

      // Report success
      reportTaskSuccess(request.task, modelId);

      // Record usage with task metadata
      recordUsage({
        provider: result.provider,
        model: result.model,
        operation: "generate",
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        estimatedCostUsd: estimateCost(result.provider, result.model, result.usage.totalTokens),
        latencyMs: result.latencyMs,
        success: true,
        metadata: { task: request.task, routingMode: config.mode },
      });

      return {
        ...result,
        routing: decision,
        fallbackFrom: i > 0 ? chain[0].providerId : undefined,
      };
    } catch (err) {
      lastError = err as Error;
      reportTaskFailure(request.task, modelId, lastError);

      recordUsage({
        provider: providerId,
        model: modelId,
        operation: "generate",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        latencyMs: 0,
        success: false,
        errorCode: (err as any).code ?? "provider_error",
        metadata: { task: request.task, routingMode: config.mode },
      });

      // Don't continue if not retryable
      if ((err as any).retryable === false) break;
    }
  }

  throw createAIRuntimeError(
    "all_providers_failed",
    `Task "${request.task}": all providers failed. Last error: ${lastError?.message ?? "unknown"}`,
    { retryable: false, cause: lastError as any },
  );
}

/**
 * Generate structured output with task-based model routing.
 */
export async function taskGenerateStructured<T = Record<string, unknown>>(
  request: TaskStructuredRequest,
): Promise<StructuredOutputResult<T> & { routing: RoutingDecision }> {
  const config = getRoutingConfig();

  if (config.mode === "legacy") {
    const { generateStructured } = await import("./runtime");
    const result = await generateStructured<T>(request);
    return { ...result, routing: routeTask(request.task) };
  }

  const decision = routeTask(request.task);
  const chain = buildProviderChain(decision, request.provider);

  let lastError: Error | undefined;

  for (let i = 0; i < chain.length; i++) {
    const { providerId, modelId } = chain[i];
    const provider = getProvider(providerId);

    if (!provider || !provider.isAvailable()) continue;

    try {
      const result = await provider.generateStructured<T>({
        ...request,
        model: modelId,
        provider: providerId,
        timeoutMs: request.timeoutMs ?? 30_000,
      });

      reportTaskSuccess(request.task, modelId);

      recordUsage({
        provider: result.provider,
        model: result.model,
        operation: "structured",
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        estimatedCostUsd: estimateCost(result.provider, result.model, result.usage.totalTokens),
        latencyMs: result.latencyMs,
        success: true,
        metadata: { task: request.task, routingMode: config.mode },
      });

      return {
        ...result,
        routing: decision,
        fallbackFrom: i > 0 ? chain[0].providerId : undefined,
      };
    } catch (err) {
      lastError = err as Error;
      reportTaskFailure(request.task, modelId, lastError);

      recordUsage({
        provider: providerId,
        model: modelId,
        operation: "structured",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        latencyMs: 0,
        success: false,
        errorCode: (err as any).code ?? "provider_error",
        metadata: { task: request.task, routingMode: config.mode },
      });

      if ((err as any).retryable === false) break;
    }
  }

  throw createAIRuntimeError(
    "all_providers_failed",
    `Task "${request.task}": all providers failed for structured output. Last error: ${lastError?.message ?? "unknown"}`,
    { retryable: false, cause: lastError as any },
  );
}

/**
 * Generate embeddings with task-based routing.
 */
export async function taskEmbed(
  request: TaskEmbedRequest,
): Promise<EmbedResult & { routing: RoutingDecision }> {
  const config = getRoutingConfig();

  if (config.mode === "legacy") {
    const { embed } = await import("./runtime");
    const result = await embed(request);
    return { ...result, routing: routeTask(request.task) };
  }

  const decision = routeTask(request.task);
  const chain = buildProviderChain(decision, undefined);

  let lastError: Error | undefined;

  for (let i = 0; i < chain.length; i++) {
    const { providerId, modelId } = chain[i];
    const provider = getProvider(providerId);

    if (!provider || !provider.isAvailable()) continue;

    try {
      const result = await provider.embed({
        ...request,
        model: modelId,
        timeoutMs: request.timeoutMs ?? 30_000,
      });

      reportTaskSuccess(request.task, modelId);

      recordUsage({
        provider: result.provider,
        model: result.model,
        operation: "embed",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        latencyMs: result.latencyMs,
        success: true,
        metadata: { task: request.task, routingMode: config.mode },
      });

      return {
        ...result,
        routing: decision,
      };
    } catch (err) {
      lastError = err as Error;
      reportTaskFailure(request.task, modelId, lastError);

      recordUsage({
        provider: providerId,
        model: modelId,
        operation: "embed",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        latencyMs: 0,
        success: false,
        errorCode: (err as any).code ?? "provider_error",
        metadata: { task: request.task, routingMode: config.mode },
      });

      if ((err as any).retryable === false) break;
    }
  }

  throw createAIRuntimeError(
    "all_providers_failed",
    `Task "${request.task}": all providers failed for embeddings. Last error: ${lastError?.message ?? "unknown"}`,
    { retryable: false, cause: lastError as any },
  );
}

// ---------------------------------------------------------------------------
// Provider chain builder
// ---------------------------------------------------------------------------

interface ChainEntry {
  providerId: ProviderId;
  modelId: string;
}

function buildProviderChain(
  decision: RoutingDecision,
  requestedProvider?: ProviderId,
): ChainEntry[] {
  const chain: ChainEntry[] = [];

  // Primary: routed model
  chain.push({
    providerId: decision.model.providerId,
    modelId: decision.model.modelId,
  });

  // Fallbacks from routing decision
  for (const fallback of decision.fallbacks) {
    chain.push({
      providerId: fallback.providerId,
      modelId: fallback.modelId,
    });
  }

  // If a specific provider was requested and not already in chain, add it
  if (requestedProvider && !chain.some((e) => e.providerId === requestedProvider)) {
    const providers = getAvailableProviders();
    const provider = providers.find((p) => p.id === requestedProvider);
    if (provider) {
      const models = provider.listModels();
      if (models.length > 0) {
        chain.push({
          providerId: requestedProvider,
          modelId: models[0].id,
        });
      }
    }
  }

  return chain;
}

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

function estimateCost(_providerId: ProviderId, modelId: string, totalTokens: number): number {
  const profile = getModelProfile(modelId);
  if (profile) {
    return Math.round((totalTokens / 1000) * profile.costPer1kTokens * 1_000_000) / 1_000_000;
  }
  return 0;
}
