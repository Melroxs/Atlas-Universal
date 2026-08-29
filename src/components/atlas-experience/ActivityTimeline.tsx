// ---------------------------------------------------------------------------
// Atlas Activity Timeline
//
// Enhanced timeline with:
//   - Date grouping (Today, Yesterday, etc.)
//   - Source distinction (Human / Atlas / System / External)
//   - Significance indicators
//   - Entity links
//   - Loading / empty states
// ---------------------------------------------------------------------------

import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { formatDate } from "@/components/atlas-ui";
import { Badge } from "@/components/ui/badge";
import type {
  AtlasActivity,
  ActivityDateGroup,
  ActivitySignificance,
  ActivityActor,
} from "@/lib/atlas-experience/activity";
import { CATEGORY_LABELS } from "@/lib/atlas-experience/activity";
import { groupActivitiesByDate } from "@/lib/atlas-experience/activity-aggregation";
import {
  Bot,
  Calendar,
  CheckCircle2,
  Clock,
  AlertTriangle,
  FileText,
  Globe,
  Loader2,
  Radar,
  Sparkles,
  Target,
  User,
  Zap,
  type LucideIcon,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Actor Styling
// ---------------------------------------------------------------------------

const ACTOR_CONFIG: Record<ActivityActor["type"], { icon: LucideIcon; color: string; bg: string; label: string }> = {
  user: {
    icon: User,
    color: "text-sky-600 dark:text-sky-300",
    bg: "bg-sky-400/10 ring-sky-400/25",
    label: "Human",
  },
  atlas: {
    icon: Radar,
    color: "text-teal-600 dark:text-teal-300",
    bg: "bg-teal-400/10 ring-teal-400/25",
    label: "Atlas",
  },
  system: {
    icon: Zap,
    color: "text-violet-600 dark:text-violet-300",
    bg: "bg-violet-400/10 ring-violet-400/25",
    label: "System",
  },
  external: {
    icon: Globe,
    color: "text-amber-600 dark:text-amber-300",
    bg: "bg-amber-400/10 ring-amber-400/25",
    label: "External",
  },
};

/** Map of activity category to icon for visual variety */
const CATEGORY_ICONS: Partial<Record<string, LucideIcon>> = {
  claim_created: Target,
  evidence_gap_identified: AlertTriangle,
  contradiction_found: AlertTriangle,
  supplement_submitted: Sparkles,
  recommendation_generated: Sparkles,
  recommendation_approved: CheckCircle2,
  document_uploaded: FileText,
  document_processing_completed: CheckCircle2,
  document_processing_failed: AlertTriangle,
  workflow_failed: AlertTriangle,
  revenue_opportunity_identified: Target,
  crm_reply_received: FileText,
};

// ---------------------------------------------------------------------------
// Significance Badge
// ---------------------------------------------------------------------------

const SIGNIFICANCE_STYLES: Record<ActivitySignificance, string> = {
  important: "border-rose-400/30 bg-rose-400/10 text-rose-600 dark:text-rose-300",
  notable: "border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300",
  routine: "border-border/60 bg-muted text-muted-foreground",
};

// ---------------------------------------------------------------------------
// ActivityTimelineEntry
// ---------------------------------------------------------------------------

export function ActivityTimelineEntry({ activity }: { activity: AtlasActivity }) {
  const navigate = useNavigate();
  const actorConfig = ACTOR_CONFIG[activity.actor.type];
  const ActorIcon = actorConfig.icon;
  const categoryIcon = CATEGORY_ICONS[activity.category] ?? ActorIcon;

  return (
    <div className="group relative flex gap-3 py-3">
      {/* Timeline dot */}
      <div
        className={cn(
          "relative z-10 flex size-[30px] shrink-0 items-center justify-center rounded-full ring-1",
          actorConfig.bg,
        )}
      >
        <ActorIcon className={cn("size-3.5", actorConfig.color)} />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground">{activity.title}</p>
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide",
              actorConfig.color,
            )}
          >
            {actorConfig.label}
          </span>
          {activity.significance === "important" && (
            <span className="rounded-full border border-rose-400/30 bg-rose-400/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-rose-600 dark:text-rose-300">
              important
            </span>
          )}
        </div>
        {activity.summary && (
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {activity.summary}
          </p>
        )}
        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground/60">
          <span>{formatDate(activity.timestamp)}</span>
          {activity.entity.id && activity.entity.label && (
            <>
              <span>·</span>
              {activity.entity.href ? (
                <button
                  type="button"
                  onClick={() => navigate(activity.entity.href!)}
                  className="transition-colors hover:text-teal-600 dark:hover:text-teal-300"
                >
                  {activity.entity.label}
                </button>
              ) : (
                <span>{activity.entity.label}</span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActivityTimeline — grouped by date
// ---------------------------------------------------------------------------

export function ActivityTimeline({
  activities,
  maxItems = 30,
  showDateHeaders = true,
}: {
  activities: AtlasActivity[];
  maxItems?: number;
  showDateHeaders?: boolean;
}) {
  const sorted = [...activities].sort((a, b) => b.timestamp - a.timestamp).slice(0, maxItems);
  const groups = showDateHeaders ? groupActivitiesByDate(sorted) : [{ label: "", activities: sorted }];

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <Clock className="size-6 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">No activity recorded</p>
        <p className="text-xs text-muted-foreground/70">
          Events will appear here as Atlas observes your workspace.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.label}>
          {showDateHeaders && group.label && (
            <div className="mb-2 flex items-center gap-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </h4>
              <div className="h-px flex-1 bg-border/40" />
            </div>
          )}
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border/60" />
            {group.activities.map((activity) => (
              <ActivityTimelineEntry key={activity.id} activity={activity} />
            ))}
          </div>
        </div>
      ))}

      {activities.length > maxItems && (
        <p className="pl-10 text-center text-xs text-muted-foreground/50">
          {activities.length - maxItems} more event{activities.length - maxItems === 1 ? "" : "s"} not shown
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActivityTimelineSkeleton — loading state
// ---------------------------------------------------------------------------

export function ActivityTimelineSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3 animate-pulse">
          <div className="size-[30px] shrink-0 rounded-full bg-muted" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-4 w-3/4 rounded bg-muted" />
            <div className="h-3 w-1/2 rounded bg-muted/60" />
          </div>
        </div>
      ))}
    </div>
  );
}
