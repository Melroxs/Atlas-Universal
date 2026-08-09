// ---------------------------------------------------------------------------
// Tool input validation.
//
// Model-generated or client-supplied JSON is NEVER executed blindly. Every
// payload passes through validateToolInput: unknown keys are stripped, types
// coerced, enums/limits enforced. The result is the only input a handler sees.
// ---------------------------------------------------------------------------

import type { ToolDefinition, ToolField } from "./registry";

export type ValidatedInput = Record<string, string | number | boolean>;

export interface ValidationResult {
  ok: boolean;
  value: ValidatedInput;
  errors: string[];
}

export function validateToolInput(
  tool: ToolDefinition,
  raw: unknown,
): ValidationResult {
  const errors: string[] = [];
  const value: ValidatedInput = {};
  const source: Record<string, unknown> =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  for (const field of tool.inputSchema.fields) {
    const present = field.key in source && source[field.key] !== undefined && source[field.key] !== null;
    if (!present) {
      if (field.required) {
        errors.push(`"${field.key}" is required.`);
      }
      continue;
    }
    const rawValue = source[field.key];
    const coerced = coerce(field, rawValue);
    if (coerced === undefined) {
      errors.push(`"${field.key}" must be a valid ${field.type}${field.enum ? ` (${field.enum.join(", ")})` : ""}.`);
      continue;
    }
    if (typeof coerced === "string") {
      if (field.minLength !== undefined && coerced.length < field.minLength) {
        errors.push(`"${field.key}" must be at least ${field.minLength} characters.`);
        continue;
      }
      if (field.maxLength !== undefined && coerced.length > field.maxLength) {
        errors.push(`"${field.key}" must be at most ${field.maxLength} characters.`);
        continue;
      }
    }
    if (typeof coerced === "number") {
      if (field.min !== undefined && coerced < field.min) {
        errors.push(`"${field.key}" must be at least ${field.min}.`);
        continue;
      }
      if (field.max !== undefined && coerced > field.max) {
        errors.push(`"${field.key}" must be at most ${field.max}.`);
        continue;
      }
    }
    value[field.key] = coerced;
  }

  // Anything not declared in the schema is dropped — never forwarded.
  return { ok: errors.length === 0, value, errors };
}

function coerce(field: ToolField, raw: unknown): string | number | boolean | undefined {
  switch (field.type) {
    case "string":
      return typeof raw === "string" ? raw : typeof raw === "number" ? String(raw) : undefined;
    case "number":
      if (typeof raw === "number" && Number.isFinite(raw)) return raw;
      if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) {
        return Number(raw);
      }
      return undefined;
    case "boolean":
      if (typeof raw === "boolean") return raw;
      if (raw === "true") return true;
      if (raw === "false") return false;
      return undefined;
    case "enum":
      if (typeof raw === "string" && field.enum?.includes(raw)) return raw;
      return undefined;
  }
}

/** Describe a tool's form controls for the UI (generated from the schema). */
export function describeFormFields(tool: ToolDefinition): ToolField[] {
  return tool.inputSchema.fields;
}
