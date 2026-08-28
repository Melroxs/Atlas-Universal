// ---------------------------------------------------------------------------
// Atlas AI Runtime — Base Provider
//
// Abstract base class providing shared utilities for all AI providers.
// Concrete adapters extend this and implement the provider-specific logic.
// ---------------------------------------------------------------------------

import type {
  AIProvider,
  ProviderId,
  ProviderCapabilities,
  AIGenerateRequest,
  AIGenerateResponse,
  AIStructuredRequest,
  AIStreamChunk,
  AIEmbedRequest,
  AIEmbedResponse,
  AIErrorCode,
  ProviderConfig,
  ModelConfig,
} from "../types";

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/** Classify an HTTP status code into an AI error code. */
export function classifyHttpError(status: number): AIErrorCode {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limited";
  if (status === 404) return "model_unavailable";
  if (status >= 500) return "server";
  return "unknown";
}

/** Classify a fetch/network error into an AI error code. */
export function classifyNetworkError(err: unknown): AIErrorCode {
  if (err instanceof DOMException && err.name === "AbortError") return "timeout";
  if (err instanceof TypeError) {
    const msg = err.message.toLowerCase();
    if (msg.includes("fetch") || msg.includes("network") || msg.includes("econnreset")) {
      return "network";
    }
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("timeout") || msg.includes("aborted")) return "timeout";
    if (msg.includes("fetch") || msg.includes("network") || msg.includes("econnreset")) {
      return "network";
    }
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Base provider
// ---------------------------------------------------------------------------

export abstract class BaseAIProvider implements AIProvider {
  abstract readonly id: ProviderId;
  abstract readonly name: string;
  abstract readonly capabilities: ProviderCapabilities;

  protected config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  get available(): boolean {
    return this.config.enabled && Boolean(this.config.apiKey);
  }

  /** Resolve the model to use for a request. */
  protected resolveModel(request: AIGenerateRequest): string {
    return request.model ?? this.config.defaultModel;
  }

  /** Find a model config by ID. */
  protected findModel(modelId: string): ModelConfig | undefined {
    return this.config.models.find((m) => m.id === modelId);
  }

  /** Build the base URL for a model endpoint. */
  protected abstract buildEndpoint(model: string, action: "generate" | "embed" | "stream"): string;

  /** Build headers for API calls. */
  protected abstract buildHeaders(): Record<string, string>;

  // -----------------------------------------------------------------------
  // Abstract methods — each provider implements these
  // -----------------------------------------------------------------------

  protected abstract doGenerate(
    request: AIGenerateRequest,
    model: string,
  ): Promise<AIGenerateResponse>;

  protected abstract doStream(
    request: AIGenerateRequest,
    model: string,
  ): AsyncIterable<AIStreamChunk>;

  protected abstract doEmbed(
    request: AIEmbedRequest,
    model: string,
  ): Promise<AIEmbedResponse>;

  // -----------------------------------------------------------------------
  // Public interface
  // -----------------------------------------------------------------------

  async generate(request: AIGenerateRequest): Promise<AIGenerateResponse> {
    if (!this.available) {
      return this.notConfigured();
    }
    const model = this.resolveModel(request);
    return this.doGenerate(request, model);
  }

  async generateStructured(request: AIStructuredRequest): Promise<AIGenerateResponse> {
    if (!this.available) {
      return this.notConfigured();
    }
    const model = this.resolveModel(request);

    // If provider supports structured output natively, use it.
    if (this.capabilities.structuredOutput) {
      return this.doGenerate(
        { ...request, responseFormat: "json" },
        model,
      );
    }

    // Fallback: append schema instruction to the system prompt and parse.
    const schemaInstruction = `\n\nYou MUST respond with valid JSON matching this schema:\n${JSON.stringify(request.schema, null, 2)}\n\nDo not include any text outside the JSON object.`;
    const messages = [...request.messages];
    if (messages.length > 0 && messages[0].role === "system") {
      messages[0] = { ...messages[0], content: messages[0].content + schemaInstruction };
    } else {
      messages.unshift({ role: "system", content: `You must respond with valid JSON.${schemaInstruction}` });
    }

    return this.doGenerate({ ...request, messages, responseFormat: "json" }, model);
  }

  async *stream(request: AIGenerateRequest): AsyncIterable<AIStreamChunk> {
    if (!this.available) {
      yield { delta: "", done: true };
      return;
    }
    const model = this.resolveModel(request);
    yield* this.doStream(request, model);
  }

  async embed(request: AIEmbedRequest): Promise<AIEmbedResponse> {
    if (!this.available) {
      return {
        ok: false,
        provider: this.id,
        model: request.model ?? this.config.defaultModel,
        latencyMs: 0,
        error: {
          code: "provider_not_configured",
          message: `${this.name} is not configured`,
          retryable: false,
        },
      };
    }
    if (!this.capabilities.embeddings) {
      return {
        ok: false,
        provider: this.id,
        model: request.model ?? this.config.defaultModel,
        latencyMs: 0,
        error: {
          code: "provider_not_configured",
          message: `${this.name} does not support embeddings`,
          retryable: false,
        },
      };
    }
    const model = request.model ?? this.config.defaultModel;
    return this.doEmbed(request, model);
  }

  // -----------------------------------------------------------------------
  // Shared utilities
  // -----------------------------------------------------------------------

  /** Create a not-configured response. */
  protected notConfigured(): AIGenerateResponse {
    return {
      ok: false,
      provider: this.id,
      model: this.config.defaultModel,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      latencyMs: 0,
      error: {
        code: "provider_not_configured",
        message: `${this.name} is not configured (missing API key)`,
        retryable: false,
      },
    };
  }

  /** Create a success response. */
  protected success(
    text: string,
    model: string,
    usage: { promptTokens: number; completionTokens: number; totalTokens: number },
    latencyMs: number,
  ): AIGenerateResponse {
    return {
      ok: true,
      text,
      provider: this.id,
      model,
      usage,
      latencyMs,
    };
  }

  /** Create an error response from a caught error. */
  protected errorResponse(
    code: AIErrorCode,
    message: string,
    model: string,
    latencyMs: number,
    status?: number,
  ): AIGenerateResponse {
    return {
      ok: false,
      provider: this.id,
      model,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      latencyMs,
      error: {
        code,
        message,
        retryable: code !== "auth" && code !== "validation_error",
        status,
      },
    };
  }

  /** Execute a fetch with timeout. */
  protected async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Chain external signal
    if (signal) {
      signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
