// ---------------------------------------------------------------------------
// Atlas AI Runtime — NVIDIA NIM Provider Adapter
//
// NVIDIA NIM exposes an OpenAI-compatible REST API, so this adapter uses
// the standard /v1/chat/completions and /v1/embeddings endpoints.
// Base URL defaults to https://integrate.api.nvidia.com/v1
// ---------------------------------------------------------------------------

import type {
  ProviderId,
  AIGenerateRequest,
  AIGenerateResponse,
  AIStructuredRequest,
  AIStreamChunk,
  AIEmbedRequest,
  AIEmbedResponse,
  ProviderConfig,
  ProviderCapabilities,
} from "../types";
import { BaseAIProvider, classifyHttpError, classifyNetworkError } from "./base";

// ---------------------------------------------------------------------------
// OpenAI-compatible request/response types (used by NVIDIA NIM)
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  response_format?: { type: "text" | "json_object" };
}

interface ChatCompletionResponse {
  id?: string;
  choices?: Array<{
    message?: { role?: string; content?: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; code?: string; type?: string };
}

interface EmbeddingRequest {
  model: string;
  input: string | string[];
}

interface EmbeddingResponse {
  data?: Array<{ embedding: number[]; index: number }>;
  usage?: { prompt_tokens?: number; total_tokens?: number };
  error?: { message?: string };
}

// ---------------------------------------------------------------------------
// NVIDIA NIM adapter
// ---------------------------------------------------------------------------

export class NvidiaNimProvider extends BaseAIProvider {
  readonly id: ProviderId = "nvidia_nim";
  readonly name = "NVIDIA NIM";
  readonly capabilities: ProviderCapabilities = {
    generate: true,
    structuredOutput: true,
    streaming: true,
    embeddings: true,
    vision: false,
    toolCalling: false,
  };

  constructor(config: ProviderConfig) {
    super(config);
  }

  protected buildEndpoint(_model: string, action: "generate" | "embed" | "stream"): string {
    if (action === "embed") return `${this.config.baseUrl}/embeddings`;
    return `${this.config.baseUrl}/chat/completions`;
  }

  protected buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
    };
  }

  protected async doGenerate(
    request: AIGenerateRequest,
    model: string,
  ): Promise<AIGenerateResponse> {
    const startTime = Date.now();

    try {
      const body: ChatCompletionRequest = {
        model,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
        max_tokens: request.maxTokens ?? 1024,
        temperature: request.temperature ?? 0.2,
        top_p: request.topP ?? 0.9,
      };

      if (request.responseFormat === "json") {
        body.response_format = { type: "json_object" };
      }

      const endpoint = this.buildEndpoint(model, "generate");
      const response = await this.fetchWithTimeout(
        endpoint,
        {
          method: "POST",
          headers: this.buildHeaders(),
          body: JSON.stringify(body),
        },
        request.timeoutMs ?? 30_000,
        request.signal,
      );

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const code = classifyHttpError(response.status);
        let message = `NVIDIA NIM API error: ${response.status}`;
        try {
          const errBody = await response.json() as ChatCompletionResponse;
          message = errBody.error?.message ?? message;
        } catch {
          // Use default message
        }
        return this.errorResponse(code, message, model, latencyMs, response.status);
      }

      const data = await response.json() as ChatCompletionResponse;
      const text = data.choices?.[0]?.message?.content ?? "";

      if (!text.trim()) {
        return this.errorResponse("malformed", "Empty response from NVIDIA NIM", model, latencyMs);
      }

      const usage = {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      };

      return this.success(text, model, usage, latencyMs);
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const code = classifyNetworkError(err);
      return this.errorResponse(
        code,
        err instanceof Error ? err.message : "Unknown error",
        model,
        latencyMs,
      );
    }
  }

  protected async *doStream(
    request: AIGenerateRequest,
    model: string,
  ): AsyncIterable<AIStreamChunk> {
    const body: ChatCompletionRequest = {
      model,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: request.maxTokens ?? 1024,
      temperature: request.temperature ?? 0.2,
      top_p: request.topP ?? 0.9,
      stream: true,
    };

    const endpoint = this.buildEndpoint(model, "stream");
    const response = await this.fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
      },
      request.timeoutMs ?? 60_000,
      request.signal,
    );

    if (!response.ok) {
      yield { delta: "", done: true };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { delta: "", done: true };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;

          try {
            const data = JSON.parse(jsonStr) as ChatCompletionResponse;
            const text = data.choices?.[0]?.message?.content ?? "";
            if (text) {
              yield { delta: text, done: false };
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { delta: "", done: true, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
  }

  protected async doEmbed(
    request: AIEmbedRequest,
    model: string,
  ): Promise<AIEmbedResponse> {
    const startTime = Date.now();

    try {
      const body: EmbeddingRequest = {
        model,
        input: request.input,
      };

      const endpoint = this.buildEndpoint(model, "embed");
      const response = await this.fetchWithTimeout(
        endpoint,
        {
          method: "POST",
          headers: this.buildHeaders(),
          body: JSON.stringify(body),
        },
        request.timeoutMs ?? 15_000,
        request.signal,
      );

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const code = classifyHttpError(response.status);
        let message = `NVIDIA NIM embedding error: ${response.status}`;
        try {
          const errBody = await response.json() as EmbeddingResponse;
          message = errBody.error?.message ?? message;
        } catch {
          // Use default
        }
        return {
          ok: false,
          provider: this.id,
          model,
          latencyMs,
          error: { code, message, retryable: code !== "auth", status: response.status },
        };
      }

      const data = await response.json() as EmbeddingResponse;
      const embeddings = (data.data ?? [])
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding);

      if (embeddings.length === 0) {
        return {
          ok: false,
          provider: this.id,
          model,
          latencyMs,
          error: { code: "malformed", message: "No embeddings returned", retryable: false },
        };
      }

      return {
        ok: true,
        embeddings,
        provider: this.id,
        model,
        dimensions: embeddings[0]?.length,
        latencyMs,
      };
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const code = classifyNetworkError(err);
      return {
        ok: false,
        provider: this.id,
        model,
        latencyMs,
        error: {
          code,
          message: err instanceof Error ? err.message : "Unknown error",
          retryable: code !== "auth",
        },
      };
    }
  }
}
