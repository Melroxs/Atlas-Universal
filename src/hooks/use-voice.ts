import { api } from "@/convex/_generated/api";
import {
  browserSpeechRecognitionSupported,
  createSpeechRecognizer,
  createWakeWordEngine,
  playWakeChime,
  requestMicrophonePermission,
  speakText,
  stopBrowserSpeaking,
  type WakeWordEngine,
} from "@/lib/voice";
import { useAction, useQuery } from "convex/react";
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

export interface UseVoiceOptions {
  /** Called with the final transcript once the user finishes speaking (push-to-talk). */
  onTranscript: (text: string) => void;
  /** Called with an ambient wake-word command (auto-sent, no button). */
  onAmbientCommand?: (text: string) => void;
}

const AMBIENT_KEY = "atlas-ambient";

function storedAmbient(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(AMBIENT_KEY) === "on";
}

/**
 * One voice state machine used by both the Ask page and the global Atlas
 * assistant. Microphone → speech recognition → transcript → caller handles
 * orchestration → caller calls speak() to hear the response.
 *
 * Phase 11 adds AMBIENT mode: "Say 'Atlas' and Atlas is ready." A dedicated
 * wake-word engine listens locally (browser speech recognition) for the wake
 * word, then captures the command that follows. Atlas never claims to be
 * listening when the mic is not actually active, and never wakes itself
 * while speaking (suppression).
 */
export function useVoice({ onTranscript, onAmbientCommand }: UseVoiceOptions) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [wakeState, setWakeState] = useState<WakeState>("off");
  const [ambientEnabled, setAmbientEnabled] = useState<boolean>(storedAmbient);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const providerStatus = useQuery(api.voice.voiceProviderStatus);
  const synthesize = useAction(api.voice.synthesizeSpeech);

  const recognizerRef = useRef<ReturnType<typeof createSpeechRecognizer> | null>(null);
  const wakeEngineRef = useRef<WakeWordEngine | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const onAmbientCommandRef = useRef(onAmbientCommand);
  onAmbientCommandRef.current = onAmbientCommand;
  const statusRef = useRef<VoiceStatus>(status);
  statusRef.current = status;

  const supported = browserSpeechRecognitionSupported();

  const finishSpeaking = useCallback(() => {
    setStatus((s) => (s === "speaking" ? "idle" : s));
  }, []);

  const speakBrowser = useCallback(
    (text: string) => {
      setStatus("speaking");
      speakText(text, { onEnd: finishSpeaking });
    },
    [finishSpeaking],
  );

  /** Speak a response — server TTS when configured, browser otherwise. */
  const speak = useCallback(
    async (text: string) => {
      if (!text) return;
      stopBrowserSpeaking();
      const useServer = providerStatus?.tts === "server";
      if (useServer) {
        setStatus("speaking");
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
    [providerStatus, synthesize, speakBrowser, finishSpeaking],
  );

  const stopSpeaking = useCallback(() => {
    stopBrowserSpeaking();
    finishSpeaking();
  }, [finishSpeaking]);

  // ---------------------------------------------------------------------
  // Ambient wake-word mode
  // ---------------------------------------------------------------------

  /** Keep Atlas from hearing itself: suppress the wake word while busy. */
  useEffect(() => {
    const busy = status === "thinking" || status === "speaking" || status === "transcribing";
    if (busy) {
      wakeEngineRef.current?.pause();
    } else if (ambientEnabled && wakeState !== "off") {
      // Resume a beat after the busy window so a trailing word never wakes us.
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
        setTimeout(() => {
          setStatus((s) => (s === "interrupted" ? "idle" : s));
          setWakeState((s) => (s === "interrupted" ? "listening_for_wake_word" : s));
        }, 1100);
        return;
      }
      setWakeState("transcribing");
      onAmbientCommandRef.current?.(text);
    },
    [stopSpeaking],
  );

  const enableAmbient = useCallback(async () => {
    if (!supported) {
      setWakeState("unavailable");
      setError("Ambient voice needs a browser with speech recognition (Chrome, Edge, Safari).");
      return;
    }
    setWakeState("initializing");
    const ok = await requestMicrophonePermission();
    if (!ok) {
      setWakeState("permission_required");
      setStatus("permission_required");
      setError("Atlas voice requires microphone access. Allow the microphone in your browser and try again.");
      return;
    }
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
      onWake: () => {
        // The chime + state transition happen via onState; nothing else needed.
      },
      onCommand: (text) => {
        handleAmbientCommand(text.trim());
      },
      onError: (code) => {
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
  }, [supported, handleAmbientCommand]);

  const disableAmbient = useCallback(() => {
    wakeEngineRef.current?.stop();
    wakeEngineRef.current = null;
    setAmbientEnabled(false);
    setWakeState("off");
    try {
      localStorage.setItem(AMBIENT_KEY, "off");
    } catch {
      // best-effort
    }
    if (statusRef.current !== "speaking") setStatus("idle");
  }, []);

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
      recognizerRef.current?.abort();
      wakeEngineRef.current?.stop();
      stopBrowserSpeaking();
    };
  }, []);

  // ---------------------------------------------------------------------
  // Push-to-talk (unchanged behavior)
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
    setError(null);
    setInterim("");
    setStatus("listening");
    const rec = createSpeechRecognizer({
      onInterim: (t) => setInterim(t),
      onFinal: (text) => {
        const t = text.trim();
        if (t) {
          setStatus("transcribing");
          onTranscriptRef.current(t);
        }
      },
      onEnd: () => {
        setStatus((s) => (s === "transcribing" ? "thinking" : "idle"));
        setInterim("");
        recognizerRef.current = null;
      },
      onError: (code) => {
        recognizerRef.current = null;
        setInterim("");
        if (code === "not-allowed" || code === "service-not-allowed") {
          setStatus("permission_required");
          setError("Microphone access was denied. Allow the microphone in your browser and try again.");
        } else if (code === "no-speech" || code === "aborted") {
          setStatus("idle");
          setError(null);
        } else if (code === "start-failed") {
          setStatus("unavailable");
          setError("The microphone couldn't be started. Check your browser's microphone permission.");
        } else {
          setStatus("error");
          setError("Speech recognition failed. Please try again.");
        }
      },
    });
    if (rec) {
      recognizerRef.current = rec;
      rec.start();
    } else {
      setStatus("unavailable");
    }
  }, [supported]);

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
    providerStatus,
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
