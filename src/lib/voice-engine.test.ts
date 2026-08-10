// ---------------------------------------------------------------------------
// Phase 12 — Ambient wake-word engine state machine tests.
//
// These drive the engine through a fake recognizer (injected via deps), so no
// browser is needed. They pin the core runtime guarantees:
//   - no command is emitted before a valid wake word;
//   - false wakes (mid-sentence "atlas") are suppressed;
//   - cooldown + duplicate suppression apply;
//   - the wake word is stripped from the captured command;
//   - interruptions only fire in interrupt-only mode (while speaking);
//   - permission denial and unsupported browsers are honest (no restart loop);
//   - stop() cleans up the recognizer.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWakeWordEngine,
  type Recognizer,
  type RecognizerHandlers,
  type WakeWordEngineHandlers,
} from "./voice";

/** Fake recognizer: records lifecycle calls and lets tests fire events. */
class FakeRecognizer implements Recognizer {
  handlers: RecognizerHandlers;
  started = 0;
  stopped = 0;
  aborted = 0;
  constructor(handlers: RecognizerHandlers) {
    this.handlers = handlers;
  }
  start() {
    this.started++;
  }
  stop() {
    this.stopped++;
  }
  abort() {
    this.aborted++;
  }
  /** Test driver — simulate an interim/final transcript event. */
  interim(text: string) {
    this.handlers.onInterim(text);
  }
  /** Test driver — simulate recognition ending. */
  end() {
    this.handlers.onEnd();
  }
  /** Test driver — simulate a recognition error. */
  error(code: string) {
    this.handlers.onError(code);
  }
}

interface Harness {
  engine: ReturnType<typeof createWakeWordEngine>;
  recognizers: FakeRecognizer[];
  states: string[];
  commands: string[];
  errors: string[];
  interrupts: number;
  wakes: string[];
  /** The recognizer the engine is currently driving (last created). */
  current: FakeRecognizer;
}

function makeHarness(
  opts?: { unsupported?: boolean; createRecognizer?: (h: RecognizerHandlers) => Recognizer | null },
): Harness {
  const recognizers: FakeRecognizer[] = [];
  const states: string[] = [];
  const commands: string[] = [];
  const errors: string[] = [];
  const wakes: string[] = [];
  let interrupts = 0;
  let clock = 1_000_000;

  const handlers: WakeWordEngineHandlers = {
    onState: (s) => states.push(s),
    onWake: (t) => wakes.push(t),
    onCommand: (t) => commands.push(t),
    onInterrupt: () => interrupts++,
    onError: (c) => errors.push(c),
  };

  const engine = createWakeWordEngine(handlers, {
    createRecognizer: (h) => {
      if (opts?.createRecognizer) return opts.createRecognizer(h);
      const rec = new FakeRecognizer(h);
      recognizers.push(rec);
      return rec;
    },
    now: () => clock,
  });

  const advanceClock = (ms: number) => {
    clock += ms;
    return clock;
  };

  return {
    engine,
    recognizers,
    states,
    commands,
    errors,
    // Live getter — a plain primitive copy here would freeze at 0 and the
    // interrupt assertions would read a stale value even when the engine
    // correctly fired onInterrupt().
    get interrupts() {
      return interrupts;
    },
    wakes,
    get current() {
      return recognizers[recognizers.length - 1];
    },
    advanceClock,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createWakeWordEngine — wake-word behavior", () => {
  it("does not emit a command for ordinary speech (no wake word)", () => {
    const h = makeHarness();
    h.engine.start();
    expect(h.current.started).toBe(1);
    h.current.interim("what's happening with my claims?");
    h.current.interim("the weather is nice today");
    expect(h.commands).toHaveLength(0);
    expect(h.states).not.toContain("wake_detected");
  });

  it("rejects mid-sentence 'atlas' (false wake suppression)", () => {
    const h = makeHarness();
    h.engine.start();
    h.current.interim("I saw the atlas report yesterday");
    h.current.interim("the atlas is on the desk");
    expect(h.commands).toHaveLength(0);
    expect(h.states).not.toContain("wake_detected");
  });

  it("wakes on a leading 'Atlas' and captures the command", () => {
    const h = makeHarness();
    h.engine.start();
    h.current.interim("Atlas what's happening with my claims?");
    expect(h.states).toContain("wake_detected");
    expect(h.states).toContain("listening_for_command");
    expect(h.wakes).toHaveLength(1);
    // Commit after the trailing silence window.
    vi.advanceTimersByTime(1600);
    expect(h.commands).toEqual(["what's happening with my claims?"]);
  });

  it("supports wake word followed by a separate spoken command", () => {
    const h = makeHarness();
    h.engine.start();
    h.current.interim("Atlas");
    expect(h.states).toContain("wake_detected");
    expect(h.commands).toHaveLength(0);
    // User pauses, then gives the command.
    h.current.interim("Atlas what claims are missing?");
    vi.advanceTimersByTime(1600);
    expect(h.commands).toEqual(["what claims are missing?"]);
  });

  it("strips prefixes like 'hey atlas' from the command", () => {
    const h = makeHarness();
    h.engine.start();
    h.current.interim("Hey Atlas, prepare the supplement");
    vi.advanceTimersByTime(1600);
    expect(h.commands).toEqual(["prepare the supplement"]);
  });

  it("enforces cooldown between consecutive wakes", () => {
    const h = makeHarness();
    h.engine.start();
    h.current.interim("Atlas open the claim");
    vi.advanceTimersByTime(1600);
    expect(h.commands).toEqual(["open the claim"]);
    h.advanceClock(500);
    // Same recognizer may re-deliver; cooldown must suppress the re-wake.
    h.current.interim("Atlas open the claim");
    vi.advanceTimersByTime(1600);
    expect(h.commands).toHaveLength(1);
    // After the cooldown elapses, a new wake is accepted again.
    h.advanceClock(2600);
    h.current.interim("Atlas what's the status?");
    vi.advanceTimersByTime(1600);
    expect(h.commands).toHaveLength(2);
  });

  it("does not capture background chatter after the wake word into a command", () => {
    const h = makeHarness();
    h.engine.start();
    // A wake that contains no command (bare "Atlas") must not commit anything.
    h.current.interim("Atlas");
    vi.advanceTimersByTime(ABANDON_AFTER());
    expect(h.commands).toHaveLength(0);
  });
});

describe("createWakeWordEngine — interruption", () => {
  it("fires onInterrupt for 'Atlas stop' only in interrupt-only mode", () => {
    const h = makeHarness();
    h.engine.start();
    h.current.interim("Atlas stop");
    // Normal mode: interruption phrase is a command, not an interrupt.
    expect(h.interrupts).toBe(0);
    vi.advanceTimersByTime(1600);
    expect(h.commands).toEqual(["stop"]);

    h.engine.setInterruptOnly(true);
    h.current.interim("Atlas stop");
    expect(h.interrupts).toBe(1);
  });

  it("ignores ordinary wakes while interrupt-only (Atlas speaking)", () => {
    const h = makeHarness();
    h.engine.start();
    h.engine.setInterruptOnly(true);
    h.current.interim("Atlas what's happening with my claims?");
    expect(h.interrupts).toBe(0);
    expect(h.states).not.toContain("wake_detected");
    expect(h.commands).toHaveLength(0);
  });

  it("catches an interrupt phrase anywhere in the transcript", () => {
    const h = makeHarness();
    h.engine.start();
    h.engine.setInterruptOnly(true);
    h.current.interim("atlas found three claims today atlas stop");
    expect(h.interrupts).toBe(1);
  });
});

describe("createWakeWordEngine — errors and lifecycle", () => {
  it("maps permission denial to permission_required without a restart loop", () => {
    const h = makeHarness();
    h.engine.start();
    h.current.error("not-allowed");
    expect(h.states).toContain("permission_required");
    expect(h.errors).toContain("not-allowed");
    // No restart recognizer should be created after permission denial.
    vi.advanceTimersByTime(5000);
    expect(h.recognizers).toHaveLength(1);
  });

  it("returns to wake listening on no-speech errors", () => {
    const h = makeHarness();
    h.engine.start();
    h.current.error("no-speech");
    vi.advanceTimersByTime(100);
    // A fresh recognizer restarts the loop.
    expect(h.recognizers.length).toBeGreaterThan(1);
  });

  it("commits a partial command when the recognizer fails mid-command", () => {
    const h = makeHarness();
    h.engine.start();
    h.current.interim("Atlas what's the balance");
    h.current.error("network");
    expect(h.commands).toEqual(["what's the balance"]);
  });

  it("stops listening on stop() and aborts the recognizer", () => {
    const h = makeHarness();
    h.engine.start();
    h.current.interim("Atlas something");
    h.engine.stop();
    expect(h.current.aborted).toBeGreaterThan(0);
    h.current.interim("Atlas anything else");
    vi.advanceTimersByTime(2000);
    expect(h.commands).toHaveLength(0);
  });

  it("pauses and resumes without leaving the recognizer running", () => {
    const h = makeHarness();
    h.engine.start();
    h.engine.pause();
    expect(h.states).toContain("paused");
    h.current.interim("Atlas shouldn't be captured while paused");
    vi.advanceTimersByTime(2000);
    expect(h.commands).toHaveLength(0);
    h.engine.resume();
    vi.advanceTimersByTime(10);
    expect(h.recognizers.length).toBeGreaterThanOrEqual(2);
  });

  it("surfaces an honest unavailable state when speech recognition is unsupported", () => {
    const h = makeHarness({ createRecognizer: () => null });
    h.engine.start();
    expect(h.states).toContain("unavailable");
    expect(h.errors).toContain("unsupported");
    expect(h.commands).toHaveLength(0);
  });
});

/** The abandon window is not exported; 9000ms comfortably exceeds it. */
function ABANDON_AFTER(): number {
  return 9000;
}
