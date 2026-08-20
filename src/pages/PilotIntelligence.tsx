import { api } from "@/lib/api";
import { PageHeader, EmptyPanel } from "@/components/atlas-ui";
import { useMutation, useQuery } from "@/hooks/use-supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  Building2,
  Calendar,
  Lightbulb,
  MessageSquareQuote,
  Plus,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";

const TYPE_ICONS: Record<string, typeof Building2> = {
  friction: Target,
  feature_request: Lightbulb,
  bug: Zap,
  positive_feedback: Sparkles,
  workflow: TrendingUp,
  objection: Target,
};

const TYPE_LABELS: Record<string, string> = {
  friction: "Friction",
  feature_request: "Feature Request",
  bug: "Bug",
  positive_feedback: "Positive Feedback",
  workflow: "Workflow Insight",
  objection: "Objection",
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  low: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

function formatDate(d?: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: typeof Building2;
  color: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={cn("rounded-lg p-2", color)}>
            <Icon className="size-4" />
          </div>
          <div>
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function PilotIntelligence() {
  const analytics = useQuery(api.pilotIntelligence.getAnalytics);
  const companies = useQuery(api.pilotIntelligence.listCompanies);
  const insights = useQuery(api.pilotIntelligence.listInsights);
  const outcomes = useQuery(api.pilotIntelligence.listOutcomes);
  const testimonials = useQuery(api.pilotIntelligence.listTestimonials);

  const isLoading = analytics === undefined;
  const isEmpty =
    (analytics?.totalCompanies ?? 0) === 0 &&
    (analytics?.totalSessions ?? 0) === 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-pulse text-muted-foreground">
          Loading pilot intelligence…
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Pilot Intelligence"
        title="Pilot Program Overview"
        description="Track pilot companies, sessions, insights, and outcomes. Understand what's working and where to focus."
      />

      {isEmpty ? (
        <EmptyPanel icon={Sparkles}
          title="No pilot data yet"
          description="Start by adding your first pilot company or importing an application."
          action={
            <Button onClick={() => (window.location.href = "/dashboard/pilot-intelligence/companies")}>
              <Plus className="mr-2 size-4" />
              Add Pilot Company
            </Button>
          }
        />
      ) : (
        <>
          {/* Stats Row */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard
              label="Pilot Companies"
              value={analytics?.totalCompanies ?? 0}
              icon={Building2}
              color="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
            />
            <StatCard
              label="Active Companies"
              value={analytics?.activeCompanies ?? 0}
              icon={Users}
              color="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
            />
            <StatCard
              label="Total Sessions"
              value={analytics?.totalSessions ?? 0}
              icon={Calendar}
              color="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
            />
            <StatCard
              label="Open Insights"
              value={analytics?.openInsights ?? 0}
              icon={Lightbulb}
              color="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
            />
          </div>

          {/* Second Stats Row */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard
              label="Total Insights"
              value={analytics?.totalInsights ?? 0}
              icon={Sparkles}
              color="bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
            />
            <StatCard
              label="Outcomes"
              value={analytics?.totalOutcomes ?? 0}
              icon={Target}
              color="bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300"
            />
            <StatCard
              label="Revenue Recovered"
              value={
                (analytics?.totalRevenueRecovery ?? 0) > 0
                  ? `$${(analytics?.totalRevenueRecovery ?? 0).toLocaleString()}`
                  : "$0"
              }
              icon={TrendingUp}
              color="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
            />
            <StatCard
              label="Testimonials"
              value={analytics?.totalTestimonials ?? 0}
              icon={MessageSquareQuote}
              color="bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Insights by Type */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Insights by Type</CardTitle>
              </CardHeader>
              <CardContent>
                {(analytics?.insightsByType ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No insights recorded yet.</p>
                ) : (
                  <div className="space-y-2">
                    {(analytics?.insightsByType ?? []).map((item) => {
                      const Icon = TYPE_ICONS[item.type] ?? Sparkles;
                      return (
                        <div
                          key={item.type}
                          className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2"
                        >
                          <div className="flex items-center gap-2">
                            <Icon className="size-3.5 text-muted-foreground" />
                            <span className="text-sm">
                              {TYPE_LABELS[item.type] ?? item.type}
                            </span>
                          </div>
                          <Badge variant="secondary" className="font-mono text-xs">
                            {item.count}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent Insights */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Recent Insights</CardTitle>
              </CardHeader>
              <CardContent>
                {(insights ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No insights yet.</p>
                ) : (
                  <div className="space-y-2">
                    {(insights ?? []).slice(0, 5).map((insight) => (
                      <div
                        key={insight.id}
                        className="rounded-lg border border-border/50 px-3 py-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium">{insight.title}</p>
                          <Badge
                            variant="outline"
                            className={cn(
                              "shrink-0 text-[10px]",
                              PRIORITY_COLORS[insight.priority ?? "medium"],
                            )}
                          >
                            {insight.priority}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                          {insight.description ?? ""}
                        </p>
                        <div className="mt-1.5 flex items-center gap-2">
                          <Badge variant="secondary" className="text-[10px]">
                            {TYPE_LABELS[insight.insight_type] ?? insight.insight_type}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {formatDate(insight.created_at)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Companies List */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm">Pilot Companies</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => (window.location.href = "/dashboard/pilot-intelligence/companies")}
              >
                <Plus className="mr-1 size-3" />
                Add Company
              </Button>
            </CardHeader>
            <CardContent>
              {(companies ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">No companies added yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/50 text-left text-xs text-muted-foreground">
                        <th className="pb-2 font-medium">Company</th>
                        <th className="pb-2 font-medium">Type</th>
                        <th className="pb-2 font-medium">Status</th>
                        <th className="pb-2 font-medium">Contact</th>
                        <th className="pb-2 font-medium">Added</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(companies ?? []).slice(0, 10).map((co) => (
                        <tr key={co.id} className="border-b border-border/30">
                          <td className="py-2 font-medium">{co.name}</td>
                          <td className="py-2 text-muted-foreground">{co.company_type ?? "—"}</td>
                          <td className="py-2">
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px]",
                                co.status === "active"
                                  ? "border-green-400/50 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300"
                                  : co.status === "churned"
                                    ? "border-red-400/50 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300"
                                    : "",
                              )}
                            >
                              {co.status}
                            </Badge>
                          </td>
                          <td className="py-2 text-muted-foreground">
                            {co.contact_name ?? "—"}
                          </td>
                          <td className="py-2 text-muted-foreground">
                            {formatDate(co.created_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Testimonials */}
          {(testimonials ?? []).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Testimonials</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {(testimonials ?? []).slice(0, 3).map((t) => (
                    <blockquote
                      key={t.id}
                      className="rounded-lg border border-border/50 bg-muted/20 px-4 py-3 text-sm italic text-muted-foreground"
                    >
                      "{t.quote}"
                      {t.author_name && (
                        <footer className="mt-2 not-italic text-xs font-medium text-foreground">
                          — {t.author_name}
                          {t.author_role ? `, ${t.author_role}` : ""}
                        </footer>
                      )}
                    </blockquote>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
