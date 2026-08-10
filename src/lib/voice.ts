// ---------------------------------------------------------------------------
// Browser voice transport — Web Speech API (real provider, no API key needed).
//
// The server-side Convex voice actions (src/convex/voice.ts) take over STT/TTS
// when credentials are configured; otherwise the UI falls back to these
// browser-native providers and reports that honestly.
//
// Runtime guarantees:
// - Before the wake word, NOTHING is sent anywhere: recognition runs locally
//   in the browser and only the committed command transcript is handed to the
//   conversational brain (conversation.converse).
// - Exactly ONE SpeechRecognition instance is active at a time. Starting a
//   second recognizer while one is active throws InvalidStateError in Chrome,
//   which silently broke command capture in earlier builds.
// - State is reported honestly — there is no fake "always listening" state.
// ---------------------------------------------------------------------------

import {
  INTERRUPT_ANYWHERE_RE,
  detectWakeWord,
  shouldAcceptWake,
  stripWakeWord,
} from "./wake-word";

type SpeechRecognitionCtor = new () => {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
};

export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  const ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as SpeechRecognitionCtor | undefined;
  return ctor ?? null;
}

/** True when the browser can capture and transcribe speech locally. */
export function browserSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

/** True when the browser can synthesize speech locally. */
export function browserSpeechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export interface RecognizerHandlers {
  /** Called with each NEWLY finalized transcript segment (not the whole buffer). */
  onFinal: (segment: string) => void;
  /** Called on every result with the full running transcript (finals + interim). */
  onInterim: (running: string) => void;
  /** Called when recognition ends (stop or silence). */
  onEnd: () => void;
  /** Called with a normalized error code. */
  onError: (code: string) => void;
}

export interface Recognizer {
  start: () => void;
  stop: () => void;
  abort: () => void;
}

export interface RecognizerOptions {
  /** Continuous recognition (default true). False = end after one utterance. */
  continuous?: boolean;
}

/**
 * Create a speech recognizer. Returns null when the browser does not support
 * speech recognition (honest — the UI shows an unavailable state).
 *
 * `ctor` and `opts` are injectable for unit tests. Delivery semantics:
 * - onFinal fires once per finalized segment (deduplicated — it does NOT fire
 *   repeatedly with the accumulated buffer on every result event, which caused
 *   duplicate chimes/commands in earlier builds).
 * - onInterim fires with the full running text (finals + interim) on every
 *   result so consumers can do leading-position wake matching reliably.
 */
export function createSpeechRecognizer(
  handlers: RecognizerHandlers,
  ctor?: SpeechRecognitionCtor | null,
  opts?: RecognizerOptions,
): Recognizer | null {
  const Ctor = ctor !== undefined ? ctor : getSpeechRecognitionCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.continuous = opts?.continuous ?? true;
  rec.interimResults = true;
  rec.lang = "en-US";

  let finalSegments: string[] = [];
  let lastFinalIndex = -1;

  rec.onresult = (event: unknown) => {
    const evt = event as {
      resultIndex: number;
      results: ArrayLike<{ isFinal: boolean; [index: number]: { transcript: string } }>;
    };
    let interim = "";
    const fresh: string[] = [];
    for (let i = evt.resultIndex; i < evt.results.length; i++) {
      const res = evt.results[i];
      const seg = (res[0]?.transcript ?? "").trim();
      if (!seg) continue;
      if (res.isFinal) {
        // Dedupe: only a result index we have not seen before counts.
        if (i > lastFinalIndex) {
          lastFinalIndex = i;
          finalSegments.push(seg);
          fresh.push(seg);
        }
      } else {
        interim += `${seg} `;
      }
    }
    for (const s of fresh) handlers.onFinal(s);
    const running = [...finalSegments, interim.trim()].filter(Boolean).join(" ");
    handlers.onInterim(running);
  };

  rec.onerror = (event: unknown) => {
    const code = String(
      (event as { error?: string })?.error ?? "unknown",
    );
    handlers.onError(code);
  };

  rec.onend = () => {
    handlers.onEnd();
  };

  return {
    start: () => {
      try {
        rec.start();
      } catch {
        handlers.onError("start-failed");
      }
    },
    stop: () => {
      try {
        rec.stop();
      } catch {
        // Already stopped.
      }
    },
    abort: () => {
      try {
        rec.abort();
      } catch {
        // Already stopped.
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Speech synthesis
// ---------------------------------------------------------------------------

let pendingSpeakTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Speak text using the browser's speech synthesis. Returns false when
 * synthesis is unavailable so callers can fall back to a written response.
 *
 * Chrome drops an utterance when speak() is called in the same tick as
 * cancel(), so the actual speak is deferred ~60ms after the cancel — the
 * single most common reason "Atlas didn't say anything" in Chrome.
 */
export function speakText(
  text: string,
  opts?: { onEnd?: () => void },
): boolean {
  if (!browserSpeechSynthesisSupported()) return false;
  if (typeof SpeechSynthesisUtterance === "undefined") return false;
  const clean = (text ?? "").trim();
  if (!clean) return false;
  const synth = window.speechSynthesis;
  if (!synth) return false;

  if (pendingSpeakTimer !== null) {
    clearTimeout(pendingSpeakTimer);
    pendingSpeakTimer = null;
  }
  synth.cancel();

  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.rate = 1.05;
  utterance.pitch = 1;
  const voices =
    typeof synth.getVoices === "function" ? synth.getVoices() : [];
  const preferred =
    voices.find((v) => v.lang.startsWith("en") && /google|natural|premium/i.test(v.name)) ??
    voices.find((v) => v.lang.startsWith("en"));
  if (preferred) utterance.voice = preferred;
  if (opts?.onEnd) {
    utterance.onend = () => opts.onEnd?.();
    utterance.onerror = () => opts.onEnd?.();
  }
  pendingSpeakTimer = setTimeout(() => {
    pendingSpeakTimer = null;
    try {
      synth.speak(utterance);
    } catch {
      opts?.onEnd?.();
    }
  }, 60);
  return true;
}

/** Stop any browser speech synthesis immediately (interruption). */
export function stopBrowserSpeaking(): void {
  if (pendingSpeakTimer !== null) {
    clearTimeout(pendingSpeakTimer);
    pendingSpeakTimer = null;
  }
  if (browserSpeechSynthesisSupported()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Already stopped.
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 11/12 — Ambient wake-word engine
//
// A SINGLE continuous recognizer drives the whole loop (wake detection AND
// command capture). Earlier builds created a second recognizer for the
// command, which Chrome rejects while the first is active — commands were
// silently lost. Now:
//
//   listening_for_wake_word → wake_detected → listening_for_command → commit
//                                                                     ↓
//   listening_for_wake_word ←──── (fresh recognizer, clean transcript) ←┘
//
// Wake-word safety: nothing is uploaded before the wake word. Detection is a
// local leading-position match with cooldown + duplicate suppression; the
// browser transcript never leaves the device until a command commits.
// ---------------------------------------------------------------------------

/** Short confirmation tone for wake detection (optional, subtle). */
export function playWakeChime(): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.24);
    osc.onended = () => void ctx.close();
  } catch {
    // Chime is decorative — never break voice for it.
  }
}

/** Request microphone access (transient, then releases the stream). */
export async function requestMicrophonePermission(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return false;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

export type MicPermissionState =
  | "granted"
  | "prompt"
  | "denied"
  | "unsupported"
  | "unknown";

/**
 * Read the current microphone permission state (diagnostics only). Returns
 * "unsupported" when the Permissions API is unavailable.
 */
export async function getMicPermissionState(): Promise<MicPermissionState> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) {
    return "unsupported";
  }
  try {
    const status = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    });
    return (status.state as MicPermissionState) ?? "unknown";
  } catch {
    return "unknown";
  }
}

export interface WakeWordEngineHandlers {
  /** Engine states: listening_for_wake_word | wake_detected |
   *  listening_for_command | paused | permission_required | unavailable |
   *  error. */
  onState: (state: string) => void;
  /** Wake word detected (transcript at detection time). */
  onWake: (transcript: string) => void;
  /** Final command transcript captured after the wake word (wake word stripped). */
  onCommand: (text: string) => void;
  /** Interruption phrase spoken while Atlas is speaking. */
  onInterrupt: () => void;
  /** Normalized error code from the underlying recognizer. */
  onError: (code: string) => void;
}

export interface WakeWordEngine {
  start: () => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  /** While true, only interruption phrases are accepted (used during speaking). */
  setInterruptOnly: (value: boolean) => void;
}

export interface WakeWordEngineDeps {
  /** Injectable recognizer factory for unit tests (defaults to the browser). */
  createRecognizer?: (handlers: RecognizerHandlers) => Recognizer | null;
  /** Injectable clock for unit tests (defaults to Date.now). */
  now?: () => number;
}

/** Commit the command after this much silence following the last input. */
const COMMIT_SILENCE_MS = 1500;
/** Abandon a bare wake (no command yet) after this long waiting. */
const ABANDON_WAIT_MS = 8000;
/** Restarts within this window are treated as rapid (error churn). */
const RAPID_WINDOW_MS = 1200;
/** Max rapid restarts before surfacing an honest error. */
const MAX_RAPID_RESTARTS = 5;

/**
 * The ambient wake-word loop. Uses a single recognizer for wake + command so
 * Chrome never rejects a second concurrent recognizer. Call start() after mic
 * permission is granted; call setInterruptOnly(true) while Atlas is speaking
 * so "Atlas stop" can interrupt but ordinary speech cannot wake Atlas.
 */
export function createWakeWordEngine(
  handlers: WakeWordEngineHandlers,
  deps?: WakeWordEngineDeps,
): WakeWordEngine {
  const { onState, onWake, onCommand, onInterrupt } = handlers;
  const makeRecognizer = deps?.createRecognizer ?? createSpeechRecognizer;
  const now = deps?.now ?? (() => Date.now());

  let rec: Recognizer | null = null;
  let mode: "wake" | "command" = "wake";
  let stopped = true;
  let paused = false;
  let interruptOnly = false;
  let commandText = "";
  let lastWakeAt = 0;
  let lastWakeTranscript = "";
  let commitTimer: ReturnType<typeof setTimeout> | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let restartCount = 0;
  let lastRestartAt = 0;

  const emit = (state: string) => onState(state);

  const clearCommitTimer = () => {
    if (commitTimer !== null) {
      clearTimeout(commitTimer);
      commitTimer = null;
    }
  };

  /** Commit whatever command was captured, then return to wake listening. */
  const commit = () => {
    clearCommitTimer();
    const text = commandText.trim();
    commandText = "";
    mode = "wake";
    if (text) {
      restartCount = 0;
      onCommand(text);
    }
    // Fresh recognizer: the previous transcript still begins with the wake
    // word, so reusing it would re-detect "Atlas" on the next utterance.
    restartFresh();
  };

  /** Immediate restart with a brand-new recognizer (clean transcript). */
  const restartFresh = () => {
    if (stopped || paused) return;
    setTimeout(() => {
      if (!stopped && !paused) startRecognizer();
    }, 0);
  };

  /** Backoff restart used after recognition ends/errors (idempotent). */
  const scheduleRestart = () => {
    if (restartTimer !== null || stopped || paused) return;
    const since = now() - lastRestartAt;
    const rapid = since < RAPID_WINDOW_MS;
    restartCount = rapid ? restartCount + 1 : 0;
    lastRestartAt = now();
    const delay = rapid ? Math.min(300 * restartCount, 1500) : 0;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (stopped || paused) return;
      if (restartCount >= MAX_RAPID_RESTARTS) {
        emit("error");
        handlers.onError("restart-limit");
        return;
      }
      startRecognizer();
    }, delay);
  };

  const startRecognizer = () => {
    if (stopped || paused) return;
    try {
      rec?.abort();
    } catch {
      // already stopped
    }
    rec = makeRecognizer({
      onInterim,
      onFinal: () => {
        /* the engine tracks the running transcript via onInterim */
      },
      onEnd,
      onError: handleRecognizerError,
    });
    if (!rec) {
      emit("unavailable");
      handlers.onError("unsupported");
      return;
    }
    emit(mode === "command" ? "listening_for_command" : "listening_for_wake_word");
    rec.start();
  };

  const scheduleCommit = (delay: number) => {
    clearCommitTimer();
    commitTimer = setTimeout(() => {
      commitTimer = null;
      if (mode === "command" && !stopped && !paused) commit();
    }, delay);
  };

  const onInterim = (running: string) => {
    if (stopped || paused) return;
    const text = (running ?? "").trim();
    if (!text) return;

    // While Atlas is speaking, only an interruption phrase ("Atlas stop")
    // may wake — ordinary speech (including Atlas's own TTS) must not.
    if (interruptOnly) {
      if (INTERRUPT_ANYWHERE_RE.test(text)) {
        onInterrupt();
        lastWakeAt = now();
        lastWakeTranscript = text;
        restartFresh();
      }
      return;
    }

    if (mode === "wake") {
      const match = detectWakeWord(text);
      if (!match.detected) return;
      if (!shouldAcceptWake(text, { lastWakeAt, lastWakeTranscript }, now())) {
        return;
      }
      mode = "command";
      lastWakeAt = now();
      lastWakeTranscript = text;
      commandText = stripWakeWord(text);
      restartCount = 0;
      emit("wake_detected");
      onWake(text);
      emit("listening_for_command");
      scheduleCommit(commandText.trim() ? COMMIT_SILENCE_MS : ABANDON_WAIT_MS);
      return;
    }

    // Command mode: capture everything after the wake word. The recognizer
    // transcript is cumulative from its start, so stripping the leading wake
    // word each time yields exactly the command (works across pauses too).
    commandText = stripWakeWord(text);
    scheduleCommit(commandText.trim() ? COMMIT_SILENCE_MS : ABANDON_WAIT_MS);
  };

  const onEnd = () => {
    if (stopped || paused) return;
    if (mode === "command") commit();
    else scheduleRestart();
  };

  const handleRecognizerError = (code: string) => {
    if (code === "not-allowed" || code === "service-not-allowed") {
      clearCommitTimer();
      mode = "wake";
      commandText = "";
      emit("permission_required");
      handlers.onError(code);
      return;
    }
    if (mode === "command") {
      // Deliver whatever was captured before the failure, honestly.
      commit();
      return;
    }
    clearCommitTimer();
    if (code === "no-speech" || code === "aborted") {
      scheduleRestart();
      return;
    }
    emit("error");
    handlers.onError(code);
    scheduleRestart();
  };

  return {
    start: () => {
      if (!deps?.createRecognizer && !browserSpeechRecognitionSupported()) {
        emit("unavailable");
        handlers.onError("unsupported");
        return;
      }
      stopped = false;
      paused = false;
      mode = "wake";
      commandText = "";
      startRecognizer();
    },
    pause: () => {
      paused = true;
      clearCommitTimer();
      try {
        rec?.abort();
      } catch {
        // already stopped
      }
      rec = null;
      emit("paused");
    },
    resume: () => {
      if (stopped) return;
      paused = false;
      mode = "wake";
      commandText = "";
      restartFresh();
    },
    stop: () => {
      stopped = true;
      paused = false;
      clearCommitTimer();
      if (restartTimer !== null) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      try {
        rec?.abort();
      } catch {
        // already stopped
      }
      rec = null;
      mode = "wake";
      commandText = "";
    },
    setInterruptOnly: (value: boolean) => {
      interruptOnly = value;
    },
  };
}
