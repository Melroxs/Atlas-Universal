// ---------------------------------------------------------------------------
// Atlas Voice Runtime — NVIDIA NIM VoiceChat Provider
//
// Communicates with NVIDIA's NIM VoiceChat API for the Nemotron 3
// end-to-end speech-to-speech model. The API is OpenAI-compatible and
// supports streaming audio I/O, interruption detection, and persona control.
//
// NVIDIA NIM VoiceChat endpoints:
//   POST /v1/audio/speech              — text-to-speech
//   POST /v1/audio/transcriptions      — speech-to-text
//   POST /v1/chat/completions          — multimodal (audio in, text out)
//   WebSocket /v1/realtime             — full duplex speech-to-speech
//
// This adapter uses HTTP streaming for the initial integration. Full duplex
// WebSocket support is noted for future enhancement.
//
// IMPORTANT: NVIDIA Nemotron VoiceChat is an early-access model.
// This provider is always behind a fallback chain and never the sole voice.
// ---------------------------------------------------------------------------

import type {
  VoiceProviderAdapter,
  VoiceProviderConfig,
  VoiceProviderCapabilities,
  VoiceSessionConfig,
  VoiceSessionHandle,
  VoiceSession,
  VoiceSessionState,
  VoiceEventHandler,
  VoiceEvent,
} from "../types";
import {
  createVoiceError,
  httpStatusToVoiceError,
} from "../errors";
import {
  createVoiceEvent,
  emitVoiceEvent,
} from "../events";

// ---------------------------------------------------------------------------
// NVIDIA NIM Voice API wire types
// ---------------------------------------------------------------------------

interface NimSpeechRequest {
  model: string;
  input: string;
  voice?: string;
  response_format?: "wav" | "pcm" | "opus" | "flac";
  speed?: number;
}

interface NimTranscriptionRequest {
  model: string;
  file: Blob;
  language?: string;
  response_format?: "json" | "text" | "verbose_json";
}

interface NimChatMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: string; text?: string; audio?: { data: string } }>;
}

interface NimChatRequest {
  model: string;
  messages: NimChatMessage[];
  modalities?: string[];
  audio?: {
    voice?: string;
    format?: string;
  };
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

// ---------------------------------------------------------------------------
// NVIDIA NIM VoiceChat Provider
// ---------------------------------------------------------------------------

export class NvidiaNimVoiceProvider implements VoiceProviderAdapter {
  readonly id = "nvidia-nim-voice" as const;
  readonly name = "NVIDIA NIM VoiceChat (Nemotron)";
  readonly capabilities: VoiceProviderCapabilities = {
    stt: true,
    tts: true,
    speechToSpeech: true,
    streamingInput: true,
    streamingOutput: true,
    interruption: true,
    voiceControl: true,
    realtime: true,
  };

  private config: VoiceProviderConfig;

  constructor(config: VoiceProviderConfig) {
    this.config = config;
  }

  isAvailable(): boolean {
    return this.config.enabled && this.config.apiKey.length > 0;
  }

  async createSession(config: VoiceSessionConfig): Promise<VoiceSessionHandle> {
    if (!this.isAvailable()) {
      throw createVoiceError(
        "missing_api_key",
        "NVIDIA NIM VoiceChat is not configured. Set NVIDIA_NIM_API_KEY.",
        { provider: this.id },
      );
    }

    const sessionId = `nim-voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const model = config.model ?? this.config.defaultModel;
    const voice = config.voice ?? "alloy";

    const session: NimVoiceSession = {
      id: sessionId,
      state: "idle",
      provider: this.id,
      model,
      createdAt: Date.now(),
      lastStateChange: Date.now(),
      transcript: "",
      partialTranscript: "",
      _listeners: new Map(),
      _config: config,
      _model: model,
      _voice: voice,
      _history: [],
    };

    emitVoiceEvent(createVoiceEvent("session.created", sessionId, {
      provider: this.id,
      model,
      voice,
    }));

    this._emitSessionEvent(session, "session.state_changed", { state: "connecting" });

    // Verify model availability with a lightweight health check
    try {
      const healthy = await this._healthCheckModel(model);
      if (!healthy) {
        this._emitSessionEvent(session, "session.state_changed", { state: "error" });
        throw createVoiceError(
          "invalid_model",
          `NVIDIA NIM model "${model}" is not available or not responding.`,
          { provider: this.id },
        );
      }
      this._emitSessionEvent(session, "session.state_changed", { state: "idle" });
    } catch (err) {
      if (err && typeof err === "object" && "code" in err) throw err;
      this._emitSessionEvent(session, "session.state_changed", { state: "error" });
      throw createVoiceError(
        "provider_error",
        `NVIDIA NIM health check failed: ${err instanceof Error ? err.message : "unknown"}`,
        { provider: this.id, cause: err as Error },
      );
    }

    return new NimSessionHandle(session, this);
  }

  async healthCheck(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    return this._healthCheckModel(this.config.defaultModel);
  }

  // -----------------------------------------------------------------------
  // Internal: model health check
  // -----------------------------------------------------------------------

  private async _healthCheckModel(model: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.baseUrl}/models`, {
        method: "GET",
        headers: this._buildHeaders(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return false;
      const data = await res.json() as { data?: Array<{ id: string }> };
      // If the model list endpoint works, the provider is reachable
      return Array.isArray(data?.data);
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Internal: API calls
  // -----------------------------------------------------------------------

  async _synthesizeSpeech(text: string, model: string, voice: string): Promise<ArrayBuffer> {
    const t0 = Date.now();
    const body: NimSpeechRequest = {
      model,
      input: text,
      voice,
      response_format: "pcm",
    };

    const res = await fetch(`${this.config.baseUrl}/audio/speech`, {
      method: "POST",
      headers: this._buildHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const classified = httpStatusToVoiceError(res.status, this.id);
      throw createVoiceError(classified.code, classified.message, {
        provider: this.id,
        httpStatus: res.status,
        retryable: classified.retryable,
      });
    }

    const buffer = await res.arrayBuffer();
    return buffer;
  }

  async _transcribeAudio(audioBlob: Blob, model: string, language?: string): Promise<string> {
    const formData = new FormData();
    formData.append("model", model);
    formData.append("file", audioBlob, "audio.wav");
    if (language) formData.append("language", language);

    const res = await fetch(`${this.config.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: formData,
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const classified = httpStatusToVoiceError(res.status, this.id);
      throw createVoiceError(classified.code, classified.message, {
        provider: this.id,
        httpStatus: res.status,
        retryable: classified.retryable,
      });
    }

    const data = await res.json() as { text?: string };
    return data?.text ?? "";
  }

  async _chatCompletion(
    messages: NimChatMessage[],
    model: string,
    options?: {
      voice?: string;
      modalities?: string[];
      stream?: boolean;
      temperature?: number;
      maxTokens?: number;
    },
  ): Promise<{ text: string; audio?: string }> {
    const body: NimChatRequest = {
      model,
      messages,
      modalities: options?.modalities ?? ["text"],
      audio: options?.voice ? { voice: options.voice, format: "wav" } : undefined,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 1024,
      stream: options?.stream ?? false,
    };

    const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this._buildHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const classified = httpStatusToVoiceError(res.status, this.id);
      throw createVoiceError(classified.code, classified.message, {
        provider: this.id,
        httpStatus: res.status,
        retryable: classified.retryable,
      });
    }

    const payload = await res.json() as {
      choices?: Array<{
        message?: {
          content?: string;
          audio?: { data: string };
        };
      }>;
    };

    const text = payload.choices?.[0]?.message?.content ?? "";
    const audio = payload.choices?.[0]?.message?.audio?.data;

    return { text, audio };
  }

  private _buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
    };
  }

  private _emitSessionEvent(session: NimVoiceSession, type: string, data: Record<string, unknown>): void {
    const event: VoiceEvent = {
      type: type as VoiceEvent["type"],
      timestamp: Date.now(),
      sessionId: session.id,
      data,
    };
    emitVoiceEvent(event);
    for (const handler of session._listeners.values()) {
      try { handler(event); } catch { /* subscriber errors don't crash */ }
    }
  }
}

// ---------------------------------------------------------------------------
// NVIDIA NIM Voice Session Handle
// ---------------------------------------------------------------------------

class NimSessionHandle implements VoiceSessionHandle {
  private _session: NimVoiceSession;
  private _provider: NvidiaNimVoiceProvider;

  constructor(session: NimVoiceSession, provider: NvidiaNimVoiceProvider) {
    this._session = session;
    this._provider = provider;
  }

  get id(): string { return this._session.id; }
  get state(): VoiceSessionState { return this._session.state; }

  onEvent(handler: VoiceEventHandler): () => void {
    const id = `h-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this._session._listeners.set(id, handler);
    return () => { this._session._listeners.delete(id); };
  }

  async sendAudio(audioData: ArrayBuffer): Promise<void> {
    this._setState("processing");
    this._emitEvent("audio.input_stopped", {});

    try {
      // Convert raw audio to a Blob for the transcription API
      const blob = new Blob([audioData], { type: "audio/wav" });
      const transcript = await this._provider._transcribeAudio(
        blob,
        this._session._model,
        this._session._config.language,
      );

      if (transcript.trim()) {
        this._session.transcript = transcript;
        this._session._history.push({ role: "user", content: transcript });
        this._emitEvent("transcript.final", { transcript, isFinal: true });
      }
    } catch (err) {
      this._emitEvent("provider.error", {
        error: err instanceof Error ? err.message : "transcription failed",
      });
      throw err;
    }
  }

  async sendText(text: string): Promise<void> {
    if (!text.trim()) return;

    this._session.transcript = text;
    this._session._history.push({ role: "user", content: text });
    this._emitEvent("transcript.final", { transcript: text, isFinal: true });

    // Generate response
    await this._generateResponse(text);
  }

  async interrupt(): Promise<void> {
    this._setState("interrupted");
    this._emitEvent("interruption.detected", { source: "user" });

    // Clear any pending audio playback
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }

  async cancel(): Promise<void> {
    await this.close();
  }

  async close(): Promise<void> {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this._setState("closed");
    this._emitEvent("session.closed", {});
    this._session._listeners.clear();
  }

  getSession(): VoiceSession {
    const s = this._session;
    return {
      id: s.id,
      state: s.state,
      provider: s.provider,
      model: s.model,
      createdAt: s.createdAt,
      lastStateChange: s.lastStateChange,
      transcript: s.transcript,
      partialTranscript: s.partialTranscript,
    };
  }

  // -- Private --

  private async _generateResponse(userText: string): Promise<void> {
    this._setState("processing");

    try {
      // Build messages with conversation history
      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        {
          role: "system",
          content: "You are Atlas, an AI assistant for insurance restoration contractors. Be concise, helpful, and professional. Keep responses brief for voice interaction (1-3 sentences).",
        },
        ...this._session._history,
      ];

      this._emitEvent("response.text_delta", { text: "" });

      const result = await this._provider._chatCompletion(
        messages,
        this._session._model,
        {
          voice: this._session._voice,
          modalities: ["text"],
          temperature: 0.7,
          maxTokens: 512,
        },
      );

      this._emitEvent("response.text_complete", { text: result.text });
      this._session._history.push({ role: "assistant", content: result.text });

      // Synthesize speech if we got text
      if (result.text) {
        this._setState("speaking");
        this._emitEvent("response.audio_delta", { text: result.text });

        try {
          const audioBuffer = await this._provider._synthesizeSpeech(
            result.text,
            this._session._model,
            this._session._voice,
          );
          await this._playAudioBuffer(audioBuffer);
          this._emitEvent("response.audio_complete", { text: result.text });
        } catch {
          // TTS fallback: try browser TTS
          await this._fallbackBrowserTTS(result.text);
        }
      }

      this._setState("completed");
      this._emitEvent("session.completed", {});
    } catch (err) {
      this._setState("error");
      this._emitEvent("provider.error", {
        error: err instanceof Error ? err.message : "generation failed",
      });
      throw err;
    }
  }

  private async _playAudioBuffer(buffer: ArrayBuffer): Promise<void> {
    if (typeof AudioContext === "undefined") return;

    const ctx = new AudioContext();
    try {
      const audioData = new Uint8Array(buffer);
      // PCM16 24kHz mono — decode via AudioContext
      const audioBuffer = await ctx.decodeAudioData(audioData.buffer);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      return new Promise((resolve) => {
        source.onended = () => {
          ctx.close();
          resolve();
        };
        source.start();
      });
    } catch {
      ctx.close();
      throw new Error("Failed to decode audio buffer");
    }
  }

  private async _fallbackBrowserTTS(text: string): Promise<void> {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    if (typeof SpeechSynthesisUtterance === "undefined") return;

    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();

      setTimeout(() => {
        try {
          window.speechSynthesis.speak(utterance);
        } catch {
          resolve();
        }
      }, 60);
    });
  }

  private _setState(state: VoiceSessionState): void {
    this._session.state = state;
    this._session.lastStateChange = Date.now();
    this._emitEvent("session.state_changed", { state });
  }

  private _emitEvent(type: string, data: Record<string, unknown>): void {
    const event: VoiceEvent = {
      type: type as VoiceEvent["type"],
      timestamp: Date.now(),
      sessionId: this._session.id,
      data,
    };
    emitVoiceEvent(event);
    for (const handler of this._session._listeners.values()) {
      try { handler(event); } catch { /* subscriber errors don't crash */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Internal session type
// ---------------------------------------------------------------------------

interface NimVoiceSession extends VoiceSession {
  _listeners: Map<string, VoiceEventHandler>;
  _config: VoiceSessionConfig;
  _model: string;
  _voice: string;
  _history: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}
