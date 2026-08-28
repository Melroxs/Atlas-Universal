// ---------------------------------------------------------------------------
// Atlas AI Runtime — Main Runtime Facade
//
// This is the single entry point for all Atlas business logic that needs
// to call an LLM. It handles:
//   - Provider selection (auto or manual)
//   - Fallback across providers on failure
//   - Retry with exponential backoff
//   - Usage tracking (metadata only, never customer content)
//   - Timeout enforcement
//
// Atlas business logic never calls provider-specific SDKs directly.
// ---------------------------------------------------------------------------

import type {
  AIProviderAdapter,
  GenerateRequest,
  GenerateResult,
  StructuredOutputRequest,
  StructuredOutputResult,
  StreamRequest,
  EmbedRequest,
  EmbedResult,
  VisionRequest,
  ProviderId,
  FallbackConfig,
  UsageRecord,
  AIRuntimeError,
} from "./types";
import { createAIRuntimeError } from "./errors";
import { getDefaultFallbackConfig } from "./config";
import {
  getAvailableProviders,
  getProvider,
  findProviderForModel,
  findProvidersForTier,
  initializeRegistry,
} from "./registry";
import { recordUsage } from "./usage-tracker";

// ---------------------------------------------------------------------------
// Runtime configuration
// ---------------------------------------------------------------------------

export interface AtlasAIRuntimeConfig {
  /** Default fallback configuration. */
  fallback: FallbackConfig;
  /** Default request timeout in ms. */
  defaultTimeoutMs: number;
  /** Default provider (if not auto-selected). */
  defaultProvider?: ProviderId;
  /** Default model (if not specified in request). */
  defaultModel?: string;
}

const DEFAULT_RUNTIME_CONFIG: AtlasAIRuntimeConfig = {
  fallback: getDefaultFallbackConfig(),
  defaultTimeoutMs: 30_000,
};

// ---------------------------------------------------------------------------
// Runtime singleton
// ---------------------------------------------------------------------------

let _config: AtlasAIRuntimeConfig = { ...DEFAULT_RUNTIME_CONFIG };
let _initialized = false;

/**
 * Initialize the Atlas AI Runtime.
 * Must be called before any generation requests.
 */
export async function initAtlasAI(
  config?: Partial<AtlasAIRuntimeConfig>,
): Promise<void> {
  if (config) {
    _config = { ...DEFAULT_RUNTIME_CONFIG, ...config };
  }
  await initializeRegistry();
  _initialized = true;
}

/**
 * Reset the runtime (for testing).
 */
export function resetAtlasAI(): void {
  _config = { ...DEFAULT_RUNTIME_CONFIG };
  _initialized = false;
}

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

function resolveProvider(request: {
  provider?: ProviderId;
  model?: string;
}): AIProviderAdapter {
  ensureInitialized();

  // 1. Explicit provider
  if (request.provider) {
    const provider = getProvider(request.provider);
    if (provider && provider.isAvailable()) return provider;
  }

  // 2. Model-specific provider
  if (request.model) {
    const provider = findProviderForModel(request.model);
    if (provider) return provider;
  }

  // 3. Default provider
  if (_config.defaultProvider) {
    const provider = getProvider(_config.defaultProvider);
    if (provider && provider.isAvailable()) return provider;
  }

  // 4. First available provider
  const available = getAvailableProviders();
  if (available.length > 0) return available[0];

  throw createAIRuntimeError(
    "all_providers_failed",
    "No AI providers are available. Configure GEMINI_API_KEY or NVIDIA_NIM_API_KEY.",
  );
}

function getFallbackChain(request: {
  provider?: ProviderId;
  model?: string;
}): AIProviderAdapter[] {
  ensureInitialized();

  const primary = resolveProvider(request);
  const all = getAvailableProviders();

  // Build chain: primary first, then others
  return [primary, ...all.filter((p) => p.id !== primary.id)];
}

// ---------------------------------------------------------------------------
// Core generation with fallback
// ---------------------------------------------------------------------------

/**
 * Generate text with automatic provider fallback.
 */
export async function generate(
  request: GenerateRequest,
): Promise<GenerateResult> {
  const chain = getFallbackChain(request);
  let lastError: AIRuntimeError | undefined;

  for (let i = 0; i < Math.min(chain.length, _config.fallback.maxAttempts); i++) {
    const provider = chain[i];
    try {
      const result = await provider.generate({
        ...request,
        timeoutMs: request.timeoutMs ?? _config.defaultTimeoutMs,
      });

      // Record successful usage
      recordUsage({
        provider: result.provider,
        model: result.model,
        operation: "generate",
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        estimatedCostUsd: estimateCost(provider, result.usage.totalTokens),
        latencyMs: result.latencyMs,
        success: true,
      });

      // Tag fallback if different from requested provider
      if (request.provider && result.provider !== request.provider) {
        return { ...result, fallbackFrom: request.provider };
      }

      return result;
    } catch (err) {
      lastError = err as AIRuntimeError;

      // Record failed usage
      recordUsage({
        provider: provider.id,
        model: request.model ?? provider.listModels()[0]?.id ?? "unknown",
        operation: "generate",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        latencyMs: 0,
        success: false,
        errorCode: lastError.code,
      });

      // Don't retry if not retryable
      if (!lastError.retryable) break;

      // Exponential backoff before next provider
      if (i < chain.length - 1) {
        const delay = Math.min(
          _config.fallback.retryDelayMs * Math.pow(2, i),
          _config.fallback.maxRetryDelayMs,
        );
        await sleep(delay);
      }
    }
  }

  throw createAIRuntimeError(
    "all_providers_failed",
    `All ${chain.length} provider(s) failed. Last error: ${lastError?.message ?? "unknown"}`,
    { retryable: false, cause: lastError },
  );
}

/**
 * Generate structured output (JSON) with automatic provider fallback.
 */
export async function generateStructured<T = Record<string, unknown>>(
  request: StructuredOutputRequest,
): Promise<StructuredOutputResult<T>> {
  const chain = getFallbackChain(request);
  let lastError: AIRuntimeError | undefined;

  for (let i = 0; i < Math.min(chain.length, _config.fallback.maxAttempts); i++) {
    const provider = chain[i];
    try {
      const result = await provider.generateStructured<T>({
        ...request,
        timeoutMs: request.timeoutMs ?? _config.defaultTimeoutMs,
      });

      recordUsage({
        provider: result.provider,
        model: result.model,
        operation: "structured",
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        estimatedCostUsd: estimateCost(provider, result.usage.totalTokens),
        latencyMs: result.latencyMs,
        success: true,
      });

      if (request.provider && result.provider !== request.provider) {
        return { ...result, fallbackFrom: request.provider };
      }

      return result;
    } catch (err) {
      lastError = err as AIRuntimeError;

      recordUsage({
        provider: provider.id,
        model: request.model ?? provider.listModels()[0]?.id ?? "unknown",
        operation: "structured",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        latencyMs: 0,
        success: false,
        errorCode: lastError.code,
      });

      if (!lastError.retryable) break;

      if (i < chain.length - 1) {
        const delay = Math.min(
          _config.fallback.retryDelayMs * Math.pow(2, i),
          _config.fallback.maxRetryDelayMs,
        );
        await sleep(delay);
      }
    }
  }

  throw createAIRuntimeError(
    "all_providers_failed",
    `All ${chain.length} provider(s) failed for structured generation. Last error: ${lastError?.message ?? "unknown"}`,
    { retryable: false, cause: lastError },
  );
}

/**
 * Stream text generation with automatic provider fallback.
 */
export async function stream(request: StreamRequest): Promise<void> {
  const chain = getFallbackChain(request);
  let lastError: AIRuntimeError | undefined;

  for (let i = 0; i < Math.min(chain.length, _config.fallback.maxAttempts); i++) {
    const provider = chain[i];
    try {
      await provider.stream({
        ...request,
        timeoutMs: request.timeoutMs ?? _config.defaultTimeoutMs,
      });

      recordUsage({
        provider: provider.id,
        model: request.model ?? provider.listModels()[0]?.id ?? "unknown",
        operation: "stream",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        latencyMs: 0,
        success: true,
      });

      return;
    } catch (err) {
      lastError = err as AIRuntimeError;

      recordUsage({
        provider: provider.id,
        model: request.model ?? provider.listModels()[0]?.id ?? "unknown",
        operation: "stream",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        latencyMs: 0,
        success: false,
        errorCode: lastError.code,
      });

      if (!lastError.retryable) break;

      if (i < chain.length - 1) {
        const delay = Math.min(
          _config.fallback.retryDelayMs * Math.pow(2, i),
          _config.fallback.maxRetryDelayMs,
        );
        await sleep(delay);
      }
    }
  }

  throw createAIRuntimeError(
    "all_providers_failed",
    `All ${chain.length} provider(s) failed for streaming. Last error: ${lastError?.message ?? "unknown"}`,
    { retryable: false, cause: lastError },
  );
}

/**
 * Generate embeddings with automatic provider fallback.
 */
export async function embed(request: EmbedRequest): Promise<EmbedResult> {
  const chain = getFallbackChain(request);
  let lastError: AIRuntimeError | undefined;

  for (let i = 0; i < Math.min(chain.length, _config.fallback.maxAttempts); i++) {
    const provider = chain[i];
    try {
      const result = await provider.embed({
        ...request,
        timeoutMs: request.timeoutMs ?? _config.defaultTimeoutMs,
      });

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
      });

      return result;
    } catch (err) {
      lastError = err as AIRuntimeError;

      recordUsage({
        provider: provider.id,
        model: request.model ?? provider.listModels()[0]?.id ?? "unknown",
        operation: "embed",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        latencyMs: 0,
        success: false,
        errorCode: lastError.code,
      });

      if (!lastError.retryable) break;

      if (i < chain.length - 1) {
        const delay = Math.min(
          _config.fallback.retryDelayMs * Math.pow(2, i),
          _config.fallback.maxRetryDelayMs,
        );
        await sleep(delay);
      }
    }
  }

  throw createAIRuntimeError(
    "all_providers_failed",
    `All ${chain.length} provider(s) failed for embeddings. Last error: ${lastError?.message ?? "unknown"}`,
    { retryable: false, cause: lastError },
  );
}

/**
 * Vision request (image understanding) with automatic provider fallback.
 */
export async function vision(request: VisionRequest): Promise<GenerateResult> {
  const chain = getFallbackChain(request).filter((p) => p.vision);
  if (chain.length === 0) {
    throw createAIRuntimeError(
      "not_implemented",
      "No available provider supports vision requests.",
    );
  }

  let lastError: AIRuntimeError | undefined;

  for (let i = 0; i < Math.min(chain.length, _config.fallback.maxAttempts); i++) {
    const provider = chain[i];
    try {
      const result = await provider.vision!({
        ...request,
        timeoutMs: request.timeoutMs ?? _config.defaultTimeoutMs,
      });

      recordUsage({
        provider: result.provider,
        model: result.model,
        operation: "vision",
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        estimatedCostUsd: estimateCost(provider, result.usage.totalTokens),
        latencyMs: result.latencyMs,
        success: true,
      });

      return result;
    } catch (err) {
      lastError = err as AIRuntimeError;

      recordUsage({
        provider: provider.id,
        model: request.model ?? provider.listModels()[0]?.id ?? "unknown",
        operation: "vision",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        latencyMs: 0,
        success: false,
        errorCode: lastError.code,
      });

      if (!lastError.retryable) break;

      if (i < chain.length - 1) {
        const delay = Math.min(
          _config.fallback.retryDelayMs * Math.pow(2, i),
          _config.fallback.maxRetryDelayMs,
        );
        await sleep(delay);
      }
    }
  }

  throw createAIRuntimeError(
    "all_providers_failed",
    `All ${chain.length} provider(s) failed for vision. Last error: ${lastError?.message ?? "unknown"}`,
    { retryable: false, cause: lastError },
  );
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function ensureInitialized(): void {
  if (!_initialized) {
    initializeRegistry();
    _initialized = true;
  }
}

function estimateCost(provider: AIProviderAdapter, totalTokens: number): number {
  const models = provider.listModels();
  if (models.length === 0) return 0;
  const avgCostPer1k = models.reduce((sum, m) => sum + m.costPer1kTokens, 0) / models.length;
  return Math.round((totalTokens / 1000) * avgCostPer1k * 1_000_000) / 1_000_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
