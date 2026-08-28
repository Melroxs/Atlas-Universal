// ---------------------------------------------------------------------------
// Atlas AI Runtime — Runtime facade unit tests
//
// Tests the fallback chain, provider resolution, retry behavior, and error
// propagation using mock provider adapters. No real HTTP calls are made.
// ---------------------------------------------------------------------------

import { describe, expect, it, beforeEach } from "vitest";
import {
  generate,
  generateStructured,
  embed,
  resetAtlasAI,
} from "./runtime";
import { registerProvider, resetRegistry } from "./registry";
import { resetUsageRecords, getUsageRecords } from "./usage-tracker";
import type {
  AIProviderAdapter,
  GenerateRequest,
  GenerateResult,
  StructuredOutputRequest,
  StructuredOutputResult,
  StreamRequest,
  EmbedRequest,
  EmbedResult,
  ModelConfig,
} from "./types";

// ---------------------------------------------------------------------------
// Mock providers
// ---------------------------------------------------------------------------

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

/**
 * Creates a mock provider that either succeeds or throws on every call.
 */
function createMockProvider(
  id: string,
  opts: {
    available?: boolean;
    response?: string;
    error?: Error;
    models?: ModelConfig[];
    generateFn?: (req: GenerateRequest) => Promise<GenerateResult>;
    embedFn?: (req: EmbedRequest) => Promise<EmbedResult>;
  } = {},
): AIProviderAdapter {
  const available = opts.available ?? true;
  const models = opts.models ?? [makeModel(`${id}-default`, "fast", id)];

  // Extract generate so generateStructured can reuse it.
  const generateImpl: (req: GenerateRequest) => Promise<GenerateResult> =
    opts.generateFn ??
    (async (req: GenerateRequest): Promise<GenerateResult> => {
      if (opts.error) throw opts.error;
      return {
        text: opts.response ?? "Hello from mock",
        provider: id,
        model: req.model ?? models[0]?.id ?? "unknown",
        usage: { promptTokens: 50, completionTokens: 100, totalTokens: 150 },
        latencyMs: 42,
      };
    });

  return {
    id,
    name: `Mock ${id}`,
    isAvailable: () => available,
    listModels: () => models,
    getModel: (modelId: string) => models.find((m) => m.id === modelId),

    generate: generateImpl,

    generateStructured: async (
      req: StructuredOutputRequest,
    ): Promise<StructuredOutputResult> => {
      const result = await generateImpl(req);
      return { ...result, data: JSON.parse(result.text) };
    },

    stream: async (_req: StreamRequest): Promise<void> => {
      if (opts.error) throw opts.error;
    },

    embed: opts.embedFn
      ? opts.embedFn
      : async (req: EmbedRequest): Promise<EmbedResult> => {
          if (opts.error) throw opts.error;
          return {
            embeddings: req.texts.map(() => [0.1, 0.2, 0.3]),
            dimension: 3,
            provider: id,
            model: models[0]?.id ?? "unknown",
            latencyMs: 10,
          };
        },

    vision: async (_req): Promise<GenerateResult> => {
      if (opts.error) throw opts.error;
      return {
        text: "vision result",
        provider: id,
        model: models[0]?.id ?? "unknown",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        latencyMs: 0,
      };
    },
  } as unknown as AIProviderAdapter;
}

beforeEach(() => {
  resetRegistry();
  resetAtlasAI();
  resetUsageRecords();
});

// ---------------------------------------------------------------------------
// generate — basic success
// ---------------------------------------------------------------------------

describe("generate", () => {
  it("returns the response from the first available provider", async () => {
    const gemini = createMockProvider("gemini", { response: "Hello from Gemini" });
    registerProvider(gemini);

    const result = await generate({ prompt: "Hi" });
    expect(result.text).toBe("Hello from Gemini");
    expect(result.provider).toBe("gemini");
  });

  it("uses the explicit provider when requested and available", async () => {
    const gemini = createMockProvider("gemini", { response: "from gemini" });
    const nvidia = createMockProvider("nvidia-nim", { response: "from nvidia" });
    registerProvider(gemini);
    registerProvider(nvidia);

    const result = await generate({ prompt: "Hi", provider: "nvidia-nim" });
    expect(result.text).toBe("from nvidia");
    expect(result.provider).toBe("nvidia-nim");
  });

  it("throws when no providers are available", async () => {
    await expect(generate({ prompt: "Hi" })).rejects.toMatchObject({
      code: "all_providers_failed",
    });
  });

  it("throws when the requested provider is unavailable", async () => {
    const gemini = createMockProvider("gemini", { available: false });
    registerProvider(gemini);

    await expect(generate({ prompt: "Hi", provider: "gemini" })).rejects.toMatchObject({
      code: "all_providers_failed",
    });
  });
});

// ---------------------------------------------------------------------------
// generate — fallback chain
// ---------------------------------------------------------------------------

describe("generate — fallback", () => {
  it("falls back to the second provider when the first fails (retryable)", async () => {
    const gemini = createMockProvider("gemini", {
      error: Object.assign(new Error("rate limited"), {
        code: "rate_limited",
        retryable: true,
        provider: "gemini",
      }),
    });
    const nvidia = createMockProvider("nvidia-nim", { response: "from nvidia fallback" });

    registerProvider(gemini);
    registerProvider(nvidia);

    // Pass explicit provider so runtime tags fallbackFrom
    const result = await generate({ prompt: "Hi", provider: "gemini" });
    expect(result.text).toBe("from nvidia fallback");
    expect(result.provider).toBe("nvidia-nim");
    expect(result.fallbackFrom).toBe("gemini");
  });

  it("does not fall back on non-retryable errors", async () => {
    const gemini = createMockProvider("gemini", {
      error: Object.assign(new Error("bad key"), {
        code: "authentication",
        retryable: false,
        provider: "gemini",
      }),
    });
    const nvidia = createMockProvider("nvidia-nim", { response: "should not reach" });

    registerProvider(gemini);
    registerProvider(nvidia);

    await expect(generate({ prompt: "Hi" })).rejects.toMatchObject({
      code: "all_providers_failed",
    });
  });

  it("throws all_providers_failed when all providers fail", async () => {
    const gemini = createMockProvider("gemini", {
      error: Object.assign(new Error("500"), {
        code: "provider_error",
        retryable: true,
        provider: "gemini",
      }),
    });
    const nvidia = createMockProvider("nvidia-nim", {
      error: Object.assign(new Error("500"), {
        code: "provider_error",
        retryable: true,
        provider: "nvidia-nim",
      }),
    });

    registerProvider(gemini);
    registerProvider(nvidia);

    await expect(generate({ prompt: "Hi" })).rejects.toMatchObject({
      code: "all_providers_failed",
    });
  });
});

// ---------------------------------------------------------------------------
// generate — model-specific provider resolution
// ---------------------------------------------------------------------------

describe("generate — model resolution", () => {
  it("routes to the provider that hosts the requested model", async () => {
    const gemini = createMockProvider("gemini", {
      response: "gemini model",
      models: [makeModel("gemini-2.5-flash", "fast", "gemini")],
    });
    const nvidia = createMockProvider("nvidia-nim", {
      response: "nvidia model",
      models: [makeModel("deepseek-ai/deepseek-v4-pro-0813", "strong", "nvidia-nim")],
    });

    registerProvider(gemini);
    registerProvider(nvidia);

    const result = await generate({
      prompt: "Hi",
      model: "deepseek-ai/deepseek-v4-pro-0813",
    });
    expect(result.text).toBe("nvidia model");
    expect(result.provider).toBe("nvidia-nim");
  });
});

// ---------------------------------------------------------------------------
// generateStructured
// ---------------------------------------------------------------------------

describe("generateStructured", () => {
  it("parses JSON from the provider response", async () => {
    const provider = createMockProvider("gemini", {
      response: '{"answer":"ok","confidence":0.9}',
    });
    registerProvider(provider);

    const result = await generateStructured<{ answer: string; confidence: number }>({
      prompt: "Analyze this",
      schema: { type: "object" },
    });
    expect(result.data.answer).toBe("ok");
    expect(result.data.confidence).toBe(0.9);
    expect(result.provider).toBe("gemini");
  });

  it("falls back on structured output failure (retryable)", async () => {
    const gemini = createMockProvider("gemini", {
      error: Object.assign(new Error("rate limited"), {
        code: "rate_limited",
        retryable: true,
        provider: "gemini",
      }),
    });
    const nvidia = createMockProvider("nvidia-nim", {
      response: '{"result":"fallback"}',
    });

    registerProvider(gemini);
    registerProvider(nvidia);

    const result = await generateStructured({ prompt: "Analyze", schema: {}, provider: "gemini" });
    expect(result.data).toEqual({ result: "fallback" });
    expect(result.fallbackFrom).toBe("gemini");
  });
});

// ---------------------------------------------------------------------------
// embed
// ---------------------------------------------------------------------------

describe("embed", () => {
  it("returns embeddings from an available provider", async () => {
    const gemini = createMockProvider("gemini", {
      models: [
        {
          ...makeModel("text-embedding-004", "fast", "gemini"),
          capabilities: {
            generate: false,
            structuredOutput: false,
            streaming: false,
            toolCalling: false,
            embeddings: true,
            vision: false,
            multiModal: false,
          },
        },
      ],
    });
    registerProvider(gemini);

    const result = await embed({ texts: ["hello", "world"] });
    expect(result.embeddings).toHaveLength(2);
    expect(result.provider).toBe("gemini");
    expect(result.dimension).toBe(3);
  });

  it("falls back when the primary provider fails", async () => {
    const gemini = createMockProvider("gemini", {
      error: Object.assign(new Error("timeout"), {
        code: "timeout",
        retryable: true,
        provider: "gemini",
      }),
    });
    const nvidia = createMockProvider("nvidia-nim", {
      embedFn: async (req: EmbedRequest): Promise<EmbedResult> => ({
        embeddings: req.texts.map(() => [0.4, 0.5, 0.6]),
        dimension: 3,
        provider: "nvidia-nim",
        model: "nvidia-embed",
        latencyMs: 5,
      }),
    });

    registerProvider(gemini);
    registerProvider(nvidia);

    const result = await embed({ texts: ["test"] });
    expect(result.provider).toBe("nvidia-nim");
    expect(result.embeddings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Usage tracking integration
// ---------------------------------------------------------------------------

describe("usage tracking integration", () => {
  it("records usage after a successful generate call", async () => {
    const provider = createMockProvider("gemini", { response: "ok" });
    registerProvider(provider);

    await generate({ prompt: "Hi" });

    const records = getUsageRecords();
    expect(records).toHaveLength(1);
    expect(records[0].provider).toBe("gemini");
    expect(records[0].operation).toBe("generate");
    expect(records[0].success).toBe(true);
    expect(records[0].totalTokens).toBe(150);
  });

  it("records failed usage when a provider throws", async () => {
    const gemini = createMockProvider("gemini", {
      error: Object.assign(new Error("429"), {
        code: "rate_limited",
        retryable: true,
        provider: "gemini",
      }),
    });
    const nvidia = createMockProvider("nvidia-nim", { response: "ok" });

    registerProvider(gemini);
    registerProvider(nvidia);

    await generate({ prompt: "Hi" });

    const records = getUsageRecords();
    // First record = failed gemini, second = successful nvidia
    expect(records).toHaveLength(2);
    expect(records[0].success).toBe(false);
    expect(records[0].errorCode).toBe("rate_limited");
    expect(records[1].success).toBe(true);
  });
});
