// ---------------------------------------------------------------------------
// Atlas Voice Runtime — Browser Voice Provider
//
// Wraps the existing browser Web Speech API (STT + TTS) as a voice
// provider adapter. This is the guaranteed fallback — it works without
// any API key or server-side infrastructure.
//
// Limitations (honest — never hidden from callers):
// - STT quality depends on the browser/OS
// - No true full-duplex speech-to-speech
// - No server-side voice/persona control
// - No streaming audio input/output
// - No interruption detection (browser-native only)
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
import { createVoiceError } from "../errors";
import {
  createVoiceEvent,
  emitVoiceEvent,
} from "../events";

// ---------------------------------------------------------------------------
// Browser Voice Provider
// ---------------------------------------------------------------------------

export class BrowserVoiceProvider implements VoiceProviderAdapter {
  readonly id = "browser" as const;
  readonly name = "Browser Voice (Web Speech API)";
  readonly capabilities: VoiceProviderCapabilities = {
    stt: true,
    tts: true,
    speechToSpeech: false,
    streamingInput: false,
    streamingOutput: false,
    interruption: false,
    voiceControl: false,
    realtime: false,
  };

  private config: VoiceProviderConfig;

  constructor(config: VoiceProviderConfig) {
    this.config = config;
  }

  isAvailable(): boolean {
    if (typeof window === "undefined") return false;
    const w = window as unknown as Record<string, unknown>;
    const hasSTT = !!(w.SpeechRecognition ?? w.webkitSpeechRecognition);
    const hasTTS = "speechSynthesis" in window;
    return hasSTT || hasTTS;
  }

  async createSession(config: VoiceSessionConfig): Promise<VoiceSessionHandle> {
    if (!this.isAvailable()) {
      throw createVoiceError(
        "browser_unsupported",
        "Browser speech recognition/synthesis is not available in this environment.",
        { provider: this.id },
      );
    }

    const sessionId = `browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const session: BrowserSession = {
      id: sessionId,
      state: "idle",
      provider: "browser",
      model: "browser-native",
      createdAt: Date.now(),
      lastStateChange: Date.now(),
      transcript: "",
      partialTranscript: "",
      _listeners: new Map(),
      _recognition: null,
      _config: config,
    };

    emitVoiceEvent(createVoiceEvent("session.created", sessionId, {
      provider: "browser",
      model: "browser-native",
    }));

    return new BrowserSessionHandle(session);
  }

  async healthCheck(): Promise<boolean> {
    return this.isAvailable();
  }
}

// ---------------------------------------------------------------------------
// Browser Session Handle
// ---------------------------------------------------------------------------

class BrowserSessionHandle implements VoiceSessionHandle {
  private _session: BrowserSession;

  constructor(session: BrowserSession) {
    this._session = session;
  }

  get id(): string { return this._session.id; }
  get state(): VoiceSessionState { return this._session.state; }

  onEvent(handler: VoiceEventHandler): () => void {
    const id = `h-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this._session._listeners.set(id, handler);
    return () => { this._session._listeners.delete(id); };
  }

  async sendAudio(_audioData: ArrayBuffer): Promise<void> {
    // Browser provider doesn't support direct audio input via this API.
    // STT is handled through the Web Speech API recognition interface.
    throw createVoiceError(
      "not_implemented",
      "Browser voice provider does not support direct audio input. Use push-to-talk or ambient recognition instead.",
      { provider: "browser" },
    );
  }

  async sendText(text: string): Promise<void> {
    if (!text.trim()) return;

    this._setState("processing");
    this._emitEvent("transcript.final", {
      transcript: text,
      isFinal: true,
    });

    // Use browser TTS to speak the text if configured
    if (this._session._config.enableInterruption !== false) {
      this._speakText(text);
    }
  }

  async interrupt(): Promise<void> {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this._setState("interrupted");
    this._emitEvent("interruption.detected", { source: "browser" });

    // Return to idle after interruption
    setTimeout(() => {
      if (this._session.state === "interrupted") {
        this._setState("idle");
      }
    }, 500);
  }

  async cancel(): Promise<void> {
    await this.close();
  }

  async close(): Promise<void> {
    if (this._session._recognition) {
      try { this._session._recognition.abort(); } catch { /* already stopped */ }
      this._session._recognition = null;
    }
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

  // -- Private helpers --

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

  private _speakText(text: string): void {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    if (typeof SpeechSynthesisUtterance === "undefined") return;

    this._setState("speaking");
    this._emitEvent("response.audio_complete", { text });

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 1;

    const voices = window.speechSynthesis.getVoices?.() ?? [];
    const preferred =
      voices.find((v) => v.lang.startsWith("en") && /google|natural|premium/i.test(v.name)) ??
      voices.find((v) => v.lang.startsWith("en"));
    if (preferred) utterance.voice = preferred;

    utterance.onend = () => {
      this._setState("completed");
      this._emitEvent("session.completed", {});
    };
    utterance.onerror = () => {
      this._setState("idle");
    };

    // Defer speak past any pending cancel (Chrome quirk)
    setTimeout(() => {
      try {
        window.speechSynthesis.speak(utterance);
      } catch {
        this._setState("idle");
      }
    }, 60);
  }
}

// ---------------------------------------------------------------------------
// Internal session type (extends VoiceSession with internal fields)
// ---------------------------------------------------------------------------

interface BrowserSession extends VoiceSession {
  _listeners: Map<string, VoiceEventHandler>;
  _recognition: { abort(): void } | null;
  _config: VoiceSessionConfig;
}
