// ---------------------------------------------------------------------------
// Atlas AI Runtime — Model Registry
//
// Centralized registry that tracks all available models and their capabilities.
// Used by the task router to select the best model for each workload.
// ---------------------------------------------------------------------------

import type { ModelConfig, ModelTier, ProviderId, CapabilityLevel } from "./types";
import { loadProviderConfigs } from "./config";

// ---------------------------------------------------------------------------
// Model capability requirements (what a task needs)
// ---------------------------------------------------------------------------

export interface CapabilityRequirement {
  /** Minimum capability level required. */
  level: CapabilityLevel;
  /** Whether this capability is strictly required (task fails without it). */
  required: boolean;
}

export interface ModelRoutingProfile {
  /** Unique model identifier. */
  modelId: string;
  /** Provider this model belongs to. */
  providerId: ProviderId;
  /** Model tier. */
  tier: ModelTier;
  /** Cost per 1K tokens (USD). */
  costPer1kTokens: number;
  /** Max context window. */
  maxContextTokens: number;
  /** Max output tokens. */
  maxOutputTokens: number;

  // Capability scores (0-10 scale for routing decisions)
  reasoning: number;
  structuredOutput: number;
  streaming: number;
  toolCalling: number;
  embeddings: number;
  vision: number;
  documentUnderstanding: number;
  longContext: number;
  speed: number; // inverse of latency expectation

  /** Whether this model is currently available (provider enabled + API key present). */
  available: boolean;
  /** Last known availability check timestamp. */
  lastChecked: string;
  /** Consecutive failure count (auto-resets on success). */
  failureCount: number;
  /** Whether this model is disabled by admin. */
  disabled: boolean;
}

// ---------------------------------------------------------------------------
// Capability scoring — maps boolean ModelCapabilities to numeric scores
// ---------------------------------------------------------------------------

function capabilityToScore(
  value: boolean | CapabilityLevel | undefined,
  tier: ModelTier,
  defaultScore: number,
): number {
  if (typeof value === "boolean") return value ? defaultScore : 0;
  if (typeof value === "string") {
    switch (value) {
      case "high": return 9;
      case "medium": return 6;
      case "low": return 3;
    }
  }
  // Infer from tier
  switch (tier) {
    case "strong": return 8;
    case "standard": return 6;
    case "fast": return 4;
    default: return defaultScore;
  }
}

// ---------------------------------------------------------------------------
// Model Registry singleton
// ---------------------------------------------------------------------------

let _models: Map<string, ModelRoutingProfile> = new Map();
let _initialized = false;

/**
 * Initialize the model registry from configured providers.
 * Should be called after provider configs are loaded.
 */
export function initializeModelRegistry(): void {
  if (_initialized) return;

  const configs = loadProviderConfigs();
  _models.clear();

  for (const config of configs) {
    for (const model of config.models) {
      const profile = modelConfigToProfile(model, config.id, config.enabled);
      _models.set(model.id, profile);
    }
  }

  _initialized = true;
}

/**
 * Reset the model registry (for testing).
 */
export function resetModelRegistry(): void {
  _models.clear();
  _initialized = false;
}

/**
 * Check if model registry is initialized.
 */
export function isModelRegistryInitialized(): boolean {
  return _initialized;
}

/**
 * Convert a ModelConfig to a ModelRoutingProfile.
 */
function modelConfigToProfile(
  model: ModelConfig,
  providerId: ProviderId,
  providerEnabled: boolean,
): ModelRoutingProfile {
  const caps = model.capabilities;
  const tier = model.tier;

  return {
    modelId: model.id,
    providerId,
    tier,
    costPer1kTokens: model.costPer1kTokens,
    maxContextTokens: model.maxContextTokens,
    maxOutputTokens: model.maxOutputTokens,

    reasoning: capabilityToScore(caps.reasoning, tier, tier === "strong" ? 8 : tier === "standard" ? 6 : 4),
    structuredOutput: caps.structuredOutput ? (tier === "strong" ? 9 : tier === "standard" ? 8 : 7) : 0,
    streaming: caps.streaming ? 8 : 0,
    toolCalling: caps.toolCalling ? 8 : 0,
    embeddings: caps.embeddings ? 8 : 0,
    vision: caps.vision ? 7 : 0,
    documentUnderstanding: capabilityToScore(caps.documentUnderstanding, tier, caps.vision ? 6 : 3),
    longContext: capabilityToScore(caps.longContext, tier, model.maxContextTokens > 100_000 ? 8 : 4),
    speed: tier === "fast" ? 9 : tier === "standard" ? 6 : 4,

    available: providerEnabled,
    lastChecked: new Date().toISOString(),
    failureCount: 0,
    disabled: false,
  };
}

// ---------------------------------------------------------------------------
// Registry query API
// ---------------------------------------------------------------------------

/**
 * Get routing profile for a specific model.
 */
export function getModelProfile(modelId: string): ModelRoutingProfile | undefined {
  return _models.get(modelId);
}

/**
 * Get all model profiles.
 */
export function getAllModelProfiles(): ModelRoutingProfile[] {
  return Array.from(_models.values());
}

/**
 * Get all available (not disabled, provider enabled) models.
 */
export function getAvailableModels(): ModelRoutingProfile[] {
  return getAllModelProfiles().filter((m) => m.available && !m.disabled);
}

/**
 * Get models matching specific criteria.
 */
export function findModels(criteria: {
  tier?: ModelTier;
  providerId?: ProviderId;
  minCapability?: { key: keyof Omit<ModelRoutingProfile, "modelId" | "providerId" | "tier" | "costPer1kTokens" | "maxContextTokens" | "maxOutputTokens" | "available" | "lastChecked" | "failureCount" | "disabled">; minScore: number };
  maxCostPer1k?: number;
  minContextTokens?: number;
  maxOutputTokens?: number;
}): ModelRoutingProfile[] {
  return getAvailableModels().filter((model) => {
    if (criteria.tier && model.tier !== criteria.tier) return false;
    if (criteria.providerId && model.providerId !== criteria.providerId) return false;
    if (criteria.maxCostPer1k && model.costPer1kTokens > criteria.maxCostPer1k) return false;
    if (criteria.minContextTokens && model.maxContextTokens < criteria.minContextTokens) return false;
    if (criteria.maxOutputTokens && model.maxOutputTokens < criteria.maxOutputTokens) return false;
    if (criteria.minCapability) {
      const score = model[criteria.minCapability.key] as number;
      if (score < criteria.minCapability.minScore) return false;
    }
    return true;
  });
}

/**
 * Mark a model as having failed (increases failure count, may disable).
 */
export function recordModelFailure(modelId: string): void {
  const model = _models.get(modelId);
  if (!model) return;
  model.failureCount++;
  // Auto-disable after 5 consecutive failures
  if (model.failureCount >= 5) {
    model.disabled = true;
  }
}

/**
 * Mark a model as having succeeded (resets failure count).
 */
export function recordModelSuccess(modelId: string): void {
  const model = _models.get(modelId);
  if (!model) return;
  model.failureCount = 0;
  model.lastChecked = new Date().toISOString();
}

/**
 * Manually enable/disable a model (admin control).
 */
export function setModelDisabled(modelId: string, disabled: boolean): void {
  const model = _models.get(modelId);
  if (!model) return;
  model.disabled = disabled;
}

/**
 * Get registry status for observability.
 */
export function getModelRegistryStatus(): {
  totalModels: number;
  availableModels: number;
  disabledModels: number;
  modelsWithFailures: number;
  byProvider: Record<string, { total: number; available: number }>;
} {
  const all = getAllModelProfiles();
  const byProvider: Record<string, { total: number; available: number }> = {};

  for (const model of all) {
    if (!byProvider[model.providerId]) {
      byProvider[model.providerId] = { total: 0, available: 0 };
    }
    byProvider[model.providerId].total++;
    if (model.available && !model.disabled) {
      byProvider[model.providerId].available++;
    }
  }

  return {
    totalModels: all.length,
    availableModels: getAvailableModels().length,
    disabledModels: all.filter((m) => m.disabled).length,
    modelsWithFailures: all.filter((m) => m.failureCount > 0).length,
    byProvider,
  };
}
