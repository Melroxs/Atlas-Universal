import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

export function formatDate(ts?: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatBytes(bytes?: number | null): string {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function titleCase(s: string): string {
  return s
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

const PRIORITY_STYLES: Record<string, string> = {
  high: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  medium: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  low: "border-sky-400/30 bg-sky-400/10 text-sky-300",
};

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("font-mono uppercase tracking-wide", PRIORITY_STYLES[priority])}
    >
      {priority}
    </Badge>
  );
}

const REC_STATUS_STYLES: Record<string, string> = {
  open: "border-teal-400/30 bg-teal-400/10 text-teal-300",
  approved: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  rejected: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  dismissed: "border-muted-foreground/30 bg-muted text-muted-foreground",
  executed: "border-indigo-400/30 bg-indigo-400/10 text-indigo-300",
};

export function RecStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("font-mono uppercase tracking-wide", REC_STATUS_STYLES[status])}
    >
      {status}
    </Badge>
  );
}

const DOC_STATUS_STYLES: Record<string, string> = {
  ready: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  processing: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  uploaded: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  failed: "border-rose-400/30 bg-rose-400/10 text-rose-300",
};

export function DocStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("font-mono uppercase tracking-wide", DOC_STATUS_STYLES[status])}
    >
      {status}
    </Badge>
  );
}

const CLASS_STYLES: Record<string, string> = {
  SOP: "border-violet-400/30 bg-violet-400/10 text-violet-300",
  Policy: "border-cyan-400/30 bg-cyan-400/10 text-cyan-300",
  Invoice: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  Estimate: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  Spreadsheet: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  Report: "border-teal-400/30 bg-teal-400/10 text-teal-300",
};

export function ClassificationBadge({ classification }: { classification: string }) {
  const style = CLASS_STYLES[classification];
  if (style) {
    return <Badge variant="outline" className={cn(style)}>{classification}</Badge>;
  }
  return (
    <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground">
      {classification}
    </Badge>
  );
}

const KNOWLEDGE_STYLES: Record<string, string> = {
  FACT: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  RULE: "border-cyan-400/40 bg-cyan-400/10 text-cyan-300",
  OBSERVATION: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  INFERENCE: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  RECOMMENDATION: "border-violet-400/40 bg-violet-400/10 text-violet-300",
};

export function KnowledgeBadge({ classification }: { classification: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("font-mono text-[10px] uppercase tracking-wide", KNOWLEDGE_STYLES[classification])}
    >
      {classification}
    </Badge>
  );
}

const CONN_STATUS_STYLES: Record<string, string> = {
  connected: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  syncing: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  error: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  disconnected: "border-muted-foreground/30 bg-muted text-muted-foreground",
};

export function ConnStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("font-mono uppercase tracking-wide", CONN_STATUS_STYLES[status])}
    >
      {status}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Confidence / progress
// ---------------------------------------------------------------------------

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    value >= 0.75 ? "bg-emerald-400" : value >= 0.5 ? "bg-amber-400" : "bg-rose-400";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-[11px] text-muted-foreground">{pct}%</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="atlas-eyebrow mb-1.5">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  accent = "text-teal-300",
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  hint?: string;
  accent?: string;
}) {
  return (
    <Card className="border-border/70 bg-card/60 shadow-none backdrop-blur-sm">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <Icon className={cn("size-4", accent)} />
        </div>
        <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
          {value}
        </p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function EmptyPanel({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="atlas-grid-fine relative flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-card/40 px-6 py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl border border-border/60 bg-muted/40 text-teal-300">
        <Icon className="size-6" />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Panel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn("border-border/70 bg-card/60 shadow-none", className)}>
      {children}
    </Card>
  );
}
