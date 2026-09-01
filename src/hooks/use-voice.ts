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
import {
  initVoiceRuntime,
  getVoiceRuntimeStatus,
  processVoiceTranscript,
  initVoiceBridge,
  initSafetyGate,
} from "@/lib/voice-runtime";
import { useVoiceSession } from "@/components/voice-session";
import { useAction, useQuery } from "@/hooks/use-supabase";
import { api } from "@/lib/api";
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
  onTranscript: (text: string) => void;
  onAmbientCommand?: (text: string) => void;
  entityContext?: string;
  pageContext?: string;
}

const AMBIENT_KEY = "atlas-ambient";
const LOG_LIMIT = 50;

function storedAmbient(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(AMBIENT_KEY) === "on";
}

/**
 * Voice state machine for the Ask page and global Atlas assistant.
 *
 * IMPORTANT: All hooks are declared unconditionally before any conditional
 * early return to satisfy React's Rules of Hooks (fixes React error #310).
 * The `isShared` flag determines the return value, not which hooks are called.
 */
export function useVoice({ onTranscript, onAmbientCommand, entityContext, pageContext }: UseVoiceOptions) {
  const session = useVoiceSession();
  const isShared = session.ambientSupported || session.status !== "idle" || session.ambientEnabled;

  // Refs for callbacks (used by both shared and local paths)
  const onAmbientCommandRef = useRef(onAmbientCommand);
  onAmbientCommandRef.current = onAmbientCommand;
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  // Voice Runtime initialization
  const voiceRuntimeReadyRef = useRef(false);
  useEffect(() => {
    if (!voiceRuntimeReadyRef.current) {
      void initVoiceRuntime().then(() => {
        voiceRuntimeReadyRef.current = true;
      }).catch(() => {});
      initSafetyGate();
      initVoiceBridge({ defaultEntityContext: entityContext, defaultPageContext: pageContext });
    }
  }, [entityContext, pageContext]);

  const voiceRuntimeStatus = voiceRuntimeReadyRef.current ? getVoiceRuntimeStatus() : null;

  // =========================================================================
  // LOCAL FALLBACK STATE — all hooks declared unconditionally (Rules of Hooks)
  // In shared mode these still run but the conditional return below picks
  // session values instead.
  // =========================================================================

  const [localStatus, setLocalStatus] = useState<VoiceStatus>("idle");
  const [localWakeState, setLocalWakeState] = useState<WakeState>("off");
  const [localAmbientEnabled, setLocalAmbientEnabled] = useState<boolean>(storedAmbient);
  const [localInterim, setLocalInterim] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [voiceEvents, setVoiceEvents] = useState<VoiceLogEntry[]>([]);
  const providerStatus = useQuery(api.voice.voiceProviderStatus);
  const synthesize = useAction(api.voice.synthesizeSpeech);

  const recognizerRef = useRef<ReturnType<typeof createSpeechRecognizer> | null>(null);
  const wakeEngineRef = useRef<WakeWordEngine | null>(null);
  const ambientRoundTripRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captureBusyRef = useRef(false);
  const statusRef = useRef<VoiceStatus>(localStatus);
  statusRef.current = localStatus;

  const supported = browserSpeechRecognitionSupported();
  const ttsSupported = browserSpeechSynthesisSupported();

  const logEvent = useCallback((event: string, detail?: string) => {
    setVoiceEvents((prev) => {
      const next = [...prev, { ts: Date.now(), event, detail }];
      return next.length > LOG_LIMIT ? next.slice(next.length - LOG_LIMIT) : next;
    });
  }, []);

  const pushDiagnostic = useCallback(
    (event: string, detail?: string) => logEvent(event, detail),
    [logEvent],
  );

  const localFinishSpeaking = useCallback(() => {
    setLocalStatus((s) => (s === "speaking" ? "idle" : s));
    logEvent("tts-end");
  }, [logEvent]);

  const speakBrowser = useCallback(
    (text: string) => {
      setLocalStatus("speaking");
      logEvent("tts-start", "browser");
      speakText(text, { onEnd: localFinishSpeaking });
    },
    [localFinishSpeaking, logEvent],
  );

  const localSpeak = useCallback(
    async (text: string) => {
      if (!text) return;
      stopBrowserSpeaking();
      captureBusyRef.current = false;
      wakeEngineRef.current?.resume();
      const useServer = providerStatus?.tts === "server";
      if (useServer) {
        setLocalStatus("speaking");
        logEvent("tts-start", `server:${providerStatus?.ttsProvider ?? "unknown"}`);
        try {
          const res = await synthesize({ text });
          const audio = new Audio(`data:${res.mimeType};base64,${res.audioB64}`);
          audio.onended = localFinishSpeaking;
          audio.onerror = () => { localFinishSpeaking(); speakBrowser(text); };
          await audio.play();
        } catch {
          localFinishSpeaking();
          speakBrowser(text);
        }
      } else {
        speakBrowser(text);
      }
    },
    [providerStatus, synthesize, speakBrowser, localFinishSpeaking, logEvent],
  );

  const localStopSpeaking = useCallback(() => {
    stopBrowserSpeaking();
    localFinishSpeaking();
  }, [localFinishSpeaking]);

  const handleAmbientCommand = useCallback(
    (text: string) => {
      const low = text.toLowerCase();
      const interrupted =
        /^\s*(stop|wait|never mind|nevermind|quiet|cancel that|pause|hold on|be quiet)\b/.test(low) ||
        /\batlas[,.]?\s+(stop|wait|never mind|nevermind|quiet|cancel that|pause|hold on)\b/.test(low);
      if (interrupted) {
        localStopSpeaking();
        setLocalStatus("interrupted");
        setLocalWakeState("interrupted");
        logEvent("voice-interrupt", text);
        setTimeout(() => {
          setLocalStatus((s) => (s === "interrupted" ? "idle" : s));
          setLocalWakeState((s) => (s === "interrupted" ? "listening_for_wake_word" : s));
        }, 1100);
        return;
      }
      setLocalWakeState("transcribing");
      setLocalStatus("transcribing");
      logEvent("command-captured", text);
      captureBusyRef.current = true;
      onAmbientCommandRef.current?.(text);
      if (ambientRoundTripRef.current !== null) clearTimeout(ambientRoundTripRef.current);
      ambientRoundTripRef.current = setTimeout(() => {
        ambientRoundTripRef.current = null;
        captureBusyRef.current = false;
        wakeEngineRef.current?.resume();
        setLocalStatus((s) => (s === "transcribing" ? "idle" : s));
        setLocalWakeState((s) => (s === "transcribing" ? "listening_for_wake_word" : s));
      }, 15_000);
    },
    [localStopSpeaking, logEvent],
  );

  const enableAmbient = useCallback(async () => {
    if (!supported) {
      setLocalWakeState("unavailable");
      setLocalError("Ambient voice needs a browser with speech recognition (Chrome, Edge, Safari).");
      logEvent("ambient-unavailable");
      return;
    }
    setLocalWakeState("initializing");
    logEvent("mic-permission-request");
    const ok = await requestMicrophonePermission();
    if (!ok) {
      setLocalWakeState("permission_required");
      setLocalStatus("permission_required");
      setLocalError("Atlas voice requires microphone access. Allow the microphone in your browser and try again.");
      logEvent("mic-permission-denied");
      return;
    }
    logEvent("mic-permission-granted");
    setLocalError(null);
    setLocalAmbientEnabled(true);
    try { localStorage.setItem(AMBIENT_KEY, "on"); } catch {}
    const engine = createWakeWordEngine({
      onState: (state) => {
        setLocalWakeState(state as WakeState);
        logEvent("engine-state", state);
        if (state === "listening_for_wake_word") { setLocalStatus("listening_for_wake_word"); setLocalError(null); }
        else if (state === "wake_detected") { setLocalStatus("wake_detected"); playWakeChime(); }
        else if (state === "listening_for_command") { setLocalStatus("listening_for_command"); }
        else if (state === "paused") { setLocalStatus("paused"); }
        else if (state === "permission_required") { setLocalStatus("permission_required"); setLocalWakeState("permission_required"); setLocalError("Microphone access was denied. Allow the microphone in your browser."); }
        else if (state === "error" || state === "unavailable") { setLocalStatus(state === "unavailable" ? "unavailable" : "error"); setLocalWakeState(state); }
      },
      onWake: (transcript) => { logEvent("wake-word-detected", transcript); },
      onCommand: (text) => { handleAmbientCommand(text.trim()); },
      onInterrupt: () => {
        logEvent("voice-interrupt", "engine");
        localStopSpeaking();
        setLocalStatus("interrupted");
        setLocalWakeState("interrupted");
        setTimeout(() => { setLocalStatus((s) => (s === "interrupted" ? "idle" : s)); setLocalWakeState((s) => (s === "interrupted" ? "listening_for_wake_word" : s)); }, 1100);
      },
      onError: (code) => {
        logEvent("engine-error", code);
        if (code === "unsupported") { setLocalWakeState("unavailable"); setLocalStatus("unavailable"); }
        else if (code === "not-allowed" || code === "service-not-allowed") { setLocalWakeState("permission_required"); setLocalStatus("permission_required"); setLocalError("Microphone access was denied. Allow the microphone in your browser and try again."); }
      },
    });
    wakeEngineRef.current = engine;
    engine.start();
  }, [supported, handleAmbientCommand, localStopSpeaking, logEvent]);

  const disableAmbient = useCallback(() => {
    if (ambientRoundTripRef.current !== null) { clearTimeout(ambientRoundTripRef.current); ambientRoundTripRef.current = null; }
    captureBusyRef.current = false;
    wakeEngineRef.current?.stop();
    wakeEngineRef.current = null;
    setLocalAmbientEnabled(false);
    setLocalWakeState("off");
    logEvent("ambient-disabled");
    try { localStorage.setItem(AMBIENT_KEY, "off"); } catch {}
    if (statusRef.current !== "speaking") setLocalStatus("idle");
  }, [logEvent]);

  const localToggleAmbient = useCallback(() => {
    if (localAmbientEnabled) disableAmbient();
    else void enableAmbient();
  }, [localAmbientEnabled, disableAmbient, enableAmbient]);

  // Ambient state machine (guarded: only runs in local mode)
  useEffect(() => {
    if (isShared) return;
    const engine = wakeEngineRef.current;
    if (!engine || !localAmbientEnabled) return;
    if (localStatus === "speaking") { engine.setInterruptOnly(true); return; }
    engine.setInterruptOnly(false);
    const busy = localStatus === "thinking" || localStatus === "transcribing";
    if (busy) {
      engine.pause();
    } else if (localWakeState === "paused" || localWakeState === "interrupted") {
      if (captureBusyRef.current) return;
      const t = setTimeout(() => wakeEngineRef.current?.resume(), 400);
      return () => clearTimeout(t);
    }
  }, [isShared, localStatus, localAmbientEnabled, localWakeState]);

  // Sync persisted ambient preference on mount (guarded: only in local mode)
  useEffect(() => {
    if (isShared) return;
    if (localAmbientEnabled && !wakeEngineRef.current && supported) {
      void enableAmbient();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (ambientRoundTripRef.current !== null) { clearTimeout(ambientRoundTripRef.current); ambientRoundTripRef.current = null; }
      captureBusyRef.current = false;
      recognizerRef.current?.abort();
      wakeEngineRef.current?.stop();
      stopBrowserSpeaking();
    };
  }, []);

  // Push-to-talk
  const localStop = useCallback(() => {
    const rec = recognizerRef.current;
    if (rec) rec.stop();
    else setLocalStatus("idle");
  }, []);

  const localStart = useCallback(() => {
    if (!supported) { setLocalStatus("unavailable"); setLocalError("Voice input isn't supported in this browser. You can still type to Atlas."); return; }
    stopBrowserSpeaking();
    captureBusyRef.current = true;
    wakeEngineRef.current?.pause();
    setLocalError(null);
    setLocalInterim("");
    setLocalStatus("listening");
    logEvent("ptt-start");
    let segments: string[] = [];
    let delivered = false;
    const endCapture = () => { captureBusyRef.current = false; wakeEngineRef.current?.resume(); };
    const commit = (via: string) => {
      if (delivered) return;
      delivered = true;
      recognizerRef.current = null;
      endCapture();
      const text = segments.join(" ").trim();
      setLocalInterim("");
      if (text) { setLocalStatus("transcribing"); logEvent("transcript-received", via); onTranscriptRef.current(text); }
      else { setLocalStatus((s) => (s === "listening" ? "idle" : s)); }
    };
    const rec = createSpeechRecognizer({
      onInterim: (t) => setLocalInterim(t),
      onFinal: (segment) => { segments.push(segment); },
      onEnd: () => commit("end"),
      onError: (code) => {
        if (code === "not-allowed" || code === "service-not-allowed") { recognizerRef.current = null; endCapture(); setLocalStatus("permission_required"); setLocalError("Microphone access was denied. Allow the microphone in your browser and try again."); logEvent("ptt-error", code); }
        else if (code === "no-speech" || code === "aborted") { recognizerRef.current = null; endCapture(); setLocalStatus((s) => (s === "listening" ? "idle" : s)); setLocalError(null); logEvent("ptt-error", code); }
        else if (code === "start-failed") { recognizerRef.current = null; endCapture(); setLocalStatus("unavailable"); setLocalError("The microphone couldn't be started. Check your browser's microphone permission."); logEvent("ptt-error", code); }
        else {
          const t = segments.join(" ").trim();
          recognizerRef.current = null; endCapture();
          if (t) { setLocalStatus("transcribing"); logEvent("transcript-received", `error:${code}`); onTranscriptRef.current(t); }
          else { setLocalStatus("error"); setLocalError("Speech recognition failed. Please try again."); logEvent("ptt-error", code); }
        }
      },
    }, undefined, { continuous: false });
    if (rec) { recognizerRef.current = rec; rec.start(); }
    else { endCapture(); setLocalStatus("unavailable"); }
  }, [supported, logEvent]);

  const localToggle = useCallback(() => {
    if (localStatus === "listening" || localStatus === "transcribing") localStop();
    else void localStart();
  }, [localStatus, localStart, localStop]);

  // =========================================================================
  // RETURN — shared mode delegates to session, local mode uses local state
  // All hooks above are called unconditionally on every render.
  // =========================================================================

  if (isShared) {
    return {
      status: session.status as VoiceStatus,
      wakeState: session.wakeState as WakeState,
      ambientEnabled: session.ambientEnabled,
      ambientSupported: session.ambientSupported,
      supported: session.supported,
      ttsSupported: session.ttsSupported,
      interim: session.interim,
      error: session.error,
      voiceEvents: [] as VoiceLogEntry[],
      pushDiagnostic: () => {},
      start: session.togglePtt,
      stop: session.togglePtt,
      toggle: session.togglePtt,
      speak: session.speak,
      stopSpeaking: session.stopSpeaking,
      enableAmbient: session.enableAmbient,
      disableAmbient: session.disableAmbient,
      toggleAmbient: session.toggleAmbient,
      voiceRuntimeStatus,
      processVoiceTranscript,
    };
  }

  return {
    status: localStatus,
    wakeState: localWakeState,
    ambientEnabled: localAmbientEnabled,
    ambientSupported: supported,
    interim: localInterim,
    error: localError,
    supported,
    ttsSupported,
    providerStatus,
    voiceEvents,
    pushDiagnostic,
    start: localStart,
    stop: localStop,
    toggle: localToggle,
    speak: localSpeak,
    stopSpeaking: localStopSpeaking,
    enableAmbient,
    disableAmbient,
    toggleAmbient: localToggleAmbient,
    voiceRuntimeStatus,
    processVoiceTranscript,
  };
}
