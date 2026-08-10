// ---------------------------------------------------------------------------
// Phase 11 — Ambient wake-word detection ("Say 'Atlas' and Atlas is ready.")
//
// Pure, unit-tested detection helpers used by the ambient voice engine in
// lib/voice.ts and the use-voice hook. Everything here is deterministic:
// the wake word is matched against browser speech transcripts with a
// confidence threshold, cooldown, duplicate suppression and interruption
// handling. The browser remains the honest transport — there is no fake
// "always listening" state.
// ---------------------------------------------------------------------------

export type WakeWordState =
  | "unavailable"
  | "permission_required"
  | "initializing"
  | "ambient_ready"
  | "listening_for_wake_word"
  | "wake_detected"
  | "listening_for_command"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "interrupted"
  | "paused"
  | "error";

const WAKE_PREFIX_RE = /^(hey|ok|okay|yo|hi)\s+atlas\b/i;
const WAKE_LEADING_RE = /^\s*atlas\b/i;

/** Commands that interrupt Atlas while it is speaking. */
export const INTERRUPT_RE =
  /^\s*atlas[,.]?\s*(stop|wait|never mind|nevermind|quiet|silence|cancel that|pause|be quiet|hold on)\b/i;
export const INTERRUPT_WORDS_RE =
  /\b(atlas[,.]?\s+(stop|wait|never mind|nevermind|quiet|silence|pause|hold on)|stop talking|be quiet)\b/i;

/** The word "atlas" appearing anywhere (used for false-positive scoring). */
const ATLAS_ANYWHERE_RE = /\batlas\b/i;

export interface WakeMatch {
  detected: boolean;
  /** 0..1 heuristic confidence of the match. */
  confidence: number;
  /** Which variant matched (for debugging / tests). */
  variant: "leading" | "prefixed" | "none";
  /** True when the phrase is an interruption command rather than a request. */
  interruption: boolean;
}

/**
 * Detect whether the given (interim or final) transcript starts with the
 * wake word. Leading position is required — mid-sentence "atlas" is a false
 * positive. Confidence: a bare "atlas" at the start scores 0.9; prefixed
 * ("hey atlas") scores 0.95.
 */
export function detectWakeWord(transcript: string): WakeMatch {
  const t = (transcript ?? "").trim();
  if (!t) {
    return { detected: false, confidence: 0, variant: "none", interruption: false };
  }
  const interruption = INTERRUPT_RE.test(t) || INTERRUPT_WORDS_RE.test(t);
  if (WAKE_PREFIX_RE.test(t)) {
    return { detected: true, confidence: 0.95, variant: "prefixed", interruption };
  }
  if (WAKE_LEADING_RE.test(t)) {
    return { detected: true, confidence: 0.9, variant: "leading", interruption };
  }
  return { detected: false, confidence: 0, variant: "none", interruption };
}

/** True when the word appears anywhere — used only for cooldown bookkeeping. */
export function mentionsAtlas(transcript: string): boolean {
  return ATLAS_ANYWHERE_RE.test(transcript ?? "");
}

/**
 * Strip the wake word from the front of a transcript, leaving the command.
 * "Atlas what's happening with the Johnson claim?" → "what's happening with
 * the Johnson claim?" Returns the cleaned command.
 */
export function stripWakeWord(transcript: string): string {
  const t = (transcript ?? "").trim();
  if (!t) return "";
  const withoutPrefix = t
    .replace(WAKE_PREFIX_RE, "")
    .replace(WAKE_LEADING_RE, "")
    .trim();
  return withoutPrefix.replace(/^[,.\s]+/, "").trim();
}

/**
 * Minimal gate: a transcript is a plausible command when it has at least one
 * word of content after the wake word. "Atlas" alone is treated as a chime
 * (ready state), not a command.
 */
export function hasCommandAfterWake(transcript: string): boolean {
  const rest = stripWakeWord(transcript);
  return rest.split(/\s+/).filter(Boolean).length > 0;
}

export interface WakeGuardState {
  /** ms of the last accepted wake (used for cooldown). */
  lastWakeAt: number;
  /** Last transcript that triggered a wake (duplicate suppression). */
  lastWakeTranscript: string;
}

/**
 * False-positive protection: cooldown between wakes, and duplicate
 * suppression when the recognizer re-delivers the same phrase.
 */
export function shouldAcceptWake(
  transcript: string,
  state: WakeGuardState | null,
  now: number,
  opts?: { cooldownMs?: number },
): boolean {
  const cooldown = opts?.cooldownMs ?? 2500;
  const t = (transcript ?? "").trim();
  if (!t) return false;
  if (state && now - state.lastWakeAt < cooldown) return false;
  if (state && state.lastWakeTranscript === t) return false;
  return true;
}
