// ---------------------------------------------------------------------------
// Atlas Voice Runtime — Event Bus
//
// Manages voice event subscriptions and dispatch. Used by the runtime
// to broadcast session events to subscribers (UI components, telemetry, etc.).
// ---------------------------------------------------------------------------

import type { VoiceEvent, VoiceEventType, VoiceEventHandler } from "./types";

// ---------------------------------------------------------------------------
// Event Bus singleton
// ---------------------------------------------------------------------------

type Subscription = {
  id: string;
  types: VoiceEventType[] | null; // null = all events
  handler: VoiceEventHandler;
};

let _subscriptions: Map<string, Subscription> = new Map();
let _eventHistory: VoiceEvent[] = [];
const MAX_HISTORY = 200;

let _nextSubId = 0;

/**
 * Subscribe to voice events.
 * @param handler Called for every matching event.
 * @param types Optional filter — only these event types are delivered.
 * @returns Unsubscribe function.
 */
export function subscribeToVoiceEvents(
  handler: VoiceEventHandler,
  types?: VoiceEventType[],
): () => void {
  const id = `sub-${++_nextSubId}`;
  _subscriptions.set(id, { id, types: types ?? null, handler });

  return () => {
    _subscriptions.delete(id);
  };
}

/**
 * Emit a voice event to all matching subscribers.
 */
export function emitVoiceEvent(event: VoiceEvent): void {
  // Store in history
  _eventHistory.push(event);
  if (_eventHistory.length > MAX_HISTORY) {
    _eventHistory = _eventHistory.slice(_eventHistory.length - MAX_HISTORY);
  }

  // Dispatch to subscribers
  for (const sub of _subscriptions.values()) {
    if (!sub.types || sub.types.includes(event.type)) {
      try {
        sub.handler(event);
      } catch {
        // Subscriber errors must never crash the runtime
      }
    }
  }
}

/**
 * Get recent event history (for diagnostics).
 */
export function getVoiceEventHistory(limit?: number): VoiceEvent[] {
  if (limit) return _eventHistory.slice(-limit);
  return [..._eventHistory];
}

/**
 * Clear event history and all subscriptions (for testing).
 */
export function resetVoiceEvents(): void {
  _subscriptions.clear();
  _eventHistory = [];
  _nextSubId = 0;
}

/**
 * Helper to create a VoiceEvent with consistent structure.
 */
export function createVoiceEvent(
  type: VoiceEventType,
  sessionId: string,
  data: Record<string, unknown> = {},
): VoiceEvent {
  return {
    type,
    timestamp: Date.now(),
    sessionId,
    data,
  };
}
