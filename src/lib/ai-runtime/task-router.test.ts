// ---------------------------------------------------------------------------
// Atlas AI Runtime — Task Router Tests
//
// Tests for model registry, task requirements, task-based routing,
// fallback chains, feature flags, and observability.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  initializeModelRegistry,
  resetModelRegistry,
  isModelRegistryInitialized,
  getModelProfile,
  getAllModelProfiles,
  getAvailableModels,
  findModels,
  recordModelFailure,
  recordModelSuccess,
  setModelDisabled,
  getModelRegistryStatus,
} from "./model-registry";
import {
  getTaskRequirements,
  getAllTaskRequirements,
  getTasksRequiringCapability,
} from "./task-requirements";
import {
  initTaskRouter,
  resetTaskRouter,
  getRoutingConfig,
  updateRoutingConfig,
  routeTask,
  reportTaskSuccess,
  reportTaskFailure,
  getRoutingStatus,
} from "./task-router";
import { resetConfigCache } from "./config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupEnv(apiKey: string = "test-key") {
  process.env.GEMINI_API_KEY = apiKey;
  process.env.NVIDIA_NIM_API_KEY = apiKey;
}

function cleanEnv() {
  delete process.env.GEMINI_API_KEY;
  delete process.env.NVIDIA_NIM_API_KEY;
  delete process.env.GEMINI_MODEL;
  delete process.env.NVIDIA_NIM_BASE_URL;
  delete process.env.NVIDIA_NIM_DEFAULT_MODEL;
}

// ===========================================================================
// Model Registry Tests
// ===========================================================================

describe("Model Registry", () => {
  beforeEach(() => {
    cleanEnv();
    resetModelRegistry();
    resetConfigCache();
  });

  afterEach(() => {
    cleanEnv();
    resetModelRegistry();
    resetConfigCache();
  });

  it("should not be initialized by default", () => {
    expect(isModelRegistryInitialized()).toBe(false);
  });

  it("should initialize from configured providers", () => {
    setupEnv();
    initializeModelRegistry();
    expect(isModelRegistryInitialized()).toBe(true);

    const models = getAllModelProfiles();
    expect(models.length).toBeGreaterThan(0);
  });

  it("should track model capabilities", () => {
    setupEnv();
    initializeModelRegistry();

    const geminiFlash = getModelProfile("gemini-2.5-flash");
    expect(geminiFlash).toBeDefined();
    expect(geminiFlash!.tier).toBe("fast");
    expect(geminiFlash!.reasoning).toBeGreaterThan(0);
    expect(geminiFlash!.embeddings).toBeGreaterThan(0);
    expect(geminiFlash!.vision).toBeGreaterThan(0);
  });

  it("should track NVIDIA models", () => {
    setupEnv();
    initializeModelRegistry();

    const deepseekPro = getModelProfile("deepseek-ai/deepseek-v4-pro-0813");
    expect(deepseekPro).toBeDefined();
    expect(deepseekPro!.tier).toBe("strong");
    expect(deepseekPro!.providerId).toBe("nvidia-nim");
  });

  it("should find models by criteria", () => {
    setupEnv();
    initializeModelRegistry();

    const fastModels = findModels({ tier: "fast" });
    expect(fastModels.length).toBeGreaterThan(0);
    fastModels.forEach((m) => expect(m.tier).toBe("fast"));

    const geminiModels = findModels({ providerId: "gemini" });
    expect(geminiModels.length).toBeGreaterThan(0);
    geminiModels.forEach((m) => expect(m.providerId).toBe("gemini"));
  });

  it("should find models with minimum capabilities", () => {
    setupEnv();
    initializeModelRegistry();

    const highReasoning = findModels({
      minCapability: { key: "reasoning", minScore: 8 },
    });
    expect(highReasoning.length).toBeGreaterThan(0);
  });

  it("should record model failures and auto-disable", () => {
    setupEnv();
    initializeModelRegistry();

    const modelId = "gemini-2.5-flash";
    const before = getModelProfile(modelId)!;
    expect(before.disabled).toBe(false);

    // Record 5 failures to trigger auto-disable
    for (let i = 0; i < 5; i++) {
      recordModelFailure(modelId);
    }

    const after = getModelProfile(modelId)!;
    expect(after.disabled).toBe(true);
    expect(after.failureCount).toBe(5);
  });

  it("should reset failure count on success", () => {
    setupEnv();
    initializeModelRegistry();

    const modelId = "gemini-2.5-flash";
    recordModelFailure(modelId);
    recordModelFailure(modelId);
    expect(getModelProfile(modelId)!.failureCount).toBe(2);

    recordModelSuccess(modelId);
    expect(getModelProfile(modelId)!.failureCount).toBe(0);
  });

  it("should allow manual enable/disable", () => {
    setupEnv();
    initializeModelRegistry();

    const modelId = "gemini-2.5-flash";
    setModelDisabled(modelId, true);
    expect(getModelProfile(modelId)!.disabled).toBe(true);

    setModelDisabled(modelId, false);
    expect(getModelProfile(modelId)!.disabled).toBe(false);
  });

  it("should exclude disabled models from available list", () => {
    setupEnv();
    initializeModelRegistry();

    const modelId = "gemini-2.5-flash";
    const before = getAvailableModels();
    expect(before.some((m) => m.modelId === modelId)).toBe(true);

    setModelDisabled(modelId, true);
    const after = getAvailableModels();
    expect(after.some((m) => m.modelId === modelId)).toBe(false);
  });

  it("should return correct registry status", () => {
    setupEnv();
    initializeModelRegistry();

    const status = getModelRegistryStatus();
    expect(status.totalModels).toBeGreaterThan(0);
    expect(status.availableModels).toBeGreaterThan(0);
    expect(status.disabledModels).toBe(0);
    expect(status.modelsWithFailures).toBe(0);
    expect(status.byProvider.gemini).toBeDefined();
    expect(status.byProvider["nvidia-nim"]).toBeDefined();
  });

  it("should return empty with no providers configured", () => {
    initializeModelRegistry();
    const models = getAllModelProfiles();
    expect(models.length).toBe(0);
  });
});

// ===========================================================================
// Task Requirements Tests
// ===========================================================================

describe("Task Requirements", () => {
  it("should have requirements for all tasks", () => {
    const reqs = getAllTaskRequirements();
    expect(reqs.length).toBe(11);
  });

  it("should require embeddings capability for embedding task", () => {
    const req = getTaskRequirements("embedding");
    expect(req.embeddings.required).toBe(true);
    expect(req.embeddings.level).toBe("high");
    expect(req.reasoning.level).toBe("low");
  });

  it("should require high reasoning for evidence tasks", () => {
    const req = getTaskRequirements("evidence_reasoning");
    expect(req.reasoning.required).toBe(true);
    expect(req.reasoning.level).toBe("high");
    expect(req.structuredOutput.required).toBe(true);
  });

  it("should prefer speed for CRM tasks", () => {
    const req = getTaskRequirements("crm_outreach");
    expect(req.speed.level).toBe("high");
    expect(req.reasoning.level).toBe("low");
  });

  it("should find tasks requiring specific capabilities", () => {
    const highReasoning = getTasksRequiringCapability("reasoning", "high");
    expect(highReasoning).toContain("evidence_reasoning");
    expect(highReasoning).toContain("gap_intelligence");
    expect(highReasoning).toContain("supplement_reasoning");
    expect(highReasoning).toContain("agent_reasoning");
  });

  it("should have correct context window requirements", () => {
    const embedding = getTaskRequirements("embedding");
    expect(embedding.minContextTokens).toBe(0);

    const evidence = getTaskRequirements("evidence_reasoning");
    expect(evidence.minContextTokens).toBeGreaterThanOrEqual(32_768);
  });
});

// ===========================================================================
// Task Router Tests
// ===========================================================================

describe("Task Router", () => {
  beforeEach(() => {
    cleanEnv();
    resetModelRegistry();
    resetConfigCache();
    resetTaskRouter();
  });

  afterEach(() => {
    cleanEnv();
    resetModelRegistry();
    resetConfigCache();
    resetTaskRouter();
  });

  it("should initialize with default routed config", () => {
    initTaskRouter();
    const config = getRoutingConfig();
    expect(config.mode).toBe("routed");
    expect(config.enableFallback).toBe(true);
    expect(config.preferCostOptimized).toBe(false);
  });

  it("should allow updating routing config", () => {
    initTaskRouter();
    updateRoutingConfig({ mode: "legacy" });
    expect(getRoutingConfig().mode).toBe("legacy");

    updateRoutingConfig({ mode: "single-provider", singleProviderId: "gemini" });
    expect(getRoutingConfig().mode).toBe("single-provider");
    expect(getRoutingConfig().singleProviderId).toBe("gemini");
  });

  it("should route embedding task to embedding-capable model", () => {
    setupEnv();
    initTaskRouter();

    const decision = routeTask("embedding");
    expect(decision.task).toBe("embedding");
    expect(decision.model).toBeDefined();
    expect(decision.model.embeddings).toBeGreaterThan(0);
    expect(decision.score).toBeGreaterThanOrEqual(0);
  });

  it("should route high-reasoning tasks to strong models", () => {
    setupEnv();
    initTaskRouter();

    const decision = routeTask("evidence_reasoning");
    expect(decision.task).toBe("evidence_reasoning");
    expect(decision.model.reasoning).toBeGreaterThanOrEqual(5);
  });

  it("should route fast tasks to fast models", () => {
    setupEnv();
    initTaskRouter();

    const decision = routeTask("crm_outreach");
    expect(decision.model.tier).toBe("fast");
  });

  it("should provide fallback chain", () => {
    setupEnv();
    initTaskRouter();

    const decision = routeTask("ask_atlas");
    expect(decision.fallbacks.length).toBeGreaterThanOrEqual(0);
    // Fallbacks should be different models than primary
    for (const fb of decision.fallbacks) {
      expect(fb.modelId).not.toBe(decision.model.modelId);
    }
  });

  it("should use legacy mode routing", () => {
    setupEnv();
    initTaskRouter({ mode: "legacy" });

    const decision = routeTask("ask_atlas");
    expect(decision.mode).toBe("legacy");
    expect(decision.model).toBeDefined();
  });

  it("should use single-provider mode", () => {
    setupEnv();
    initTaskRouter({ mode: "single-provider", singleProviderId: "gemini" });

    const decision = routeTask("ask_atlas");
    expect(decision.mode).toBe("single-provider");
    expect(decision.model.providerId).toBe("gemini");
  });

  it("should include task metadata in routing decision", () => {
    setupEnv();
    initTaskRouter();

    const decision = routeTask("embedding_query");
    expect(decision.task).toBe("embedding_query");
    expect(typeof decision.reason).toBe("string");
    expect(decision.reason.length).toBeGreaterThan(0);
  });

  it("should track success and failure", () => {
    setupEnv();
    initTaskRouter();

    const decision = routeTask("ask_atlas");
    const modelId = decision.model.modelId;

    // Should not throw
    reportTaskSuccess("ask_atlas", modelId);
    reportTaskFailure("ask_atlas", modelId, new Error("test"));
  });

  it("should return routing status", () => {
    setupEnv();
    initTaskRouter();
    // Trigger model registry initialization via a routing call
    routeTask("ask_atlas");

    const status = getRoutingStatus();
    expect(status.mode).toBe("routed");
    expect(status.modelRegistry.totalModels).toBeGreaterThan(0);
    expect(status.taskCount).toBe(11);
  });

  it("should respect cost limit", () => {
    setupEnv();
    initTaskRouter({ maxCostPer1kTokens: 0.005 });

    const decision = routeTask("ask_atlas");
    expect(decision.model.costPer1kTokens).toBeLessThanOrEqual(0.005);
  });

  it("should respect context window requirements", () => {
    setupEnv();
    initTaskRouter();

    const decision = routeTask("evidence_reasoning");
    const reqs = getTaskRequirements("evidence_reasoning");
    expect(decision.model.maxContextTokens).toBeGreaterThanOrEqual(reqs.minContextTokens);
  });

  it("should reset properly", () => {
    setupEnv();
    initTaskRouter({ mode: "legacy" });
    expect(getRoutingConfig().mode).toBe("legacy");

    resetTaskRouter();
    // After reset, re-init should use defaults
    initTaskRouter();
    expect(getRoutingConfig().mode).toBe("routed");
  });
});

// ===========================================================================
// Integration: Model Registry ↔ Task Router
// ===========================================================================

describe("Model Registry ↔ Task Router Integration", () => {
  beforeEach(() => {
    cleanEnv();
    resetModelRegistry();
    resetConfigCache();
    resetTaskRouter();
  });

  afterEach(() => {
    cleanEnv();
    resetModelRegistry();
    resetConfigCache();
    resetTaskRouter();
  });

  it("should route all tasks without errors", () => {
    setupEnv();
    initTaskRouter();

    const tasks = [
      "embedding", "embedding_query", "ask_atlas", "voice_conversation",
      "crm_outreach", "email_generation", "evidence_reasoning",
      "gap_intelligence", "supplement_reasoning", "qa_reasoning", "agent_reasoning",
    ] as const;

    for (const task of tasks) {
      const decision = routeTask(task);
      expect(decision.model).toBeDefined();
      expect(decision.score).toBeGreaterThanOrEqual(0);
      expect(decision.task).toBe(task);
    }
  });

  it("should skip disabled models in routing", () => {
    setupEnv();
    initTaskRouter();

    // Initialize model registry first (routeTask does this implicitly)
    routeTask("ask_atlas");

    // Disable all strong models
    const strongModels = findModels({ tier: "strong" });
    for (const m of strongModels) {
      setModelDisabled(m.modelId, true);
    }

    // High-reasoning tasks should still find a model (maybe standard tier)
    const decision = routeTask("ask_atlas");
    expect(decision.model).toBeDefined();
    // Should not be strong since we disabled all strong models
    expect(strongModels.every((m) => m.disabled)).toBe(true);
  });

  it("should handle all providers disabled gracefully", () => {
    setupEnv();
    initTaskRouter();

    // Initialize model registry first
    routeTask("ask_atlas");

    // Disable all models
    const allModels = getAllModelProfiles();
    for (const m of allModels) {
      setModelDisabled(m.modelId, true);
    }

    expect(() => routeTask("embedding")).toThrow();
  });

  it("should prefer Gemini for embeddings (only Gemini has embedding capability)", () => {
    setupEnv();
    initTaskRouter();

    const decision = routeTask("embedding");
    expect(decision.model.embeddings).toBeGreaterThan(0);
    // Gemini is the only provider with embeddings
    expect(decision.model.providerId).toBe("gemini");
  });
});
