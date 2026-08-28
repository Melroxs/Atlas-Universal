// ---------------------------------------------------------------------------
// Atlas Voice Runtime — Configuration
//
// Loads voice provider configuration from environment variables. Supports:
//   - Browser (existing): no API key needed
//   - NVIDIA NIM VoiceChat: NVIDIA_NIM_API_KEY, NVIDIA_NIM_VOICE_MODEL
//
// Reuses NVIDIA_NIM_API_KEY from the existing AI Runtime config.
// ---------------------------------------------------------------------------

import type { VoiceProviderConfig, VoiceProviderCapabilities, VoiceRuntimeConfig } from "./types";
import { DEFAULT_VOICE_RUNTIME_CONFIG } from "./types";

// ---------------------------------------------------------------------------
// Environment helper
// ---------------------------------------------------------------------------

function env(key: string): string | undefined {
  if (typeof process !== "undefined") {
    return (process.env as Record<string, string | undefined>)[key];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Browser voice provider config (always available in browser environments)
// ---------------------------------------------------------------------------

function loadBrowserVoiceConfig(): VoiceProviderConfig {
  return {
    id: "browser",
    name: "Browser Voice (Web Speech API)",
    baseUrl: "",
    apiKey: "",
    defaultModel: "browser-native",
    priority: 10, // lowest priority — used as fallback
    enabled: true,
    capabilities: {
      stt: true,
      tts: true,
      speechToSpeech: false,
      streamingInput: false,
      streamingOutput: false,
      interruption: false,
      voiceControl: false,
      realtime: false,
    },
  };
}

// ---------------------------------------------------------------------------
// NVIDIA NIM VoiceChat configuration
// ---------------------------------------------------------------------------

const NIM_VOICE_CAPABILITIES: VoiceProviderCapabilities = {
  stt: true,
  tts: true,
  speechToSpeech: true,
  streamingInput: true,
  streamingOutput: true,
  interruption: true,
  voiceControl: true,
  realtime: true,
};

function loadNvidiaNimVoiceConfig(): VoiceProviderConfig | null {
  // Reuse the existing NVIDIA NIM API key from the AI Runtime
  const apiKey = (env("NVIDIA_NIM_API_KEY") ?? "").trim();
  if (!apiKey) return null;

  const baseUrl = (env("NVIDIA_NIM_BASE_URL") ?? "https://integrate.api.nvidia.com/v1").trim();
  const defaultModel = (env("NVIDIA_NIM_VOICE_MODEL") ?? "nvidia/nemotron-3-voicechat-12b").trim();

  return {
    id: "nvidia-nim-voice",
    name: "NVIDIA NIM VoiceChat (Nemotron)",
    baseUrl,
    apiKey,
    defaultModel,
    priority: 1, // highest priority — preferred provider when available
    enabled: true,
    capabilities: NIM_VOICE_CAPABILITIES,
  };
}

// ---------------------------------------------------------------------------
// Configuration cache
// ---------------------------------------------------------------------------

let _configCache: VoiceProviderConfig[] | null = null;

/**
 * Load all configured voice providers from environment.
 * Browser voice is always included as a fallback.
 */
export function loadVoiceProviderConfigs(): VoiceProviderConfig[] {
  if (_configCache) return _configCache;

  const configs: VoiceProviderConfig[] = [];

  // NVIDIA NIM VoiceChat (preferred when configured)
  const nvidia = loadNvidiaNimVoiceConfig();
  if (nvidia) configs.push(nvidia);

  // Browser voice (always available as fallback)
  configs.push(loadBrowserVoiceConfig());

  // Sort by priority (lower = higher priority)
  configs.sort((a, b) => a.priority - b.priority);

  _configCache = configs;
  return configs;
}

/** Reset config cache (for testing). */
export function resetVoiceConfigCache(): void {
  _configCache = null;
}

/**
 * Check if NVIDIA NIM voice credentials are configured.
 */
export function isNvidiaNimVoiceConfigured(): boolean {
  const key = (env("NVIDIA_NIM_API_KEY") ?? "").trim();
  return key.length > 0;
}

/**
 * Get the voice runtime config from environment with sensible defaults.
 */
export function getVoiceRuntimeConfig(): Partial<VoiceRuntimeConfig> {
  const config: Partial<VoiceRuntimeConfig> = {};

  const defaultProvider = (env("ATLAS_VOICE_PROVIDER") ?? "").trim();
  if (defaultProvider) config.defaultProvider = defaultProvider;

  const defaultVoice = (env("ATLAS_VOICE_DEFAULT_VOICE") ?? "").trim();
  if (defaultVoice) config.defaultVoice = defaultVoice;

  return config;
}

/**
 * Check if the NVIDIA NIM Nemotron voice model is explicitly configured.
 */
export function getNvidiaVoiceModel(): string {
  return (env("NVIDIA_NIM_VOICE_MODEL") ?? "nvidia/nemotron-3-voicechat-12b").trim();
}
