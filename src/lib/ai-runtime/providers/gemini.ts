// ---------------------------------------------------------------------------
// Atlas AI Runtime — Gemini Provider Adapter
//
// Wraps the existing Gemini REST API implementation from the conversation-converse
// Edge Function into the Atlas AI Runtime provider interface. This preserves
// the existing behavior while making it accessible through the unified runtime.
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
// Gemini-specific types
// ---------------------------------------------------------------------------

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiRequestBody {
  contents: GeminiContent[];
  systemInstruction?: { parts: GeminiPart[] };
  generationConfig?: {
    responseMimeType?: string;
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
  };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: { code?: number; message?: string };
}

// ---------------------------------------------------------------------------
// Gemini adapter
// ---------------------------------------------------------------------------

export class GeminiProvider extends BaseAIProvider {
  readonly id: ProviderId = "gemini";
  readonly name = "Google Gemini";
  readonly capabilities: ProviderCapabilities = {
    generate: true,
    structuredOutput: true,
    streaming: true,
    embeddings: false,
    vision: true,
    toolCalling: true,
  };

  constructor(config: ProviderConfig) {
    super(config);
  }

  protected buildEndpoint(_model: string, _action: "generate" | "embed" | "stream"): string {
    const model = _action === "embed" ? _model : this.config.defaultModel;
    return `${this.config.baseUrl}/v1beta/models/${model}:generateContent`;
  }

  protected buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-goog-api-key": this.config.apiKey,
    };
  }

  protected async doGenerate(
    request: AIGenerateRequest,
    model: string,
  ): Promise<AIGenerateResponse> {
    const startTime = Date.now();

    try {
      const body = this.buildRequestBody(request);
      const endpoint = `${this.config.baseUrl}/v1beta/models/${model}:generateContent`;

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
        let message = `Gemini API error: ${response.status}`;
        try {
          const errBody = await response.json() as GeminiResponse;
          message = errBody.error?.message ?? message;
        } catch {
          // Use default message
        }
        return this.errorResponse(code, message, model, latencyMs, response.status);
      }

      const data = await response.json() as GeminiResponse;
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

      if (!text.trim()) {
        return this.errorResponse("malformed", "Empty response from Gemini", model, latencyMs);
      }

      const usage = {
        promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: data.usageMetadata?.totalTokenCount ?? 0,
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
    const body = this.buildRequestBody(request);
    const endpoint = `${this.config.baseUrl}/v1beta/models/${model}:streamGenerateContent?alt=sse`;

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
            const data = JSON.parse(jsonStr) as GeminiResponse;
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
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

    yield {
      delta: "",
      done: true,
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
    };
  }

  protected async doEmbed(
    _request: AIEmbedRequest,
    _model: string,
  ): Promise<AIEmbedResponse> {
    // Gemini doesn't use the same embedding endpoint through this interface.
    // Embeddings are handled locally via src/lib/ingest/localEmbed.ts.
    return {
      ok: false,
      provider: this.id,
      model: _model,
      latencyMs: 0,
      error: {
        code: "provider_not_configured",
        message: "Gemini embeddings are handled via localEmbed — use the dedicated embedding path",
        retryable: false,
      },
    };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private buildRequestBody(request: AIGenerateRequest): GeminiRequestBody {
    const contents: GeminiContent[] = [];

    for (const msg of request.messages) {
      if (msg.role === "system") continue; // Handled separately
      contents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      });
    }

    const systemMsg = request.messages.find((m) => m.role === "system");

    const body: GeminiRequestBody = { contents };
    if (systemMsg) {
      body.systemInstruction = { parts: [{ text: systemMsg.content }] };
    }

    body.generationConfig = {
      temperature: request.temperature ?? 0.2,
      topP: request.topP ?? 0.9,
      maxOutputTokens: request.maxTokens ?? 600,
    };

    if (request.responseFormat === "json") {
      body.generationConfig.responseMimeType = "application/json";
    }

    return body;
  }
}
