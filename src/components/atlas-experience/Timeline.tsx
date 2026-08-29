// ---------------------------------------------------------------------------
// Atlas Entity Timeline
//
// A reusable chronological timeline that combines:
//   - claim events
//   - document events
//   - evidence events
//   - workflow events
//   - user actions
//   - Atlas discoveries
//   - system events
//
// Clearly distinguishes between human action, Atlas discovery,
// system event, and external activity.
// ---------------------------------------------------------------------------

import { cn } from "@/lib/utils";
import { formatDate } from "@/components/atlas-ui";
import {
  Bot,
  Clock,
  FileText,
  Globe,
  Radar,
  User,
  Zap,
  type LucideIcon,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Timeline Item Types
// ---------------------------------------------------------------------------

export type TimelineEventSource = "human" | "atlas" | "system" | "external";

export interface TimelineItem {
  id: string;
  /** What happened */
  title: string;
  /** Optional description/detail */
  description?: string;
  /** When it happened */
  timestamp: number;
  /** Who/what caused it */
  source: TimelineEventSource;
  /** Source label (e.g., "John Smith", "Atlas", "System") */
  sourceLabel?: string;
  /** Category for icon/color */
  category?: string;
  /** Optional link */
  href?: string;
}

// ---------------------------------------------------------------------------
// Source Styling
// ---------------------------------------------------------------------------

const SOURCE_CONFIG: Record<TimelineEventSource, { icon: LucideIcon; color: string; bg: string; label: string }> = {
  human: {
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

// ---------------------------------------------------------------------------
// Timeline Component
// ---------------------------------------------------------------------------

export function Timeline({
  items,
  maxItems = 20,
}: {
  items: TimelineItem[];
  maxItems?: number;
}) {
  const sorted = [...items].sort((a, b) => b.timestamp - a.timestamp).slice(0, maxItems);

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <Clock className="size-6 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">No activity recorded</p>
        <p className="text-xs text-muted-foreground/70">
          Events will appear here as they occur.
        </p>
      </div>
    );
  }

  return (
    <div className="relative space-y-0">
      {/* Vertical line */}
      <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border/60" />

      {sorted.map((item, index) => {
        const config = SOURCE_CONFIG[item.source];
        const Icon = config.icon;

        return (
          <div key={item.id} className="relative flex gap-3 py-3">
            {/* Timeline dot */}
            <div
              className={cn(
                "relative z-10 flex size-[30px] shrink-0 items-center justify-center rounded-full ring-1",
                config.bg,
              )}
            >
              <Icon className={cn("size-3.5", config.color)} />
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-foreground">{item.title}</p>
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide",
                    config.color,
                    "bg-transparent",
                  )}
                >
                  {config.label}
                </span>
              </div>
              {item.description && (
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  {item.description}
                </p>
              )}
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground/60">
                {item.sourceLabel && <span>{item.sourceLabel}</span>}
                <span>·</span>
                <span>{formatDate(item.timestamp)}</span>
              </div>
            </div>
          </div>
        );
      })}

      {items.length > maxItems && (
        <p className="pl-10 text-center text-xs text-muted-foreground/50">
          {items.length - maxItems} more event{items.length - maxItems === 1 ? "" : "s"} not shown
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline Factory — create timeline items from existing data
// ---------------------------------------------------------------------------

/**
 * Create a timeline item from a claim event.
 */
export function claimEventToTimeline(event: {
  _id: string;
  actionType: string;
  targetType?: string;
  metadata?: Record<string, unknown>;
  actorName?: string;
  _creationTime: number;
}): TimelineItem {
  const source: TimelineEventSource =
    event.actionType.startsWith("ai_") || event.actionType.startsWith("atlas_")
      ? "atlas"
      : event.actionType.startsWith("system_")
        ? "system"
        : "human";

  return {
    id: `claim-${event._id}`,
    title: event.actionType.replace(/_/g, " "),
    description: event.targetType ? `Target: ${event.targetType}` : undefined,
    timestamp: event._creationTime,
    source,
    sourceLabel: event.actorName ?? undefined,
    category: event.actionType,
  };
}

/**
 * Create a timeline item from a document event.
 */
export function documentEventToTimeline(event: {
  _id: string;
  actionType: string;
  metadata?: Record<string, unknown>;
  _creationTime: number;
}): TimelineItem {
  return {
    id: `doc-${event._id}`,
    title: event.actionType.replace(/_/g, " "),
    timestamp: event._creationTime,
    source: "system",
    category: "document",
  };
}

/**
 * Create timeline items from recent activity.
 */
export function activityToTimeline(
  activity: Array<{
    _id: string;
    actionType: string;
    targetType?: string;
    metadata?: Record<string, unknown>;
    actorName?: string;
    _creationTime: number;
  }>,
): TimelineItem[] {
  return activity.map(claimEventToTimeline);
}
