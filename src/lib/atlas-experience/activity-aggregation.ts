// ---------------------------------------------------------------------------
// Atlas Activity Aggregation
//
// Collects and normalizes activity from all existing Atlas systems into
// a unified timeline. This is the core intelligence layer that answers:
//   "What happened?"
//   "When did it change?"
//   "What did Atlas discover?"
// ---------------------------------------------------------------------------

import {
  type AtlasActivity,
  type ActivityDateGroup,
  type ActivitySignificance,
  type ActivityCategory,
  type WorkspaceActivitySummary,
  claimEventToActivity,
  jobEventToActivity,
  recommendationEventToActivity,
  documentEventToActivity,
} from "./activity";

// ---------------------------------------------------------------------------
// Date Grouping
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

/**
 * Get a date label for a timestamp.
 */
export function getDateLabel(timestamp: number): string {
  const now = Date.now();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayStart = today.getTime();
  const ts = new Date(timestamp);

  if (timestamp >= todayStart) return "Today";
  if (timestamp >= todayStart - MS_PER_DAY) return "Yesterday";

  // Within the last 7 days
  const dayName = ts.toLocaleDateString("en-US", { weekday: "long" });
  if (timestamp >= todayStart - MS_PER_DAY * 6) return dayName;

  // Older — show full date
  return ts.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Group activities by date.
 */
export function groupActivitiesByDate(activities: AtlasActivity[]): ActivityDateGroup[] {
  const sorted = [...activities].sort((a, b) => b.timestamp - a.timestamp);
  const groups = new Map<string, AtlasActivity[]>();

  for (const activity of sorted) {
    const label = getDateLabel(activity.timestamp);
    const group = groups.get(label);
    if (group) {
      group.push(activity);
    } else {
      groups.set(label, [activity]);
    }
  }

  return Array.from(groups.entries()).map(([label, items]) => ({
    label,
    activities: items,
  }));
}

// ---------------------------------------------------------------------------
// Activity Collection — normalize existing Atlas data
// ---------------------------------------------------------------------------

/**
 * Collect activity from a claim's timeline events.
 */
export function collectClaimActivity(timeline: Array<{
  label: string;
  detail?: string;
  ts: number;
  source: string;
}>, claimId: string, claimLabel: string): AtlasActivity[] {
  return timeline.map((event) => {
    const activity = claimEventToActivity(event);
    activity.entity = { type: "claim", id: claimId, label: claimLabel };
    return activity;
  });
}

/**
 * Collect activity from job events.
 */
export function collectJobActivity(events: Array<{
  _id: string;
  event_type: string;
  actor: string;
  payload: Record<string, unknown>;
  _creationTime: number;
  job_type?: string;
}>): AtlasActivity[] {
  return events.map(jobEventToActivity);
}

/**
 * Collect activity from recommendation events.
 */
export function collectRecommendationActivity(events: Array<{
  _id: string;
  title: string;
  actionType: string;
  status: string;
  _creationTime: number;
}>): AtlasActivity[] {
  return events.map(recommendationEventToActivity);
}

/**
 * Collect activity from document events.
 */
export function collectDocumentActivity(events: Array<{
  _id: string;
  title?: string;
  status?: string;
  actionType?: string;
  _creationTime: number;
}>): AtlasActivity[] {
  return events.map(documentEventToActivity);
}

// ---------------------------------------------------------------------------
// Workspace Activity Summary
// ---------------------------------------------------------------------------

/**
 * Compute a lightweight workspace activity summary from a set of activities.
 */
export function computeWorkspaceActivitySummary(
  activities: AtlasActivity[],
  windowMs: number = MS_PER_DAY,
): WorkspaceActivitySummary {
  const now = Date.now();
  const cutoff = now - windowMs;
  const recent = activities.filter((a) => a.timestamp >= cutoff);

  const lastActivityAt = activities.length > 0
    ? Math.max(...activities.map((a) => a.timestamp))
    : null;

  return {
    lastActivityAt,
    recentImportantCount: recent.filter((a) => a.significance === "important").length,
    recentAtlasDiscoveries: recent.filter((a) => a.actor.type === "atlas").length,
    recentHumanActions: recent.filter((a) => a.actor.type === "user").length,
    totalRecentCount: recent.length,
  };
}

// ---------------------------------------------------------------------------
// Activity Filtering
// ---------------------------------------------------------------------------

/**
 * Filter activities by significance.
 */
export function filterBySignificance(
  activities: AtlasActivity[],
  significance: ActivitySignificance,
): AtlasActivity[] {
  return activities.filter((a) => a.significance === significance);
}

/**
 * Filter activities by category.
 */
export function filterByCategory(
  activities: AtlasActivity[],
  ...categories: ActivityCategory[]
): AtlasActivity[] {
  return activities.filter((a) => categories.includes(a.category));
}

/**
 * Filter activities by actor type.
 */
export function filterByActorType(
  activities: AtlasActivity[],
  actorType: AtlasActivity["actor"]["type"],
): AtlasActivity[] {
  return activities.filter((a) => a.actor.type === actorType);
}

/**
 * Filter activities by entity.
 */
export function filterByEntity(
  activities: AtlasActivity[],
  entityType: string,
  entityId: string,
): AtlasActivity[] {
  return activities.filter(
    (a) => a.entity.type === entityType && a.entity.id === entityId,
  );
}

/**
 * Filter activities to only those with significance >= "important".
 */
export function filterImportantActivities(activities: AtlasActivity[]): AtlasActivity[] {
  return activities.filter((a) => a.significance === "important" || a.significance === "notable");
}

/**
 * Get the most recent N activities.
 */
export function getRecentActivities(activities: AtlasActivity[], n: number): AtlasActivity[] {
  return [...activities]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, n);
}
