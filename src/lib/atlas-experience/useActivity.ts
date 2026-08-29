// ---------------------------------------------------------------------------
// useActivity Hook
//
// React hook that connects the Activity aggregation layer to the component
// tree. Provides activity data for Dashboard, entity pages, and Ask Atlas.
// ---------------------------------------------------------------------------

import { useMemo, useState, useCallback } from "react";
import { useQuery } from "@/hooks/use-supabase";
import { api } from "@/lib/api";
import {
  type AtlasActivity,
  type ActivityDateGroup,
  type WorkspaceActivitySummary,
} from "./activity";
import {
  collectClaimActivity,
  collectJobActivity,
  collectRecommendationActivity,
  collectDocumentActivity,
  collectCrmActivity,
  groupActivitiesByDate,
  computeWorkspaceActivitySummary,
  filterByEntity,
  filterImportantActivities,
  getRecentActivities,
} from "./activity-aggregation";
import { useAtlasContext } from "./context";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseActivityResult {
  /** All collected activities */
  activities: AtlasActivity[];
  /** Activities grouped by date */
  dateGroups: ActivityDateGroup[];
  /** Workspace-level activity summary */
  workspaceSummary: WorkspaceActivitySummary;
  /** Whether activity data is loading */
  isLoading: boolean;
  /** Filter activities by entity */
  forEntity: (entityType: string, entityId: string) => AtlasActivity[];
  /** Get only important/notable activities */
  importantOnly: () => AtlasActivity[];
  /** Get the most recent N activities */
  recent: (n: number) => AtlasActivity[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useActivity(): UseActivityResult {
  const [loading, setLoading] = useState(false);

  // Query existing data that feeds into activity
  // We use the existing queries that are already available
  const jobEvents = useQuery(api.jobs.listJobs, {});
  const recommendations = useQuery(api.recommendations.listRecommendations, {});

  // Combine all activity sources
  const activities = useMemo<AtlasActivity[]>(() => {
    const all: AtlasActivity[] = [];

    // Job events — map from job data
    if (Array.isArray(jobEvents)) {
      for (const job of jobEvents.slice(0, 50)) {
        const row = job as Record<string, unknown>;
        all.push({
          id: `job-${String(row._id)}`,
          entity: {
            type: "workflow",
            id: String(row._id ?? ""),
            label: String(row.job_type ?? "Job").replace(/_/g, " "),
          },
          category: String(row.status) === "completed" ? "job_completed"
            : String(row.status) === "failed" ? "job_failed"
            : "job_created",
          actor: { type: "system", label: "System" },
          title: `Job: ${String(row.job_type ?? "unknown").replace(/_/g, " ")}`,
          summary: String(row.status ?? "").replace(/_/g, " "),
          timestamp: typeof row._creationTime === "number" ? row._creationTime : Date.now(),
          source: "jobs",
          significance: String(row.status) === "failed" ? "important" : "routine",
        });
      }
    }

    // Recommendation events
    if (Array.isArray(recommendations)) {
      for (const rec of recommendations.slice(0, 50)) {
        const row = rec as Record<string, unknown>;
        const status = String(row.status ?? "open");
        all.push({
          id: `rec-${String(row._id)}`,
          entity: {
            type: "recommendation",
            id: String(row._id ?? ""),
            label: String(row.title ?? "Recommendation"),
          },
          category: status === "approved" ? "recommendation_approved"
            : status === "rejected" ? "recommendation_rejected"
            : status === "executed" ? "recommendation_executed"
            : "recommendation_generated",
          actor: { type: status === "open" ? "atlas" : "user", label: status === "open" ? "Atlas" : "User" },
          title: String(row.title ?? "Recommendation"),
          summary: `${String(row.priority ?? "")} priority · ${status}`,
          timestamp: typeof row._creationTime === "number" ? row._creationTime : Date.now(),
          source: "recommendations",
          significance: status === "open" ? "notable" : "routine",
        });
      }
    }

    return all;
  }, [jobEvents, recommendations]);

  const dateGroups = useMemo(() => groupActivitiesByDate(activities), [activities]);
  const workspaceSummary = useMemo(() => computeWorkspaceActivitySummary(activities), [activities]);

  const forEntity = useCallback(
    (entityType: string, entityId: string) => filterByEntity(activities, entityType, entityId),
    [activities],
  );

  const importantOnly = useCallback(
    () => filterImportantActivities(activities),
    [activities],
  );

  const recent = useCallback(
    (n: number) => getRecentActivities(activities, n),
    [activities],
  );

  return {
    activities,
    dateGroups,
    workspaceSummary,
    isLoading: jobEvents === undefined || recommendations === undefined,
    forEntity,
    importantOnly,
    recent,
  };
}
