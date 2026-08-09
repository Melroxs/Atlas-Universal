// ---------------------------------------------------------------------------
// Event payload validation.
//
// Every event payload is validated + restricted to the keys declared in the
// registered EventDefinition before it is persisted or processed. Unknown
// keys are stripped, types are coerced, required fields are enforced.
//
// PURE module — unit-testable and shared by the ingest mutation and processor.
// ---------------------------------------------------------------------------

import type { EventDefinition, EventPayloadField } from "./contract";

export interface ValidatedEventPayload {
  ok: true;
  value: Record<string, unknown>;
  errors: string[];
}
export interface InvalidEventPayload {
  ok: false;
  value: null;
  errors: string[];
}
export type PayloadValidation = ValidatedEventPayload | InvalidEventPayload;

function coerceScalar(field: EventPayloadField, raw: unknown): unknown | null {
  switch (field.type) {
    case "string":
      if (typeof raw === "number") return String(raw);
      if (typeof raw !== "string") return null;
      return raw;
    case "number":
      if (typeof raw === "string") {
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
      }
      if (typeof raw !== "number" || Number.isNaN(raw)) return null;
      return raw;
    case "boolean":
      if (typeof raw === "boolean") return raw;
      if (raw === "true") return true;
      if (raw === "false") return false;
      return null;
    case "string_array":
      if (Array.isArray(raw) && raw.every((x) => typeof x === "string")) {
        return raw;
      }
      if (typeof raw === "string") return raw ? [raw] : [];
      return null;
    case "number_array":
      if (
        Array.isArray(raw) &&
        raw.every((x) => typeof x === "number" && !Number.isNaN(x))
      ) {
        return raw;
      }
      return null;
  }
  return null;
}

/** Validate a payload against the definition and return only schema keys. */
export function validateEventPayload(
  def: EventDefinition | undefined,
  payload: unknown,
): PayloadValidation {
  const errors: string[] = [];
  if (!def) {
    return { ok: false, value: null, errors: ["No event definition is registered."] };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, value: null, errors: ["Event payload must be an object."] };
  }
  const raw = payload as Record<string, unknown>;
  const value: Record<string, unknown> = {};
  for (const field of def.payloadSchema.fields) {
    const r = raw[field.key];
    if (r === undefined || r === null) {
      if (field.required) errors.push(`Missing required payload field "${field.key}".`);
      continue;
    }
    const coerced = coerceScalar(field, r);
    if (coerced === null) {
      errors.push(`Payload field "${field.key}" has an invalid value.`);
      continue;
    }
    value[field.key] = coerced;
  }
  if (errors.length > 0) return { ok: false, value: null, errors };
  return { ok: true, value, errors: [] };
}
