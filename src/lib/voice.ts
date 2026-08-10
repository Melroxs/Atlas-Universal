// ---------------------------------------------------------------------------
// Browser voice transport — Web Speech API (real provider, no API key needed).
//
// The server-side Convex voice actions (src/convex/voice.ts) take over STT/TTS
// when credentials are configured; otherwise the UI falls back to these
// browser-native providers and reports that honestly.
// ---------------------------------------------------------------------------

import { detectWakeWord } from "./wake-word";

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
  /** Called with the running final transcript as it accumulates. */
  onFinal: (text: string) => void;
  /** Called with interim (uncommitted) transcript for live display. */
  onInterim: (text: string) => void;
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

/**
 * Create a continuous speech recognizer. Returns null when the browser does
 * not support speech recognition (honest — the UI shows an unavailable state).
 */
export function createSpeechRecognizer(handlers: RecognizerHandlers): Recognizer | null {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = "en-US";

  let finalText = "";

  rec.onresult = (event: unknown) => {
    const evt = event as {
      resultIndex: number;
      results: ArrayLike<{ isFinal: boolean; [index: number]: { transcript: string } }>;
    };
    let interim = "";
    for (let i = evt.resultIndex; i < evt.results.length; i++) {
      const res = evt.results[i];
      if (res.isFinal) finalText += res[0].transcript;
      else interim += res[0].transcript;
    }
    handlers.onInterim(interim || finalText);
    if (finalText.trim()) handlers.onFinal(finalText.trim());
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

/**
 * Speak text using the browser's speech synthesis. Returns false when
 * synthesis is unavailable so callers can fall back to a written response.
 */
export function speakText(
  text: string,
  opts?: { onEnd?: () => void },
): boolean {
  if (!browserSpeechSynthesisSupported()) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.05;
  utterance.pitch = 1;
  const voices = synth.getVoices();
  const preferred =
    voices.find((v) => v.lang.startsWith("en") && /google|natural|premium/i.test(v.name)) ??
    voices.find((v) => v.lang.startsWith("en"));
  if (preferred) utterance.voice = preferred;
  if (opts?.onEnd) {
    utterance.onend = () => opts.onEnd?.();
    utterance.onerror = () => opts.onEnd?.();
  }
  synth.speak(utterance);
  return true;
}

/** Stop any browser speech synthesis immediately (interruption). */
export function stopBrowserSpeaking(): void {
  if (browserSpeechSynthesisSupported()) {
    window.speechSynthesis.cancel();
  }
}

// ---------------------------------------------------------------------------
// Phase 11 — Ambient wake-word engine
//
// A continuous recognizer watches for the wake word (browser-native
// transport, honest about device limits). On detection it hands off to a
// fresh command recognizer. Cooldown + duplicate suppression live here;
// suppression-while-speaking lives in the hook (it calls pause/resume).
// ---------------------------------------------------------------------------

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

/** Short confirmation tone for wake detection (optional, subtle). */
export function playWakeChime(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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

export interface WakeWordEngineHandlers {
  /** Wake-word state transitions: listening_for_wake_word | wake_detected |
   *  listening_for_command | paused | error | unavailable. */
  onState: (state: string) => void;
  /** Wake word detected (transcript at detection time). */
  onWake: (transcript: string) => void;
  /** Final command transcript captured after the wake word. */
  onCommand: (text: string) => void;
  /** Normalized error code from the underlying recognizer. */
  onError: (code: string) => void;
}

export interface WakeWordEngine {
  start: () => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
}

/**
 * The ambient wake-word loop. Uses the same browser recognizer transport as
 * push-to-talk — no remote audio, no fake states. Call start() after the mic
 * permission is granted; call pause() while Atlas is speaking/thinking so the
 * wake word is suppressed during its own output.
 */
export function createWakeWordEngine(handlers: WakeWordEngineHandlers): WakeWordEngine {
  let wakeRec: ReturnType<typeof createSpeechRecognizer> | null = null;
  let cmdRec: ReturnType<typeof createSpeechRecognizer> | null = null;
  let stopped = false;
  let paused = false;
  let lastWakeAt = 0;
  let lastWakeTranscript = "";

  const emit = (state: string) => handlers.onState(state);

  const stopCmdRec = () => {
    try {
      cmdRec?.abort();
    } catch {
      // already stopped
    }
    cmdRec = null;
  };

  const startCommandCapture = (wakeTranscript: string) => {
    stopCmdRec();
    emit("wake_detected");
    const transcript = wakeTranscript.trim();
    if (transcript) {
      lastWakeAt = Date.now();
      lastWakeTranscript = transcript;
    }
    // Small pause so the wake word itself isn't captured as the command.
    setTimeout(() => {
      if (stopped || paused) return;
      emit("listening_for_command");
      cmdRec = createSpeechRecognizer({
        onInterim: () => {
          /* command interim is not shown by default */
        },
        onFinal: (text) => {
          const t = text.trim();
          if (!t) return;
          stopCmdRec();
          handlers.onCommand(t);
        },
        onEnd: () => {
          cmdRec = null;
          if (!stopped && !paused) {
            startWakeListening();
          }
        },
        onError: (code) => {
          cmdRec = null;
          if (code === "not-allowed" || code === "service-not-allowed") {
            handlers.onError(code);
            emit("permission_required");
            return;
          }
          if (!stopped && !paused) startWakeListening();
        },
      });
      cmdRec?.start();
    }, 260);
  };

  const startWakeListening = () => {
    if (stopped || paused) return;
    if (cmdRec) stopCmdRec();
    wakeRec = createSpeechRecognizer({
      onInterim: (text) => {
        if (paused || stopped) return;
        const match = detectWake(text);
        if (match) startCommandCapture(text);
      },
      onFinal: (text) => {
        if (paused || stopped) return;
        const match = detectWake(text);
        if (match) startCommandCapture(text);
      },
      onEnd: () => {
        wakeRec = null;
        if (!stopped && !paused) startWakeListening();
      },
      onError: (code) => {
        wakeRec = null;
        if (code === "not-allowed" || code === "service-not-allowed") {
          handlers.onError(code);
          emit("permission_required");
          return;
        }
        if (code === "no-speech" || code === "aborted") {
          if (!stopped && !paused) startWakeListening();
          return;
        }
        emit("error");
        handlers.onError(code);
      },
    });
    wakeRec?.start();
    emit("listening_for_wake_word");
  };

  const detectWake = (text: string): boolean => {
    const match = detectWakeWord(text);
    if (!match.detected) return false;
    const now = Date.now();
    if (now - lastWakeAt < 2500) return false;
    if (lastWakeTranscript === text.trim()) return false;
    return true;
  };

  return {
    start: () => {
      if (!browserSpeechRecognitionSupported()) {
        handlers.onError("unsupported");
        emit("unavailable");
        return;
      }
      stopped = false;
      paused = false;
      startWakeListening();
    },
    pause: () => {
      paused = true;
      stopCmdRec();
      try {
        wakeRec?.abort();
      } catch {
        // already stopped
      }
      wakeRec = null;
      emit("paused");
    },
    resume: () => {
      paused = false;
      if (stopped) return;
      startWakeListening();
    },
    stop: () => {
      stopped = true;
      paused = false;
      stopCmdRec();
      try {
        wakeRec?.abort();
      } catch {
        // already stopped
      }
      wakeRec = null;
    },
  };
}
