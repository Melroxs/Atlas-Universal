// ---------------------------------------------------------------------------
// Atlas Voice Runtime — Session Manager
//
// Manages voice session lifecycle: creation, state tracking, concurrent
// session limits, and cleanup. The session manager is the primary interface
// for the Voice Runtime facade.
// ---------------------------------------------------------------------------

import type {
  VoiceSessionConfig,
  VoiceSessionHandle,
  VoiceSessionState,
  VoiceEventHandler,
  VoiceEvent,
  VoiceProviderId,
} from "./types";
import { createVoiceError } from "./errors";
import { createVoiceEvent, emitVoiceEvent } from "./events";
import {
  buildVoiceFallbackChain,
  getVoiceProvider,
} from "./registry";
import type { VoiceRuntimeConfig } from "./types";

// ---------------------------------------------------------------------------
// Active session tracking
// ---------------------------------------------------------------------------

interface ActiveSession {
  handle: VoiceSessionHandle;
  providerId: VoiceProviderId;
  createdAt: number;
  lastActivity: number;
}

const _activeSessions: Map<string, ActiveSession> = new Map();
let _maxConcurrentSessions = 1;

/**
 * Initialize the session manager with runtime config.
 */
export function initSessionManager(config: VoiceRuntimeConfig): void {
  _maxConcurrentSessions = config.maxConcurrentSessions;
}

/**
 * Create a new voice session with automatic provider fallback.
 *
 * Flow:
 * 1. Build provider fallback chain
 * 2. Try creating a session with the primary provider
 * 3. On failure, try the next provider in the chain
 * 4. Return the session handle
 */
export async function createVoiceSession(
  config: VoiceSessionConfig,
): Promise<VoiceSessionHandle> {
  // Check concurrent session limit
  if (_activeSessions.size >= _maxConcurrentSessions) {
    throw createVoiceError(
      "session_limit",
      `Maximum concurrent voice sessions (${_maxConcurrentSessions}) reached. Close an existing session first.`,
    );
  }

  // Build fallback chain
  const chain = buildVoiceFallbackChain(config.provider);

  if (chain.length === 0) {
    throw createVoiceError(
      "provider_unavailable",
      "No voice providers are available. Check NVIDIA_NIM_API_KEY or browser speech support.",
    );
  }

  let lastError: Error | undefined;

  for (const provider of chain) {
    try {
      const handle = await provider.createSession(config);

      // Track the active session
      _activeSessions.set(handle.id, {
        handle,
        providerId: provider.id,
        createdAt: Date.now(),
        lastActivity: Date.now(),
      });

      // Set up auto-cleanup on session close
      handle.onEvent((event) => {
        if (
          event.type === "session.closed" ||
          event.type === "session.completed" ||
          event.type === "session.error"
        ) {
          _activeSessions.delete(handle.id);
        }

        // Update last activity
        const session = _activeSessions.get(handle.id);
        if (session) {
          session.lastActivity = Date.now();
        }

        // Track fallback usage
        if (event.type === "provider.fallback") {
          emitVoiceEvent(createVoiceEvent(
            "provider.fallback",
            handle.id,
            {
              from: event.data.from,
              to: event.data.to,
              reason: event.data.reason,
            },
          ));
        }
      });

      return handle;
    } catch (err) {
      lastError = err as Error;

      // Emit fallback event if there are more providers to try
      const nextProvider = chain.indexOf(provider);
      if (nextProvider < chain.length - 1) {
        emitVoiceEvent(createVoiceEvent(
          "provider.fallback",
          "pending",
          {
            from: provider.id,
            to: chain[nextProvider + 1]?.id,
            reason: lastError.message,
          },
        ));
      }

      // Don't continue if the error is not retryable
      if (lastError && "retryable" in lastError && !(lastError as { retryable: boolean }).retryable) {
        break;
      }
    }
  }

  throw createVoiceError(
    "all_providers_failed",
    `All voice providers failed. Last error: ${lastError?.message ?? "unknown"}`,
    { retryable: false, cause: lastError },
  );
}

/**
 * Get a specific active session by ID.
 */
export function getActiveSession(sessionId: string): ActiveSession | undefined {
  return _activeSessions.get(sessionId);
}

/**
 * Get all active sessions.
 */
export function getActiveSessions(): Array<{
  id: string;
  provider: VoiceProviderId;
  state: VoiceSessionState;
  createdAt: number;
  lastActivity: number;
}> {
  return Array.from(_activeSessions.values()).map((s) => ({
    id: s.handle.id,
    provider: s.providerId,
    state: s.handle.state,
    createdAt: s.createdAt,
    lastActivity: s.lastActivity,
  }));
}

/**
 * Get the count of active sessions.
 */
export function getActiveSessionCount(): number {
  return _activeSessions.size;
}

/**
 * Close all active sessions (for cleanup or testing).
 */
export async function closeAllSessions(): Promise<void> {
  const handles = Array.from(_activeSessions.values()).map((s) => s.handle);
  _activeSessions.clear();

  for (const handle of handles) {
    try {
      await handle.close();
    } catch {
      // best-effort cleanup
    }
  }
}

/**
 * Reset session manager (for testing).
 */
export function resetSessionManager(): void {
  _activeSessions.clear();
  _maxConcurrentSessions = 1;
}
