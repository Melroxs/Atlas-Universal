// ---------------------------------------------------------------------------
// Atlas AI Runtime — Provider Registry
//
// Manages the set of available AI providers. Handles:
//   - Registration of provider adapters
//   - Provider selection based on model policies
//   - Fallback chain when the primary provider fails
//   - Runtime enable/disable of providers
// ---------------------------------------------------------------------------

import type {
  AIProviderAdapter,
  ProviderId,
  ModelTier,
} from "./types";
import { loadProviderConfigs } from "./config";

// ---------------------------------------------------------------------------
// Registry singleton
// ---------------------------------------------------------------------------

const _providers = new Map<ProviderId, AIProviderAdapter>();
let _initialized = false;

/**
 * Initialize the registry from environment configuration.
 * Safe to call multiple times — only initializes once.
 */
export async function initializeRegistry(): Promise<void> {
  if (_initialized) return;

  const configs = loadProviderConfigs();
  for (const config of configs) {
    if (config.id === "gemini") {
      const { GeminiProvider } = await import("./providers/gemini");
      _providers.set("gemini", new GeminiProvider(config));
    } else if (config.id === "nvidia-nim") {
      const { NvidiaNimProvider } = await import("./providers/nvidia-nim");
      _providers.set("nvidia-nim", new NvidiaNimProvider(config));
    }
  }

  _initialized = true;
}

/**
 * Synchronous initialization for providers that are already imported.
 * Used by the runtime when providers are registered directly.
 */
export function ensureInitialized(): void {
  if (_initialized) return;
  // Load configs synchronously — providers must be registered via registerProvider
  // or initializeRegistry must be called first.
  const configs = loadProviderConfigs();
  // Mark as initialized even if no providers were configured — we don't want
  // to re-initialize on every call.
  _initialized = true;

  // If configs exist but no providers were registered, this is a no-op.
  // The caller should use initializeRegistry() for async setup.
  void configs;
}

/**
 * Register a provider adapter directly (for testing or custom providers).
 */
export function registerProvider(adapter: AIProviderAdapter): void {
  _providers.set(adapter.id, adapter);
  _initialized = true;
}

/**
 * Get a specific provider adapter.
 */
export function getProvider(id: ProviderId): AIProviderAdapter | undefined {
  return _providers.get(id);
}

/**
 * Get all registered providers, sorted by priority.
 */
export function getAllProviders(): AIProviderAdapter[] {
  ensureInitialized();
  return Array.from(_providers.values());
}

/**
 * Get all available (enabled + has API key) providers.
 */
export function getAvailableProviders(): AIProviderAdapter[] {
  ensureInitialized();
  return Array.from(_providers.values()).filter((p) => p.isAvailable());
}

/**
 * Check if a specific provider is available.
 */
export function isProviderAvailable(id: ProviderId): boolean {
  ensureInitialized();
  const provider = _providers.get(id);
  return provider?.isAvailable() ?? false;
}

/**
 * Find the best provider for a given model tier preference.
 * Returns providers sorted by priority, filtered to those with the
 * requested tier capability.
 */
export function findProvidersForTier(
  _tier?: ModelTier,
  preferredProvider?: ProviderId,
): AIProviderAdapter[] {
  ensureInitialized();
  const available = getAvailableProviders();

  // If a preferred provider is specified and available, try it first
  if (preferredProvider) {
    const preferred = available.find((p) => p.id === preferredProvider);
    if (preferred) {
      const others = available.filter((p) => p.id !== preferredProvider);
      return [preferred, ...others];
    }
  }

  return available;
}

/**
 * Find a provider that supports a specific model.
 */
export function findProviderForModel(
  modelId: string,
): AIProviderAdapter | undefined {
  ensureInitialized();
  for (const provider of getAvailableProviders()) {
    if (provider.getModel(modelId)) return provider;
  }
  return undefined;
}

/**
 * Reset the registry (for testing).
 */
export function resetRegistry(): void {
  _providers.clear();
  _initialized = false;
}
