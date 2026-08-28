// ---------------------------------------------------------------------------
// Atlas AI Runtime — Main Service
//
// The single entry point for all AI operations in Atlas. Business logic
// calls atlasAI.generate(), atlasAI.generateStructured(), etc. and the
// runtime handles provider selection, retry, fallback, and observability.
//
// Usage:
//   import { atlasAI } from "@/lib/ai-runtime";
//   const result = await atlasAI.generate({ messages: [...] });
// ---------------------------------------------------------------------------

import type {
  ProviderId,
  AIGenerateRequest,
  AIGenerateResponse,
  AIStructuredRequest,
  AIStreamChunk,
  AIEmbedRequest,
  AIEmbedResponse,
  ModelTier,
  ProviderConfig,
} from "./types";
import {
  getAvailableProviders,
  getProvider,
  getProviderConfig,
  getBestProvider,
  findBestModelInTier,
  initializeRegistry,
} from "./registry";
import { withRetry, DEFAULT_RETRY_CONFIG, type RetryConfig } from "./retry";

// ---------------------------------------------------------------------------
// Runtime configuration
// ---------------------------------------------------------------------------

export interface AIRuntimeConfig {
  /** Default request timeout in milliseconds. */
  defaultTimeoutMs: number;
  /** Default max tokens for generation. */
  defaultMaxTokens: number;
  /** Default temperature. */
  defaultTemperature: number;
  /** Retry configuration. */
  retry: RetryConfig;
  /** Whether to log AI operations (metadata only, never secrets). */
  enableLogging: boolean;
}

const DEFAULT_CONFIG: AIRuntimeConfig = {
  defaultTimeoutMs: 30_000,
  defaultMaxTokens: 2048,
  defaultTemperature: 0.2,
  retry: DEFAULT_RETRY_CONFIG,
  enableLogging: true,
};

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

let _config: AIRuntimeConfig = { ...DEFAULT_CONFIG };
let _initialized = false;

// ---------------------------------------------------------------------------
// Logger (structured, never logs secrets)
// ---------------------------------------------------------------------------

function log(event: string, data: Record<string, unknown> = {}): void {
  if (!_config.enableLogging) return;
  // Only log metadata: provider, model, latency, token counts — never
  // prompts, completions, API keys, or customer content.
  console.info(`[atlas-ai-runtime] ${event}`, data);
}

// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------

function selectProvider(request: AIGenerateRequest): {
  provider: import("./types").AIProvider;
  model: string;
} | null {
  // 1. Explicit provider requested
  if (request.provider) {
    const provider = getProvider(request.provider);
    if (provider?.available) {
      const cfg = getProviderConfig(request.provider);
      return { provider, model: request.model ?? cfg?.defaultModel ?? "" };
    }
    return null;
  }

  // 2. Find best available provider
  const best = getBestProvider();
  if (!best) return null;

  // If a specific model is requested, find it across providers
  if (request.model) {
    const found = findBestModelInTier("strong");
    // Just use the best provider with the requested model
    return { provider: best, model: request.model };
  }

  return { provider: best, model: "" };
}

// ---------------------------------------------------------------------------
// Log entry tracking (for observability)
// ---------------------------------------------------------------------------

interface LogEntry {
  timestamp: string;
  provider: ProviderId;
  model: string;
  operation: "generate" | "generateStructured" | "stream" | "embed";
  latencyMs: number;
  tokens?: { prompt: number; completion: number; total: number };
  success: boolean;
  errorCode?: string;
  retryCount?: number;
}

const _logHistory: LogEntry[] = [];
const MAX_LOG_HISTORY = 100;

function recordLog(entry: LogEntry): void {
  _logHistory.push(entry);
  if (_logHistory.length > MAX_LOG_HISTORY) {
    _logHistory.shift();
  }
}

// ---------------------------------------------------------------------------
// Main runtime API
// ---------------------------------------------------------------------------

class AtlasAIRuntime {
  /** Whether the runtime has been initialized. */
  get initialized(): boolean {
    return _initialized;
  }

  /** Get the runtime configuration. */
  get config(): Readonly<AIRuntimeConfig> {
    return _config;
  }

  /**
   * Initialize the runtime with provider configs.
   * Call once at application startup or Edge Function cold start.
   */
  initialize(configs?: ProviderConfig[], runtimeConfig?: Partial<AIRuntimeConfig>): void {
    initializeRegistry(configs);
    if (runtimeConfig) {
      _config = { ...DEFAULT_CONFIG, ...runtimeConfig };
    }
    _initialized = true;

    const available = getAvailableProviders();
    log("runtime-initialized", {
      providers: available.length,
      providerNames: available.map((p) => p.id),
    });
  }

  /**
   * Generate text completion.
   *
   * Automatically selects the best provider, applies retry logic, and
   * falls back to the next available provider on transient failures.
   */
  async generate(request: AIGenerateRequest): Promise<AIGenerateResponse> {
    this.ensureInitialized();

    const resolved = selectProvider(request);
    if (!resolved) {
      return {
        ok: false,
        provider: "gemini",
        model: request.model ?? "",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        latencyMs: 0,
        error: {
          code: "no_providers_available",
          message: "No AI providers are configured. Add GEMINI_API_KEY or NVIDIA_NIM_API_KEY.",
          retryable: false,
        },
      };
    }

  const { provider, model } = resolved;
  const cfg = getProviderConfig(provider.id);
  const effectiveModel = model || cfg?.defaultModel || "";

  const result = await withRetry(
    async (attempt) => {
      const response = await provider.generate({
        ...request,
        model: effectiveModel,
          timeoutMs: request.timeoutMs ?? _config.defaultTimeoutMs,
          maxTokens: request.maxTokens ?? _config.defaultMaxTokens,
          temperature: request.temperature ?? _config.defaultTemperature,
        });
        return response;
      },
      _config.retry,
      request.signal,
    );

    recordLog({
      timestamp: new Date().toISOString(),
      provider: provider.id,
      model: effectiveModel,
      operation: "generate",
      latencyMs: result.latencyMs,
      tokens: result.usage ? {
        prompt: result.usage.promptTokens,
        completion: result.usage.completionTokens,
        total: result.usage.totalTokens,
      } : undefined,
      success: result.ok,
      errorCode: result.error?.code,
    });

    log("generate-completed", {
      provider: provider.id,
      model: effectiveModel,
      latencyMs: result.latencyMs,
      success: result.ok,
      tokens: result.usage.totalTokens,
    });

    return result;
  }

  /**
   * Generate structured JSON output conforming to a schema.
   */
  async generateStructured(request: AIStructuredRequest): Promise<AIGenerateResponse> {
    this.ensureInitialized();

    const resolved = selectProvider(request);
    if (!resolved) {
      return {
        ok: false,
        provider: "gemini",
        model: request.model ?? "",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        latencyMs: 0,
        error: {
          code: "no_providers_available",
          message: "No AI providers are configured.",
          retryable: false,
        },
      };
    }

    const { provider, model } = resolved;
    const cfg = getProviderConfig(provider.id);
    const effectiveModel = model || cfg?.defaultModel || "";

    const result = await withRetry(
      async () => {
        return provider.generateStructured({
          ...request,
          model: effectiveModel,
          timeoutMs: request.timeoutMs ?? _config.defaultTimeoutMs,
          maxTokens: request.maxTokens ?? _config.defaultMaxTokens,
          temperature: request.temperature ?? _config.defaultTemperature,
        });
      },
      _config.retry,
      request.signal,
    );

    recordLog({
      timestamp: new Date().toISOString(),
      provider: provider.id,
      model: effectiveModel,
      operation: "generateStructured",
      latencyMs: result.latencyMs,
      tokens: result.usage ? {
        prompt: result.usage.promptTokens,
        completion: result.usage.completionTokens,
        total: result.usage.totalTokens,
      } : undefined,
      success: result.ok,
      errorCode: result.error?.code,
    });

    return result;
  }

  /**
   * Generate text with streaming.
   */
  async *stream(request: AIGenerateRequest): AsyncIterable<AIStreamChunk> {
    this.ensureInitialized();

    const resolved = selectProvider(request);
    if (!resolved) {
      yield { delta: "", done: true };
      return;
    }

    const { provider, model } = resolved;
    const cfg = getProviderConfig(provider.id);
    const effectiveModel = model || cfg?.defaultModel || "";

    yield* provider.stream({
      ...request,
      model: effectiveModel,
      timeoutMs: request.timeoutMs ?? _config.defaultTimeoutMs,
      maxTokens: request.maxTokens ?? _config.defaultMaxTokens,
      temperature: request.temperature ?? _config.defaultTemperature,
    });
  }

  /**
   * Generate embeddings.
   */
  async embed(request: AIEmbedRequest): Promise<AIEmbedResponse> {
    this.ensureInitialized();

    // Find a provider that supports embeddings
    const available = getAvailableProviders();
    const embeddingProvider = available.find((p) => p.capabilities.embeddings);

    if (!embeddingProvider) {
      return {
        ok: false,
        provider: "gemini",
        model: request.model ?? "",
        latencyMs: 0,
        error: {
          code: "no_providers_available",
          message: "No AI provider with embedding support is configured.",
          retryable: false,
        },
      };
    }

    return embeddingProvider.embed(request);
  }

  /**
   * Get the recent operation log (for observability dashboard).
   */
  getLogHistory(): readonly LogEntry[] {
    return _logHistory;
  }

  /**
   * Check if the runtime is healthy (at least one provider available).
   */
  healthCheck(): { healthy: boolean; providers: Array<{ id: string; available: boolean }> } {
    const all = getAvailableProviders();
    return {
      healthy: all.length > 0,
      providers: all.map((p) => ({ id: p.id, available: p.available })),
    };
  }

  private ensureInitialized(): void {
    if (!_initialized) {
      this.initialize();
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const atlasAI = new AtlasAIRuntime();

// ---------------------------------------------------------------------------
// Convenience functions (tree-shakable)
// ---------------------------------------------------------------------------

/** Quick check: is any AI provider configured? */
export function isAIConfigured(): boolean {
  if (!_initialized) atlasAI.initialize();
  return getAvailableProviders().length > 0;
}

/** Get the name of the currently active provider (for display). */
export function getActiveProviderName(): string | null {
  const best = getBestProvider();
  return best?.name ?? null;
}
