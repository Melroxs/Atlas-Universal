// ---------------------------------------------------------------------------
// Atlas AI Runtime — Barrel Export
//
// Import from "@/lib/ai-runtime" to access the provider-agnostic AI runtime.
// ---------------------------------------------------------------------------

// Main runtime
export { atlasAI, isAIConfigured, getActiveProviderName } from "./runtime";
export type { AIRuntimeConfig } from "./runtime";

// Types
export type {
  ProviderId,
  ModelTier,
  AIMessage,
  AIGenerateRequest,
  AIGenerateResponse,
  AIStructuredRequest,
  AIStreamChunk,
  AIEmbedRequest,
  AIEmbedResponse,
  AIErrorCode,
  ProviderCapabilities,
  ProviderConfig,
  ModelConfig,
  AIProvider,
} from "./types";

// Registry
export {
  initializeRegistry,
  getAllProviders,
  getAvailableProviders,
  getProvider,
  getProviderConfig,
  hasAvailableProvider,
  getBestProvider,
  findModel,
  findBestModelInTier,
  resetRegistry,
} from "./registry";

// Retry utilities
export {
  withRetry,
  backoffDelay,
  isRetryable,
  isRateLimited,
  rateLimitDelay,
  DEFAULT_RETRY_CONFIG,
} from "./retry";
export type { RetryConfig } from "./retry";

// Providers (for advanced use / direct instantiation)
export { GeminiProvider } from "./providers/gemini";
export { NvidiaNimProvider } from "./providers/nvidia";
