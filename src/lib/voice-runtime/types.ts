// ---------------------------------------------------------------------------
// Atlas Voice Runtime — Core Type Definitions
//
// Provider-agnostic interfaces for voice interaction. Every Atlas feature
// that handles voice input/output should use these types through the
// voice runtime, not provider-specific SDKs directly.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Provider identity
// ---------------------------------------------------------------------------

export type VoiceProviderId = "browser" | "nvidia-nim-voice" | string;

export interface VoiceProviderConfig {
  id: VoiceProviderId;
  name: string;
  /** Base URL for the provider's API. */
  baseUrl: string;
  /** API key (NEVER logged or exposed to client). */
  apiKey: string;
  /** Default model for this provider. */
  defaultModel: string;
  /** Provider priority (lower = higher priority for fallback selection). */
  priority: number;
  /** Whether this provider is currently enabled. */
  enabled: boolean;
  /** Provider capabilities. */
  capabilities: VoiceProviderCapabilities;
}

export interface VoiceProviderCapabilities {
  /** Supports speech-to-text (STT). */
  stt: boolean;
  /** Supports text-to-speech (TTS). */
  tts: boolean;
  /** Supports end-to-end speech-to-speech (full duplex). */
  speechToSpeech: boolean;
  /** Supports streaming audio input. */
  streamingInput: boolean;
  /** Supports streaming audio output. */
  streamingOutput: boolean;
  /** Supports interruption/barge-in detection. */
  interruption: boolean;
  /** Supports voice/persona control. */
  voiceControl: boolean;
  /** Supports real-time bidirectional audio. */
  realtime: boolean;
}

// ---------------------------------------------------------------------------
// Voice session
// ---------------------------------------------------------------------------

export type VoiceSessionState =
  | "idle"
  | "connecting"
  | "listening"
  | "processing"
  | "speaking"
  | "interrupted"
  | "completed"
  | "error"
  | "closed";

export interface VoiceSessionConfig {
  /** Preferred provider. Falls back to auto-selection if unavailable. */
  provider?: VoiceProviderId;
  /** Model override. Uses provider default if not specified. */
  model?: string;
  /** Voice/persona for TTS output. */
  voice?: string;
  /** Language code (default: "en-US"). */
  language?: string;
  /** Whether to enable interruption detection. */
  enableInterruption?: boolean;
  /** Whether to enable partial transcript updates. */
  enablePartialTranscripts?: boolean;
  /** Maximum session duration in ms (0 = unlimited). */
  maxDurationMs?: number;
  /** Request timeout in ms. */
  timeoutMs?: number;
  /** Metadata for logging/tracking. */
  metadata?: Record<string, unknown>;
}

export interface VoiceSession {
  /** Unique session identifier. */
  readonly id: string;
  /** Current session state. */
  state: VoiceSessionState;
  /** Provider handling this session. */
  readonly provider: VoiceProviderId;
  /** Model being used. */
  readonly model: string;
  /** Session creation timestamp. */
  readonly createdAt: number;
  /** Last state change timestamp. */
  lastStateChange: number;
  /** Current transcript (accumulated). */
  transcript: string;
  /** Current partial transcript (interim). */
  partialTranscript: string;
}

// ---------------------------------------------------------------------------
// Voice events
// ---------------------------------------------------------------------------

export type VoiceEventType =
  | "session.created"
  | "session.state_changed"
  | "session.connected"
  | "session.completed"
  | "session.error"
  | "session.closed"
  | "audio.input_started"
  | "audio.input_stopped"
  | "audio.output_started"
  | "audio.output_stopped"
  | "transcript.partial"
  | "transcript.final"
  | "response.text_delta"
  | "response.text_complete"
  | "response.audio_delta"
  | "response.audio_complete"
  | "interruption.detected"
  | "provider.fallback"
  | "provider.error"
  | "action.triggered"
  | "action.completed"
  | "action.failed";

export interface VoiceEvent {
  type: VoiceEventType;
  timestamp: number;
  sessionId: string;
  data: Record<string, unknown>;
}

export type VoiceEventHandler = (event: VoiceEvent) => void;

// ---------------------------------------------------------------------------
// Voice actions (agentic capabilities)
// ---------------------------------------------------------------------------

export type VoiceActionRiskLevel = "read" | "low_risk_write" | "high_risk_write";

export interface VoiceActionDefinition {
  /** Unique action identifier. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Description of what this action does. */
  description: string;
  /** Risk level — determines confirmation requirements. */
  riskLevel: VoiceActionRiskLevel;
  /** Whether this action requires confirmation before execution. */
  requiresConfirmation: boolean;
  /** Category for grouping (e.g., "claims", "evidence", "crm"). */
  category: string;
  /** Parameters this action accepts. */
  parameters: VoiceActionParameter[];
  /** Execute the action. Returns the result. */
  execute: (params: Record<string, unknown>, context: VoiceActionContext) => Promise<VoiceActionResult>;
}

export interface VoiceActionParameter {
  name: string;
  type: "string" | "number" | "boolean" | "enum";
  required: boolean;
  description: string;
  enum?: string[];
}

export interface VoiceActionContext {
  /** Tenant ID for isolation. */
  tenantId: string;
  /** User ID. */
  userId: string | null;
  /** Current entity context (e.g., claim ID). */
  entityContextId?: string;
  /** Page context (e.g., "Revenue Recovery"). */
  pageContext?: string;
  /** Conversation session ID. */
  sessionId?: string;
}

export interface VoiceActionResult {
  success: boolean;
  data?: Record<string, unknown>;
  message: string;
  /** Whether this result needs spoken confirmation. */
  requiresConfirmation?: boolean;
  /** Confirmation prompt if requiresConfirmation is true. */
  confirmationPrompt?: string;
}

// ---------------------------------------------------------------------------
// Voice provider adapter interface
// ---------------------------------------------------------------------------

/**
 * Every voice provider implements this interface. The voice runtime never
 * calls provider-specific SDKs directly — it goes through this abstraction.
 */
export interface VoiceProviderAdapter {
  /** Unique provider identifier. */
  readonly id: VoiceProviderId;

  /** Display name. */
  readonly name: string;

  /** Provider capabilities. */
  readonly capabilities: VoiceProviderCapabilities;

  /** Check if the provider has valid credentials/is available. */
  isAvailable(): boolean;

  /** Create a new voice session. */
  createSession(config: VoiceSessionConfig): Promise<VoiceSessionHandle>;

  /** Health check. Returns true if the provider is responding. */
  healthCheck(): Promise<boolean>;
}

/**
 * A handle to an active voice session. Provides methods for controlling
 * the session lifecycle and receiving events.
 */
export interface VoiceSessionHandle {
  /** Session ID. */
  readonly id: string;

  /** Current state. */
  readonly state: VoiceSessionState;

  /** Subscribe to voice events. Returns an unsubscribe function. */
  onEvent(handler: VoiceEventHandler): () => void;

  /** Send audio data (PCM16 or provider-specific format). */
  sendAudio(audioData: ArrayBuffer): Promise<void>;

  /** Send a text message (for hybrid text+voice mode). */
  sendText(text: string): Promise<void>;

  /** Request interruption of current output. */
  interrupt(): Promise<void>;

  /** Cancel the session entirely. */
  cancel(): Promise<void>;

  /** Close the session and release resources. */
  close(): Promise<void>;

  /** Get current session info. */
  getSession(): VoiceSession;
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

export interface VoiceTelemetryRecord {
  timestamp: string;
  sessionId: string;
  provider: VoiceProviderId;
  model: string;
  /** Session duration in ms. */
  durationMs: number;
  /** Audio input duration in ms. */
  inputAudioMs: number;
  /** Audio output duration in ms. */
  outputAudioMs: number;
  /** Latency from audio input to first response audio (ms). */
  firstResponseLatencyMs: number;
  /** Whether the session succeeded. */
  success: boolean;
  /** Error code if failed. */
  errorCode?: string;
  /** Whether fallback was used. */
  fallbackFrom?: VoiceProviderId;
  /** Number of interruptions during the session. */
  interruptionCount: number;
  /** Transcript word count. */
  transcriptWordCount: number;
  /** Whether an action was triggered. */
  actionTriggered?: string;
  /** Estimated cost (if available). */
  estimatedCostUsd?: number;
  /** Metadata — never customer content. */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Voice runtime configuration
// ---------------------------------------------------------------------------

export interface VoiceRuntimeConfig {
  /** Default voice provider. */
  defaultProvider?: VoiceProviderId;
  /** Default model for voice interactions. */
  defaultModel?: string;
  /** Default voice/persona for TTS. */
  defaultVoice?: string;
  /** Default language. */
  defaultLanguage?: string;
  /** Whether interruption detection is enabled by default. */
  enableInterruption: boolean;
  /** Maximum session duration in ms. */
  maxSessionDurationMs: number;
  /** Default request timeout in ms. */
  defaultTimeoutMs: number;
  /** Maximum concurrent voice sessions. */
  maxConcurrentSessions: number;
  /** Whether voice actions require confirmation by default. */
  confirmActionsByDefault: boolean;
}

export const DEFAULT_VOICE_RUNTIME_CONFIG: VoiceRuntimeConfig = {
  enableInterruption: true,
  maxSessionDurationMs: 300_000, // 5 minutes
  defaultTimeoutMs: 60_000, // 1 minute
  maxConcurrentSessions: 1,
  confirmActionsByDefault: true,
};
