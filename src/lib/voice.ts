// ---------------------------------------------------------------------------
// Browser voice transport — Web Speech API (real provider, no API key needed).
//
// The server-side Convex voice actions (src/convex/voice.ts) take over STT/TTS
// when credentials are configured; otherwise the UI falls back to these
// browser-native providers and reports that honestly.
// ---------------------------------------------------------------------------

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
