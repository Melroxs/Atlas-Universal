import { api } from "@/convex/_generated/api";
import { EmptyPanel, PageHeader, formatDate, titleCase } from "@/components/atlas-ui";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { Loader2, ScrollText, Search } from "lucide-react";
import { useMemo, useState } from "react";

const ACTION_TONES: Record<string, string> = {
  document_uploaded: "border-cyan-400/30 bg-cyan-400/10 text-cyan-600 dark:text-cyan-300",
  document_deleted: "border-rose-400/30 bg-rose-400/10 text-rose-600 dark:text-rose-300",
  detectors_ran: "border-violet-400/30 bg-violet-400/10 text-violet-600 dark:text-violet-300",
  recommendation_approved: "border-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300",
  recommendation_rejected: "border-rose-400/30 bg-rose-400/10 text-rose-600 dark:text-rose-300",
  recommendation_dismissed: "border-muted-foreground/40 bg-muted text-muted-foreground",
  recommendation_executed: "border-indigo-400/30 bg-indigo-400/10 text-indigo-600 dark:text-indigo-300",
  pack_activated: "border-teal-400/30 bg-teal-400/10 text-teal-600 dark:text-teal-300",
  pack_dismissed: "border-muted-foreground/40 bg-muted text-muted-foreground",
  connection_created: "border-sky-400/30 bg-sky-400/10 text-sky-600 dark:text-sky-300",
  connection_synced: "border-teal-400/30 bg-teal-400/10 text-teal-600 dark:text-teal-300",
  connection_deleted: "border-rose-400/30 bg-rose-400/10 text-rose-600 dark:text-rose-300",
  member_invited: "border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300",
  member_added: "border-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300",
  member_removed: "border-rose-400/30 bg-rose-400/10 text-rose-600 dark:text-rose-300",
  member_role_changed: "border-violet-400/30 bg-violet-400/10 text-violet-600 dark:text-violet-300",
  tenant_created: "border-teal-400/30 bg-teal-400/10 text-teal-600 dark:text-teal-300",
  onboarding_completed: "border-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300",
};

export default function Audit() {
  const logs = useQuery(api.audit.listAuditLogs, { limit: 80 });
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return logs ?? [];
    return (logs ?? []).filter((l) =>
      [
        l.actionType,
        l.targetType ?? "",
        l.actorName ?? "",
        JSON.stringify(l.metadata ?? {}),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [logs, q]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Audit Log"
        title="Every action, on the record"
        description="A tamper-evident trail of who did what in your workspace — from document uploads to recommendation approvals."
      />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by action, actor, target…"
          className="pl-9"
        />
      </div>

      {logs === undefined ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading audit trail…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyPanel
          icon={ScrollText}
          title={q ? "No matching entries" : "No audit entries yet"}
          description={
            q
              ? "Try a different filter."
              : "Actions like uploads, detections, approvals and role changes will appear here."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card/50">
          <div className="divide-y divide-border/50">
            {filtered.map((log) => {
              const tone = ACTION_TONES[log.actionType] ?? "border-border/70 bg-muted/40 text-muted-foreground";
              return (
                <div key={log._id} className="flex flex-wrap items-start gap-3 px-5 py-3.5">
                  <div className="mt-1.5 size-2 shrink-0 rounded-full bg-teal-400/60" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={cn("font-mono text-[10px]", tone)}>
                        {log.actionType.replace(/_/g, " ")}
                      </Badge>
                      {log.targetType && (
                        <span className="text-xs text-muted-foreground">
                          {titleCase(log.targetType)}
                          {log.targetId ? ` · ${log.targetId}` : ""}
                        </span>
                      )}
                    </div>
                    {log.metadata && (
                      <pre className="atlas-scroll mt-1.5 overflow-x-auto font-mono text-[11px] leading-4 text-muted-foreground/70">
                        {JSON.stringify(log.metadata, null, 1).slice(0, 400)}
                      </pre>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-muted-foreground">
                      {log.actorName ?? (log.actorType === "system" ? "Atlas" : "unknown")}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/60">
                      {formatDate(log._creationTime)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
