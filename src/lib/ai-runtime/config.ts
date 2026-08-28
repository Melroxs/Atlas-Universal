// ---------------------------------------------------------------------------
// Atlas AI Runtime — Configuration
//
// Loads provider configuration from environment variables. Supports:
//   - Gemini (existing): GEMINI_API_KEY, GEMINI_MODEL
//   - NVIDIA NIM (new): NVIDIA_NIM_API_KEY, NVIDIA_NIM_BASE_URL, NVIDIA_NIM_DEFAULT_MODEL
//
// The config never exposes API keys beyond this module boundary.
// ---------------------------------------------------------------------------

import type { ProviderConfig, ModelConfig, ModelCapabilities, FallbackConfig } from "./types";

// ---------------------------------------------------------------------------
// Capabilities per provider
// ---------------------------------------------------------------------------

const GEMINI_CAPABILITIES: ModelCapabilities = {
  generate: true,
  structuredOutput: true,
  streaming: true,
  toolCalling: true,
  embeddings: true,
  vision: true,
  multiModal: true,
};

const NIM_CAPABILITIES: ModelCapabilities = {
  generate: true,
  structuredOutput: true,
  streaming: true,
  toolCalling: true,
  embeddings: false,
  vision: true,
  multiModal: false,
};

// ---------------------------------------------------------------------------
// Environment helper (works in both Node and Edge Runtime)
// ---------------------------------------------------------------------------

function env(key: string): string | undefined {
  if (typeof process !== "undefined") {
    return (process.env as Record<string, string | undefined>)[key];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Gemini configuration
// ---------------------------------------------------------------------------

function loadGeminiConfig(): ProviderConfig | null {
  const apiKey = (env("GEMINI_API_KEY") ?? "").trim();
  if (!apiKey) return null;

  const defaultModel = (env("GEMINI_MODEL") ?? "").trim() || "gemini-2.5-flash";

  const models: ModelConfig[] = [
    {
      id: "gemini-2.5-flash",
      name: "Gemini 2.5 Flash",
      providerId: "gemini",
      tier: "fast",
      costPer1kTokens: 0.0001,
      maxContextTokens: 1_048_576,
      maxOutputTokens: 65_536,
      capabilities: GEMINI_CAPABILITIES,
    },
    {
      id: "gemini-2.5-pro",
      name: "Gemini 2.5 Pro",
      providerId: "gemini",
      tier: "standard",
      costPer1kTokens: 0.00125,
      maxContextTokens: 1_048_576,
      maxOutputTokens: 65_536,
      capabilities: GEMINI_CAPABILITIES,
    },
    {
      id: "gemini-2.0-flash",
      name: "Gemini 2.0 Flash",
      providerId: "gemini",
      tier: "fast",
      costPer1kTokens: 0.0001,
      maxContextTokens: 1_048_576,
      maxOutputTokens: 8_192,
      capabilities: GEMINI_CAPABILITIES,
    },
    {
      id: "text-embedding-004",
      name: "Gemini Embedding (text-embedding-004)",
      providerId: "gemini",
      tier: "fast",
      costPer1kTokens: 0.00002,
      maxContextTokens: 2_048,
      maxOutputTokens: 0,
      capabilities: { ...GEMINI_CAPABILITIES, generate: false, structuredOutput: false, streaming: false, toolCalling: false, vision: false, multiModal: false },
    },
  ];

  return {
    id: "gemini",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKey,
    defaultModel,
    models,
    priority: 1,
    enabled: true,
  };
}

// ---------------------------------------------------------------------------
// NVIDIA NIM configuration
// ---------------------------------------------------------------------------

function loadNvidiaNimConfig(): ProviderConfig | null {
  const apiKey = (env("NVIDIA_NIM_API_KEY") ?? "").trim();
  if (!apiKey) return null;

  const baseUrl = (env("NVIDIA_NIM_BASE_URL") ?? "https://integrate.api.nvidia.com/v1").trim();
  const defaultModel = (env("NVIDIA_NIM_DEFAULT_MODEL") ?? "deepseek-ai/deepseek-v4-pro").trim();

  const models: ModelConfig[] = [
    {
      id: "deepseek-ai/deepseek-v4-pro",
      name: "DeepSeek V4 Pro",
      providerId: "nvidia-nim",
      tier: "strong",
      costPer1kTokens: 0.003,
      maxContextTokens: 131_072,
      maxOutputTokens: 8_192,
      capabilities: NIM_CAPABILITIES,
    },
    {
      id: "deepseek-ai/deepseek-v4-flash",
      name: "DeepSeek V4 Flash",
      providerId: "nvidia-nim",
      tier: "fast",
      costPer1kTokens: 0.0003,
      maxContextTokens: 131_072,
      maxOutputTokens: 8_192,
      capabilities: NIM_CAPABILITIES,
    },
    {
      id: "nvidia/llama-3.3-nemotron-super-49b-v1",
      name: "NVIDIA Nemotron Super 49B",
      providerId: "nvidia-nim",
      tier: "standard",
      costPer1kTokens: 0.001,
      maxContextTokens: 131_072,
      maxOutputTokens: 8_192,
      capabilities: NIM_CAPABILITIES,
    },
    {
      id: "nvidia/nemotron-ultra-253b",
      name: "NVIDIA Nemotron Ultra 253B",
      providerId: "nvidia-nim",
      tier: "strong",
      costPer1kTokens: 0.005,
      maxContextTokens: 131_072,
      maxOutputTokens: 8_192,
      capabilities: NIM_CAPABILITIES,
    },
  ];

  return {
    id: "nvidia-nim",
    name: "NVIDIA NIM",
    baseUrl,
    apiKey,
    defaultModel,
    models,
    priority: 2,
    enabled: true,
  };
}

// ---------------------------------------------------------------------------
// Configuration cache
// ---------------------------------------------------------------------------

let _configCache: ProviderConfig[] | null = null;

/**
 * Load all configured providers from environment.
 * Returns an array of enabled ProviderConfigs (only providers with valid
 * API keys are returned as enabled).
 */
export function loadProviderConfigs(): ProviderConfig[] {
  if (_configCache) return _configCache;

  const configs: ProviderConfig[] = [];
  const gemini = loadGeminiConfig();
  if (gemini) configs.push(gemini);

  const nvidia = loadNvidiaNimConfig();
  if (nvidia) configs.push(nvidia);

  // Sort by priority
  configs.sort((a, b) => a.priority - b.priority);

  _configCache = configs;
  return configs;
}

/** Reset config cache (for testing). */
export function resetConfigCache(): void {
  _configCache = null;
}

/**
 * Get the default fallback configuration.
 */
export function getDefaultFallbackConfig(): FallbackConfig {
  return {
    enabled: true,
    maxAttempts: 3,
    retryDelayMs: 1000,
    maxRetryDelayMs: 30_000,
    maxRetriesPerProvider: 2,
  };
}

/**
 * Check if NVIDIA NIM credentials are configured.
 */
export function isNvidiaNimConfigured(): boolean {
  const key = (env("NVIDIA_NIM_API_KEY") ?? "").trim();
  return key.length > 0;
}

/**
 * Check if Gemini credentials are configured.
 */
export function isGeminiConfigured(): boolean {
  const key = (env("GEMINI_API_KEY") ?? "").trim();
  return key.length > 0;
}
