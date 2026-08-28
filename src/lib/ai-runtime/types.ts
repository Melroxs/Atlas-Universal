// ---------------------------------------------------------------------------
// Atlas AI Runtime — Core Types
//
// Provider-agnostic types for the Atlas AI Runtime. Every AI call in Atlas
// should eventually flow through these interfaces so the application never
// needs to know whether the request is going to Gemini, NVIDIA NIM, or
// another provider.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Provider identification
// ---------------------------------------------------------------------------

export type ProviderId = "gemini" | "nvidia_nim" | "openai_compatible";

// ---------------------------------------------------------------------------
// Model tier — determines cost/speed tradeoff
// ---------------------------------------------------------------------------

export type ModelTier = "fast" | "standard" | "strong";

// ---------------------------------------------------------------------------
// Message types (provider-agnostic)
// ---------------------------------------------------------------------------

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// ---------------------------------------------------------------------------
// Generation request
// ---------------------------------------------------------------------------

export interface AIGenerateRequest {
  /** The messages to send to the model. */
  messages: AIMessage[];

  /** Which provider to use (null = auto-select from config). */
  provider?: ProviderId;

  /** Specific model ID override (null = use provider default). */
  model?: string;

  /** Max tokens the model may emit. */
  maxTokens?: number;

  /** Sampling temperature (0..2). */
  temperature?: number;

  /** Nucleus sampling parameter. */
  topP?: number;

  /** Response format hint. */
  responseFormat?: "text" | "json";

  /** Request timeout in milliseconds. */
  timeoutMs?: number;

  /** Abort signal for cancellation. */
  signal?: AbortSignal;

  /** Metadata for logging/tracking (never includes secrets). */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Structured generation request
// ---------------------------------------------------------------------------

export interface AIStructuredRequest extends Omit<AIGenerateRequest, "responseFormat"> {
  /** JSON Schema the model's output must conform to. */
  schema: Record<string, unknown>;

  /** Strict mode — reject outputs with extra properties. */
  strict?: boolean;
}

// ---------------------------------------------------------------------------
// Generation response
// ---------------------------------------------------------------------------

export interface AIGenerateResponse {
  /** Whether the request succeeded. */
  ok: boolean;

  /** The generated text (when ok=true). */
  text?: string;

  /** Parsed JSON (when responseFormat=json or structured generation). */
  parsed?: unknown;

  /** Which provider actually handled the request. */
  provider: ProviderId;

  /** Which model was used. */
  model: string;

  /** Token usage breakdown. */
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };

  /** Request latency in milliseconds. */
  latencyMs: number;

  /** Error information (when ok=false). */
  error?: {
    code: AIErrorCode;
    message: string;
    /** Whether this error is retryable. */
    retryable: boolean;
    /** HTTP status code if applicable. */
    status?: number;
  };
}

// ---------------------------------------------------------------------------
// Streaming response
// ---------------------------------------------------------------------------

export interface AIStreamChunk {
  /** The text delta for this chunk. */
  delta: string;

  /** Whether this is the final chunk. */
  done: boolean;

  /** Token usage (only on the final chunk). */
  usage?: AIGenerateResponse["usage"];
}

// ---------------------------------------------------------------------------
// Embedding request/response
// ---------------------------------------------------------------------------

export interface AIEmbedRequest {
  /** Text(s) to embed. */
  input: string | string[];

  /** Which provider to use. */
  provider?: ProviderId;

  /** Specific embedding model override. */
  model?: string;

  /** Request timeout in milliseconds. */
  timeoutMs?: number;

  /** Abort signal for cancellation. */
  signal?: AbortSignal;
}

export interface AIEmbedResponse {
  ok: boolean;
  embeddings?: number[][];
  provider: ProviderId;
  model: string;
  dimensions?: number;
  latencyMs: number;
  error?: AIGenerateResponse["error"];
}

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export type AIErrorCode =
  | "auth"
  | "rate_limited"
  | "timeout"
  | "network"
  | "server"
  | "model_unavailable"
  | "malformed"
  | "provider_not_configured"
  | "no_providers_available"
  | "validation_error"
  | "unknown";

// ---------------------------------------------------------------------------
// Provider capabilities
// ---------------------------------------------------------------------------

export interface ProviderCapabilities {
  /** Whether the provider supports text generation. */
  generate: boolean;
  /** Whether the provider supports structured JSON output. */
  structuredOutput: boolean;
  /** Whether the provider supports streaming. */
  streaming: boolean;
  /** Whether the provider supports embeddings. */
  embeddings: boolean;
  /** Whether the provider supports vision/image input. */
  vision: boolean;
  /** Whether the provider supports tool/function calling. */
  toolCalling: boolean;
}

// ---------------------------------------------------------------------------
// Provider configuration
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  /** Unique provider identifier. */
  id: ProviderId;
  /** Display name. */
  name: string;
  /** API key (server-side only, never exposed to client). */
  apiKey: string;
  /** Base URL for API calls. */
  baseUrl: string;
  /** Default model for this provider. */
  defaultModel: string;
  /** Available models, ordered fast → strong. */
  models: ModelConfig[];
  /** Provider capabilities. */
  capabilities: ProviderCapabilities;
  /** Whether this provider is enabled (has valid credentials). */
  enabled: boolean;
  /** Priority for auto-selection (lower = preferred). */
  priority: number;
}

export interface ModelConfig {
  /** Model ID (provider-specific). */
  id: string;
  /** Display name. */
  name: string;
  /** Cost tier. */
  tier: ModelTier;
  /** Estimated cost per 1K tokens (USD). */
  costPer1kTokens: number;
  /** Max context tokens. */
  maxContextTokens: number;
  /** Max output tokens. */
  maxOutputTokens: number;
}

// ---------------------------------------------------------------------------
// Provider interface — every adapter implements this
// ---------------------------------------------------------------------------

export interface AIProvider {
  /** Provider identifier. */
  readonly id: ProviderId;

  /** Provider display name. */
  readonly name: string;

  /** Whether this provider is currently available. */
  readonly available: boolean;

  /** Provider capabilities. */
  readonly capabilities: ProviderCapabilities;

  /**
   * Generate text completion.
   * Returns a standardized response regardless of the underlying provider.
   */
  generate(request: AIGenerateRequest): Promise<AIGenerateResponse>;

  /**
   * Generate structured JSON output conforming to a schema.
   * Falls back to generate + parse when the provider doesn't natively
   * support structured output.
   */
  generateStructured(request: AIStructuredRequest): Promise<AIGenerateResponse>;

  /**
   * Generate text with streaming.
   * Yields chunks as they arrive from the provider.
   */
  stream(request: AIGenerateRequest): AsyncIterable<AIStreamChunk>;

  /**
   * Generate embeddings for the given input.
   * Throws if the provider doesn't support embeddings.
   */
  embed(request: AIEmbedRequest): Promise<AIEmbedResponse>;
}
