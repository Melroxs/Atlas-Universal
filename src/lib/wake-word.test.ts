import { describe, expect, it } from "vitest";
import {
  detectWakeWord,
  hasCommandAfterWake,
  mentionsAtlas,
  shouldAcceptWake,
  stripWakeWord,
} from "./wake-word";

describe("detectWakeWord", () => {
  it("detects a bare leading 'Atlas'", () => {
    const r = detectWakeWord("Atlas what's happening with the Johnson claim?");
    expect(r.detected).toBe(true);
    expect(r.variant).toBe("leading");
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("detects prefixed variants", () => {
    for (const t of ["Hey Atlas, open the claim", "ok atlas, what changed?", "Okay Atlas stop"]) {
      expect(detectWakeWord(t).detected, t).toBe(true);
    }
  });

  it("rejects mid-sentence 'atlas' (false-positive protection)", () => {
    expect(detectWakeWord("I saw the atlas report yesterday").detected).toBe(false);
    expect(detectWakeWord("the atlas is on the desk").detected).toBe(false);
  });

  it("rejects empty transcripts", () => {
    expect(detectWakeWord("").detected).toBe(false);
  });

  it("flags interruption commands", () => {
    expect(detectWakeWord("Atlas stop").interruption).toBe(true);
    expect(detectWakeWord("Atlas, wait").interruption).toBe(true);
    expect(detectWakeWord("atlas never mind").interruption).toBe(true);
    expect(detectWakeWord("Atlas what's happening?").interruption).toBe(false);
  });
});

describe("stripWakeWord", () => {
  it("removes the wake word and keeps the command", () => {
    expect(stripWakeWord("Atlas what's happening?")).toBe("what's happening?");
    expect(stripWakeWord("Hey Atlas, prepare the supplement")).toBe("prepare the supplement");
    expect(stripWakeWord("ok atlas stop")).toBe("stop");
  });
});

describe("hasCommandAfterWake", () => {
  it("requires content after the wake word", () => {
    expect(hasCommandAfterWake("Atlas")).toBe(false);
    expect(hasCommandAfterWake("Atlas what's happening?")).toBe(true);
  });
});

describe("mentionsAtlas", () => {
  it("finds the word anywhere", () => {
    expect(mentionsAtlas("the atlas report")).toBe(true);
    expect(mentionsAtlas("nothing here")).toBe(false);
  });
});

describe("shouldAcceptWake", () => {
  it("enforces a cooldown", () => {
    const state = { lastWakeAt: 0, lastWakeTranscript: "" };
    expect(shouldAcceptWake("Atlas go", state, 1000)).toBe(true);
    expect(shouldAcceptWake("Atlas go", state, 2000)).toBe(false);
  });

  it("suppresses duplicates", () => {
    const state = { lastWakeAt: 0, lastWakeTranscript: "Atlas go" };
    expect(shouldAcceptWake("Atlas go", state, 10_000)).toBe(false);
    expect(shouldAcceptWake("Atlas different", state, 10_000)).toBe(true);
  });
});
