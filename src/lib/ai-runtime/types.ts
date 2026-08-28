// ---------------------------------------------------------------------------
// Atlas AI Runtime — Core Type Definitions
//
// Provider-agnostic interfaces for LLM interaction. Every Atlas feature
// that calls an LLM should ultimately use these types through the runtime.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Provider identity
// ---------------------------------------------------------------------------

export type ProviderId = "gemini" | "nvidia-nim" | string;

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  /** Base URL for the provider's API (e.g., https://generativelanguage.googleapis.com). */
  baseUrl: string;
  /** API key (NEVER logged or exposed to client). */
  apiKey: string;
  /** Default model for this provider when no specific model is requested. */
  defaultModel: string;
  /** Available models on this provider. */
  models: ModelConfig[];
  /** Provider priority (lower = higher priority for fallback selection). */
  priority: number;
  /** Whether this provider is currently enabled (has valid credentials). */
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Model registry
// ---------------------------------------------------------------------------

export type ModelTier = "fast" | "standard" | "strong";

/** Capability strength rating for model matching. */
export type CapabilityLevel = "low" | "medium" | "high";

export interface ModelConfig {
  id: string;
  name: string;
  providerId: ProviderId;
  tier: ModelTier;
  /** Estimated cost per 1K tokens (USD). */
  costPer1kTokens: number;
  /** Max context window in tokens. */
  maxContextTokens: number;
  /** Max output tokens. */
  maxOutputTokens: number;
  /** Model capabilities. */
  capabilities: ModelCapabilities;
}

export interface ModelCapabilities {
  /** Supports chat/conversation generation. */
  generate: boolean;
  /** Supports structured (JSON) output. */
  structuredOutput: boolean;
  /** Supports streaming responses. */
  streaming: boolean;
  /** Supports function/tool calling. */
  toolCalling: boolean;
  /** Supports text embeddings. */
  embeddings: boolean;
  /** Supports vision (image/document input). */
  vision: boolean;
  /** Supports multi-modal (text + image in same request). */
  multiModal: boolean;
  /** Reasoning strength (low/medium/high). */
  reasoning?: CapabilityLevel;
  /** Document understanding capability. */
  documentUnderstanding?: CapabilityLevel;
  /** Long-context handling (>50K tokens). */
  longContext?: CapabilityLevel;
}

// ---------------------------------------------------------------------------
// Generation request/response
// ---------------------------------------------------------------------------

export interface GenerateRequest {
  /** The prompt or message. */
  prompt: string;
  /** System instruction. */
  systemPrompt?: string;
  /** Preferred provider (otherwise auto-selected by priority). */
  provider?: ProviderId;
  /** Model override (otherwise uses provider default). */
  model?: string;
  /** Max output tokens. */
  maxTokens?: number;
  /** Temperature (0..2). */
  temperature?: number;
  /** Top-p sampling. */
  topP?: number;
  /** Stop sequences. */
  stopSequences?: string[];
  /** Whether the response should be JSON. */
  jsonMode?: boolean;
  /** Abort signal for timeout/cancellation. */
  signal?: AbortSignal;
  /** Request timeout in ms. */
  timeoutMs?: number;
  /** Optional conversation history (for multi-turn). */
  history?: Array<{ role: "user" | "model"; text: string }>;
  /** Metadata for logging/tracking (never customer data). */
  metadata?: Record<string, unknown>;
}

export interface GenerateResult {
  /** The generated text. */
  text: string;
  /** Provider that handled the request. */
  provider: ProviderId;
  /** Model used. */
  model: string;
  /** Token usage. */
  usage: TokenUsage;
  /** Latency in ms. */
  latencyMs: number;
  /** Whether this was a fallback from another provider. */
  fallbackFrom?: ProviderId;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// ---------------------------------------------------------------------------
// Structured output
// ---------------------------------------------------------------------------

export interface StructuredOutputRequest extends GenerateRequest {
  /** JSON schema for the expected output. */
  schema: Record<string, unknown>;
  /** Whether to enforce strict schema compliance. */
  strict?: boolean;
}

export interface StructuredOutputResult<T = Record<string, unknown>>
  extends GenerateResult {
  /** The parsed structured output. */
  data: T;
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

export interface StreamRequest extends GenerateRequest {
  /** Called for each chunk of the stream. */
  onChunk: (chunk: StreamChunk) => void;
  /** Called when the stream completes. */
  onComplete: (result: GenerateResult) => void;
  /** Called on stream error. */
  onError: (error: AIRuntimeError) => void;
}

export interface StreamChunk {
  text: string;
  /** Whether this is the final chunk. */
  done: boolean;
  /** Accumulated text so far. */
  accumulatedText: string;
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

export interface EmbedRequest {
  /** Array of texts to embed. */
  texts: string[];
  /** Model override. */
  model?: string;
  /** Abort signal. */
  signal?: AbortSignal;
  /** Timeout in ms. */
  timeoutMs?: number;
}

export interface EmbedResult {
  /** Array of embedding vectors, same order as input texts. */
  embeddings: number[][];
  /** Dimension of the embeddings. */
  dimension: number;
  /** Provider and model used. */
  provider: ProviderId;
  model: string;
  /** Latency in ms. */
  latencyMs: number;
  /** Token usage (if available). */
  usage?: TokenUsage;
}

// ---------------------------------------------------------------------------
// Vision
// ---------------------------------------------------------------------------

export interface VisionRequest {
  /** The prompt/instruction. */
  prompt: string;
  /** Image data as base64 or URL. */
  images: Array<{ data: string; mimeType: string } | { url: string }>;
  /** System prompt. */
  systemPrompt?: string;
  /** Model override. */
  model?: string;
  /** Max output tokens. */
  maxTokens?: number;
  /** Temperature. */
  temperature?: number;
  /** JSON mode. */
  jsonMode?: boolean;
  /** Signal. */
  signal?: AbortSignal;
  /** Timeout in ms. */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Tool calling
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCallRequest extends GenerateRequest {
  /** Available tools. */
  tools: ToolDefinition[];
  /** Maximum tool call iterations. */
  maxIterations?: number;
  /** Called for each tool invocation. */
  onToolCall?: (call: ToolCall) => void;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResult {
  name: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Provider adapter interface
// ---------------------------------------------------------------------------

/**
 * Every LLM provider implements this interface. The runtime never calls
 * provider-specific SDKs directly — it goes through this abstraction.
 */
export interface AIProviderAdapter {
  /** Unique provider identifier. */
  readonly id: ProviderId;

  /** Display name. */
  readonly name: string;

  /** Check if the provider has valid credentials. */
  isAvailable(): boolean;

  /** List supported models. */
  listModels(): ModelConfig[];

  /** Get a specific model config. */
  getModel(modelId: string): ModelConfig | undefined;

  /** Generate text. */
  generate(request: GenerateRequest): Promise<GenerateResult>;

  /** Generate with structured output. */
  generateStructured<T = Record<string, unknown>>(
    request: StructuredOutputRequest,
  ): Promise<StructuredOutputResult<T>>;

  /** Stream text generation. */
  stream(request: StreamRequest): Promise<void>;

  /** Generate embeddings. */
  embed(request: EmbedRequest): Promise<EmbedResult>;

  /** Vision (image understanding). */
  vision?(request: VisionRequest): Promise<GenerateResult>;
}

// ---------------------------------------------------------------------------
// AI Runtime error
// ---------------------------------------------------------------------------

export type AIRuntimeErrorCode =
  | "provider_unavailable"
  | "missing_api_key"
  | "invalid_model"
  | "authentication"
  | "rate_limited"
  | "timeout"
  | "network"
  | "malformed_response"
  | "provider_error"
  | "all_providers_failed"
  | "invalid_request"
  | "not_implemented";

export interface AIRuntimeError extends Error {
  code: AIRuntimeErrorCode;
  /** The provider that failed. */
  provider?: ProviderId;
  /** HTTP status code from the provider, if applicable. */
  httpStatus?: number;
  /** Whether this error is retryable. */
  retryable: boolean;
  /** Original error for debugging (NEVER contains API keys). */
  cause?: Error;
}

// ---------------------------------------------------------------------------
// Usage tracking
// ---------------------------------------------------------------------------

export interface UsageRecord {
  timestamp: string;
  provider: ProviderId;
  model: string;
  operation: "generate" | "structured" | "stream" | "embed" | "vision" | "tool_call";
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  success: boolean;
  errorCode?: AIRuntimeErrorCode;
  /** Metadata — never customer content. */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Fallback configuration
// ---------------------------------------------------------------------------

export interface FallbackConfig {
  /** Whether fallback is enabled. */
  enabled: boolean;
  /** Maximum number of fallback attempts. */
  maxAttempts: number;
  /** Delay before retry in ms. */
  retryDelayMs: number;
  /** Maximum retry delay (for exponential backoff) in ms. */
  maxRetryDelayMs: number;
  /** Maximum number of retries per provider. */
  maxRetriesPerProvider: number;
}

export const DEFAULT_FALLBACK_CONFIG: FallbackConfig = {
  enabled: true,
  maxAttempts: 3,
  retryDelayMs: 1000,
  maxRetryDelayMs: 30_000,
  maxRetriesPerProvider: 2,
};
