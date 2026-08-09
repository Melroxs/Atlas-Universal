import { describe, expect, it } from "vitest";
import { evaluateRules, extractEvidence } from "./decision";
import type { DecisionRule } from "./contract";

const DEFAULTS = {
  decision: "no_action",
  confidence: 0.5,
  rationale: "No rule matched.",
  risk: "READ" as const,
  requiresHumanReview: false,
};

function rule(overrides: Partial<DecisionRule> = {}): DecisionRule {
  return {
    if: { op: "exists", path: "document._id" },
    then: {
      decision: "mark_reviewed",
      confidence: 0.9,
      requiresHumanReview: true,
      nextStepId: "approve",
      rationale: "A known document changed.",
    },
    ...overrides,
  };
}

describe("evaluateRules", () => {
  it("returns a structured decision with evidence, confidence and rationale", () => {
    const d = evaluateRules(
      [rule()],
      { document: { _id: "doc_1" }, evidenceReferences: [{ kind: "event", title: "drive.file_updated" }] },
      DEFAULTS,
    );
    expect(d.decision).toBe("mark_reviewed");
    expect(d.confidence).toBe(0.9);
    expect(d.requiresHumanReview).toBe(true);
    expect(d.recommendedNextStep).toBe("approve");
    expect(d.rationale.length).toBeGreaterThan(0);
    expect(d.evidenceReferences.length).toBe(1);
    expect(d.risk).toBe("READ");
  });

  it("first matching rule wins", () => {
    const d = evaluateRules(
      [
        rule({ if: { op: "equals", path: "document.mimeType", value: "text/plain" }, then: { decision: "plain", confidence: 0.5, requiresHumanReview: false, rationale: "a" } }),
        rule({ if: { op: "exists", path: "document._id" }, then: { decision: "any", confidence: 0.8, requiresHumanReview: true, rationale: "b" } }),
      ],
      { document: { _id: "doc_1", mimeType: "text/plain" } },
      DEFAULTS,
    );
    expect(d.decision).toBe("plain");
  });

  it("falls back to defaults when no rule matches — no action by default", () => {
    const d = evaluateRules([rule({ if: { op: "exists", path: "document.missing" } })], { document: {} }, DEFAULTS);
    expect(d.decision).toBe("no_action");
    expect(d.recommendedNextStep).toBeNull();
    expect(d.requiresHumanReview).toBe(false);
  });

  it("fails closed when a rule condition errors (never silently approves)", () => {
    const d = evaluateRules(
      [{ if: { op: "gt", path: "document.size", value: "nope" }, then: { decision: "approve", confidence: 1, requiresHumanReview: false, rationale: "x" } }],
      { document: { size: 10 } },
      DEFAULTS,
    );
    expect(d.decision).toBe("no_action");
  });

  it("clamps confidence into [0,1]", () => {
    const d = evaluateRules(
      [{ if: { op: "exists", path: "document._id" }, then: { decision: "x", confidence: 1.7, requiresHumanReview: false, rationale: "x" } }],
      { document: { _id: "d" } },
      DEFAULTS,
    );
    expect(d.confidence).toBe(1);
  });

  it("recommendedNextStep honors the rule, then the default, then null", () => {
    const withDefault = evaluateRules([], {}, { ...DEFAULTS, recommendedNextStep: "gate" });
    expect(withDefault.recommendedNextStep).toBe("gate");
    const none = evaluateRules([], {}, DEFAULTS);
    expect(none.recommendedNextStep).toBeNull();
  });
});

describe("extractEvidence", () => {
  it("extracts only well-formed references and caps the count", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ kind: "document", documentId: `d_${i}`, title: `Doc ${i}` }));
    const out = extractEvidence({ evidenceReferences: many });
    expect(out.length).toBe(10);
    expect(out[0].kind).toBe("document");
    expect(out[0].documentId).toBe("d_0");
  });

  it("ignores malformed references", () => {
    expect(extractEvidence({ evidenceReferences: ["junk", { kind: "event" }] })).toEqual([
      { kind: "event" },
    ]);
    expect(extractEvidence({})).toEqual([]);
    expect(extractEvidence({ evidenceReferences: "nope" })).toEqual([]);
  });
});
