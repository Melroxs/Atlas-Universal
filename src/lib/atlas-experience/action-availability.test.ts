// ---------------------------------------------------------------------------
// Tests for Atlas Action Availability
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  getAvailableActions,
  getExecutableActions,
  createActionProposals,
} from "./action-availability";

describe("getAvailableActions", () => {
  const baseCtx = {
    userRole: "atlas_admin" as const,
    userId: "user-1",
  };

  describe("Claim actions", () => {
    it("shows review evidence for any claim", () => {
      const result = getAvailableActions({
        ...baseCtx,
        entityType: "claim",
        entityId: "c1",
        entityLabel: "Claim #1042",
        entityState: { status: "opened" },
      });
      expect(result.some((a) => a.actionType === "show_evidence")).toBe(true);
    });

    it("shows prepare supplement for opened claims", () => {
      const result = getAvailableActions({
        ...baseCtx,
        entityType: "claim",
        entityId: "c1",
        entityLabel: "Claim #1042",
        entityState: { status: "opened" },
      });
      expect(result.some((a) => a.actionType === "prepare_supplement")).toBe(true);
    });

    it("hides submit supplement when no supplement exists", () => {
      const result = getAvailableActions({
        ...baseCtx,
        entityType: "claim",
        entityId: "c1",
        entityLabel: "Claim #1042",
        entityState: { status: "opened" },
      });
      expect(result.some((a) => a.actionType === "submit_supplement")).toBe(false);
    });

    it("shows submit supplement when ready_for_submission", () => {
      const result = getAvailableActions({
        ...baseCtx,
        entityType: "claim",
        entityId: "c1",
        entityLabel: "Claim #1042",
        entityState: { status: "opened", supplementStatus: "ready_for_submission" },
      });
      expect(result.some((a) => a.actionType === "submit_supplement")).toBe(true);
    });

    it("hides prepare supplement for closed claims", () => {
      const result = getAvailableActions({
        ...baseCtx,
        entityType: "claim",
        entityId: "c1",
        entityLabel: "Claim #1042",
        entityState: { status: "closed" },
      });
      expect(result.some((a) => a.actionType === "prepare_supplement")).toBe(false);
    });

    it("always includes ask atlas", () => {
      const result = getAvailableActions({
        ...baseCtx,
        entityType: "claim",
        entityId: "c1",
        entityLabel: "Claim #1042",
        entityState: { status: "opened" },
      });
      expect(result.some((a) => a.actionType === "ask_followup")).toBe(true);
    });
  });

  describe("Recommendation actions", () => {
    it("shows approve/reject for open recommendations", () => {
      const result = getAvailableActions({
        ...baseCtx,
        entityType: "recommendation",
        entityId: "r1",
        entityLabel: "Recommendation #1",
        entityState: { status: "open" },
      });
      expect(result.some((a) => a.actionType === "approve_recommendation")).toBe(true);
      expect(result.some((a) => a.actionType === "reject_recommendation")).toBe(true);
    });

    it("hides approve/reject for approved recommendations", () => {
      const result = getAvailableActions({
        ...baseCtx,
        entityType: "recommendation",
        entityId: "r1",
        entityLabel: "Recommendation #1",
        entityState: { status: "approved" },
      });
      expect(result.some((a) => a.actionType === "approve_recommendation")).toBe(false);
      expect(result.some((a) => a.actionType === "reject_recommendation")).toBe(false);
    });
  });

  describe("Supplement actions", () => {
    it("shows submit for ready_for_submission", () => {
      const result = getAvailableActions({
        ...baseCtx,
        entityType: "supplement",
        entityId: "s1",
        entityLabel: "Supplement #1",
        entityState: { status: "ready_for_submission" },
      });
      expect(result.some((a) => a.actionType === "submit_supplement")).toBe(true);
    });

    it("hides submit for draft", () => {
      const result = getAvailableActions({
        ...baseCtx,
        entityType: "supplement",
        entityId: "s1",
        entityLabel: "Supplement #1",
        entityState: { status: "draft" },
      });
      expect(result.some((a) => a.actionType === "submit_supplement")).toBe(false);
    });
  });

  describe("Role-based authorization", () => {
    it("denies customer_user from prepare_supplement", () => {
      const result = getAvailableActions({
        ...baseCtx,
        userRole: "customer_user",
        entityType: "claim",
        entityId: "c1",
        entityLabel: "Claim #1042",
        entityState: { status: "opened" },
      });
      const prepareSupp = result.find((a) => a.actionType === "prepare_supplement");
      expect(prepareSupp?.authorized).toBe(false);
      expect(prepareSupp?.available).toBe(false);
    });

    it("allows atlas_admin for prepare_supplement", () => {
      const result = getAvailableActions({
        ...baseCtx,
        userRole: "atlas_admin",
        entityType: "claim",
        entityId: "c1",
        entityLabel: "Claim #1042",
        entityState: { status: "opened" },
      });
      const prepareSupp = result.find((a) => a.actionType === "prepare_supplement");
      expect(prepareSupp?.authorized).toBe(true);
      expect(prepareSupp?.available).toBe(true);
    });
  });

  describe("Unknown entity type", () => {
    it("returns empty for unknown entity types", () => {
      const result = getAvailableActions({
        ...baseCtx,
        entityType: "company",
        entityId: "comp1",
        entityLabel: "Company",
        entityState: {},
      });
      expect(result).toHaveLength(0);
    });
  });
});

describe("getExecutableActions", () => {
  it("filters to only authorized actions", () => {
    const result = getExecutableActions({
      userRole: "customer_user",
      userId: "user-1",
      entityType: "claim",
      entityId: "c1",
      entityLabel: "Claim #1042",
      entityState: { status: "opened" },
    });
    // customer_user should not see prepare_supplement
    expect(result.some((a) => a.actionType === "prepare_supplement")).toBe(false);
    // but should see show_evidence (low risk)
    expect(result.some((a) => a.actionType === "show_evidence")).toBe(true);
  });
});

describe("createActionProposals", () => {
  it("creates proposals from available actions", () => {
    const proposals = createActionProposals({
      userRole: "atlas_admin",
      userId: "user-1",
      entityType: "claim",
      entityId: "c1",
      entityLabel: "Claim #1042",
      entityState: { status: "opened" },
    });
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals[0].entity.id).toBe("c1");
    expect(proposals[0].entity.type).toBe("claim");
  });

  it("filters by action type when specified", () => {
    const proposals = createActionProposals(
      {
        userRole: "atlas_admin",
        userId: "user-1",
        entityType: "claim",
        entityId: "c1",
        entityLabel: "Claim #1042",
        entityState: { status: "opened" },
      },
      ["prepare_supplement"],
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0].type).toBe("prepare_supplement");
  });
});
