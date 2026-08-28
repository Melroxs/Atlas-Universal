// ---------------------------------------------------------------------------
// Atlas AI Runtime — NVIDIA NIM Provider Adapter
//
// NVIDIA NIM exposes an OpenAI-compatible /v1/chat/completions endpoint.
// This adapter communicates directly with NVIDIA's API — no proxy, no
// unnecessary middleware. The implementation uses standard fetch() and
// follows the OpenAI chat completions wire format.
// ---------------------------------------------------------------------------

import type {
  AIProviderAdapter,
  ProviderConfig,
  GenerateRequest,
  GenerateResult,
  StructuredOutputRequest,
  StructuredOutputResult,
  StreamRequest,
  EmbedRequest,
  EmbedResult,
  TokenUsage,
  AIRuntimeError,
  ModelConfig,
  VisionRequest,
} from "../types";
import {
  createAIRuntimeError,
  httpStatusToErrorCode,
  classifyFetchError,
} from "../errors";

// ---------------------------------------------------------------------------
// OpenAI-compatible wire types (minimal)
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string[];
  response_format?: { type: "json_object" };
  stream?: boolean;
}

interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model: string;
}

// ---------------------------------------------------------------------------
// NVIDIA NIM Provider
// ---------------------------------------------------------------------------

export class NvidiaNimProvider implements AIProviderAdapter {
  readonly id = "nvidia-nim" as const;
  readonly name = "NVIDIA NIM";

  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  isAvailable(): boolean {
    return this.config.enabled && this.config.apiKey.length > 0;
  }

  listModels(): ModelConfig[] {
    return this.config.models;
  }

  getModel(modelId: string): ModelConfig | undefined {
    return this.config.models.find((m) => m.id === modelId);
  }

  private resolveModel(model?: string): string {
    return model || this.config.defaultModel;
  }

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
    };
  }

  private get chatEndpoint(): string {
    return `${this.config.baseUrl}/chat/completions`;
  }

  private get embeddingsEndpoint(): string {
    return `${this.config.baseUrl}/embeddings`;
  }

  // -----------------------------------------------------------------------
  // generate
  // -----------------------------------------------------------------------

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const t0 = Date.now();
    const model = this.resolveModel(request.model);
    const timeoutMs = request.timeoutMs ?? 30_000;

    const messages = this.buildMessages(request);

    const body: ChatCompletionRequest = {
      model,
      messages,
      temperature: request.temperature ?? 0.2,
      top_p: request.topP ?? 0.9,
      max_tokens: request.maxTokens ?? 2048,
      ...(request.jsonMode ? { response_format: { type: "json_object" } } : {}),
      ...(request.stopSequences?.length ? { stop: request.stopSequences } : {}),
    };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(this.chatEndpoint, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal: request.signal ?? controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const raw = await res.text().catch(() => "");
        const classified = httpStatusToErrorCode(res.status, this.id);
        throw createAIRuntimeError(classified.code, classified.message, {
          provider: this.id,
          httpStatus: res.status,
          retryable: classified.retryable,
        });
      }

      const payload = (await res.json()) as ChatCompletionResponse;

      const text = payload.choices?.[0]?.message?.content?.trim();
      if (!text) {
        throw createAIRuntimeError("malformed_response", "NVIDIA NIM returned an empty response.", { provider: this.id });
      }

      const usage: TokenUsage = {
        promptTokens: payload.usage?.prompt_tokens ?? 0,
        completionTokens: payload.usage?.completion_tokens ?? 0,
        totalTokens: payload.usage?.total_tokens ?? 0,
      };

      return {
        text,
        provider: this.id,
        model: payload.model || model,
        usage,
        latencyMs: Date.now() - t0,
      };
    } catch (err) {
      if (err && typeof err === "object" && "code" in err) throw err;
      throw classifyFetchError(err, this.id, timeoutMs);
    }
  }

  // -----------------------------------------------------------------------
  // generateStructured
  // -----------------------------------------------------------------------

  async generateStructured<T = Record<string, unknown>>(
    request: StructuredOutputRequest,
  ): Promise<StructuredOutputResult<T>> {
    const result = await this.generate({
      ...request,
      jsonMode: true,
    });

    let data: T;
    try {
      data = JSON.parse(result.text) as T;
    } catch {
      // Try to extract JSON from surrounding text
      const t = result.text.trim();
      const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
      const jsonStr = fence
        ? fence[1].trim()
        : (() => {
            const start = t.indexOf("{");
            const end = t.lastIndexOf("}");
            return start !== -1 && end > start ? t.slice(start, end + 1) : t;
          })();
      try {
        data = JSON.parse(jsonStr) as T;
      } catch {
        throw createAIRuntimeError("malformed_response", "NVIDIA NIM returned invalid JSON.", { provider: this.id });
      }
    }

    return { ...result, data };
  }

  // -----------------------------------------------------------------------
  // stream
  // -----------------------------------------------------------------------

  async stream(request: StreamRequest): Promise<void> {
    const t0 = Date.now();
    const model = this.resolveModel(request.model);
    const timeoutMs = request.timeoutMs ?? 30_000;

    const messages = this.buildMessages(request);

    const body: ChatCompletionRequest = {
      model,
      messages,
      temperature: request.temperature ?? 0.2,
      top_p: request.topP ?? 0.9,
      max_tokens: request.maxTokens ?? 2048,
      stream: true,
    };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(this.chatEndpoint, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal: request.signal ?? controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const classified = httpStatusToErrorCode(res.status, this.id);
        throw createAIRuntimeError(classified.code, classified.message, {
          provider: this.id,
          httpStatus: res.status,
          retryable: classified.retryable,
        });
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw createAIRuntimeError("provider_error", "NVIDIA NIM stream body not readable.", { provider: this.id });
      }

      const decoder = new TextDecoder();
      let accumulatedText = "";
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);
            if (data === "[DONE]") break;

            try {
              const parsed = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const chunk = parsed.choices?.[0]?.delta?.content ?? "";
              if (chunk) {
                accumulatedText += chunk;
                request.onChunk({
                  text: chunk,
                  done: false,
                  accumulatedText,
                });
              }
            } catch {
              // Skip malformed SSE lines
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      request.onChunk({ text: "", done: true, accumulatedText });

      request.onComplete({
        text: accumulatedText,
        provider: this.id,
        model,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        latencyMs: Date.now() - t0,
      });
    } catch (err) {
      if (err && typeof err === "object" && "code" in err) {
        request.onError(err as AIRuntimeError);
        return;
      }
      request.onError(classifyFetchError(err, this.id, timeoutMs));
    }
  }

  // -----------------------------------------------------------------------
  // embed
  // -----------------------------------------------------------------------

  async embed(request: EmbedRequest): Promise<EmbedResult> {
    const model = request.model || "nvidia/nv-embedqa-e5-v5";
    const timeoutMs = request.timeoutMs ?? 15_000;

    // Check if the model supports embeddings
    const modelConfig = this.getModel(model);
    if (modelConfig && !modelConfig.capabilities.embeddings) {
      throw createAIRuntimeError("not_implemented", `Model ${model} does not support embeddings.`, { provider: this.id });
    }

    const t0 = Date.now();

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(this.embeddingsEndpoint, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({
          input: request.texts,
          model,
          input_type: "passage",
          encoding_format: "float",
        }),
        signal: request.signal ?? controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const classified = httpStatusToErrorCode(res.status, this.id);
        throw createAIRuntimeError(classified.code, classified.message, {
          provider: this.id,
          httpStatus: res.status,
          retryable: classified.retryable,
        });
      }

      const data = (await res.json()) as {
        data?: Array<{ embedding: number[]; index: number }>;
        model?: string;
      };

      const embeddings = data?.data
        ?.sort((a, b) => a.index - b.index)
        .map((d) => d.embedding);

      if (!Array.isArray(embeddings) || embeddings.length !== request.texts.length) {
        throw createAIRuntimeError("malformed_response", "NVIDIA NIM returned an unexpected embedding format.", { provider: this.id });
      }

      return {
        embeddings,
        dimension: embeddings[0]?.length ?? 0,
        provider: this.id,
        model: data?.model ?? model,
        latencyMs: Date.now() - t0,
      };
    } catch (err) {
      if (err && typeof err === "object" && "code" in err) throw err;
      throw classifyFetchError(err, this.id, timeoutMs);
    }
  }

  // -----------------------------------------------------------------------
  // vision
  // -----------------------------------------------------------------------

  async vision(request: VisionRequest): Promise<GenerateResult> {
    const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];

    for (const img of request.images) {
      if ("url" in img) {
        content.push({ type: "image_url", image_url: { url: img.url } });
      } else {
        content.push({
          type: "image_url",
          image_url: { url: `data:${img.mimeType};base64,${img.data}` },
        });
      }
    }
    content.push({ type: "text", text: request.prompt });

    const t0 = Date.now();
    const model = this.resolveModel(request.model);
    const timeoutMs = request.timeoutMs ?? 30_000;

    const messages: ChatMessage[] = [];
    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }
    messages.push({ role: "user", content });

    const body: ChatCompletionRequest = {
      model,
      messages,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 2048,
    };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(this.chatEndpoint, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal: request.signal ?? controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const classified = httpStatusToErrorCode(res.status, this.id);
        throw createAIRuntimeError(classified.code, classified.message, {
          provider: this.id,
          httpStatus: res.status,
          retryable: classified.retryable,
        });
      }

      const payload = (await res.json()) as ChatCompletionResponse;
      const text = payload.choices?.[0]?.message?.content?.trim() ?? "";

      return {
        text,
        provider: this.id,
        model: payload.model || model,
        usage: {
          promptTokens: payload.usage?.prompt_tokens ?? 0,
          completionTokens: payload.usage?.completion_tokens ?? 0,
          totalTokens: payload.usage?.total_tokens ?? 0,
        },
        latencyMs: Date.now() - t0,
      };
    } catch (err) {
      if (err && typeof err === "object" && "code" in err) throw err;
      throw classifyFetchError(err, this.id, timeoutMs);
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private buildMessages(request: GenerateRequest): ChatMessage[] {
    const messages: ChatMessage[] = [];

    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }

    if (request.history) {
      for (const h of request.history) {
        messages.push({
          role: h.role === "model" ? "assistant" : "user",
          content: h.text,
        });
      }
    }

    messages.push({ role: "user", content: request.prompt });
    return messages;
  }
}
