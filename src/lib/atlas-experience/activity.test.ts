// ---------------------------------------------------------------------------
// Atlas Activity Model Tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  type AtlasActivity,
  CATEGORY_SIGNIFICANCE,
  CATEGORY_LABELS,
  claimEventToActivity,
  jobEventToActivity,
  recommendationEventToActivity,
  documentEventToActivity,
  crmEventToActivity,
} from "./activity";
import {
  getDateLabel,
  groupActivitiesByDate,
  computeWorkspaceActivitySummary,
  filterBySignificance,
  filterByCategory,
  filterByActorType,
  filterByEntity,
  filterImportantActivities,
  getRecentActivities,
} from "./activity-aggregation";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 86_400_000;

function makeActivity(overrides: Partial<AtlasActivity> = {}): AtlasActivity {
  return {
    id: `test-${Math.random().toString(36).slice(2, 8)}`,
    entity: { type: "claim", id: "claim-1", label: "Test Claim" },
    category: "user_action",
    actor: { type: "user", label: "Test User" },
    title: "Test Activity",
    timestamp: NOW,
    significance: "routine",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Activity Model Tests
// ---------------------------------------------------------------------------

describe("AtlasActivity model", () => {
  it("has significance for every category", () => {
    for (const category of Object.keys(CATEGORY_LABELS)) {
      expect(CATEGORY_SIGNIFICANCE[category as keyof typeof CATEGORY_SIGNIFICANCE]).toBeDefined();
    }
  });

  it("has a label for every category", () => {
    for (const category of Object.keys(CATEGORY_SIGNIFICANCE)) {
      expect(CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS]).toBeDefined();
    }
  });

  it("claimEventToActivity creates correct activity", () => {
    const activity = claimEventToActivity({
      label: "Atlas discovered evidence gap",
      detail: "Missing scope documentation",
      ts: NOW,
      source: "atlas",
    });

    expect(activity.actor.type).toBe("atlas");
    expect(activity.title).toBe("Atlas discovered evidence gap");
    expect(activity.summary).toBe("Missing scope documentation");
    expect(activity.timestamp).toBe(NOW);
  });

  it("jobEventToActivity maps job_completed correctly", () => {
    const activity = jobEventToActivity({
      _id: "job-1",
      event_type: "job_completed",
      actor: "system",
      payload: { job_id: "j1" },
      _creationTime: NOW,
      job_type: "evidence_extraction",
    });

    expect(activity.category).toBe("job_completed");
    expect(activity.actor.type).toBe("system");
    expect(activity.significance).toBe("routine");
  });

  it("jobEventToActivity maps job_failed to important", () => {
    const activity = jobEventToActivity({
      _id: "job-2",
      event_type: "job_failed",
      actor: "system",
      payload: { job_id: "j2", error: "Timeout" },
      _creationTime: NOW,
      job_type: "document_ingestion",
    });

    expect(activity.category).toBe("job_failed");
    expect(activity.significance).toBe("important");
    expect(activity.summary).toBe("Timeout");
  });

  it("recommendationEventToActivity maps approved correctly", () => {
    const activity = recommendationEventToActivity({
      _id: "rec-1",
      title: "Supplement opportunity",
      actionType: "approved",
      status: "approved",
      _creationTime: NOW,
    });

    expect(activity.category).toBe("recommendation_approved");
    expect(activity.significance).toBe("important");
  });

  it("documentEventToActivity maps processing_failed correctly", () => {
    const activity = documentEventToActivity({
      _id: "doc-1",
      title: "estimate.pdf",
      status: "failed",
      _creationTime: NOW,
    });

    expect(activity.category).toBe("document_processing_failed");
    expect(activity.significance).toBe("important");
  });

  it("crmEventToActivity maps reply_received correctly", () => {
    const activity = crmEventToActivity({
      _id: "crm-1",
      type: "reply_received",
      companyName: "NPP Roofing",
      _creationTime: NOW,
    });

    expect(activity.category).toBe("crm_reply_received");
    expect(activity.significance).toBe("important");
  });
});

// ---------------------------------------------------------------------------
// Aggregation Tests
// ---------------------------------------------------------------------------

describe("getDateLabel", () => {
  it("returns 'Today' for recent timestamps", () => {
    const label = getDateLabel(NOW - 1000);
    expect(label).toBe("Today");
  });

  it("returns 'Yesterday' for timestamps from yesterday", () => {
    const label = getDateLabel(NOW - DAY - 1000);
    expect(label).toBe("Yesterday");
  });

  it("returns a day name for timestamps within last week", () => {
    const label = getDateLabel(NOW - DAY * 3);
    // Should be a day name like "Monday", "Tuesday", etc.
    expect(label.length).toBeGreaterThan(2);
    expect(label).not.toBe("Today");
    expect(label).not.toBe("Yesterday");
  });
});

describe("groupActivitiesByDate", () => {
  it("groups activities by date label", () => {
    const activities = [
      makeActivity({ timestamp: NOW - 1000, id: "a1" }),
      makeActivity({ timestamp: NOW - 2000, id: "a2" }),
      makeActivity({ timestamp: NOW - DAY - 1000, id: "a3" }),
    ];

    const groups = groupActivitiesByDate(activities);
    expect(groups.length).toBeGreaterThanOrEqual(1);
    // Today's activities should be first
    expect(groups[0].label).toBe("Today");
    expect(groups[0].activities.length).toBe(2);
  });

  it("returns empty array for no activities", () => {
    expect(groupActivitiesByDate([])).toEqual([]);
  });
});

describe("filtering functions", () => {
  const activities = [
    makeActivity({ significance: "important", category: "contradiction_found", actor: { type: "atlas", label: "Atlas" }, entity: { type: "claim", id: "c1", label: "Claim 1" } }),
    makeActivity({ significance: "routine", category: "user_action", actor: { type: "user", label: "User" }, entity: { type: "claim", id: "c1", label: "Claim 1" } }),
    makeActivity({ significance: "notable", category: "document_uploaded", actor: { type: "system", label: "System" }, entity: { type: "document", id: "d1", label: "Doc 1" } }),
  ];

  it("filterBySignificance works", () => {
    expect(filterBySignificance(activities, "important").length).toBe(1);
    expect(filterBySignificance(activities, "routine").length).toBe(1);
  });

  it("filterByCategory works", () => {
    expect(filterByCategory(activities, "contradiction_found").length).toBe(1);
    expect(filterByCategory(activities, "user_action", "document_uploaded").length).toBe(2);
  });

  it("filterByActorType works", () => {
    expect(filterByActorType(activities, "atlas").length).toBe(1);
    expect(filterByActorType(activities, "user").length).toBe(1);
    expect(filterByActorType(activities, "system").length).toBe(1);
  });

  it("filterByEntity works", () => {
    expect(filterByEntity(activities, "claim", "c1").length).toBe(2);
    expect(filterByEntity(activities, "document", "d1").length).toBe(1);
    expect(filterByEntity(activities, "claim", "nonexistent").length).toBe(0);
  });

  it("filterImportantActivities returns important + notable", () => {
    const result = filterImportantActivities(activities);
    expect(result.length).toBe(2);
  });

  it("getRecentActivities returns top N", () => {
    const result = getRecentActivities(activities, 2);
    expect(result.length).toBe(2);
    // Should be sorted newest first
    expect(result[0].timestamp).toBeGreaterThanOrEqual(result[1].timestamp);
  });
});

describe("computeWorkspaceActivitySummary", () => {
  it("computes summary correctly", () => {
    const activities = [
      makeActivity({ significance: "important", actor: { type: "atlas", label: "Atlas" }, timestamp: NOW - 1000 }),
      makeActivity({ significance: "routine", actor: { type: "user", label: "User" }, timestamp: NOW - 2000 }),
      makeActivity({ significance: "notable", actor: { type: "system", label: "System" }, timestamp: NOW - 2 * DAY }),
    ];

    const summary = computeWorkspaceActivitySummary(activities);
    expect(summary.lastActivityAt).toBe(NOW - 1000);
    expect(summary.recentImportantCount).toBe(1);
    expect(summary.recentAtlasDiscoveries).toBe(1);
    expect(summary.recentHumanActions).toBe(1);
    expect(summary.totalRecentCount).toBe(2); // Only 2 within 1 day window
  });

  it("handles empty activities", () => {
    const summary = computeWorkspaceActivitySummary([]);
    expect(summary.lastActivityAt).toBeNull();
    expect(summary.totalRecentCount).toBe(0);
  });
});
