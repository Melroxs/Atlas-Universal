// ---------------------------------------------------------------------------
// Atlas Command Center Tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  computeSystemStatus,
  selectNextBestAction,
  buildAskAtlasContext,
} from "./command-center";
import { type AttentionItem } from "./attention";
import { type AtlasActivity } from "./activity";
import { type AtlasDecision } from "./decision";
import { type WorkspaceHealth } from "./context";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = Date.now();

const DEFAULT_HEALTH: WorkspaceHealth = {
  documents: 10,
  entities: 50,
  openSignals: 3,
  activeWorkflows: 2,
  openClaims: 5,
  pipelineActive: true,
};

function makeAttention(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: `att-${Math.random().toString(36).slice(2, 8)}`,
    severity: "medium",
    category: "evidence_gap",
    title: "Test attention",
    explanation: "Test explanation",
    timestamp: NOW,
    status: "open",
    ...overrides,
  };
}

function makeDecision(overrides: Partial<AtlasDecision> = {}): AtlasDecision {
  return {
    id: `dec-${Math.random().toString(36).slice(2, 8)}`,
    entity: { type: "claim", id: "claim-1", label: "Test Claim" },
    observation: { title: "Test observation", summary: "Test summary" },
    importance: { severity: "medium" },
    evidence: [],
    recommendation: { title: "Test recommendation", summary: "Test rec", reasoning: "Because" },
    status: "new",
    requiresApproval: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeActivity(overrides: Partial<AtlasActivity> = {}): AtlasActivity {
  return {
    id: `act-${Math.random().toString(36).slice(2, 8)}`,
    entity: { type: "claim", id: "claim-1", label: "Test Claim" },
    category: "user_action",
    actor: { type: "user", label: "User" },
    title: "Test activity",
    timestamp: NOW,
    significance: "routine",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// System Status Tests
// ---------------------------------------------------------------------------

describe("computeSystemStatus", () => {
  it("returns online status for healthy workspace", () => {
    const status = computeSystemStatus(DEFAULT_HEALTH);
    expect(status.online).toBe(true);
    expect(status.degraded).toBe(false);
    expect(status.statusMessage).toBe("Atlas is online");
  });

  it("detects empty workspace as degraded", () => {
    const health: WorkspaceHealth = {
      documents: 0,
      entities: 0,
      openSignals: 0,
      activeWorkflows: 0,
      openClaims: 0,
      pipelineActive: false,
    };
    const status = computeSystemStatus(health);
    expect(status.degraded).toBe(true);
    expect(status.statusMessage).toContain("knowledge base is empty");
  });
});

// ---------------------------------------------------------------------------
// Next Best Action Tests
// ---------------------------------------------------------------------------

describe("selectNextBestAction", () => {
  it("returns null when no signals exist", () => {
    const result = selectNextBestAction({
      attentionItems: [],
      decisions: [],
      activities: [],
    });
    expect(result).toBeNull();
  });

  it("prioritizes critical attention items first", () => {
    const result = selectNextBestAction({
      attentionItems: [
        makeAttention({ severity: "medium", status: "open" }),
        makeAttention({ severity: "critical", status: "open", title: "Critical issue" }),
      ],
      decisions: [],
      activities: [],
    });
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Critical issue");
    expect(result!.priorityScore).toBe(0);
  });

  it("prioritizes pending approvals after critical attention", () => {
    const result = selectNextBestAction({
      attentionItems: [],
      decisions: [
        makeDecision({
          requiresApproval: true,
          status: "new",
          recommendation: { title: "Approve supplement", summary: "", reasoning: "Because" },
        }),
      ],
      activities: [],
    });
    expect(result).not.toBeNull();
    expect(result!.actionType).toBe("approve");
  });

  it("falls back to revenue opportunities", () => {
    const result = selectNextBestAction({
      attentionItems: [],
      decisions: [
        makeDecision({
          status: "new",
          importance: { severity: "medium", impact: 8420 },
          recommendation: { title: "Review supplement", summary: "", reasoning: "Because" },
        }),
      ],
      activities: [],
    });
    expect(result).not.toBeNull();
    expect(result!.reason).toContain("$8,420");
  });

  it("skips non-open attention items", () => {
    const result = selectNextBestAction({
      attentionItems: [
        makeAttention({ severity: "critical", status: "acknowledged" }),
      ],
      decisions: [],
      activities: [],
    });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Ask Atlas Context Tests
// ---------------------------------------------------------------------------

describe("buildAskAtlasContext", () => {
  it("builds context from real data", () => {
    const context = buildAskAtlasContext({
      health: DEFAULT_HEALTH,
      attentionItems: [
        makeAttention({ severity: "critical", title: "Contradiction found" }),
        makeAttention({ severity: "medium", title: "Evidence gap" }),
      ],
      activities: [
        makeActivity({ timestamp: NOW - 1000 }),
        makeActivity({ timestamp: NOW - 2000, actor: { type: "atlas", label: "Atlas" } }),
      ],
      decisions: [
        makeDecision({
          requiresApproval: true,
          status: "new",
          observation: { title: "Approve supplement", summary: "" },
        }),
        makeDecision({
          status: "new",
          importance: { severity: "high", impact: 5000 },
          observation: { title: "Revenue opportunity", summary: "" },
        }),
      ],
    });

    expect(context.workspaceHealth).toContain("10 documents");
    expect(context.criticalAttention).toContain("1 critical/high");
    expect(context.recentActivity).toContain("2 activities today");
    expect(context.pendingDecisions).toContain("1 decisions pending approval");
    expect(context.highImpactRecommendations).toContain("$5,000");
  });

  it("handles empty data gracefully", () => {
    const context = buildAskAtlasContext({
      health: { documents: 0, entities: 0, openSignals: 0, activeWorkflows: 0, openClaims: 0, pipelineActive: false },
      attentionItems: [],
      activities: [],
      decisions: [],
    });

    expect(context.workspaceHealth).toContain("empty");
    expect(context.criticalAttention).toContain("No critical");
    expect(context.recentActivity).toContain("No recent");
    expect(context.pendingDecisions).toContain("No pending");
    expect(context.highImpactRecommendations).toContain("No high-impact");
  });

  it("includes current entity context when provided", () => {
    const context = buildAskAtlasContext({
      health: DEFAULT_HEALTH,
      attentionItems: [],
      activities: [],
      decisions: [],
      currentEntity: { type: "claim", id: "claim-1", label: "Claim #1042" },
    });

    expect(context.currentEntity).toContain("Claim #1042");
  });
});
