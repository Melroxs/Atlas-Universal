// ---------------------------------------------------------------------------
// Atlas Voice Runtime — Main Runtime Facade
//
// The single entry point for all Atlas voice interaction. Handles:
//   - Provider selection with automatic fallback
//   - Session lifecycle management
//   - Voice action execution
//   - Telemetry recording
//   - Event dispatch
//
// Atlas business logic never calls provider-specific voice APIs directly.
// ---------------------------------------------------------------------------

import type {
  VoiceSessionConfig,
  VoiceSessionHandle,
  VoiceEvent,
  VoiceEventHandler,
  VoiceEventType,
  VoiceRuntimeConfig,
  VoiceActionContext,
  VoiceActionResult,
  VoiceProviderId,
} from "./types";
import { DEFAULT_VOICE_RUNTIME_CONFIG } from "./types";
import { createVoiceError } from "./errors";
import { emitVoiceEvent, createVoiceEvent, subscribeToVoiceEvents } from "./events";
import {
  initializeVoiceRegistry,
  getVoiceProvider,
  isVoiceProviderAvailable,
} from "./registry";
import {
  createVoiceSession,
  getActiveSessions,
  getActiveSessionCount,
  closeAllSessions,
  initSessionManager,
} from "./session";
import {
  recordVoiceSession,
  getVoiceTelemetryByProvider,
  getVoiceTotalCost,
  getVoiceErrorRateByProvider,
} from "./telemetry";
import {
  registerDefaultVoiceActions,
  executeVoiceAction,
  getAllVoiceActions,
} from "./actions";

// ---------------------------------------------------------------------------
// Runtime singleton
// ---------------------------------------------------------------------------

let _config: VoiceRuntimeConfig = { ...DEFAULT_VOICE_RUNTIME_CONFIG };
let _initialized = false;
let _currentSession: VoiceSessionHandle | null = null;
let _sessionStartTime: number = 0;

/**
 * Initialize the Atlas Voice Runtime.
 * Must be called before any voice session requests.
 */
export async function initVoiceRuntime(
  config?: Partial<VoiceRuntimeConfig>,
): Promise<void> {
  if (config) {
    _config = { ...DEFAULT_VOICE_RUNTIME_CONFIG, ...config };
  }

  await initializeVoiceRegistry();
  initSessionManager(_config);
  registerDefaultVoiceActions();
  _initialized = true;
}

/**
 * Reset the voice runtime (for testing).
 */
export async function resetVoiceRuntime(): Promise<void> {
  if (_currentSession) {
    try { await _currentSession.close(); } catch { /* best-effort */ }
    _currentSession = null;
  }
  _config = { ...DEFAULT_VOICE_RUNTIME_CONFIG };
  _initialized = false;
}

/**
 * Check if the voice runtime is initialized.
 */
export function isVoiceRuntimeInitialized(): boolean {
  return _initialized;
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

/**
 * Start a new voice session.
 *
 * Flow:
 * 1. Close any existing session
 * 2. Create a new session with provider fallback
 * 3. Track the session for the runtime
 * 4. Return the session handle
 */
export async function startVoiceSession(
  config?: Partial<VoiceSessionConfig>,
): Promise<VoiceSessionHandle> {
  ensureInitialized();

  // Close existing session if any
  if (_currentSession) {
    try { await _currentSession.close(); } catch { /* best-effort */ }
    _currentSession = null;
  }

  const sessionConfig: VoiceSessionConfig = {
    provider: config?.provider ?? _config.defaultProvider,
    model: config?.model ?? _config.defaultModel,
    voice: config?.voice ?? _config.defaultVoice,
    language: config?.language ?? _config.defaultLanguage ?? "en-US",
    enableInterruption: config?.enableInterruption ?? _config.enableInterruption,
    maxDurationMs: config?.maxDurationMs ?? _config.maxSessionDurationMs,
    timeoutMs: config?.timeoutMs ?? _config.defaultTimeoutMs,
    metadata: config?.metadata,
  };

  const handle = await createVoiceSession(sessionConfig);
  _currentSession = handle;
  _sessionStartTime = Date.now();

  // Set up session event handler for telemetry
  handle.onEvent((event) => {
    _handleSessionEvent(event);
  });

  return handle;
}

/**
 * Get the current active voice session (if any).
 */
export function getCurrentSession(): VoiceSessionHandle | null {
  return _currentSession;
}

/**
 * Close the current voice session.
 */
export async function closeCurrentSession(): Promise<void> {
  if (_currentSession) {
    const session = _currentSession;
    _currentSession = null;

    try {
      await session.close();
    } catch {
      // best-effort cleanup
    }
  }
}

// ---------------------------------------------------------------------------
// Quick actions (convenience methods)
// ---------------------------------------------------------------------------

/**
 * Send text to the current voice session (hybrid text+voice mode).
 */
export async function sendVoiceText(text: string): Promise<void> {
  if (!_currentSession) {
    throw createVoiceError(
      "session_expired",
      "No active voice session. Start one with startVoiceSession() first.",
    );
  }
  await _currentSession.sendText(text);
}

/**
 * Interrupt the current voice session.
 */
export async function interruptVoice(): Promise<void> {
  if (_currentSession) {
    await _currentSession.interrupt();
  }
}

/**
 * Execute a voice action by ID.
 */
export async function runVoiceAction(
  actionId: string,
  params: Record<string, unknown>,
  context: VoiceActionContext,
): Promise<VoiceActionResult> {
  ensureInitialized();

  // Emit action triggered event
  emitVoiceEvent(createVoiceEvent(
    "action.triggered",
    _currentSession?.id ?? "no-session",
    { actionId, params: { ...params, _confirmed: params._confirmed } },
  ));

  const result = await executeVoiceAction(actionId, params, context);

  // Emit completion event
  emitVoiceEvent(createVoiceEvent(
    result.success ? "action.completed" : "action.failed",
    _currentSession?.id ?? "no-session",
    { actionId, success: result.success, message: result.message },
  ));

  return result;
}

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

/**
 * Get voice runtime status for observability dashboard.
 */
export function getVoiceRuntimeStatus(): {
  initialized: boolean;
  currentSession: { id: string; provider: VoiceProviderId; state: string } | null;
  activeSessions: number;
  registeredActions: number;
  telemetry: ReturnType<typeof getVoiceTelemetryByProvider>;
  totalCost: number;
  errorRates: ReturnType<typeof getVoiceErrorRateByProvider>;
} {
  return {
    initialized: _initialized,
    currentSession: _currentSession
      ? {
          id: _currentSession.id,
          provider: _currentSession.getSession().provider,
          state: _currentSession.state,
        }
      : null,
    activeSessions: getActiveSessionCount(),
    registeredActions: getAllVoiceActions().length,
    telemetry: getVoiceTelemetryByProvider(),
    totalCost: getVoiceTotalCost(),
    errorRates: getVoiceErrorRateByProvider(),
  };
}

// ---------------------------------------------------------------------------
// Internal: session event handler for telemetry
// ---------------------------------------------------------------------------

function _handleSessionEvent(event: VoiceEvent): void {
  // Record telemetry on session completion or error
  if (event.type === "session.completed" || event.type === "session.error") {
    const durationMs = Date.now() - _sessionStartTime;

    recordVoiceSession({
      timestamp: new Date().toISOString(),
      sessionId: event.sessionId,
      provider: _currentSession?.getSession().provider ?? "unknown",
      model: _currentSession?.getSession().model ?? "unknown",
      durationMs,
      inputAudioMs: 0,
      outputAudioMs: 0,
      firstResponseLatencyMs: 0,
      success: event.type === "session.completed",
      errorCode: event.type === "session.error"
        ? String(event.data.error ?? "unknown")
        : undefined,
      interruptionCount: 0,
      transcriptWordCount: 0,
    });
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function ensureInitialized(): void {
  if (!_initialized) {
    throw createVoiceError(
      "provider_unavailable",
      "Voice runtime not initialized. Call initVoiceRuntime() first.",
    );
  }
}
