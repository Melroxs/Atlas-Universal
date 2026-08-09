import { describe, expect, it } from "vitest";
import { evaluateCondition } from "./conditions";
import type { Condition } from "./contract";

const ctx = {
  decision: { decision: "important_document", confidence: 0.8 },
  document: { _id: "doc_1", mimeType: "application/pdf", size: 2048 },
  tags: ["contract", "legal"],
};

describe("evaluateCondition", () => {
  it("treats a missing condition as true", () => {
    expect(evaluateCondition(undefined, ctx)).toEqual({ result: true });
  });

  it("evaluates exists against present and missing paths", () => {
    expect(evaluateCondition({ op: "exists", path: "document._id" }, ctx)).toEqual({ result: true });
    expect(evaluateCondition({ op: "exists", path: "document.missing" }, ctx)).toEqual({ result: false });
  });

  it("evaluates equals with coercion", () => {
    expect(evaluateCondition({ op: "equals", path: "decision.decision", value: "important_document" }, ctx)).toEqual({ result: true });
    expect(evaluateCondition({ op: "equals", path: "decision.decision", value: "no_action" }, ctx)).toEqual({ result: false });
    expect(evaluateCondition({ op: "equals", path: "document.size", value: 2048 }, ctx)).toEqual({ result: true });
  });

  it("evaluates contains for strings and arrays", () => {
    expect(evaluateCondition({ op: "contains", path: "document.mimeType", value: "pdf" }, ctx)).toEqual({ result: true });
    expect(evaluateCondition({ op: "contains", path: "tags", value: "legal" }, ctx)).toEqual({ result: true });
    expect(evaluateCondition({ op: "contains", path: "tags", value: "nope" }, ctx)).toEqual({ result: false });
    expect(evaluateCondition({ op: "contains", path: "document.missing", value: "x" }, ctx)).toEqual({ result: false });
  });

  it("evaluates numeric comparisons", () => {
    expect(evaluateCondition({ op: "gt", path: "document.size", value: 1000 }, ctx)).toEqual({ result: true });
    expect(evaluateCondition({ op: "gte", path: "document.size", value: 2048 }, ctx)).toEqual({ result: true });
    expect(evaluateCondition({ op: "lt", path: "document.size", value: 2048 }, ctx)).toEqual({ result: false });
    expect(evaluateCondition({ op: "lte", path: "document.size", value: 2048 }, ctx)).toEqual({ result: true });
  });

  it("fails closed with an error on non-numeric comparisons", () => {
    const r = evaluateCondition({ op: "gt", path: "document.mimeType", value: 10 }, ctx);
    expect(r.result).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it("combines and/or/not", () => {
    const and: Condition = {
      op: "and",
      conditions: [
        { op: "exists", path: "document._id" },
        { op: "equals", path: "decision.decision", value: "important_document" },
      ],
    };
    expect(evaluateCondition(and, ctx)).toEqual({ result: true });

    const or: Condition = {
      op: "or",
      conditions: [
        { op: "equals", path: "decision.decision", value: "nope" },
        { op: "exists", path: "document._id" },
      ],
    };
    expect(evaluateCondition(or, ctx)).toEqual({ result: true });

    const not: Condition = { op: "not", condition: { op: "exists", path: "document.missing" } };
    expect(evaluateCondition(not, ctx)).toEqual({ result: true });
  });

  it("short-circuits on a failing sub-condition", () => {
    const c: Condition = {
      op: "and",
      conditions: [
        { op: "equals", path: "decision.decision", value: "nope" },
        { op: "exists", path: "document._id" },
      ],
    };
    expect(evaluateCondition(c, ctx).result).toBe(false);
  });

  it("returns an error for unknown operators (fail closed)", () => {
    const r = evaluateCondition({ op: "regex" as "equals", path: "a", value: 1 }, ctx);
    expect(r.result).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it("missing context fails closed — never silently approves", () => {
    expect(evaluateCondition({ op: "equals", path: "decision.decision", value: "important_document" }, {}).result).toBe(false);
    expect(evaluateCondition({ op: "exists", path: "anything" }, {}).result).toBe(false);
  });
});
