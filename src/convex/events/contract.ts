// ---------------------------------------------------------------------------
// Atlas Universal — Event Contract
//
// The typed abstraction every event source speaks. PURE module (no Convex
// runtime, no node imports): the same code runs in V8 mutations, node actions
// and unit tests.
//
//  EventDefinition  — what an event TYPE is (registry-driven, never hardcoded)
//  EventEnvelope    — the normalized internal shape every event takes
//  identity/dedupe  — deterministic ids + idempotency keys
//  retry model      — bounded, retryable vs permanent classification
//  sanitization     — provider payloads are reduced to safe keys only
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EventProcessingStatus =
  | "received"
  | "processing"
  | "processed"
  | "ignored"
  | "failed"
  | "retrying";

export const EVENT_STATUSES: EventProcessingStatus[] = [
  "received",
  "processing",
  "processed",
  "ignored",
  "failed",
  "retrying",
];

/** How an event actually arrives at Atlas — never claimed, always real. */
export type SourceMechanism = "polling" | "webhook" | "manual";

export interface EventPayloadField {
  key: string;
  type: "string" | "number" | "boolean" | "string_array" | "number_array";
  required?: boolean;
  description: string;
}

export interface EventDefinition {
  /** Stable id: "<provider>.<event>" e.g. "drive.file_created". */
  id: string;
  /** Same as id. */
  type: string;
  provider: string;
  /** Human-readable connector label, e.g. "Google Drive". */
  connector: string;
  description: string;
  version: string;
  /** Where the event originates, e.g. "google-drive-changes-poll". */
  source: string;
  /** Allowed payload keys + validation. */
  payloadSchema: { fields: EventPayloadField[] };
  /** OAuth scopes the connected account must have granted. */
  requiredScopes: string[];
  implementationStatus: "implemented" | "planned";
  /** How this event actually arrives today. */
  sourceMechanism: SourceMechanism;
  /** "provider_key" uses the provider's own idempotency identity. */
  deduplicationStrategy: "provider_key" | "resource_hash";
  /** Handler dispatch id — null while planned. */
  handlerId: string | null;
  documentationUrl?: string;
}

/**
 * The normalized internal event envelope. Tenant identity is NEVER taken from
 * an external payload — it is resolved from the authenticated connection.
 */
export interface EventEnvelope {
  eventType: string;
  provider: string;
  connectorId: string | null;
  /** Resolved server-side from the connection — never from the payload. */
  tenantId: string;
  connectionId: string | null;
  sourceResourceId: string;
  occurredAt: number;
  receivedAt: number;
  payload: Record<string, unknown>;
  payloadVersion: string;
  correlationId?: string | null;
  idempotencyKey: string;
  /** How this event arrived. */
  sourceMechanism: SourceMechanism;
  /** Provider's own event identity (e.g. Drive changeId) when available. */
  providerEventId?: string | null;
}

// ---------------------------------------------------------------------------
// Deterministic identity (works in every runtime — no node crypto)
// ---------------------------------------------------------------------------

/**
 * Deterministic 64-bit FNV-1a hash — stable across runtimes and platforms.
 * Used for event ids and fallback idempotency keys (not a cryptographic use).
 */
export function hashString(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c;
    h2 = Math.imul(h2, 0x85ebca6b) ^ (h2 >>> 13);
  }
  h1 = (h1 ^ (h1 >>> 16)) >>> 0;
  h2 = (h2 ^ (h2 >>> 16)) >>> 0;
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

export interface IdempotencyInput {
  provider: string;
  connectionId: string | null;
  eventType: string;
  sourceResourceId: string;
  occurredAt: number;
  /** Provider-supplied key (e.g. Drive changeId) — preferred when present. */
  providerKey?: string | null;
}

/**
 * Prefer the provider's own idempotency identity; fall back to a stable hash
 * of the event's identity fields. The same real event always yields the same
 * key — a re-delivered event can never double-apply.
 */
export function buildIdempotencyKey(input: IdempotencyInput): string {
  if (input.providerKey) {
    return `${input.provider}:${input.connectionId ?? "?"}:${input.providerKey}`;
  }
  return hashString(
    `${input.provider}|${input.connectionId ?? "?"}|${input.eventType}|` +
      `${input.sourceResourceId}|${input.occurredAt}`,
  );
}

/** Deterministic event id — the same event always maps to the same id. */
export function deterministicEventId(idempotencyKey: string): string {
  return `evt_${hashString(idempotencyKey)}`;
}

// ---------------------------------------------------------------------------
// Envelope validation (before anything is persisted)
// ---------------------------------------------------------------------------

const REQUIRED_ENVELOPE_KEYS: Array<{
  key: keyof EventEnvelope;
  type: "string" | "number" | "object" | "string-or-null";
}> = [
  { key: "eventType", type: "string" },
  { key: "provider", type: "string" },
  { key: "sourceResourceId", type: "string" },
  { key: "occurredAt", type: "number" },
  { key: "receivedAt", type: "number" },
  { key: "payload", type: "object" },
  { key: "payloadVersion", type: "string" },
  { key: "idempotencyKey", type: "string" },
];

export type EnvelopeValidation =
  | { ok: true; envelope: EventEnvelope }
  | { ok: false; errors: string[] };

export function validateEnvelope(input: unknown): EnvelopeValidation {
  const errors: string[] = [];
  if (!input || typeof input !== "object") {
    return { ok: false, errors: ["Envelope must be an object."] };
  }
  const e = input as Record<string, unknown>;
  for (const { key, type } of REQUIRED_ENVELOPE_KEYS) {
    const v = e[key];
    if (type === "object") {
      if (!v || typeof v !== "object" || Array.isArray(v)) {
        errors.push(`Envelope field "${key}" must be an object.`);
      }
    } else if (type === "string-or-null") {
      if (v != null && typeof v !== "string") {
        errors.push(`Envelope field "${key}" must be a string or null.`);
      }
    } else if (typeof v !== type) {
      errors.push(`Envelope field "${key}" must be a ${type}.`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  const e2 = e as unknown as EventEnvelope;
  if (!e2.eventType || e2.eventType.length > 120) {
    errors.push("Envelope eventType is invalid.");
  }
  if (Number.isNaN(e2.occurredAt) || e2.occurredAt <= 0) {
    errors.push("Envelope occurredAt must be a positive timestamp.");
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, envelope: e2 };
}

// ---------------------------------------------------------------------------
// Payload sanitization — never persist raw provider bodies
// ---------------------------------------------------------------------------

const SENSITIVE_KEY = /token|secret|authorization|api[_-]?key|password|credential/i;

/**
 * Recursively redact anything that looks like a credential and truncate deep
 * structures. Provider payloads are ALSO restricted to the declared schema
 * keys before they are stored — this is the second, deeper safety net.
 */
export function sanitizeEventPayload(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (Array.isArray(value)) return value.map((x) => sanitizeEventPayload(x, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k)
        ? "[redacted]"
        : sanitizeEventPayload(val, depth + 1);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Retry model — bounded, honest
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_ATTEMPTS = 5;
export const RETRY_BASE_MS = 15_000;
export const RETRY_CAP_MS = 30 * 60 * 1000;

export type RetryClass = "retryable" | "permanent";

const RETRYABLE_MESSAGE = /fetch failed|network|timeout|timed out|temporar|rate limit|rate_limit|econnreset|econnrefused|socket hang|429|502|503|504/i;

/**
 * Classify a processing failure. Explicit codes first (sanitized ToolError
 * codes from the tool runtime), then message patterns. Defaults to permanent —
 * Atlas never hammers an event that will never succeed.
 */
export function classifyFailure(
  error: unknown,
  code?: string | null,
): RetryClass {
  const c = (code ?? "").toLowerCase();
  if (
    c.includes("rate_limited") ||
    c.includes("429") ||
    /drive_api_(5\d\d|429)/.test(c) ||
    c === "network" ||
    c === "timeout"
  ) {
    return "retryable";
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (RETRYABLE_MESSAGE.test(message)) return "retryable";
  return "permanent";
}

/** Bounded exponential backoff (first retry waits the base interval). */
export function backoffMs(attempt: number, baseMs = RETRY_BASE_MS): number {
  const factor = Math.max(0, attempt - 1);
  return Math.min(baseMs * 2 ** factor, RETRY_CAP_MS);
}

/** Map an error to a short, sanitized message for the event record. */
export function sanitizeEventError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.length > 300 ? `${error.message.slice(0, 300)}…` : error.message;
  }
  return "Event processing failed.";
}

/** Default event description when a definition is missing. */
export function defaultEventDescription(eventType: string): string {
  return `Event "${eventType}" was received from a connected source.`;
}
