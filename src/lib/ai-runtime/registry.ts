// ---------------------------------------------------------------------------
// Atlas AI Runtime — Provider Registry
//
// Manages registered AI providers and handles provider selection based on
// configuration, availability, and task requirements.
// ---------------------------------------------------------------------------

import type {
  ProviderId,
  AIProvider,
  ProviderConfig,
  ModelConfig,
  ModelTier,
  ProviderCapabilities,
} from "./types";
import { GeminiProvider } from "./providers/gemini";
import { NvidiaNimProvider } from "./providers/nvidia";

// ---------------------------------------------------------------------------
// Registry state
// ---------------------------------------------------------------------------

const _providers = new Map<ProviderId, AIProvider>();
const _configs = new Map<ProviderId, ProviderConfig>();

// ---------------------------------------------------------------------------
// Default provider configurations
// ---------------------------------------------------------------------------

function buildDefaultConfigs(): ProviderConfig[] {
  return [
    {
      id: "gemini",
      name: "Google Gemini",
      apiKey: "",
      baseUrl: "https://generativelanguage.googleapis.com",
      defaultModel: "gemini-2.5-flash",
      models: [
        { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", tier: "fast", costPer1kTokens: 0.0001, maxContextTokens: 1_048_576, maxOutputTokens: 8192 },
        { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", tier: "standard", costPer1kTokens: 0.00125, maxContextTokens: 1_048_576, maxOutputTokens: 65536 },
      ],
      capabilities: { generate: true, structuredOutput: true, streaming: true, embeddings: false, vision: true, toolCalling: true },
      enabled: false,
      priority: 1,
    },
    {
      id: "nvidia_nim",
      name: "NVIDIA NIM",
      apiKey: "",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      defaultModel: "deepseek-ai/deepseek-r1",
      models: [
        { id: "deepseek-ai/deepseek-r1", name: "DeepSeek R1", tier: "fast", costPer1kTokens: 0.00025, maxContextTokens: 131_072, maxOutputTokens: 32768 },
        { id: "nvidia/llama-3.1-nemotron-70b-instruct", name: "Nemotron 70B", tier: "standard", costPer1kTokens: 0.0012, maxContextTokens: 131_072, maxOutputTokens: 32768 },
        { id: "nvidia/llama-3.3-70b-instruct", name: "Llama 3.3 70B", tier: "standard", costPer1kTokens: 0.00088, maxContextTokens: 131_072, maxOutputTokens: 32768 },
      ],
      capabilities: { generate: true, structuredOutput: true, streaming: true, embeddings: true, vision: false, toolCalling: false },
      enabled: false,
      priority: 2,
    },
  ];
}

// ---------------------------------------------------------------------------
// Configuration loading
// ---------------------------------------------------------------------------

/**
 * Load provider configurations from environment variables.
 * Server-side only — never call from browser code.
 *
 * Supported environment variables:
 *   GEMINI_API_KEY         — Gemini API key
 *   GEMINI_MODEL           — Override Gemini model
 *   NVIDIA_NIM_API_KEY     — NVIDIA NIM API key
 *   NVIDIA_NIM_BASE_URL    — Override NVIDIA NIM base URL
 *   NVIDIA_NIM_DEFAULT_MODEL — Override NVIDIA NIM default model
 *   AI_PROVIDER            — Force a specific provider (gemini|nvidia_nim)
 */
export function loadProviderConfigs(env?: Record<string, string | undefined>): ProviderConfig[] {
  const e = env ?? (typeof process !== "undefined" ? process.env : {});
  const configs = buildDefaultConfigs();

  // Gemini
  const geminiKey = (e.GEMINI_API_KEY ?? "").trim();
  const geminiModel = (e.GEMINI_MODEL ?? "").trim();
  const geminiConfig = configs.find((c) => c.id === "gemini")!;
  if (geminiKey) {
    geminiConfig.apiKey = geminiKey;
    geminiConfig.enabled = true;
    if (geminiModel) {
      geminiConfig.defaultModel = geminiModel;
    }
  }

  // NVIDIA NIM
  const nvidiaKey = (e.NVIDIA_NIM_API_KEY ?? "").trim();
  const nvidiaBaseUrl = (e.NVIDIA_NIM_BASE_URL ?? "").trim();
  const nvidiaModel = (e.NVIDIA_NIM_DEFAULT_MODEL ?? "").trim();
  const nvidiaConfig = configs.find((c) => c.id === "nvidia_nim")!;
  if (nvidiaKey) {
    nvidiaConfig.apiKey = nvidiaKey;
    nvidiaConfig.enabled = true;
    if (nvidiaBaseUrl) nvidiaConfig.baseUrl = nvidiaBaseUrl;
    if (nvidiaModel) nvidiaConfig.defaultModel = nvidiaModel;
  }

  // Forced provider override
  const forcedProvider = (e.AI_PROVIDER ?? "").trim().toLowerCase();
  if (forcedProvider === "gemini") {
    nvidiaConfig.enabled = false;
    geminiConfig.priority = 0;
  } else if (forcedProvider === "nvidia_nim") {
    geminiConfig.enabled = false;
    nvidiaConfig.priority = 0;
  }

  return configs;
}

// ---------------------------------------------------------------------------
// Registry operations
// ---------------------------------------------------------------------------

/** Initialize the registry from environment or explicit configs. */
export function initializeRegistry(configs?: ProviderConfig[]): void {
  const providerConfigs = configs ?? loadProviderConfigs();
  _configs.clear();
  _providers.clear();

  for (const config of providerConfigs) {
    _configs.set(config.id, config);

    let provider: AIProvider;
    switch (config.id) {
      case "gemini":
        provider = new GeminiProvider(config);
        break;
      case "nvidia_nim":
        provider = new NvidiaNimProvider(config);
        break;
      default:
        continue;
    }
    _providers.set(config.id, provider);
  }
}

/** Get all registered providers (including disabled ones). */
export function getAllProviders(): AIProvider[] {
  return Array.from(_providers.values());
}

/** Get only available (enabled + has API key) providers, sorted by priority. */
export function getAvailableProviders(): AIProvider[] {
  return getAllProviders()
    .filter((p) => p.available)
    .sort((a, b) => {
      const configA = _configs.get(a.id);
      const configB = _configs.get(b.id);
      return (configA?.priority ?? 99) - (configB?.priority ?? 99);
    });
}

/** Get a specific provider by ID. */
export function getProvider(id: ProviderId): AIProvider | undefined {
  return _providers.get(id);
}

/** Get a specific provider config. */
export function getProviderConfig(id: ProviderId): ProviderConfig | undefined {
  return _configs.get(id);
}

/** Check if any provider is available. */
export function hasAvailableProvider(): boolean {
  return getAvailableProviders().length > 0;
}

/** Get the best available provider (highest priority). */
export function getBestProvider(): AIProvider | undefined {
  return getAvailableProviders()[0];
}

/** Find a model across all available providers. */
export function findModel(
  modelId: string,
): { provider: AIProvider; model: ModelConfig } | undefined {
  for (const provider of getAvailableProviders()) {
    const config = _configs.get(provider.id);
    const model = config?.models.find((m) => m.id === modelId);
    if (model) return { provider, model };
  }
  return undefined;
}

/** Find the best model within a tier across all providers. */
export function findBestModelInTier(
  tier: ModelTier,
  maxCost?: number,
): { provider: AIProvider; model: ModelConfig } | undefined {
  const tierOrder: ModelTier[] = ["fast", "standard", "strong"];
  const targetIdx = tierOrder.indexOf(tier);

  for (const provider of getAvailableProviders()) {
    const config = _configs.get(provider.id);
    if (!config) continue;

    const candidates = config.models
      .filter((m) => {
        const tierIdx = tierOrder.indexOf(m.tier);
        if (tierIdx > targetIdx) return false;
        if (maxCost !== undefined && m.costPer1kTokens > maxCost) return false;
        return true;
      })
      .sort((a, b) => tierOrder.indexOf(b.tier) - tierOrder.indexOf(a.tier));

    if (candidates.length > 0) {
      return { provider, model: candidates[0] };
    }
  }
  return undefined;
}

/** Reset the registry (for testing). */
export function resetRegistry(): void {
  _providers.clear();
  _configs.clear();
}
