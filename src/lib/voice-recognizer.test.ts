// ---------------------------------------------------------------------------
// Phase 12 — Speech recognizer + synthesis transport tests.
//
// createSpeechRecognizer previously called onFinal with the whole accumulated
// buffer on EVERY result event, which made the wake engine re-chime and PTT
// deliver duplicate transcripts. These tests pin the new semantics: onFinal
// fires once per NEWLY finalized segment; onInterim carries the full running
// text. speakText defers the actual speak() past cancel() (Chrome drops
// same-tick utterances) — that deferral is what makes Atlas audibly respond.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSpeechRecognizer,
  speakText,
  stopBrowserSpeaking,
} from "./voice";

/** Minimal fake SpeechRecognition implementation. */
class FakeSpeechRecognition {
  continuous = true;
  interimResults = true;
  lang = "en-US";
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  start() {}
  stop() {}
  abort() {}
}

function fireResult(
  rec: FakeSpeechRecognition,
  resultIndex: number,
  results: Array<{ transcript: string; isFinal: boolean }>,
) {
  rec.onresult?.({
    resultIndex,
    results: results.map((r) => ({ isFinal: r.isFinal, 0: { transcript: r.transcript } })),
  });
}

describe("createSpeechRecognizer", () => {
  it("fires onFinal once per newly finalized segment (not on every result)", () => {
    const finals: string[] = [];
    const interims: string[] = [];
    const rec = new FakeSpeechRecognition();
    createSpeechRecognizer(
      {
        onFinal: (s) => finals.push(s),
        onInterim: (t) => interims.push(t),
        onEnd: () => {},
        onError: () => {},
      },
      FakeSpeechRecognition as unknown as typeof rec.constructor,
    );
    // First result: interim only.
    fireResult(rec, 0, [{ transcript: "Atlas what", isFinal: false }]);
    expect(finals).toHaveLength(0);
    expect(interims[interims.length - 1]).toContain("Atlas what");
    // Second result: first segment finalizes, next is interim.
    fireResult(rec, 0, [
      { transcript: "Atlas what", isFinal: true },
      { transcript: "is happening", isFinal: false },
    ]);
    expect(finals).toEqual(["Atlas what"]);
    expect(interims[interims.length - 1]).toContain("Atlas what");
    expect(interims[interims.length - 1]).toContain("is happening");
    // Third result: repeated delivery of the same final must NOT re-fire.
    fireResult(rec, 0, [
      { transcript: "Atlas what", isFinal: true },
      { transcript: "is happening", isFinal: false },
    ]);
    expect(finals).toEqual(["Atlas what"]);
    // Fourth: a genuinely new final segment.
    fireResult(rec, 1, [{ transcript: "is happening", isFinal: true }]);
    expect(finals).toEqual(["Atlas what", "is happening"]);
  });

  it("delivers a full running transcript through onInterim", () => {
    const interims: string[] = [];
    const rec = new FakeSpeechRecognition();
    createSpeechRecognizer(
      {
        onFinal: () => {},
        onInterim: (t) => interims.push(t),
        onEnd: () => {},
        onError: () => {},
      },
      FakeSpeechRecognition as unknown as typeof rec.constructor,
    );
    fireResult(rec, 0, [{ transcript: "Atlas what's happening", isFinal: true }]);
    fireResult(rec, 1, [{ transcript: "with my claims", isFinal: false }]);
    expect(interims[interims.length - 1]).toBe("Atlas what's happening with my claims");
  });

  it("returns null when speech recognition is unsupported", () => {
    expect(createSpeechRecognizer({ onFinal: () => {}, onInterim: () => {}, onEnd: () => {}, onError: () => {} }, null)).toBeNull();
  });
});

describe("speakText", () => {
  let utterances: Array<{ text: string }>;
  let speakMock: ReturnType<typeof vi.fn>;
  let cancelMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    utterances = [];
    speakMock = vi.fn((u: { text: string }) => {
      utterances.push(u);
    });
    cancelMock = vi.fn();
    const synth = {
      cancel: cancelMock,
      getVoices: () => [],
      speak: speakMock,
    };
    vi.stubGlobal("window", { speechSynthesis: synth });
    vi.stubGlobal(
      "SpeechSynthesisUtterance",
      class {
        text: string;
        rate = 1;
        pitch = 1;
        voice: unknown;
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(text: string) {
          this.text = text;
        }
      },
    );
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    stopBrowserSpeaking();
  });

  it("cancels before speaking and defers the actual speak() past the cancel", () => {
    const onEnd = vi.fn();
    const ok = speakText("Here is your update", { onEnd });
    expect(ok).toBe(true);
    expect(cancelMock).toHaveBeenCalled();
    expect(speakMock).not.toHaveBeenCalled(); // deferred past the cancel
    vi.advanceTimersByTime(100);
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(utterances[0].text).toBe("Here is your update");
    // Simulate utterance finishing.
    (speakMock.mock.calls[0][0] as { onend?: () => void }).onend?.();
    expect(onEnd).toHaveBeenCalled();
  });

  it("stopBrowserSpeaking cancels a pending utterance before it plays", () => {
    speakText("don't speak this");
    stopBrowserSpeaking();
    vi.advanceTimersByTime(200);
    expect(speakMock).not.toHaveBeenCalled();
  });

  it("returns false for empty text", () => {
    expect(speakText("   ")).toBe(false);
  });
});
