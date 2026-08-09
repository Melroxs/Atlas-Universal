// ---------------------------------------------------------------------------
// Structured condition evaluation.
//
// Workflow "condition" steps evaluate declarative conditions against the
// instance context. Malformed conditions fail CLOSED (false + error) — a
// broken condition never lets a step run by accident.
//
// PURE module.
// ---------------------------------------------------------------------------

import type { Condition } from "./contract";
import { getContextPath } from "./contract";

export interface ConditionResult {
  result: boolean;
  error?: string;
}

export function evaluateCondition(
  condition: Condition | undefined,
  context: Record<string, unknown>,
): ConditionResult {
  if (!condition) return { result: true };
  switch (condition.op) {
    case "and": {
      for (const c of condition.conditions) {
        const r = evaluateCondition(c, context);
        if (r.error) return { result: false, error: r.error };
        if (!r.result) return { result: false };
      }
      return { result: true };
    }
    case "or": {
      for (const c of condition.conditions) {
        const r = evaluateCondition(c, context);
        if (r.error) return { result: false, error: r.error };
        if (r.result) return { result: true };
      }
      return { result: false };
    }
    case "not": {
      const r = evaluateCondition(condition.condition, context);
      return { result: !r.result, error: r.error };
    }
    case "exists": {
      const v = getContextPath(context, condition.path);
      return { result: v !== undefined && v !== null };
    }
    case "equals": {
      const v = getContextPath(context, condition.path);
      return { result: String(v ?? "") === String(condition.value ?? "") };
    }
    case "contains": {
      const v = getContextPath(context, condition.path);
      if (Array.isArray(v)) return { result: v.includes(condition.value as never) };
      if (typeof v === "string") {
        return { result: v.includes(String(condition.value ?? "")) };
      }
      return { result: false };
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const v = getContextPath(context, condition.path);
      const a = Number(v);
      const b = Number(condition.value);
      if (Number.isNaN(a) || Number.isNaN(b)) {
        return { result: false, error: `Condition "${condition.op}" on "${condition.path}" could not compare values.` };
      }
      switch (condition.op) {
        case "gt":
          return { result: a > b };
        case "gte":
          return { result: a >= b };
        case "lt":
          return { result: a < b };
        case "lte":
          return { result: a <= b };
      }
    }
    default:
      return { result: false, error: "Unknown condition operator." };
  }
}
