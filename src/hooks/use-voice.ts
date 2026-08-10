import { api } from "@/convex/_generated/api";
import {
  browserSpeechRecognitionSupported,
  createSpeechRecognizer,
  speakText,
  stopBrowserSpeaking,
} from "@/lib/voice";
import { useAction, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceStatus =
  | "idle"
  | "unavailable"
  | "listening"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "error";

export interface UseVoiceOptions {
  /** Called with the final transcript once the user finishes speaking. */
  onTranscript: (text: string) => void;
}

/**
 * One voice state machine used by both the Ask page and the global Atlas
 * assistant. Microphone → speech recognition → transcript → caller handles
 * orchestration → caller calls speak() to hear the response.
 *
 * TTS prefers the server provider when configured (VOICE_TTS_API_KEY), else
 * falls back to browser speech synthesis — both are real providers, and the
 * UI reports the active one honestly.
 */
export function useVoice({ onTranscript }: UseVoiceOptions) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const providerStatus = useQuery(api.voice.voiceProviderStatus);
  const synthesize = useAction(api.voice.synthesizeSpeech);

  const recognizerRef = useRef<ReturnType<typeof createSpeechRecognizer> | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

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
          setStatus("error");
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

  // Clean up on unmount — never leave the mic or audio running.
  useEffect(() => {
    return () => {
      recognizerRef.current?.abort();
      stopBrowserSpeaking();
    };
  }, []);

  return {
    status,
    interim,
    error,
    supported,
    providerStatus,
    start,
    stop,
    toggle,
    speak,
    stopSpeaking,
  };
}
