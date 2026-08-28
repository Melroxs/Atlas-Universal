// ---------------------------------------------------------------------------
// Atlas Voice Runtime — Core Tests
//
// Tests the voice runtime provider registry, event bus, session manager,
// telemetry, action registry, and runtime facade. Uses mock providers
// so no real API keys or browser APIs are needed.
// ---------------------------------------------------------------------------

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type {
  VoiceProviderAdapter,
  VoiceProviderConfig,
  VoiceSessionConfig,
  VoiceSessionHandle,
  VoiceSession,
  VoiceSessionState,
  VoiceEventHandler,
  VoiceEvent,
  VoiceProviderCapabilities,
} from "./types";
import { DEFAULT_VOICE_RUNTIME_CONFIG } from "./types";
import { createVoiceError, isRetryableCode, httpStatusToVoiceError, sanitizeVoiceErrorMessage } from "./errors";
import {
  emitVoiceEvent,
  subscribeToVoiceEvents,
  getVoiceEventHistory,
  resetVoiceEvents,
  createVoiceEvent,
} from "./events";
import {
  registerVoiceProvider,
  getVoiceProvider,
  getAllVoiceProviders,
  getAvailableVoiceProviders,
  buildVoiceFallbackChain,
  resetVoiceRegistry,
} from "./registry";
import {
  recordVoiceSession,
  getVoiceTelemetryByProvider,
  getVoiceTotalCost,
  getVoiceErrorRateByProvider,
  resetVoiceTelemetry,
} from "./telemetry";
import {
  registerVoiceAction,
  getVoiceAction,
  getAllVoiceActions,
  executeVoiceAction,
  clearVoiceActions,
  registerDefaultVoiceActions,
} from "./actions";

// ---------------------------------------------------------------------------
// Mock voice provider for testing
// ---------------------------------------------------------------------------

class MockVoiceProvider implements VoiceProviderAdapter {
  readonly id: string;
  readonly name: string;
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

  private _available: boolean;
  private _failCreate: boolean;

  constructor(id: string, available = true, failCreate = false) {
    this.id = id;
    this.name = `Mock ${id}`;
    this._available = available;
    this._failCreate = failCreate;
  }

  isAvailable(): boolean {
    return this._available;
  }

  async createSession(_config: VoiceSessionConfig): Promise<VoiceSessionHandle> {
    if (this._failCreate) {
      throw createVoiceError("provider_error", "Mock creation failure", { provider: this.id });
    }

    const sessionId = `${this.id}-session-${Date.now()}`;
    return new MockSessionHandle(sessionId, this.id);
  }

  async healthCheck(): Promise<boolean> {
    return this._available;
  }
}

class MockSessionHandle implements VoiceSessionHandle {
  readonly id: string;
  private _state: VoiceSessionState = "idle";
  private _listeners: Map<string, VoiceEventHandler> = new Map();
  private _providerId: string;

  constructor(id: string, providerId: string) {
    this.id = id;
    this._providerId = providerId;
  }

  get state(): VoiceSessionState {
    return this._state;
  }

  onEvent(handler: VoiceEventHandler): () => void {
    const key = `sub-${Date.now()}-${Math.random()}`;
    this._listeners.set(key, handler);
    return () => { this._listeners.delete(key); };
  }

  async sendAudio(_audioData: ArrayBuffer): Promise<void> {
    this._setState("processing");
    this._emit("transcript.final", { transcript: "mock audio transcript" });
    this._setState("completed");
  }

  async sendText(text: string): Promise<void> {
    this._setState("processing");
    this._emit("transcript.final", { transcript: text, isFinal: true });
    this._emit("response.text_complete", { text: `Mock response to: ${text}` });
    this._setState("completed");
  }

  async interrupt(): Promise<void> {
    this._setState("interrupted");
    this._emit("interruption.detected", {});
  }

  async cancel(): Promise<void> {
    await this.close();
  }

  async close(): Promise<void> {
    this._setState("closed");
    this._emit("session.closed", {});
    this._listeners.clear();
  }

  getSession(): VoiceSession {
    return {
      id: this.id,
      state: this._state,
      provider: this._providerId,
      model: "mock-model",
      createdAt: Date.now(),
      lastStateChange: Date.now(),
      transcript: "",
      partialTranscript: "",
    };
  }

  private _setState(state: VoiceSessionState): void {
    this._state = state;
    this._emit("session.state_changed", { state });
  }

  private _emit(type: string, data: Record<string, unknown>): void {
    const event = createVoiceEvent(type as VoiceEvent["type"], this.id, data);
    for (const handler of this._listeners.values()) {
      handler(event);
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Voice Runtime — Errors", () => {
  it("creates a typed voice error with correct properties", () => {
    const err = createVoiceError("timeout", "Timed out", { provider: "nvidia-nim-voice" });
    expect(err.code).toBe("timeout");
    expect(err.message).toBe("Timed out");
    expect(err.provider).toBe("nvidia-nim-voice");
    expect(err.retryable).toBe(true);
  });

  it("marks non-retryable codes correctly", () => {
    expect(isRetryableCode("authentication")).toBe(false);
    expect(isRetryableCode("missing_api_key")).toBe(false);
    expect(isRetryableCode("timeout")).toBe(true);
    expect(isRetryableCode("rate_limited")).toBe(true);
    expect(isRetryableCode("provider_error")).toBe(true);
  });

  it("maps HTTP status codes to error codes", () => {
    expect(httpStatusToVoiceError(401).code).toBe("authentication");
    expect(httpStatusToVoiceError(429).code).toBe("rate_limited");
    expect(httpStatusToVoiceError(500).code).toBe("provider_error");
    expect(httpStatusToVoiceError(404).code).toBe("invalid_model");
  });

  it("sanitizes API keys from error messages", () => {
    expect(sanitizeVoiceErrorMessage("Key nvapi-abc123def456 is invalid")).toContain("[REDACTED]");
    expect(sanitizeVoiceErrorMessage("AIzaSyExample12345678901234567")).toContain("[REDACTED]");
  });
});

describe("Voice Runtime — Event Bus", () => {
  beforeEach(() => {
    resetVoiceEvents();
  });

  it("emits events to subscribers", () => {
    const events: VoiceEvent[] = [];
    const unsub = subscribeToVoiceEvents((e) => events.push(e));

    emitVoiceEvent(createVoiceEvent("session.created", "s1", {}));
    emitVoiceEvent(createVoiceEvent("session.completed", "s1", {}));

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("session.created");
    expect(events[1].type).toBe("session.completed");

    unsub();
  });

  it("filters events by type", () => {
    const events: VoiceEvent[] = [];
    const unsub = subscribeToVoiceEvents(
      (e) => events.push(e),
      ["session.created"],
    );

    emitVoiceEvent(createVoiceEvent("session.created", "s1", {}));
    emitVoiceEvent(createVoiceEvent("session.completed", "s1", {}));
    emitVoiceEvent(createVoiceEvent("transcript.final", "s1", {}));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("session.created");

    unsub();
  });

  it("unsubscribes cleanly", () => {
    const events: VoiceEvent[] = [];
    const unsub = subscribeToVoiceEvents((e) => events.push(e));

    emitVoiceEvent(createVoiceEvent("session.created", "s1", {}));
    expect(events).toHaveLength(1);

    unsub();
    emitVoiceEvent(createVoiceEvent("session.created", "s2", {}));
    expect(events).toHaveLength(1); // no new events after unsub
  });

  it("maintains event history", () => {
    emitVoiceEvent(createVoiceEvent("session.created", "s1", {}));
    emitVoiceEvent(createVoiceEvent("session.completed", "s1", {}));

    const history = getVoiceEventHistory();
    expect(history).toHaveLength(2);
  });
});

describe("Voice Runtime — Provider Registry", () => {
  beforeEach(() => {
    resetVoiceRegistry();
  });

  it("registers and retrieves providers", () => {
    const mock = new MockVoiceProvider("mock-1");
    registerVoiceProvider(mock);

    expect(getVoiceProvider("mock-1")).toBe(mock);
    expect(getAllVoiceProviders()).toHaveLength(1);
  });

  it("filters available providers", () => {
    registerVoiceProvider(new MockVoiceProvider("available", true));
    registerVoiceProvider(new MockVoiceProvider("unavailable", false));

    expect(getAvailableVoiceProviders()).toHaveLength(1);
    expect(getAvailableVoiceProviders()[0].id).toBe("available");
  });

  it("builds fallback chain with preferred provider first", () => {
    const p1 = new MockVoiceProvider("p1", true);
    const p2 = new MockVoiceProvider("p2", true);
    registerVoiceProvider(p1);
    registerVoiceProvider(p2);

    const chain = buildVoiceFallbackChain("p2");
    expect(chain[0].id).toBe("p2");
    expect(chain[1].id).toBe("p1");
  });

  it("returns all available when no preference specified", () => {
    registerVoiceProvider(new MockVoiceProvider("a", true));
    registerVoiceProvider(new MockVoiceProvider("b", true));

    const chain = buildVoiceFallbackChain();
    expect(chain).toHaveLength(2);
  });
});

describe("Voice Runtime — Telemetry", () => {
  beforeEach(() => {
    resetVoiceTelemetry();
  });

  it("records and aggregates sessions", () => {
    recordVoiceSession({
      timestamp: new Date().toISOString(),
      sessionId: "s1",
      provider: "browser",
      model: "mock",
      durationMs: 5000,
      inputAudioMs: 3000,
      outputAudioMs: 2000,
      firstResponseLatencyMs: 800,
      success: true,
      interruptionCount: 0,
      transcriptWordCount: 15,
    });

    recordVoiceSession({
      timestamp: new Date().toISOString(),
      sessionId: "s2",
      provider: "nvidia-nim-voice",
      model: "nemotron",
      durationMs: 8000,
      inputAudioMs: 4000,
      outputAudioMs: 4000,
      firstResponseLatencyMs: 1200,
      success: false,
      errorCode: "timeout",
      interruptionCount: 1,
      transcriptWordCount: 20,
      estimatedCostUsd: 0.005,
    });

    const byProvider = getVoiceTelemetryByProvider();
    expect(byProvider.browser.totalSessions).toBe(1);
    expect(byProvider.browser.successfulSessions).toBe(1);
    expect(byProvider["nvidia-nim-voice"].failedSessions).toBe(1);
    expect(getVoiceTotalCost()).toBeCloseTo(0.005);
  });

  it("calculates error rates", () => {
    recordVoiceSession({
      timestamp: new Date().toISOString(),
      sessionId: "s1",
      provider: "browser",
      model: "mock",
      durationMs: 1000,
      inputAudioMs: 500,
      outputAudioMs: 500,
      firstResponseLatencyMs: 200,
      success: true,
      interruptionCount: 0,
      transcriptWordCount: 5,
    });
    recordVoiceSession({
      timestamp: new Date().toISOString(),
      sessionId: "s2",
      provider: "browser",
      model: "mock",
      durationMs: 1000,
      inputAudioMs: 500,
      outputAudioMs: 500,
      firstResponseLatencyMs: 0,
      success: false,
      errorCode: "timeout",
      interruptionCount: 0,
      transcriptWordCount: 0,
    });

    const rates = getVoiceErrorRateByProvider();
    expect(rates.browser).toBe(0.5);
  });
});

describe("Voice Runtime — Action Registry", () => {
  beforeEach(() => {
    clearVoiceActions();
  });

  it("registers and retrieves actions", () => {
    registerVoiceAction({
      id: "test-action",
      name: "Test Action",
      description: "A test action",
      riskLevel: "read",
      requiresConfirmation: false,
      category: "test",
      parameters: [],
      execute: async () => ({ success: true, message: "done" }),
    });

    expect(getVoiceAction("test-action")).toBeDefined();
    expect(getAllVoiceActions()).toHaveLength(1);
  });

  it("executes an action", async () => {
    registerVoiceAction({
      id: "echo",
      name: "Echo",
      description: "Echoes input",
      riskLevel: "read",
      requiresConfirmation: false,
      category: "test",
      parameters: [{ name: "text", type: "string", required: true, description: "Text to echo" }],
      execute: async (params) => ({
        success: true,
        message: `Echo: ${params.text}`,
        data: { echoed: params.text },
      }),
    });

    const result = await executeVoiceAction("echo", { text: "hello" }, {
      tenantId: "t1",
      userId: "u1",
    });

    expect(result.success).toBe(true);
    expect(result.message).toBe("Echo: hello");
  });

  it("returns confirmation for actions requiring confirmation", async () => {
    registerVoiceAction({
      id: "dangerous",
      name: "Dangerous Action",
      description: "Does something dangerous",
      riskLevel: "high_risk_write",
      requiresConfirmation: true,
      category: "test",
      parameters: [],
      execute: async () => ({ success: true, message: "executed" }),
    });

    const result = await executeVoiceAction("dangerous", {}, {
      tenantId: "t1",
      userId: "u1",
    });

    expect(result.requiresConfirmation).toBe(true);
    expect(result.confirmationPrompt).toBeDefined();
  });

  it("executes confirmed actions", async () => {
    registerVoiceAction({
      id: "dangerous",
      name: "Dangerous Action",
      description: "Does something dangerous",
      riskLevel: "high_risk_write",
      requiresConfirmation: true,
      category: "test",
      parameters: [],
      execute: async () => ({ success: true, message: "executed" }),
    });

    const result = await executeVoiceAction("dangerous", { _confirmed: true }, {
      tenantId: "t1",
      userId: "u1",
    });

    expect(result.success).toBe(true);
    expect(result.message).toBe("executed");
  });

  it("handles unknown action IDs", async () => {
    const result = await executeVoiceAction("nonexistent", {}, {
      tenantId: "t1",
      userId: "u1",
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain("Unknown action");
  });

  it("registers default Atlas voice actions", () => {
    registerDefaultVoiceActions();
    const actions = getAllVoiceActions();
    expect(actions.length).toBeGreaterThanOrEqual(5);

    // Check key actions exist
    const ids = actions.map((a) => a.id);
    expect(ids).toContain("navigate_to_page");
    expect(ids).toContain("search_claims");
    expect(ids).toContain("get_claim_status");
    expect(ids).toContain("send_outreach_email");
    expect(ids).toContain("replay_last_response");
  });
});

describe("Voice Runtime — Session Manager", () => {
  beforeEach(() => {
    resetVoiceRegistry();
    resetVoiceEvents();
  });

  it("creates a session with an available provider", async () => {
    registerVoiceProvider(new MockVoiceProvider("mock", true));

    const { createVoiceSession } = await import("./session");
    const { initSessionManager } = await import("./session");
    initSessionManager(DEFAULT_VOICE_RUNTIME_CONFIG);

    const handle = await createVoiceSession({ provider: "mock" });
    expect(handle.id).toContain("mock");
    expect(handle.state).toBe("idle");

    await handle.close();
  });

  it("falls back to next provider when primary fails", async () => {
    registerVoiceProvider(new MockVoiceProvider("fail", true, true));
    registerVoiceProvider(new MockVoiceProvider("success", true, false));

    const { createVoiceSession } = await import("./session");
    const { initSessionManager } = await import("./session");
    initSessionManager(DEFAULT_VOICE_RUNTIME_CONFIG);

    const handle = await createVoiceSession({ provider: "fail" });
    // Should have fallen back to "success"
    expect(handle.id).toContain("success");

    await handle.close();
  });
});
