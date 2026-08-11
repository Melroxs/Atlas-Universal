// ---------------------------------------------------------------------------
// Phase 10 — Voice transport unit tests.
// Provider status derivation must be honest (no fake "connected" state) and
// unconfigured paths must surface sanitized, user-readable messages.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  sttConfigured,
  sttUnconfiguredError,
  ttsConfigured,
  ttsUnconfiguredError,
  voiceStatusFromEnv,
} from "./voice";

describe("voiceStatusFromEnv", () => {
  it("reports browser transport when nothing is configured", () => {
    const status = voiceStatusFromEnv({});
    expect(status).toEqual({
      stt: "browser",
      tts: "browser",
      serverConfigured: false,
    });
    expect(status.sttProvider).toBeUndefined();
    expect(status.ttsProvider).toBeUndefined();
  });

  it("reports server STT when a key is present", () => {
    const status = voiceStatusFromEnv({ VOICE_STT_API_KEY: "sk-test" });
    expect(status.stt).toBe("server");
    expect(status.sttProvider).toBe("openai-compatible");
    expect(status.tts).toBe("browser");
    expect(status.serverConfigured).toBe(true);
  });

  it("reports server TTS when a key is present", () => {
    const status = voiceStatusFromEnv({ VOICE_TTS_API_KEY: "sk-test" });
    expect(status.tts).toBe("server");
    expect(status.ttsProvider).toBe("openai-compatible");
    expect(status.stt).toBe("browser");
  });

  it("honors custom provider names", () => {
    const status = voiceStatusFromEnv({
      VOICE_STT_API_KEY: "k",
      VOICE_TTS_API_KEY: "k",
      VOICE_STT_PROVIDER: "deepgram",
      VOICE_TTS_PROVIDER: "elevenlabs",
    });
    expect(status.sttProvider).toBe("deepgram");
    expect(status.ttsProvider).toBe("elevenlabs");
  });

  it("reports Cartesia as the server TTS provider when its key is present", () => {
    const status = voiceStatusFromEnv({ CARTESIA_API_KEY: "sk_car_test" });
    expect(status.tts).toBe("server");
    expect(status.ttsProvider).toBe("cartesia");
    expect(status.stt).toBe("browser");
    expect(status.serverConfigured).toBe(true);
  });

  it("treats a blank Cartesia key as unconfigured", () => {
    expect(ttsConfigured({ CARTESIA_API_KEY: "   " })).toBe(false);
    const status = voiceStatusFromEnv({ CARTESIA_API_KEY: "" });
    expect(status.tts).toBe("browser");
    expect(status.ttsProvider).toBeUndefined();
  });

  it("never leaks the Cartesia key value into status", () => {
    const status = voiceStatusFromEnv({ CARTESIA_API_KEY: "sk_car_secret-123" });
    expect(JSON.stringify(status)).not.toContain("secret");
    expect(JSON.stringify(status)).not.toContain("sk_car");
  });

  it("never leaks the key value into status", () => {
    const status = voiceStatusFromEnv({ VOICE_STT_API_KEY: "sk-secret-123", VOICE_TTS_API_KEY: "sk-secret-456" });
    expect(JSON.stringify(status)).not.toContain("secret");
    expect(JSON.stringify(status)).not.toContain("sk-");
  });

  it("treats blank keys as unconfigured", () => {
    expect(sttConfigured({ VOICE_STT_API_KEY: "   " })).toBe(false);
    expect(ttsConfigured({ VOICE_TTS_API_KEY: "" })).toBe(false);
  });
});

describe("unconfigured errors", () => {
  it("are honest and user-readable", () => {
    expect(sttUnconfiguredError().message).toMatch(/not configured/i);
    expect(ttsUnconfiguredError().message).toMatch(/not configured/i);
  });

  it("never contain secrets", () => {
    expect(sttUnconfiguredError().message).not.toMatch(/key|token|secret|Bearer/i);
    expect(ttsUnconfiguredError().message).not.toMatch(/key|token|secret|Bearer/i);
  });
});
