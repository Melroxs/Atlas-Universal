import { useQuery } from "@/hooks/use-supabase";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/atlas-ui";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, CheckCircle2, Clock, Eye, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { listReviews, approveReviewRPC, rejectReviewRPC, requestChangesRPC, countPendingReviews } from "@/lib/jobs/review-rpc";
import { resumeFromReview } from "@/lib/jobs/rpc";
import { getSupabaseClient } from "@/lib/supabase";
import type { HumanReviewRow } from "@/lib/agents/human-review-api";

const STATUS_TABS = ["pending", "approved", "rejected", "needs_changes"] as const;
type TabValue = (typeof STATUS_TABS)[number];

function statusColor(status: string) {
  switch (status) {
    case "pending":
      return "bg-yellow-100 text-yellow-800 border-yellow-300";
    case "approved":
      return "bg-green-100 text-green-800 border-green-300";
    case "rejected":
      return "bg-red-100 text-red-800 border-red-300";
    case "needs_changes":
      return "bg-blue-100 text-blue-800 border-blue-300";
    default:
      return "bg-gray-100 text-gray-800 border-gray-300";
  }
}

function statusIcon(status: string) {
  switch (status) {
    case "pending":
      return <Clock className="h-3.5 w-3.5" />;
    case "approved":
      return <CheckCircle2 className="h-3.5 w-3.5" />;
    case "rejected":
      return <XCircle className="h-3.5 w-3.5" />;
    case "needs_changes":
      return <AlertTriangle className="h-3.5 w-3.5" />;
    default:
      return <Eye className="h-3.5 w-3.5" />;
  }
}

function formatCurrency(amount: number | null) {
  if (amount === null || amount === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function confidenceColor(confidence: number) {
  if (confidence >= 0.8) return "text-green-600";
  if (confidence >= 0.5) return "text-yellow-600";
  return "text-red-600";
}

export default function Reviews() {
  const workspace = useQuery(api.tenants.getMyWorkspace);
  const tenantId = workspace?.tenant?.id;
  const supabase = getSupabaseClient();

  const [tab, setTab] = useState<TabValue>("pending");
  const [reviews, setReviews] = useState<HumanReviewRow[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Fetch reviews from Supabase
  const fetchReviews = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const data = await listReviews(tenantId, null, 100, 0);
      setReviews(data);
      const count = await countPendingReviews(tenantId);
      setPendingCount(count);
    } catch (err) {
      console.error("Failed to load reviews:", err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  // Poll for new reviews every 30s (fallback)
  useEffect(() => {
    if (!tenantId) return;
    const interval = setInterval(fetchReviews, 30000);
    return () => clearInterval(interval);
  }, [tenantId, fetchReviews]);

  // Supabase Realtime — instant updates when a review is created/updated
  useEffect(() => {
    if (!supabase || !tenantId) return;
    const channel = supabase
      .channel("atlas-human-reviews")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "atlas_human_reviews",
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => {
          // Refetch on any INSERT/UPDATE/DELETE within this tenant
          fetchReviews();
        },
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.warn("[Reviews] Realtime channel error — falling back to polling");
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, tenantId, fetchReviews]);

  const filtered = useMemo(() => {
    return reviews.filter((r) => r.status === tab);
  }, [reviews, tab]);

  // Get current user ID for reviewer
  const getReviewerId = useCallback(async (): Promise<string | null> => {
    if (!supabase) return null;
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
  }, [supabase]);

  const handleApprove = async (review: HumanReviewRow) => {
    const reviewerId = await getReviewerId();
    if (!reviewerId) { toast.error("Not authenticated"); return; }
    setActionLoading(review.id);
    try {
      await approveReviewRPC(review.id, reviewerId, "Approved");
      // Resume the job
      const supabaseClient = getSupabaseClient();
      if (supabaseClient) {
        await resumeFromReview(supabaseClient, review.job_id, review.id, "approved");
      }
      toast.success("Review approved and job resumed");
      await fetchReviews();
    } catch (err) {
      toast.error(`Approval failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (review: HumanReviewRow) => {
    const reviewerId = await getReviewerId();
    if (!reviewerId) { toast.error("Not authenticated"); return; }
    setActionLoading(review.id);
    try {
      await rejectReviewRPC(review.id, reviewerId, "Rejected by reviewer");
      const supabaseClient = getSupabaseClient();
      if (supabaseClient) {
        await resumeFromReview(supabaseClient, review.job_id, review.id, "rejected");
      }
      toast.info("Review rejected");
      await fetchReviews();
    } catch (err) {
      toast.error(`Rejection failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleNeedsChanges = async (review: HumanReviewRow) => {
    const reviewerId = await getReviewerId();
    if (!reviewerId) { toast.error("Not authenticated"); return; }
    setActionLoading(review.id);
    try {
      await requestChangesRPC(review.id, reviewerId, "Needs changes requested", review.rerun_step ?? undefined);
      const supabaseClient = getSupabaseClient();
      if (supabaseClient) {
        await resumeFromReview(supabaseClient, review.job_id, review.id, "needs_changes");
      }
      toast.info("Changes requested — targeted step will rerun");
      await fetchReviews();
    } catch (err) {
      toast.error(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Agent Reviews"
        description="Review AI-generated recommendations from the Evidence Pipeline"
      />

      {/* Pending count badge + tabs */}
      <div className="flex items-center gap-3">
        {pendingCount > 0 && (
          <Badge variant="destructive" className="text-sm px-3 py-1">
            {pendingCount} pending review{pendingCount !== 1 ? "s" : ""}
          </Badge>
        )}
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
          <TabsList>
            {STATUS_TABS.map((s) => (
              <TabsTrigger key={s} value={s} className="capitalize">
                {s.replace("_", " ")}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Loading state */}
      {loading ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="mb-3 h-10 w-10 animate-spin opacity-30" />
            <p className="text-sm">Loading reviews...</p>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <ShieldCheck className="mb-3 h-10 w-10 opacity-30" />
            <p className="text-sm">
              {tab === "pending"
                ? "No pending reviews. All agent recommendations have been reviewed."
                : `No ${tab.replace("_", " ")} reviews.`}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((review) => (
            <Card key={review.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={statusColor(review.status)}>
                      {statusIcon(review.status)}
                      <span className="ml-1 capitalize">{review.status.replace("_", " ")}</span>
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      {review.agent_type}
                    </Badge>
                    {review.reviewer_user_id && (
                      <Badge variant="outline" className="text-xs">
                        Reviewed by: {review.reviewer_user_id.slice(0, 8)}...
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(review.created_at)}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm font-medium mb-2">{review.recommendation_summary}</p>

                <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
                  {review.claim_id && (
                    <span className="flex items-center gap-1">
                      Claim: <span className="font-mono">{review.claim_id}</span>
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    Financial Impact:{" "}
                    <span className="font-semibold">{formatCurrency(review.financial_impact)}</span>
                  </span>
                  <span className={`flex items-center gap-1 ${confidenceColor(review.ai_confidence)}`}>
                    Confidence: {Math.round(review.ai_confidence * 100)}%
                  </span>
                  {review.model_used && (
                    <span>Model: {review.model_used}</span>
                  )}
                </div>

                {/* QA status */}
                {review.qa_passed !== null && (
                  <div className="flex items-center gap-2 text-xs mb-3">
                    <span className={review.qa_passed ? "text-green-600" : "text-red-600"}>
                      QA: {review.qa_passed ? "PASS" : "FAIL"}
                    </span>
                    {review.qa_score !== null && <span>({review.qa_score}/100)</span>}
                  </div>
                )}

                {/* Reviewer notes (when decided) */}
                {review.reviewer_notes && (
                  <div className="text-xs text-muted-foreground mb-2 italic">
                    Reviewer: {review.reviewer_notes}
                  </div>
                )}

                {/* Action buttons */}
                {review.status === "pending" && (
                  <div className="flex gap-2 pt-2 border-t">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-green-600 border-green-300 hover:bg-green-50"
                      disabled={actionLoading === review.id}
                      onClick={() => handleApprove(review)}
                    >
                      {actionLoading === review.id ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                      )}
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600 border-red-300 hover:bg-red-50"
                      disabled={actionLoading === review.id}
                      onClick={() => handleReject(review)}
                    >
                      {actionLoading === review.id ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 mr-1" />
                      )}
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-blue-600 border-blue-300 hover:bg-blue-50"
                      disabled={actionLoading === review.id}
                      onClick={() => handleNeedsChanges(review)}
                    >
                      {actionLoading === review.id ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5 mr-1" />
                      )}
                      Needs Changes
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
