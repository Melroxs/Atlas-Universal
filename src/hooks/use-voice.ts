import { api } from "@/lib/api";
import {
  browserSpeechRecognitionSupported,
  browserSpeechSynthesisSupported,
  createSpeechRecognizer,
  createWakeWordEngine,
  playWakeChime,
  requestMicrophonePermission,
  speakText,
  stopBrowserSpeaking,
  type WakeWordEngine,
} from "@/lib/voice";
import { useAction, useQuery } from "@/hooks/use-supabase";
import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceStatus =
  | "idle"
  | "unavailable"
  | "permission_required"
  | "listening"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "ambient_ready"
  | "listening_for_wake_word"
  | "wake_detected"
  | "listening_for_command"
  | "interrupted"
  | "paused"
  | "error";

export type WakeState =
  | "off"
  | "unavailable"
  | "permission_required"
  | "initializing"
  | "ambient_ready"
  | "listening_for_wake_word"
  | "wake_detected"
  | "listening_for_command"
  | "transcribing"
  | "interrupted"
  | "paused"
  | "error";

export interface VoiceLogEntry {
  ts: number;
  event: string;
  detail?: string;
}

export interface UseVoiceOptions {
  /** Called with the final transcript once the user finishes speaking (push-to-talk). */
  onTranscript: (text: string) => void;
  /** Called with an ambient wake-word command (auto-sent, no button). */
  onAmbientCommand?: (text: string) => void;
}

const AMBIENT_KEY = "atlas-ambient";
const LOG_LIMIT = 50;

function storedAmbient(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(AMBIENT_KEY) === "on";
}

/**
 * One voice state machine used by both the Ask page and the global Atlas
 * assistant. Microphone → speech recognition → transcript → caller handles
 * orchestration → caller calls speak() to hear the response.
 *
 * Phase 12 runtime fixes:
 * - The ambient engine uses ONE recognizer for wake + command (two concurrent
 *   recognizers were rejected by Chrome, so commands were never captured).
 * - Push-to-talk accumulates final segments and delivers ONCE when the
 *   utterance ends (the old recognizer re-delivered the accumulated text on
 *   every result event, duplicating transcripts).
 * - While Atlas is speaking the engine stays in interrupt-only mode so
 *   "Atlas stop" interrupts speech but ordinary speech (including Atlas's own
 *   TTS) can never wake it.
 * - A diagnostics event log is kept for the developer-visible Voice panel.
 */
export function useVoice({ onTranscript, onAmbientCommand }: UseVoiceOptions) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [wakeState, setWakeState] = useState<WakeState>("off");
  const [ambientEnabled, setAmbientEnabled] = useState<boolean>(storedAmbient);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [voiceEvents, setVoiceEvents] = useState<VoiceLogEntry[]>([]);
  const providerStatus = useQuery(api.voice.voiceProviderStatus);
  const synthesize = useAction(api.voice.synthesizeSpeech);

  const recognizerRef = useRef<ReturnType<typeof createSpeechRecognizer> | null>(null);
  const wakeEngineRef = useRef<WakeWordEngine | null>(null);
  /**
   * Safety net: after an ambient command is handed to the brain, Atlas pauses
   * the engine until it speaks. If the caller never speaks (auto-speak off,
   * error, long think), this timer returns the engine to wake listening so
   * ambient mode never silently dies.
   */
  const ambientRoundTripRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * True while Atlas is processing an ambient command or capturing a
   * push-to-talk utterance. While true, the transient-pause auto-resume in
   * the state effect is suppressed so the engine stays paused (one
   * SpeechRecognition at a time; Atlas never listens while processing).
   */
  const captureBusyRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const onAmbientCommandRef = useRef(onAmbientCommand);
  onAmbientCommandRef.current = onAmbientCommand;
  const statusRef = useRef<VoiceStatus>(status);
  statusRef.current = status;

  const supported = browserSpeechRecognitionSupported();
  const ttsSupported = browserSpeechSynthesisSupported();

  const logEvent = useCallback((event: string, detail?: string) => {
    setVoiceEvents((prev) => {
      const next = [...prev, { ts: Date.now(), event, detail }];
      return next.length > LOG_LIMIT ? next.slice(next.length - LOG_LIMIT) : next;
    });
  }, []);

  const finishSpeaking = useCallback(() => {
    setStatus((s) => (s === "speaking" ? "idle" : s));
    logEvent("tts-end");
  }, [logEvent]);

  const speakBrowser = useCallback(
    (text: string) => {
      setStatus("speaking");
      logEvent("tts-start", "browser");
      speakText(text, { onEnd: finishSpeaking });
    },
    [finishSpeaking, logEvent],
  );

  /** Speak a response — server TTS when configured, browser otherwise. */
  const speak = useCallback(
    async (text: string) => {
      if (!text) return;
      stopBrowserSpeaking();
      // The round-trip is done: release the capture hold and bring the engine
      // back so "Atlas stop" can interrupt while Atlas speaks. The state
      // effect switches it to interrupt-only once status becomes "speaking".
      captureBusyRef.current = false;
      wakeEngineRef.current?.resume();
      const useServer = providerStatus?.tts === "server";
      if (useServer) {
        setStatus("speaking");
        logEvent("tts-start", `server:${providerStatus?.ttsProvider ?? "unknown"}`);
        try {
          const res = await synthesize({ text });
          const audio = new Audio(`data:${res.mimeType};base64,${res.audioB64}`);
          audio.onended = finishSpeaking;
          audio.onerror = () => {
            finishSpeaking();
            speakBrowser(text);
          };
          await audio.play();
        } catch {
          finishSpeaking();
          speakBrowser(text);
        }
      } else {
        speakBrowser(text);
      }
    },
    [providerStatus, synthesize, speakBrowser, finishSpeaking, logEvent],
  );

  const stopSpeaking = useCallback(() => {
    stopBrowserSpeaking();
    finishSpeaking();
  }, [finishSpeaking]);

  // ---------------------------------------------------------------------
  // Ambient wake-word mode
  // ---------------------------------------------------------------------

  /**
   * State machine: pause the engine while the brain is working (no point
   * listening during thinking/transcribing), switch to interrupt-only while
   * speaking (so "Atlas stop" works), and resume listening otherwise. Atlas
   * never listens while it is processing, and never wakes itself.
   */
  useEffect(() => {
    const engine = wakeEngineRef.current;
    if (!engine || !ambientEnabled) return;
    if (status === "speaking") {
      engine.setInterruptOnly(true);
      return;
    }
    engine.setInterruptOnly(false);
    const busy = status === "thinking" || status === "transcribing";
    if (busy) {
      engine.pause();
    } else if (wakeState === "paused" || wakeState === "interrupted") {
      // Stay paused while a capture/round-trip is in flight; otherwise resume
      // a beat after the busy window so a trailing word never wakes us.
      if (captureBusyRef.current) return;
      const t = setTimeout(() => wakeEngineRef.current?.resume(), 400);
      return () => clearTimeout(t);
    }
  }, [status, ambientEnabled, wakeState]);

  const handleAmbientCommand = useCallback(
    (text: string) => {
      const low = text.toLowerCase();
      const interrupted =
        /^\s*(stop|wait|never mind|nevermind|quiet|cancel that|pause|hold on|be quiet)\b/.test(low) ||
        /\batlas[,.]?\s+(stop|wait|never mind|nevermind|quiet|cancel that|pause|hold on)\b/.test(low);
      if (interrupted) {
        stopSpeaking();
        setStatus("interrupted");
        setWakeState("interrupted");
        logEvent("voice-interrupt", text);
        setTimeout(() => {
          setStatus((s) => (s === "interrupted" ? "idle" : s));
          setWakeState((s) => (s === "interrupted" ? "listening_for_wake_word" : s));
        }, 1100);
        return;
      }
      setWakeState("transcribing");
      setStatus("transcribing");
      logEvent("command-captured", text);
      captureBusyRef.current = true;
      onAmbientCommandRef.current?.(text);
      // Guard: if Atlas doesn't speak (auto-speak off, error, or a very long
      // think), don't leave the engine paused forever — resume listening.
      if (ambientRoundTripRef.current !== null) {
        clearTimeout(ambientRoundTripRef.current);
      }
      ambientRoundTripRef.current = setTimeout(() => {
        ambientRoundTripRef.current = null;
        captureBusyRef.current = false;
        wakeEngineRef.current?.resume();
        setStatus((s) => (s === "transcribing" ? "idle" : s));
        setWakeState((s) => (s === "transcribing" ? "listening_for_wake_word" : s));
      }, 15_000);
    },
    [stopSpeaking, logEvent],
  );

  const enableAmbient = useCallback(async () => {
    if (!supported) {
      setWakeState("unavailable");
      setError("Ambient voice needs a browser with speech recognition (Chrome, Edge, Safari).");
      logEvent("ambient-unavailable");
      return;
    }
    setWakeState("initializing");
    logEvent("mic-permission-request");
    const ok = await requestMicrophonePermission();
    if (!ok) {
      setWakeState("permission_required");
      setStatus("permission_required");
      setError("Atlas voice requires microphone access. Allow the microphone in your browser and try again.");
      logEvent("mic-permission-denied");
      return;
    }
    logEvent("mic-permission-granted");
    setError(null);
    setAmbientEnabled(true);
    try {
      localStorage.setItem(AMBIENT_KEY, "on");
    } catch {
      // persistence is best-effort
    }
    const engine = createWakeWordEngine({
      onState: (state) => {
        setWakeState(state as WakeState);
        logEvent("engine-state", state);
        if (state === "listening_for_wake_word") {
          setStatus("listening_for_wake_word");
          setError(null);
        } else if (state === "wake_detected") {
          setStatus("wake_detected");
          playWakeChime();
        } else if (state === "listening_for_command") {
          setStatus("listening_for_command");
        } else if (state === "paused") {
          setStatus("paused");
        } else if (state === "permission_required") {
          setStatus("permission_required");
          setWakeState("permission_required");
          setError("Microphone access was denied. Allow the microphone in your browser.");
        } else if (state === "error" || state === "unavailable") {
          setStatus(state === "unavailable" ? "unavailable" : "error");
          setWakeState(state);
        }
      },
      onWake: (transcript) => {
        logEvent("wake-word-detected", transcript);
      },
      onCommand: (text) => {
        handleAmbientCommand(text.trim());
      },
      onInterrupt: () => {
        logEvent("voice-interrupt", "engine");
        stopSpeaking();
        setStatus("interrupted");
        setWakeState("interrupted");
        setTimeout(() => {
          setStatus((s) => (s === "interrupted" ? "idle" : s));
          setWakeState((s) => (s === "interrupted" ? "listening_for_wake_word" : s));
        }, 1100);
      },
      onError: (code) => {
        logEvent("engine-error", code);
        if (code === "unsupported") {
          setWakeState("unavailable");
          setStatus("unavailable");
        } else if (code === "not-allowed" || code === "service-not-allowed") {
          setWakeState("permission_required");
          setStatus("permission_required");
          setError("Microphone access was denied. Allow the microphone in your browser and try again.");
        }
      },
    });
    wakeEngineRef.current = engine;
    engine.start();
  }, [supported, handleAmbientCommand, stopSpeaking, logEvent]);

  const disableAmbient = useCallback(() => {
    if (ambientRoundTripRef.current !== null) {
      clearTimeout(ambientRoundTripRef.current);
      ambientRoundTripRef.current = null;
    }
    captureBusyRef.current = false;
    wakeEngineRef.current?.stop();
    wakeEngineRef.current = null;
    setAmbientEnabled(false);
    setWakeState("off");
    logEvent("ambient-disabled");
    try {
      localStorage.setItem(AMBIENT_KEY, "off");
    } catch {
      // best-effort
    }
    if (statusRef.current !== "speaking") setStatus("idle");
  }, [logEvent]);

  const toggleAmbient = useCallback(() => {
    if (ambientEnabled) {
      disableAmbient();
    } else {
      void enableAmbient();
    }
  }, [ambientEnabled, disableAmbient, enableAmbient]);

  // Sync the persisted preference on mount (ambient only starts on explicit
  // enable to honor the “no surprise mic access” rule).
  useEffect(() => {
    if (ambientEnabled && !wakeEngineRef.current && supported) {
      void enableAmbient();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clean up on unmount — never leave the mic or audio running.
  useEffect(() => {
    return () => {
      if (ambientRoundTripRef.current !== null) {
        clearTimeout(ambientRoundTripRef.current);
        ambientRoundTripRef.current = null;
      }
      captureBusyRef.current = false;
      recognizerRef.current?.abort();
      wakeEngineRef.current?.stop();
      stopBrowserSpeaking();
    };
  }, []);

  // ---------------------------------------------------------------------
  // Push-to-talk
  // ---------------------------------------------------------------------

  const stop = useCallback(() => {
    const rec = recognizerRef.current;
    if (rec) {
      rec.stop();
    } else {
      setStatus("idle");
    }
  }, []);

  const start = useCallback(() => {
    if (!supported) {
      setStatus("unavailable");
      setError("Voice input isn't supported in this browser. You can still type to Atlas.");
      return;
    }
    // Interrupt any in-flight playback before capturing (no overlapping audio).
    stopBrowserSpeaking();
    // Pause ambient listening while capturing PTT — the browser allows only
    // one active SpeechRecognition, so a running ambient engine would make
    // this recognizer throw InvalidStateError and the capture would fail.
    captureBusyRef.current = true;
    wakeEngineRef.current?.pause();
    setError(null);
    setInterim("");
    setStatus("listening");
    logEvent("ptt-start");

    // Accumulate final segments; deliver the joined transcript exactly once
    // when the utterance ends (stop() or the browser ending the session).
    let segments: string[] = [];
    let delivered = false;
    /** PTT capture ended — release the capture hold so ambient can resume. */
    const endCapture = () => {
      captureBusyRef.current = false;
      wakeEngineRef.current?.resume();
    };
    const commit = (via: string) => {
      if (delivered) return;
      delivered = true;
      recognizerRef.current = null;
      endCapture();
      const text = segments.join(" ").trim();
      setInterim("");
      if (text) {
        setStatus("transcribing");
        logEvent("transcript-received", via);
        onTranscriptRef.current(text);
      } else {
        setStatus((s) => (s === "listening" ? "idle" : s));
      }
    };

    const rec = createSpeechRecognizer(
      {
        onInterim: (t) => setInterim(t),
        onFinal: (segment) => {
          segments.push(segment);
        },
        onEnd: () => commit("end"),
        onError: (code) => {
          if (code === "not-allowed" || code === "service-not-allowed") {
            recognizerRef.current = null;
            endCapture();
            setStatus("permission_required");
            setError("Microphone access was denied. Allow the microphone in your browser and try again.");
            logEvent("ptt-error", code);
          } else if (code === "no-speech" || code === "aborted") {
            recognizerRef.current = null;
            endCapture();
            setStatus((s) => (s === "listening" ? "idle" : s));
            setError(null);
            logEvent("ptt-error", code);
          } else if (code === "start-failed") {
            recognizerRef.current = null;
            endCapture();
            setStatus("unavailable");
            setError("The microphone couldn't be started. Check your browser's microphone permission.");
            logEvent("ptt-error", code);
          } else {
            // Unknown error: deliver what was captured, then surface honestly.
            const t = segments.join(" ").trim();
            recognizerRef.current = null;
            endCapture();
            if (t) {
              setStatus("transcribing");
              logEvent("transcript-received", `error:${code}`);
              onTranscriptRef.current(t);
            } else {
              setStatus("error");
              setError("Speech recognition failed. Please try again.");
              logEvent("ptt-error", code);
            }
          }
        },
      },
      undefined,
      { continuous: false },
    );
    if (rec) {
      recognizerRef.current = rec;
      rec.start();
    } else {
      // No recognizer was created — release the capture hold so any paused
      // ambient engine returns to wake listening instead of silently dying.
      endCapture();
      setStatus("unavailable");
    }
  }, [supported, logEvent]);

  const toggle = useCallback(() => {
    if (status === "listening" || status === "transcribing") {
      stop();
    } else {
      void start();
    }
  }, [status, start, stop]);

  return {
    status,
    wakeState,
    ambientEnabled,
    ambientSupported: supported,
    interim,
    error,
    supported,
    ttsSupported,
    providerStatus,
    voiceEvents,
    start,
    stop,
    toggle,
    speak,
    stopSpeaking,
    enableAmbient,
    disableAmbient,
    toggleAmbient,
  };
}
