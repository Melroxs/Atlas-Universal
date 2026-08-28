// ---------------------------------------------------------------------------
// Atlas Agent Runtime — Model Router
//
// Resolves which AI provider and model to use based on the agent's model
// policy and available providers. Supports escalation for low-confidence
// results. The router delegates availability checks to the ai-runtime
// provider registry so agent and non-agent code share the same provider
// configuration.
// ---------------------------------------------------------------------------

import type { ModelPolicy } from "../jobs/types";
import type { ConfidenceLevel } from "./types";

// ---------------------------------------------------------------------------
// Available providers and models (configuration, not hard-coded keys)
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  id: string;
  /** Display name. */
  name: string;
  /** Available models in this provider, ordered from fast → strong. */
  models: ModelConfig[];
  /** Whether this provider is currently configured (has API key). */
  available: boolean;
}

export interface ModelConfig {
  id: string;
  name: string;
  tier: "fast" | "standard" | "strong";
  /** Estimated cost per 1K tokens (USD). */
  cost_per_1k_tokens: number;
  /** Max tokens supported. */
  max_tokens: number;
}

// ---------------------------------------------------------------------------
// Default provider configurations
//
// The `available` flag is set to `false` by default. At runtime, if the
// ai-runtime provider registry is initialized and reports a provider as
// available, the flag is updated via `syncWithAIRuntime()`.
// ---------------------------------------------------------------------------

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: "gemini",
    name: "Google Gemini",
    models: [
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", tier: "fast", cost_per_1k_tokens: 0.0001, max_tokens: 1048576 },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", tier: "fast", cost_per_1k_tokens: 0.0001, max_tokens: 1048576 },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", tier: "standard", cost_per_1k_tokens: 0.00125, max_tokens: 1048576 },
    ],
    available: false,
  },
  {
    id: "nvidia-nim",
    name: "NVIDIA NIM",
    models: [
      { id: "deepseek-ai/deepseek-v4-flash-0731", name: "DeepSeek V4 Flash", tier: "fast", cost_per_1k_tokens: 0.0003, max_tokens: 131072 },
      { id: "deepseek-ai/deepseek-v4-pro-0813", name: "DeepSeek V4 Pro", tier: "strong", cost_per_1k_tokens: 0.003, max_tokens: 131072 },
      { id: "nvidia/nemotron-3-super-120b-a12b", name: "NVIDIA Nemotron Super 49B", tier: "standard", cost_per_1k_tokens: 0.001, max_tokens: 131072 },
      { id: "nvidia/nemotron-3-ultra-550b-a55b", name: "NVIDIA Nemotron Ultra 253B", tier: "strong", cost_per_1k_tokens: 0.005, max_tokens: 131072 },
    ],
    available: false,
  },
  {
    id: "openai",
    name: "OpenAI",
    models: [
      { id: "gpt-4o-mini", name: "GPT-4o Mini", tier: "fast", cost_per_1k_tokens: 0.00015, max_tokens: 128000 },
      { id: "gpt-4o", name: "GPT-4o", tier: "standard", cost_per_1k_tokens: 0.005, max_tokens: 128000 },
      { id: "o3-mini", name: "o3-mini", tier: "strong", cost_per_1k_tokens: 0.011, max_tokens: 200000 },
    ],
    available: false,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    models: [
      { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", tier: "fast", cost_per_1k_tokens: 0.001, max_tokens: 8192 },
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", tier: "standard", cost_per_1k_tokens: 0.003, max_tokens: 64000 },
      { id: "claude-opus-4-20250514", name: "Claude Opus 4", tier: "strong", cost_per_1k_tokens: 0.015, max_tokens: 32000 },
    ],
    available: false,
  },
];

// ---------------------------------------------------------------------------
// Router state
// ---------------------------------------------------------------------------

let _providers: ProviderConfig[] = DEFAULT_PROVIDERS.map((p) => ({
  ...p,
  models: [...p.models],
}));

export function configureProviders(providers: ProviderConfig[]): void {
  _providers = providers.map((p) => ({
    ...p,
    models: [...p.models],
  }));
}

export function getAvailableProviders(): ProviderConfig[] {
  return _providers.filter((p) => p.available);
}

export function markProviderAvailable(providerId: string, available: boolean): void {
  const provider = _providers.find((p) => p.id === providerId);
  if (provider) provider.available = available;
}

/**
 * Synchronize provider availability from the ai-runtime registry.
 * This bridges the agent model-router with the shared provider configuration
 * so both subsystems agree on which providers are live.
 *
 * Safe to call multiple times — idempotent.
 */
export async function syncWithAIRuntime(): Promise<void> {
  try {
    const { initializeRegistry, getAvailableProviders: getAIRuntimeProviders } = await import("../ai-runtime");

    // Ensure ai-runtime is initialized
    await initializeRegistry();

    const aiProviders = getAIRuntimeProviders();
    const availableIds = new Set(aiProviders.map((p) => p.id));

    for (const provider of _providers) {
      provider.available = availableIds.has(provider.id);
    }
  } catch {
    // ai-runtime not available — keep the manually-configured state.
    // This happens in test environments or when ai-runtime hasn't been set up yet.
  }
}

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

export interface ResolvedModel {
  provider: string;
  model: string;
  tier: "fast" | "standard" | "strong";
  estimated_cost_per_1k: number;
}

const TIER_ORDER: Array<"fast" | "standard" | "strong"> = ["fast", "standard", "strong"];

/**
 * Resolve the best model for a given policy and confidence requirement.
 *
 * Selection logic:
 * 1. If policy specifies a provider/model, use it if available.
 * 2. Otherwise, pick the best available model within the tier limit.
 * 3. For escalation, try the next tier up.
 */
export function resolveModel(
  policy: ModelPolicy,
  escalateFrom?: ConfidenceLevel,
): ResolvedModel | null {
  const available = getAvailableProviders();
  if (available.length === 0) return null;

  const maxTierIdx = policy.max_model_tier
    ? TIER_ORDER.indexOf(policy.max_model_tier)
    : TIER_ORDER.length - 1;

  // If escalation requested, bump the tier
  let targetTierIdx = maxTierIdx;
  if (escalateFrom === "low" && policy.allow_escalation) {
    targetTierIdx = Math.min(maxTierIdx + 1, TIER_ORDER.length - 1);
  } else if (escalateFrom === "medium" && policy.allow_escalation) {
    targetTierIdx = Math.min(maxTierIdx, TIER_ORDER.length - 1);
  }

  // Try preferred provider first
  if (policy.preferred_provider) {
    const provider = available.find((p) => p.id === policy.preferred_provider);
    if (provider) {
      const model = findBestModel(provider, policy, targetTierIdx);
      if (model) {
        return {
          provider: provider.id,
          model: model.id,
          tier: model.tier,
          estimated_cost_per_1k: model.cost_per_1k_tokens,
        };
      }
    }
  }

  // Try preferred model across any provider
  if (policy.preferred_model) {
    for (const provider of available) {
      const model = provider.models.find((m) => m.id === policy.preferred_model);
      if (model) {
        return {
          provider: provider.id,
          model: model.id,
          tier: model.tier,
          estimated_cost_per_1k: model.cost_per_1k_tokens,
        };
      }
    }
  }

  // Pick best available model within constraints
  for (const provider of available) {
    const model = findBestModel(provider, policy, targetTierIdx);
    if (model) {
      return {
        provider: provider.id,
        model: model.id,
        tier: model.tier,
        estimated_cost_per_1k: model.cost_per_1k_tokens,
      };
    }
  }

  return null;
}

function findBestModel(
  provider: ProviderConfig,
  policy: ModelPolicy,
  maxTierIdx: number,
): ModelConfig | null {
  // Filter to models within tier and cost limits
  const candidates = provider.models.filter((m) => {
    const tierIdx = TIER_ORDER.indexOf(m.tier);
    if (tierIdx > maxTierIdx) return false;
    if (policy.max_tokens && m.max_tokens < policy.max_tokens) return false;
    if (
      policy.max_cost_usd !== undefined &&
      m.cost_per_1k_tokens > policy.max_cost_usd
    )
      return false;
    return true;
  });

  // Return the strongest available model within constraints
  candidates.sort(
    (a, b) => TIER_ORDER.indexOf(b.tier) - TIER_ORDER.indexOf(a.tier),
  );
  return candidates[0] ?? null;
}

/**
 * Estimate cost for a given model and token count.
 */
export function estimateCost(
  resolved: ResolvedModel,
  totalTokens: number,
): number {
  return (totalTokens / 1000) * resolved.estimated_cost_per_1k;
}
