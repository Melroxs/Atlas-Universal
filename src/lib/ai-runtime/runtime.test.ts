// ---------------------------------------------------------------------------
// Atlas AI Runtime — Unit Tests
//
// Tests provider selection, registry, retry/backoff, error classification,
// and the runtime API. Uses mock providers to avoid real API calls.
// ---------------------------------------------------------------------------

import { describe, expect, it, beforeEach } from "vitest";
import {
  initializeRegistry,
  getAvailableProviders,
  getBestProvider,
  findModel,
  findBestModelInTier,
  resetRegistry,
  hasAvailableProvider,
  getProviderConfig,
  loadProviderConfigs,
} from "./registry";
import {
  atlasAI,
  isAIConfigured,
  getActiveProviderName,
} from "./runtime";
import {
  withRetry,
  backoffDelay,
  isRetryable,
  DEFAULT_RETRY_CONFIG,
} from "./retry";
import {
  classifyHttpError,
  classifyNetworkError,
} from "./providers/base";
import type {
  ProviderId,
  ProviderConfig,
  AIGenerateResponse,
  AIGenerateRequest,
} from "./types";

// ---------------------------------------------------------------------------
// Mock provider for testing
// ---------------------------------------------------------------------------

function makeGeminiConfig(enabled = true, apiKey = "test-key"): ProviderConfig {
  return {
    id: "gemini",
    name: "Google Gemini",
    apiKey,
    baseUrl: "https://generativelanguage.googleapis.com",
    defaultModel: "gemini-2.5-flash",
    models: [
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", tier: "fast", costPer1kTokens: 0.0001, maxContextTokens: 8192, maxOutputTokens: 1024 },
    ],
    capabilities: { generate: true, structuredOutput: true, streaming: true, embeddings: false, vision: false, toolCalling: true },
    enabled,
    priority: 1,
  };
}

function makeNvidiaConfig(enabled = true, apiKey = "nv-test-key"): ProviderConfig {
  return {
    id: "nvidia_nim",
    name: "NVIDIA NIM",
    apiKey,
    baseUrl: "https://integrate.api.nvidia.com/v1",
    defaultModel: "deepseek-ai/deepseek-r1",
    models: [
      { id: "deepseek-ai/deepseek-r1", name: "DeepSeek R1", tier: "fast", costPer1kTokens: 0.00025, maxContextTokens: 131072, maxOutputTokens: 32768 },
      { id: "nvidia/llama-3.3-70b-instruct", name: "Llama 3.3 70B", tier: "standard", costPer1kTokens: 0.00088, maxContextTokens: 131072, maxOutputTokens: 32768 },
    ],
    capabilities: { generate: true, structuredOutput: true, streaming: true, embeddings: true, vision: false, toolCalling: false },
    enabled,
    priority: 2,
  };
}

// ---------------------------------------------------------------------------
// Registry tests
// ---------------------------------------------------------------------------

describe("AI Runtime — Registry", () => {
  beforeEach(() => {
    resetRegistry();
  });

  it("initializes with default configs from environment", () => {
    initializeRegistry();
    const providers = getAvailableProviders();
    // Without API keys, no providers are available
    expect(providers).toHaveLength(0);
  });

  it("initializes with explicit configs", () => {
    initializeRegistry([makeGeminiConfig()]);
    const providers = getAvailableProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0].id).toBe("gemini");
  });

  it("respects enabled flag", () => {
    initializeRegistry([makeGeminiConfig(false)]);
    expect(getAvailableProviders()).toHaveLength(0);
  });

  it("finds a model by ID", () => {
    initializeRegistry([makeGeminiConfig()]);
    const found = findModel("gemini-2.5-flash");
    expect(found).toBeDefined();
    expect(found?.model.id).toBe("gemini-2.5-flash");
  });

  it("returns undefined for unknown model", () => {
    initializeRegistry([makeGeminiConfig()]);
    expect(findModel("nonexistent")).toBeUndefined();
  });

  it("finds best model in tier", () => {
    initializeRegistry([makeGeminiConfig(), makeNvidiaConfig()]);

    const fast = findBestModelInTier("fast");
    expect(fast).toBeDefined();
    expect(fast?.model.tier).toBe("fast");

    const strong = findBestModelInTier("strong");
    expect(strong).toBeDefined();
  });

  it("respects cost limit in findBestModelInTier", () => {
    initializeRegistry([makeNvidiaConfig()]);

    // With a very low cost limit, no model should match
    const result = findBestModelInTier("strong", 0.00001);
    expect(result).toBeUndefined();

    // With a reasonable limit, cheap model should match
    const result2 = findBestModelInTier("strong", 0.001);
    expect(result2).toBeDefined();
  });

  it("hasAvailableProvider returns false when no providers configured", () => {
    resetRegistry();
    initializeRegistry();
    expect(hasAvailableProvider()).toBe(false);
  });

  it("hasAvailableProvider returns true when a provider has an API key", () => {
    initializeRegistry([makeGeminiConfig()]);
    expect(hasAvailableProvider()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadProviderConfigs tests
// ---------------------------------------------------------------------------

describe("AI Runtime — loadProviderConfigs", () => {
  it("loads Gemini config from environment", () => {
    const configs = loadProviderConfigs({ GEMINI_API_KEY: "test-key" });
    const gemini = configs.find((c) => c.id === "gemini");
    expect(gemini).toBeDefined();
    expect(gemini!.enabled).toBe(true);
    expect(gemini!.apiKey).toBe("test-key");
  });

  it("loads NVIDIA NIM config from environment", () => {
    const configs = loadProviderConfigs({ NVIDIA_NIM_API_KEY: "nv-test-key" });
    const nvidia = configs.find((c) => c.id === "nvidia_nim");
    expect(nvidia).toBeDefined();
    expect(nvidia!.enabled).toBe(true);
    expect(nvidia!.apiKey).toBe("nv-test-key");
    expect(nvidia!.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
  });

  it("honors NVIDIA_NIM_BASE_URL override", () => {
    const configs = loadProviderConfigs({
      NVIDIA_NIM_API_KEY: "key",
      NVIDIA_NIM_BASE_URL: "https://custom.api/v1",
    });
    const nvidia = configs.find((c) => c.id === "nvidia_nim");
    expect(nvidia!.baseUrl).toBe("https://custom.api/v1");
  });

  it("honors NVIDIA_NIM_DEFAULT_MODEL override", () => {
    const configs = loadProviderConfigs({
      NVIDIA_NIM_API_KEY: "key",
      NVIDIA_NIM_DEFAULT_MODEL: "custom/model",
    });
    const nvidia = configs.find((c) => c.id === "nvidia_nim");
    expect(nvidia!.defaultModel).toBe("custom/model");
  });

  it("forces provider when AI_PROVIDER is set", () => {
    const configs = loadProviderConfigs({
      GEMINI_API_KEY: "g-key",
      NVIDIA_NIM_API_KEY: "n-key",
      AI_PROVIDER: "nvidia_nim",
    });
    const gemini = configs.find((c) => c.id === "gemini");
    const nvidia = configs.find((c) => c.id === "nvidia_nim");
    expect(gemini!.enabled).toBe(false);
    expect(nvidia!.enabled).toBe(true);
  });

  it("disables both providers when neither has a key", () => {
    const configs = loadProviderConfigs({});
    expect(configs.every((c) => !c.enabled)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Retry / backoff tests
// ---------------------------------------------------------------------------

describe("AI Runtime — Retry", () => {
  it("backoffDelay increases exponentially", () => {
    const config = { ...DEFAULT_RETRY_CONFIG, jitterFactor: 0 };
    const d0 = backoffDelay(0, config);
    const d1 = backoffDelay(1, config);
    const d2 = backoffDelay(2, config);
    expect(d1).toBeGreaterThan(d0);
    expect(d2).toBeGreaterThan(d1);
  });

  it("backoffDelay is capped at maxDelayMs", () => {
    const config = { ...DEFAULT_RETRY_CONFIG, maxDelayMs: 100, jitterFactor: 0 };
    const d = backoffDelay(10, config);
    expect(d).toBeLessThanOrEqual(100);
  });

  it("isRetryable returns true for transient errors", () => {
    expect(isRetryable("rate_limited")).toBe(true);
    expect(isRetryable("timeout")).toBe(true);
    expect(isRetryable("network")).toBe(true);
    expect(isRetryable("server")).toBe(true);
    expect(isRetryable("model_unavailable")).toBe(true);
  });

  it("isRetryable returns false for auth/validation errors", () => {
    expect(isRetryable("auth")).toBe(false);
    expect(isRetryable("validation_error")).toBe(false);
    expect(isRetryable("provider_not_configured")).toBe(false);
    expect(isRetryable("no_providers_available")).toBe(false);
  });

  it("withRetry succeeds on first attempt", async () => {
    const result = await withRetry(
      async () => ({
        ok: true as const,
        provider: "gemini" as ProviderId,
        model: "test",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        latencyMs: 10,
      }),
      { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0, jitterFactor: 0 },
    );
    expect(result.ok).toBe(true);
  });

  it("withRetry stops on non-retryable error", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        return {
          ok: false as const,
          provider: "gemini" as ProviderId,
          model: "test",
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          latencyMs: 10,
          error: { code: "auth" as const, message: "bad key", retryable: false },
        };
      },
      { maxRetries: 3, baseDelayMs: 0, maxDelayMs: 0, jitterFactor: 0 },
    );
    expect(result.ok).toBe(false);
    expect(attempts).toBe(1); // Only one attempt — no retries for auth
  });

  it("withRetry retries on transient error", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) {
          return {
            ok: false as const,
            provider: "gemini" as ProviderId,
            model: "test",
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            latencyMs: 10,
            error: { code: "rate_limited" as const, message: "quota", retryable: true, status: 429 },
          };
        }
        return {
          ok: true as const,
          provider: "gemini" as ProviderId,
          model: "test",
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          latencyMs: 10,
        };
      },
      { maxRetries: 3, baseDelayMs: 0, maxDelayMs: 0, jitterFactor: 0 },
    );
    expect(result.ok).toBe(true);
    expect(attempts).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Error classification tests
// ---------------------------------------------------------------------------

describe("AI Runtime — Error Classification", () => {
  it("classifies HTTP status codes correctly", () => {
    expect(classifyHttpError(401)).toBe("auth");
    expect(classifyHttpError(403)).toBe("auth");
    expect(classifyHttpError(429)).toBe("rate_limited");
    expect(classifyHttpError(404)).toBe("model_unavailable");
    expect(classifyHttpError(500)).toBe("server");
    expect(classifyHttpError(502)).toBe("server");
    expect(classifyHttpError(400)).toBe("unknown");
  });

  it("classifies network errors correctly", () => {
    expect(classifyNetworkError(new DOMException("aborted", "AbortError"))).toBe("timeout");
    expect(classifyNetworkError(new TypeError("fetch failed"))).toBe("network");
    expect(classifyNetworkError(new Error("ECONNRESET"))).toBe("network");
    expect(classifyNetworkError(new Error("some other error"))).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// Runtime API tests
// ---------------------------------------------------------------------------

describe("AI Runtime — Runtime API", () => {
  beforeEach(() => {
    resetRegistry();
  });

  it("initializes automatically on first use", () => {
    expect(atlasAI.initialized).toBe(false);
    atlasAI.initialize();
    expect(atlasAI.initialized).toBe(true);
  });

  it("isAIConfigured returns false when no providers available", () => {
    resetRegistry();
    expect(isAIConfigured()).toBe(false);
  });

  it("getActiveProviderName returns null when no providers", () => {
    resetRegistry();
    expect(getActiveProviderName()).toBeNull();
  });

  it("getActiveProviderName returns name when provider available", () => {
    resetRegistry();
    initializeRegistry([makeGeminiConfig()]);
    expect(getActiveProviderName()).toBe("Google Gemini");
  });

  it("healthCheck reports healthy when providers available", () => {
    initializeRegistry([makeGeminiConfig()]);
    const health = atlasAI.healthCheck();
    expect(health.healthy).toBe(true);
    expect(health.providers).toHaveLength(1);
  });

  it("healthCheck reports unhealthy when no providers", () => {
    const health = atlasAI.healthCheck();
    expect(health.healthy).toBe(false);
  });

  it("generate returns error when no providers available", async () => {
    resetRegistry();
    const result = await atlasAI.generate({
      messages: [{ role: "user", content: "test" }],
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("no_providers_available");
  });
});
