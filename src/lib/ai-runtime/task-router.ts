// ---------------------------------------------------------------------------
// Atlas AI Runtime — Task Router
//
// Selects the optimal model for each Atlas task based on capability
// requirements, cost, and availability. Deterministic routing first,
// with fallback chains per task.
// ---------------------------------------------------------------------------

import type { ProviderId, ModelTier, CapabilityLevel } from "./types";
import type { AtlasAITask } from "./tasks";
import type { ModelRoutingProfile } from "./model-registry";
import type { TaskRequirementProfile } from "./task-requirements";
import {
  initializeModelRegistry,
  isModelRegistryInitialized,
  getAvailableModels,
  findModels,
  getModelProfile,
  recordModelFailure,
  recordModelSuccess,
  getModelRegistryStatus,
} from "./model-registry";
import { getTaskRequirements } from "./task-requirements";
import { getTaskConfig } from "./tasks";

// ---------------------------------------------------------------------------
// Routing mode
// ---------------------------------------------------------------------------

export type RoutingMode = "legacy" | "single-provider" | "routed";

export interface RoutingConfig {
  /** Current routing mode. */
  mode: RoutingMode;
  /** Single provider to use in single-provider mode. */
  singleProviderId?: ProviderId;
  /** Whether to prefer cost-optimized selection. */
  preferCostOptimized: boolean;
  /** Maximum cost per 1K tokens (hard limit). */
  maxCostPer1kTokens: number;
  /** Enable automatic model fallback. */
  enableFallback: boolean;
}

const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  mode: "routed",
  preferCostOptimized: false,
  maxCostPer1kTokens: 0.01,
  enableFallback: true,
};

// ---------------------------------------------------------------------------
// Routing result
// ---------------------------------------------------------------------------

export interface RoutingDecision {
  /** Selected model. */
  model: ModelRoutingProfile;
  /** Reason for selection. */
  reason: string;
  /** Score (0-100) for this selection. */
  score: number;
  /** Fallback models in priority order. */
  fallbacks: ModelRoutingProfile[];
  /** Task that was routed. */
  task: AtlasAITask;
  /** Routing mode used. */
  mode: RoutingMode;
}

// ---------------------------------------------------------------------------
// Task Router singleton
// ---------------------------------------------------------------------------

let _config: RoutingConfig = { ...DEFAULT_ROUTING_CONFIG };
let _initialized = false;

/**
 * Initialize the task router.
 */
export function initTaskRouter(config?: Partial<RoutingConfig>): void {
  if (config) {
    _config = { ...DEFAULT_ROUTING_CONFIG, ...config };
  }
  _initialized = true;
}

/**
 * Reset the task router (for testing).
 */
export function resetTaskRouter(): void {
  _config = { ...DEFAULT_ROUTING_CONFIG };
  _initialized = false;
}

/**
 * Get current routing configuration.
 */
export function getRoutingConfig(): RoutingConfig {
  return { ..._config };
}

/**
 * Update routing configuration.
 */
export function updateRoutingConfig(config: Partial<RoutingConfig>): void {
  _config = { ..._config, ...config };
}

// ---------------------------------------------------------------------------
// Scoring functions
// ---------------------------------------------------------------------------

/**
 * Score a model against a task requirement profile.
 * Returns 0-100 score.
 */
function scoreModelForTask(
  model: ModelRoutingProfile,
  requirements: TaskRequirementProfile,
): number {
  let score = 0;
  let totalWeight = 0;

  // Score each capability
  const capabilities: Array<keyof Pick<
    ModelRoutingProfile,
    "reasoning" | "structuredOutput" | "streaming" | "toolCalling" | "embeddings" | "vision" | "documentUnderstanding" | "longContext" | "speed"
  >> = [
    "reasoning", "structuredOutput", "streaming", "toolCalling",
    "embeddings", "vision", "documentUnderstanding", "longContext", "speed",
  ];

  for (const cap of capabilities) {
    const req = requirements[cap];
    if (!req || req.weight === 0) continue;

    const modelScore = model[cap] as number;
    const reqScore = levelToScore(req.level);

    totalWeight += req.weight;

    if (modelScore >= reqScore) {
      // Full weight if meets or exceeds requirement
      score += req.weight * 10;
    } else if (modelScore > 0) {
      // Partial score proportional to how close it is
      const ratio = modelScore / reqScore;
      score += req.weight * 10 * ratio;
    }
    // If modelScore is 0 and required, this will heavily penalize
  }

  if (totalWeight === 0) return 50; // neutral if no requirements

  // Normalize to 0-100
  const normalizedScore = (score / (totalWeight * 10)) * 100;

  // Apply tier preference bonus
  const tierBonus = requirements.preferredTiers.includes(model.tier) ? 5 : 0;

  // Apply cost penalty (higher cost = lower score)
  const costPenalty = model.costPer1kTokens > requirements.maxCostPer1kTokens
    ? -15
    : model.costPer1kTokens > requirements.maxCostPer1kTokens * 0.5
      ? -5
      : 0;

  // Apply failure penalty
  const failurePenalty = model.failureCount > 0 ? model.failureCount * 10 : 0;

  return Math.max(0, Math.min(100, normalizedScore + tierBonus + costPenalty - failurePenalty));
}

function levelToScore(level: CapabilityLevel): number {
  switch (level) {
    case "high": return 8;
    case "medium": return 5;
    case "low": return 2;
  }
}

// ---------------------------------------------------------------------------
// Routing logic
// ---------------------------------------------------------------------------

/**
 * Route a task to the best available model.
 */
export function routeTask(task: AtlasAITask): RoutingDecision {
  if (!_initialized) {
    initTaskRouter();
  }

  // Ensure model registry is populated
  if (!isModelRegistryInitialized()) {
    initializeModelRegistry();
  }

  const requirements = getTaskRequirements(task);

  // Legacy mode — use default provider/model
  if (_config.mode === "legacy") {
    return routeLegacy(task, requirements);
  }

  // Single-provider mode
  if (_config.mode === "single-provider" && _config.singleProviderId) {
    return routeSingleProvider(task, requirements, _config.singleProviderId);
  }

  // Routed mode — intelligent selection
  return routeRouted(task, requirements);
}

/**
 * Legacy routing — uses default provider (Phase 1 behavior).
 */
function routeLegacy(
  task: AtlasAITask,
  requirements: TaskRequirementProfile,
): RoutingDecision {
  const models = getAvailableModels();
  if (models.length === 0) {
    throw new Error("No available models for legacy routing");
  }

  const taskConfig = getTaskConfig(task);
  const preferredTier = taskConfig.preferredTier;

  // Find models matching preferred tier
  const tierModels = models.filter((m) => m.tier === preferredTier);
  const model = tierModels[0] ?? models[0];

  return {
    model,
    reason: `Legacy mode: using ${preferredTier} tier default`,
    score: 50,
    fallbacks: models.filter((m) => m.modelId !== model.modelId).slice(0, 2),
    task,
    mode: "legacy",
  };
}

/**
 * Single-provider routing — restrict to one provider.
 */
function routeSingleProvider(
  task: AtlasAITask,
  requirements: TaskRequirementProfile,
  providerId: ProviderId,
): RoutingDecision {
  const models = findModels({ providerId });
  if (models.length === 0) {
    throw new Error(`No available models for provider: ${providerId}`);
  }

  // Score each model
  const scored = models
    .map((model) => ({ model, score: scoreModelForTask(model, requirements) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];

  return {
    model: best.model,
    reason: `Single-provider mode (${providerId}): best scored model`,
    score: best.score,
    fallbacks: scored.slice(1).map((s) => s.model),
    task,
    mode: "single-provider",
  };
}

/**
 * Routed mode — intelligent model selection across all providers.
 */
function routeRouted(
  task: AtlasAITask,
  requirements: TaskRequirementProfile,
): RoutingDecision {
  let models = getAvailableModels();

  // Filter by cost limit
  if (_config.maxCostPer1kTokens > 0) {
    models = models.filter((m) => m.costPer1kTokens <= _config.maxCostPer1kTokens);
  }

  // Filter by context window
  if (requirements.minContextTokens > 0) {
    models = models.filter((m) => m.maxContextTokens >= requirements.minContextTokens);
  }

  // Filter by output tokens
  if (requirements.minOutputTokens > 0) {
    models = models.filter((m) => m.maxOutputTokens >= requirements.minOutputTokens);
  }

  // Check required capabilities
  const requiredCapabilities: Array<keyof Pick<
    ModelRoutingProfile,
    "reasoning" | "structuredOutput" | "streaming" | "toolCalling" | "embeddings" | "vision" | "documentUnderstanding" | "longContext" | "speed"
  >> = [
    "reasoning", "structuredOutput", "streaming", "toolCalling",
    "embeddings", "vision", "documentUnderstanding", "longContext", "speed",
  ];

  for (const cap of requiredCapabilities) {
    const req = requirements[cap];
    if (!req.required) continue;
    const minScore = levelToScore(req.level);
    models = models.filter((m) => (m[cap] as number) >= minScore);
  }

  // Filter by preferred providers (if specified)
  if (requirements.preferredProviders.length > 0) {
    const preferred = models.filter((m) =>
      requirements.preferredProviders.includes(m.providerId),
    );
    if (preferred.length > 0) {
      models = preferred;
    }
  }

  if (models.length === 0) {
    throw new Error(
      `No models match requirements for task: ${task}. ` +
      `Required capabilities not met by any available model.`,
    );
  }

  // Score and sort
  const scored = models
    .map((model) => ({ model, score: scoreModelForTask(model, requirements) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const fallbacks = _config.enableFallback
    ? scored.slice(1).map((s) => s.model)
    : [];

  // Determine routing reason
  let reason: string;
  if (best.score >= 80) {
    reason = `Strong match: ${best.model.modelId} (score: ${best.score.toFixed(0)})`;
  } else if (best.score >= 60) {
    reason = `Good match: ${best.model.modelId} (score: ${best.score.toFixed(0)})`;
  } else {
    reason = `Best available: ${best.model.modelId} (score: ${best.score.toFixed(0)}, no ideal match)`;
  }

  return {
    model: best.model,
    reason,
    score: best.score,
    fallbacks,
    task,
    mode: "routed",
  };
}

// ---------------------------------------------------------------------------
// Task result reporting
// ---------------------------------------------------------------------------

/**
 * Report a successful task execution (updates model health).
 */
export function reportTaskSuccess(
  _task: AtlasAITask,
  modelId: string,
): void {
  recordModelSuccess(modelId);
}

/**
 * Report a failed task execution (updates model health).
 */
export function reportTaskFailure(
  _task: AtlasAITask,
  modelId: string,
  _error: Error,
): void {
  recordModelFailure(modelId);
}

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

/**
 * Get routing status for observability dashboard.
 */
export function getRoutingStatus(): {
  mode: RoutingMode;
  config: RoutingConfig;
  modelRegistry: ReturnType<typeof getModelRegistryStatus>;
  taskCount: number;
} {
  return {
    mode: _config.mode,
    config: { ..._config },
    modelRegistry: getModelRegistryStatus(),
    taskCount: 11, // Number of tasks in registry
  };
}
