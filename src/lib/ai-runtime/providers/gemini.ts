// ---------------------------------------------------------------------------
// Atlas AI Runtime — Gemini Provider Adapter
//
// Wraps the existing Gemini REST API implementation used by Atlas.
// This adapter delegates to the same REST endpoints and request formats
// already deployed in the conversation-converse Edge Function.
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
// Gemini Provider
// ---------------------------------------------------------------------------

export class GeminiProvider implements AIProviderAdapter {
  readonly id = "gemini" as const;
  readonly name = "Google Gemini";

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
      "x-goog-api-key": this.config.apiKey,
    };
  }

  private buildUrl(model: string, action: string = "generateContent"): string {
    return `${this.config.baseUrl}/v1beta/models/${encodeURIComponent(model)}:${action}`;
  }

  // -----------------------------------------------------------------------
  // generate
  // -----------------------------------------------------------------------

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const t0 = Date.now();
    const model = this.resolveModel(request.model);
    const timeoutMs = request.timeoutMs ?? 30_000;

    const contents = this.buildContents(request);
    const body = {
      contents,
      systemInstruction: request.systemPrompt
        ? { parts: [{ text: request.systemPrompt }] }
        : undefined,
      generationConfig: {
        temperature: request.temperature ?? 0.2,
        topP: request.topP ?? 0.9,
        maxOutputTokens: request.maxTokens ?? 2048,
        ...(request.jsonMode ? { responseMimeType: "application/json" } : {}),
        ...(request.stopSequences?.length
          ? { stopSequences: request.stopSequences }
          : {}),
      },
    };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(this.buildUrl(model), {
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

      const payload = await res.json() as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
        }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
      };

      const text = payload.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("")
        .trim();

      if (!text) {
        throw createAIRuntimeError("malformed_response", "Gemini returned an empty response (possible safety block).", { provider: this.id });
      }

      const usage: TokenUsage = {
        promptTokens: payload.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: payload.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: payload.usageMetadata?.totalTokenCount ?? 0,
      };

      return {
        text,
        provider: this.id,
        model,
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
      data = extractJsonObject(result.text) as T;
    } catch {
      throw createAIRuntimeError("malformed_response", "Gemini returned invalid JSON.", { provider: this.id });
    }

    return {
      ...result,
      data,
    };
  }

  // -----------------------------------------------------------------------
  // stream
  // -----------------------------------------------------------------------

  async stream(request: StreamRequest): Promise<void> {
    const t0 = Date.now();
    const model = this.resolveModel(request.model);
    const timeoutMs = request.timeoutMs ?? 30_000;

    const contents = this.buildContents(request);
    const body = {
      contents,
      systemInstruction: request.systemPrompt
        ? { parts: [{ text: request.systemPrompt }] }
        : undefined,
      generationConfig: {
        temperature: request.temperature ?? 0.2,
        topP: request.topP ?? 0.9,
        maxOutputTokens: request.maxTokens ?? 2048,
      },
    };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(this.buildUrl(model), {
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

      const payload = await res.json() as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
        }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
      };

      const text = payload.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("")
        .trim() ?? "";

      // Note: True SSE streaming requires a different endpoint.
      // For Phase 1, we simulate streaming by emitting the full response as one chunk.
      request.onChunk({ text, done: true, accumulatedText: text });

      const usage: TokenUsage = {
        promptTokens: payload.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: payload.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: payload.usageMetadata?.totalTokenCount ?? 0,
      };

      request.onComplete({
        text,
        provider: this.id,
        model,
        usage,
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
    const t0 = Date.now();
    const model = request.model || "text-embedding-004";
    const timeoutMs = request.timeoutMs ?? 15_000;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(
        `${this.config.baseUrl}/v1beta/models/${encodeURIComponent(model)}:embedContent?key=${this.config.apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: `models/${model}`,
            content: { parts: request.texts.map((t) => ({ text: t })) },
            taskType: "RETRIEVAL_DOCUMENT",
          }),
          signal: request.signal ?? controller.signal,
        },
      );

      clearTimeout(timer);

      if (!res.ok) {
        const classified = httpStatusToErrorCode(res.status, this.id);
        throw createAIRuntimeError(classified.code, classified.message, {
          provider: this.id,
          httpStatus: res.status,
          retryable: classified.retryable,
        });
      }

      const data = await res.json() as {
        embeddings?: Array<{ values: number[] }>;
      };

      const embeddings = data?.embeddings?.map((e) => e.values);
      if (!Array.isArray(embeddings) || embeddings.length !== request.texts.length) {
        throw createAIRuntimeError("malformed_response", "Gemini returned an unexpected embedding format.", { provider: this.id });
      }

      return {
        embeddings,
        dimension: embeddings[0]?.length ?? 0,
        provider: this.id,
        model,
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
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

    for (const img of request.images) {
      if ("url" in img) {
        // For URLs, include as a text part (Gemini supports this)
        parts.push({ text: `[Image: ${img.url}]` });
      } else {
        parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
      }
    }
    parts.push({ text: request.prompt });

    return this.generate({
      prompt: request.prompt,
      systemPrompt: request.systemPrompt,
      model: request.model,
      maxTokens: request.maxTokens,
      temperature: request.temperature,
      jsonMode: request.jsonMode,
      signal: request.signal,
      timeoutMs: request.timeoutMs,
    });
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private buildContents(request: GenerateRequest): Array<{
    role: "user" | "model";
    parts: Array<{ text: string }>;
  }> {
    const contents: Array<{
      role: "user" | "model";
      parts: Array<{ text: string }>;
    }> = [];

    if (request.history) {
      for (const h of request.history) {
        contents.push({ role: h.role, parts: [{ text: h.text }] });
      }
    }

    contents.push({ role: "user", parts: [{ text: request.prompt }] });
    return contents;
  }
}

// ---------------------------------------------------------------------------
// JSON extraction helper (ported from existing gemini.ts)
// ---------------------------------------------------------------------------

function extractJsonObject(text: string): unknown {
  let t = (text ?? "").trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) t = fence[1].trim();
  if (!t.startsWith("{")) {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start !== -1 && end > start) t = t.slice(start, end + 1);
  }
  return JSON.parse(t);
}
