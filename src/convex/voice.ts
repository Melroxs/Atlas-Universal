// ---------------------------------------------------------------------------
// Phase 10 — Voice transport.
//
// The browser uses its native speech recognition/synthesis as the default
// transport (works with no API key). When server-side credentials are
// configured via environment variables, these actions take over transcription
// and synthesis. Provider state is reported HONESTLY — no fake "connected"
// state. Server secrets never leave the server; responses contain only
// status flags and audio data.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { action, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// ---------------------------------------------------------------------------
// Configuration helpers (pure — unit tested)
// ---------------------------------------------------------------------------

export interface VoiceProviderStatus {
  /** "server" when a server-side STT provider is configured, else "browser". */
  stt: "server" | "browser";
  /** "server" when a server-side TTS provider is configured, else "browser". */
  tts: "server" | "browser";
  /** Named providers only when actually configured. */
  sttProvider?: string;
  ttsProvider?: string;
  /** True when at least one server-side credential is present. */
  serverConfigured: boolean;
}

export type VoiceEnv = Record<string, string | undefined>;

export function sttConfigured(env: VoiceEnv): boolean {
  return Boolean(env.VOICE_STT_API_KEY && env.VOICE_STT_API_KEY.trim().length > 0);
}

export function ttsConfigured(env: VoiceEnv): boolean {
  return Boolean(
    (env.VOICE_TTS_API_KEY && env.VOICE_TTS_API_KEY.trim().length > 0) ||
      (env.CARTESIA_API_KEY && env.CARTESIA_API_KEY.trim().length > 0),
  );
}

/** True when the dedicated Cartesia TTS key is present. */
export function cartesiaConfigured(env: VoiceEnv): boolean {
  return Boolean(env.CARTESIA_API_KEY && env.CARTESIA_API_KEY.trim().length > 0);
}

/** Honest, sanitized error thrown when STT isn't configured server-side. */
export function sttUnconfiguredError(): Error {
  return new Error(
    "Voice transcription is not configured yet. Browser speech recognition is used instead.",
  );
}

/** Honest, sanitized error thrown when TTS isn't configured server-side. */
export function ttsUnconfiguredError(): Error {
  return new Error(
    "Voice synthesis is not configured yet. Browser speech synthesis is used instead.",
  );
}

/** Derive the honest provider status from the environment (no secrets). */
export function voiceStatusFromEnv(env: VoiceEnv): VoiceProviderStatus {
  const stt = sttConfigured(env);
  const tts = ttsConfigured(env);
  return {
    stt: stt ? "server" : "browser",
    tts: tts ? "server" : "browser",
    ...(stt ? { sttProvider: env.VOICE_STT_PROVIDER ?? "openai-compatible" } : {}),
    ...(tts
      ? {
          ttsProvider:
            env.VOICE_TTS_PROVIDER ??
            (cartesiaConfigured(env) ? "cartesia" : "openai-compatible"),
        }
      : {}),
    serverConfigured: stt || tts,
  };
}

const VOICE_ENV = (): VoiceEnv => ({
  CARTESIA_API_KEY: process.env.CARTESIA_API_KEY,
  VOICE_STT_API_KEY: process.env.VOICE_STT_API_KEY,
  VOICE_STT_URL: process.env.VOICE_STT_URL,
  VOICE_STT_MODEL: process.env.VOICE_STT_MODEL,
  VOICE_STT_PROVIDER: process.env.VOICE_STT_PROVIDER,
  VOICE_TTS_API_KEY: process.env.VOICE_TTS_API_KEY,
  VOICE_TTS_URL: process.env.VOICE_TTS_URL,
  VOICE_TTS_MODEL: process.env.VOICE_TTS_MODEL,
  VOICE_TTS_VOICE: process.env.VOICE_TTS_VOICE,
  VOICE_TTS_PROVIDER: process.env.VOICE_TTS_PROVIDER,
});

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/** Honest voice provider status. Returns flags only — never secrets. */
export const voiceProviderStatus = query({
  args: {},
  handler: async () => voiceStatusFromEnv(VOICE_ENV()),
});

/**
 * Server-side speech-to-text. Only available when VOICE_STT_API_KEY is set;
 * otherwise throws an honest "not configured" error so the client falls back
 * to browser speech recognition. Accepts base64 audio (webm/wav/mp3/m4a).
 */
export const transcribeAudio = action({
  args: { audioB64: v.string(), mimeType: v.optional(v.string()) },
  handler: async (ctx, { audioB64, mimeType }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("You must be signed in.");
    const env = VOICE_ENV();
    if (!sttConfigured(env)) {
      throw sttUnconfiguredError();
    }
    const base = (env.VOICE_STT_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    const model = env.VOICE_STT_MODEL ?? "whisper-1";
    const bytes = Buffer.from(audioB64, "base64");
    const ext = mimeType ? mimeType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") ?? "webm" : "webm";
    const form = new FormData();
    form.append("model", model);
    form.append("file", new Blob([bytes], { type: mimeType ?? "audio/webm" }), `recording.${ext}`);

    let res: Response;
    try {
      res = await fetch(`${base}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.VOICE_STT_API_KEY}` },
        body: form,
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error("Voice transcription service is unreachable right now.");
    }
    if (!res.ok) {
      throw new Error(`Voice transcription failed (${res.status}).`);
    }
    const data = (await res.json()) as { text?: string };
    const text = (data.text ?? "").trim();
    if (!text) {
      throw new Error("No speech was detected in the recording.");
    }
    return { transcript: text, provider: env.VOICE_STT_PROVIDER ?? "openai-compatible" };
  },
});

/**
 * Cartesia low-latency TTS (Sonic). Server-side only — the API key never
 * leaves the server. Returns base64 mp3 audio with the same shape as the
 * OpenAI-compatible path so the client transport is identical.
 */
const DEFAULT_CARTESIA_VOICE_ID = "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4";

async function cartesiaSynthesize(
  apiKey: string,
  text: string,
  voiceValue: string,
): Promise<{ audioB64: string }> {
  // Cartesia voices are referenced either by stable UUID (mode "id") or by
  // name (mode "name") — accept both so VOICE_TTS_VOICE stays human-friendly.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    voiceValue,
  );
  const body = JSON.stringify({
    model_id: "sonic-3.5",
    transcript: text.slice(0, 1000),
    voice: isUuid ? { mode: "id", id: voiceValue } : { mode: "name", name: voiceValue },
    output_format: {
      container: "mp3",
      sample_rate: 44100,
      bit_rate: 128000,
    },
    generation_config: { volume: 1, speed: 1 },
  });

  let res: Response;
  try {
    res = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Cartesia-Version": "2026-03-01",
        "Content-Type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("Voice synthesis service is unreachable right now.");
  }
  if (!res.ok) {
    // Sanitized: provider bodies may echo request details; status only.
    throw new Error(`Voice synthesis failed (${res.status}).`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("Voice synthesis returned no audio.");
  return { audioB64: buf.toString("base64") };
}

/**
 * Server-side text-to-speech. When the dedicated CARTESIA_API_KEY is set,
 * speech is synthesized with Cartesia (low-latency Sonic); otherwise the
 * OpenAI-compatible VOICE_TTS_* path is used when configured. If nothing is
 * configured it throws an honest "not configured" error so the client falls
 * back to browser speech synthesis. Returns base64 audio (mp3).
 */
export const synthesizeSpeech = action({
  args: { text: v.string(), voice: v.optional(v.string()) },
  handler: async (ctx, { text, voice }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("You must be signed in.");
    const env = VOICE_ENV();
    if (!ttsConfigured(env)) {
      throw ttsUnconfiguredError();
    }
    // Dedicated Cartesia key takes over when present — the recommended
    // low-latency provider for Atlas's voice responses.
    if (cartesiaConfigured(env)) {
      const chosenVoice = voice ?? env.VOICE_TTS_VOICE ?? DEFAULT_CARTESIA_VOICE_ID;
      const audio = await cartesiaSynthesize(env.CARTESIA_API_KEY!, text, chosenVoice);
      return { audioB64: audio.audioB64, mimeType: "audio/mpeg", provider: "cartesia" };
    }
    const base = (env.VOICE_TTS_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    const model = env.VOICE_TTS_MODEL ?? "tts-1";
    const chosenVoice = voice ?? env.VOICE_TTS_VOICE ?? "nova";
    const body = JSON.stringify({
      model,
      voice: chosenVoice,
      input: text.slice(0, 1000),
      response_format: "mp3",
    });

    let res: Response;
    try {
      res = await fetch(`${base}/audio/speech`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.VOICE_TTS_API_KEY}`,
          "Content-Type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error("Voice synthesis service is unreachable right now.");
    }
    if (!res.ok) {
      throw new Error(`Voice synthesis failed (${res.status}).`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new Error("Voice synthesis returned no audio.");
    return {
      audioB64: buf.toString("base64"),
      mimeType: "audio/mpeg",
      provider: env.VOICE_TTS_PROVIDER ?? "openai-compatible",
    };
  },
});
