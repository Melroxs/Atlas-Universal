// ---------------------------------------------------------------------------
// Tests for Atlas Action Deduplication
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  deduplicateActionProposals,
  collectAndDeduplicate,
} from "./action-deduplication";

const claimEntity = { type: "claim" as const, id: "c1", label: "Claim #1042" };
const leadEntity = { type: "lead" as const, id: "l1", label: "Lead #1" };

describe("deduplicateActionProposals", () => {
  it("deduplicates same entity + action type from different sources", () => {
    const result = deduplicateActionProposals([
      { actionType: "prepare_supplement", entity: claimEntity, source: "attention", sourceId: "a1" },
      { actionType: "prepare_supplement", entity: claimEntity, source: "decision", sourceId: "d1" },
      { actionType: "prepare_supplement", entity: claimEntity, source: "signal", sourceId: "s1" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].sources).toHaveLength(3);
    expect(result[0].sources.map((s) => s.source)).toContain("attention");
    expect(result[0].sources.map((s) => s.source)).toContain("decision");
    expect(result[0].sources.map((s) => s.source)).toContain("signal");
  });

  it("keeps distinct actions separate", () => {
    const result = deduplicateActionProposals([
      { actionType: "prepare_supplement", entity: claimEntity, source: "attention" },
      { actionType: "approve_recommendation", entity: claimEntity, source: "decision" },
    ]);
    expect(result).toHaveLength(2);
  });

  it("keeps distinct entities separate", () => {
    const result = deduplicateActionProposals([
      { actionType: "prepare_email", entity: claimEntity, source: "attention" },
      { actionType: "prepare_email", entity: leadEntity, source: "signal" },
    ]);
    expect(result).toHaveLength(2);
  });

  it("takes lowest priority across sources", () => {
    const result = deduplicateActionProposals([
      { actionType: "prepare_supplement", entity: claimEntity, source: "signal", priority: 30 },
      { actionType: "prepare_supplement", entity: claimEntity, source: "conversation", priority: 5 },
    ]);
    expect(result[0].priority).toBe(5);
  });

  it("returns empty for empty input", () => {
    expect(deduplicateActionProposals([])).toHaveLength(0);
  });
});

describe("collectAndDeduplicate", () => {
  it("collects from all surfaces and deduplicates", () => {
    const result = collectAndDeduplicate({
      attention: [
        { actionType: "prepare_supplement", entity: claimEntity, id: "a1" },
        { actionType: "prepare_email", entity: leadEntity, id: "a2" },
      ],
      decisions: [
        { actionType: "prepare_supplement", entity: claimEntity, id: "d1" },
      ],
      signals: [
        { actionType: "prepare_supplement", entity: claimEntity, id: "s1" },
      ],
    });
    // prepare_supplement for c1 should be deduplicated
    expect(result).toHaveLength(2);
    const supp = result.find((r) => r.actionType === "prepare_supplement" && r.entity.id === "c1");
    expect(supp).toBeDefined();
    expect(supp!.sources).toHaveLength(3);
  });

  it("handles missing surfaces gracefully", () => {
    const result = collectAndDeduplicate({
      attention: [
        { actionType: "prepare_supplement", entity: claimEntity, id: "a1" },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].sources[0].source).toBe("attention");
  });
});
