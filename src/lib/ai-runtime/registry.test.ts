// ---------------------------------------------------------------------------
// Atlas AI Runtime — Provider Registry unit tests
// ---------------------------------------------------------------------------

import { describe, expect, it, beforeEach } from "vitest";
import {
  registerProvider,
  getProvider,
  getAllProviders,
  getAvailableProviders,
  isProviderAvailable,
  findProviderForModel,
  findProvidersForTier,
  resetRegistry,
} from "./registry";
import type { AIProviderAdapter, ModelConfig, GenerateRequest, GenerateResult, StructuredOutputRequest, StructuredOutputResult, StreamRequest, EmbedRequest, EmbedResult, VisionRequest } from "./types";

// ---------------------------------------------------------------------------
// Mock provider adapter
// ---------------------------------------------------------------------------

class MockProvider implements AIProviderAdapter {
  readonly id: string;
  readonly name: string;
  private _available: boolean;
  private models: ModelConfig[];

  constructor(
    id: string,
    name: string,
    available: boolean,
    models: ModelConfig[],
  ) {
    this.id = id;
    this.name = name;
    this._available = available;
    this.models = models;
  }

  isAvailable(): boolean {
    return this._available;
  }

  listModels(): ModelConfig[] {
    return this.models;
  }

  getModel(modelId: string): ModelConfig | undefined {
    return this.models.find((m) => m.id === modelId);
  }

  async generate(_request: GenerateRequest): Promise<GenerateResult> {
    return {
      text: "mock",
      provider: this.id,
      model: this.models[0]?.id ?? "mock-model",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      latencyMs: 0,
    };
  }

  async generateStructured<T = Record<string, unknown>>(
    request: StructuredOutputRequest,
  ): Promise<StructuredOutputResult<T>> {
    const result = await this.generate(request);
    return { ...result, data: {} as T };
  }

  async stream(_request: StreamRequest): Promise<void> {
    // no-op
  }

  async embed(_request: EmbedRequest): Promise<EmbedResult> {
    return {
      embeddings: [],
      dimension: 0,
      provider: this.id,
      model: "mock-embed",
      latencyMs: 0,
    };
  }

  async vision(_request: VisionRequest): Promise<GenerateResult> {
    return this.generate({ prompt: "" });
  }
}

function makeModel(
  id: string,
  tier: "fast" | "standard" | "strong" = "fast",
  providerId = "mock",
): ModelConfig {
  return {
    id,
    name: id,
    providerId,
    tier,
    costPer1kTokens: 0.001,
    maxContextTokens: 128_000,
    maxOutputTokens: 4096,
    capabilities: {
      generate: true,
      structuredOutput: true,
      streaming: true,
      toolCalling: false,
      embeddings: false,
      vision: false,
      multiModal: false,
    },
  };
}

beforeEach(() => {
  resetRegistry();
});

// ---------------------------------------------------------------------------
// Registration & lookup
// ---------------------------------------------------------------------------

describe("registerProvider + getProvider", () => {
  it("registers and retrieves a provider", () => {
    const provider = new MockProvider("gemini", "Google Gemini", true, []);
    registerProvider(provider);

    const retrieved = getProvider("gemini");
    expect(retrieved).toBe(provider);
    expect(retrieved?.id).toBe("gemini");
  });

  it("returns undefined for unregistered provider", () => {
    expect(getProvider("nonexistent")).toBeUndefined();
  });

  it("overwrites a provider with the same id", () => {
    const v1 = new MockProvider("gemini", "Gemini v1", true, []);
    const v2 = new MockProvider("gemini", "Gemini v2", true, []);
    registerProvider(v1);
    registerProvider(v2);

    expect(getProvider("gemini")).toBe(v2);
  });
});

// ---------------------------------------------------------------------------
// getAllProviders
// ---------------------------------------------------------------------------

describe("getAllProviders", () => {
  it("returns all registered providers", () => {
    registerProvider(new MockProvider("a", "A", true, []));
    registerProvider(new MockProvider("b", "B", false, []));

    const all = getAllProviders();
    expect(all).toHaveLength(2);
    expect(all.map((p) => p.id)).toContain("a");
    expect(all.map((p) => p.id)).toContain("b");
  });

  it("returns empty array when nothing registered", () => {
    expect(getAllProviders()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getAvailableProviders
// ---------------------------------------------------------------------------

describe("getAvailableProviders", () => {
  it("returns only available providers", () => {
    registerProvider(new MockProvider("a", "A", true, []));
    registerProvider(new MockProvider("b", "B", false, []));

    const available = getAvailableProviders();
    expect(available).toHaveLength(1);
    expect(available[0].id).toBe("a");
  });
});

// ---------------------------------------------------------------------------
// isProviderAvailable
// ---------------------------------------------------------------------------

describe("isProviderAvailable", () => {
  it("returns true for available provider", () => {
    registerProvider(new MockProvider("a", "A", true, []));
    expect(isProviderAvailable("a")).toBe(true);
  });

  it("returns false for unavailable provider", () => {
    registerProvider(new MockProvider("a", "A", false, []));
    expect(isProviderAvailable("a")).toBe(false);
  });

  it("returns false for unregistered provider", () => {
    expect(isProviderAvailable("unknown")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findProviderForModel
// ---------------------------------------------------------------------------

describe("findProviderForModel", () => {
  it("finds the provider that hosts a model", () => {
    const model = makeModel("gemini-2.5-flash");
    registerProvider(new MockProvider("gemini", "Gemini", true, [model]));
    registerProvider(new MockProvider("nvidia", "NVIDIA", true, []));

    const found = findProviderForModel("gemini-2.5-flash");
    expect(found?.id).toBe("gemini");
  });

  it("returns undefined when no provider has the model", () => {
    registerProvider(new MockProvider("gemini", "Gemini", true, []));
    expect(findProviderForModel("nonexistent-model")).toBeUndefined();
  });

  it("skips unavailable providers", () => {
    const model = makeModel("gemini-2.5-flash");
    registerProvider(new MockProvider("gemini", "Gemini", false, [model]));
    expect(findProviderForModel("gemini-2.5-flash")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// findProvidersForTier
// ---------------------------------------------------------------------------

describe("findProvidersForTier", () => {
  it("returns all available providers when no tier filter", () => {
    registerProvider(new MockProvider("a", "A", true, []));
    registerProvider(new MockProvider("b", "B", true, []));

    const result = findProvidersForTier();
    expect(result).toHaveLength(2);
  });

  it("puts preferred provider first", () => {
    registerProvider(new MockProvider("a", "A", true, []));
    registerProvider(new MockProvider("b", "B", true, []));

    const result = findProvidersForTier(undefined, "b");
    expect(result[0].id).toBe("b");
    expect(result[1].id).toBe("a");
  });

  it("falls back to normal order if preferred is unavailable", () => {
    registerProvider(new MockProvider("a", "A", true, []));
    registerProvider(new MockProvider("b", "B", false, []));

    const result = findProvidersForTier(undefined, "b");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
  });
});

// ---------------------------------------------------------------------------
// resetRegistry
// ---------------------------------------------------------------------------

describe("resetRegistry", () => {
  it("clears all registered providers", () => {
    registerProvider(new MockProvider("a", "A", true, []));
    registerProvider(new MockProvider("b", "B", true, []));

    resetRegistry();

    expect(getAllProviders()).toHaveLength(0);
    expect(getProvider("a")).toBeUndefined();
  });
});
