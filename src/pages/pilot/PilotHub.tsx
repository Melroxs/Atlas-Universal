import { api } from "@/lib/api";
import { useQuery } from "@/hooks/use-supabase";
import { useNavigate } from "react-router";
import { PageHeader } from "@/components/atlas-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ArrowRight,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  Inbox,
  Lightbulb,
  Loader2,
  Mail,
  MessageSquare,
  Radar,
  Send,
  Target,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";

const PIPELINE_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  replied: "Replied",
  qualified: "Qualified",
  demo_scheduled: "Demo Scheduled",
  demo_completed: "Demo Completed",
  pilot_invited: "Pilot Invited",
  pilot_active: "Pilot Active",
  won: "Won",
  lost: "Lost",
};

const PIPELINE_COLORS: Record<string, string> = {
  new: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  contacted: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  replied: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  qualified: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  demo_scheduled: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  demo_completed: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  pilot_invited: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  pilot_active: "bg-green-500/10 text-green-600 dark:text-green-400",
  won: "bg-green-600/10 text-green-700 dark:text-green-300",
  lost: "bg-red-500/10 text-red-600 dark:text-red-400",
};

export default function PilotHub() {
  const navigate = useNavigate();
  const stats = useQuery(api.crm.dashboardStats);
  const recentLeads = useQuery(
    api.crm.listLeads,
    stats ? { limit: 5 } : "skip",
  );
  const tasks = useQuery(
    api.crm.listTasks,
    stats ? { status: "pending", limit: 10 } : "skip",
  );
  const applications = useQuery(
    api.admin.listPilotApplications,
    stats ? { status: "new", limit: 5 } : "skip",
  );

  const isLoading = stats === undefined;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const overdue = (tasks ?? []).filter(
    (t) =>
      t.status === "pending" &&
      t.due_date &&
      new Date(t.due_date) < new Date(),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pilot Command Center"
        description="What needs your attention today."
      />

      {/* Today's Queue */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ActionCard
          icon={Inbox}
          label="New Applications"
          value={stats?.newApplications ?? 0}
          color="text-blue-600 dark:text-blue-400"
          onClick={() => navigate("/dashboard/pilot/applications")}
        />
        <ActionCard
          icon={Clock}
          label="Follow-ups Due"
          value={stats?.followupsDue ?? 0}
          color="text-amber-600 dark:text-amber-400"
          onClick={() => navigate("/dashboard/pilot/crm")}
          urgent={(overdue.length ?? 0) > 0}
          urgentLabel={`${overdue.length} overdue`}
        />
        <ActionCard
          icon={Mail}
          label="Replies Waiting"
          value={stats?.repliesWaiting ?? 0}
          color="text-orange-600 dark:text-orange-400"
          onClick={() => navigate("/dashboard/pilot/outreach")}
        />
        <ActionCard
          icon={Target}
          label="Active Pilots"
          value={stats?.activePilots ?? 0}
          color="text-green-600 dark:text-green-400"
          onClick={() => navigate("/dashboard/pilot/crm")}
        />
      </div>

      {/* Pipeline Overview */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Pipeline</CardTitle>
              <CardDescription>
                {stats?.totalLeads ?? 0} total leads
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/dashboard/pilot/crm")}
            >
              View CRM
              <ArrowRight className="ml-1 size-3" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {(stats?.pipelineCounts ?? []).map((item: any) => (
              <div
                key={item.stage}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${PIPELINE_COLORS[item.stage] ?? "bg-muted text-muted-foreground"}`}
              >
                {PIPELINE_LABELS[item.stage] ?? item.stage}
                <span className="font-mono text-[11px] opacity-70">
                  {item.count}
                </span>
              </div>
            ))}
            {(!stats?.pipelineCounts || stats.pipelineCounts.length === 0) && (
              <p className="text-xs text-muted-foreground">
                No leads in pipeline yet.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pending Tasks */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Tasks</CardTitle>
                <CardDescription>
                  {(tasks ?? []).filter((t) => t.status === "pending").length}{" "}
                  pending
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {(tasks ?? []).length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                No pending tasks. Create one from a lead.
              </p>
            ) : (
              <div className="space-y-2">
                {(tasks ?? []).slice(0, 8).map((task) => {
                  const isOverdue =
                    task.status === "pending" &&
                    task.due_date &&
                    new Date(task.due_date) < new Date();
                  return (
                    <div
                      key={task.id}
                      className="flex items-start justify-between gap-3 rounded-lg border border-border/60 p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">
                          {task.title}
                        </p>
                        {task.due_date && (
                          <p
                            className={`mt-0.5 text-xs ${isOverdue ? "text-red-500" : "text-muted-foreground"}`}
                          >
                            {isOverdue ? "Overdue" : "Due"}{" "}
                            {new Date(task.due_date).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                      <Badge
                        variant="outline"
                        className={`shrink-0 text-[10px] ${
                          isOverdue
                            ? "border-red-500/30 bg-red-500/10 text-red-600"
                            : ""
                        }`}
                      >
                        {task.task_type}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Applications */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">New Applications</CardTitle>
                <CardDescription>
                  {(applications ?? []).length} awaiting review
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("/dashboard/pilot/applications")}
              >
                Review All
                <ArrowRight className="ml-1 size-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {(applications ?? []).length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                No new applications.
              </p>
            ) : (
              <div className="space-y-2">
                {(applications ?? []).slice(0, 5).map((app: any) => (
                  <div
                    key={app.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-border/60 p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() =>
                      navigate(
                        `/dashboard/pilot/applications?id=${app.id}`,
                      )
                    }
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">
                        {app.company_name || app.full_name}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {app.contact_name || app.email} ·{" "}
                        {app.created_at
                          ? new Date(app.created_at).toLocaleDateString()
                          : ""}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className="shrink-0 border-blue-500/30 bg-blue-500/10 text-[10px] text-blue-600"
                    >
                      New
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <QuickAction
              icon={Users}
              label="Add Lead"
              onClick={() => navigate("/dashboard/pilot/crm?action=new")}
            />
            <QuickAction
              icon={Send}
              label="Write Outreach"
              onClick={() => navigate("/dashboard/pilot/outreach?action=new")}
            />
            <QuickAction
              icon={FileText}
              label="View Applications"
              onClick={() => navigate("/dashboard/pilot/applications")}
            />
            <QuickAction
              icon={Radar}
              label="Pilot Intelligence"
              onClick={() => navigate("/dashboard/pilot-intelligence")}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ActionCard({
  icon: Icon,
  label,
  value,
  color,
  onClick,
  urgent,
  urgentLabel,
}: {
  icon: any;
  label: string;
  value: number;
  color: string;
  onClick: () => void;
  urgent?: boolean;
  urgentLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-xl border border-border/60 bg-card p-4 text-left transition-colors hover:border-teal-400/30 hover:bg-muted/30"
    >
      <div className="flex items-center justify-between">
        <div className={`flex size-8 items-center justify-center rounded-lg bg-muted/50 ${color}`}>
          <Icon className="size-4" />
        </div>
        {urgent && (
          <Badge
            variant="outline"
            className="border-red-500/30 bg-red-500/10 text-[10px] text-red-600"
          >
            {urgentLabel}
          </Badge>
        )}
      </div>
      <p className="mt-3 font-mono text-2xl font-semibold text-foreground">
        {value}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </button>
  );
}

function QuickAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: any;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/20 p-3 text-left transition-colors hover:bg-muted/50 hover:border-teal-400/30"
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-teal-400/10 text-teal-600 dark:text-teal-300">
        <Icon className="size-4" />
      </div>
      <span className="text-sm font-medium text-foreground">{label}</span>
    </button>
  );
}
