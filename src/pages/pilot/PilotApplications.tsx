import { api } from "@/lib/api";
import { useMutation, useQuery } from "@/hooks/use-supabase";
import { PageHeader } from "@/components/atlas-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSearchParams } from "react-router";
import { invalidateQueries } from "@/hooks/use-supabase";
import {
  ArrowLeft,
  Building2,
  Check,
  ExternalLink,
  Eye,
  Inbox,
  Loader2,
  Mail,
  Phone,
  Plus,
  Search,
  Send,
  User,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const STATUS_COLORS: Record<string, string> = {
  new: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  pending:
    "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  reviewing:
    "border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  approved:
    "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400",
  rejected: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  waitlist:
    "border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400",
};

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  pending: "Pending",
  reviewing: "Reviewing",
  approved: "Approved",
  rejected: "Rejected",
  waitlist: "Waitlist",
};

export default function PilotApplications() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("id");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  const stats = useQuery(api.admin.pilotApplicationStats);
  const applications = useQuery(api.admin.listPilotApplications);
  const reviewApp = useMutation(api.admin.reviewPilotApplication);
  const createLead = useMutation(api.crm.createLead);
  const [showDetail, setShowDetail] = useState(false);
  const [detailApp, setDetailApp] = useState<any>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewing, setReviewing] = useState(false);

  const filteredApps = (applications ?? []).filter((app: any) => {
    const matchesSearch =
      !search ||
      (app.company_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (app.full_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (app.email ?? "").toLowerCase().includes(search.toLowerCase());
    const matchesStatus =
      filterStatus === "all" || app.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const handleReview = async (appId: string, status: string) => {
    setReviewing(true);
    try {
      await reviewApp({ id: appId, status, reviewNotes: reviewNotes || undefined });
      toast.success(`Application ${status}`);
      setShowDetail(false);
      setDetailApp(null);
      setReviewNotes("");
      invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setReviewing(false);
    }
  };

  const handleCreateLead = async (app: any) => {
    try {
      await createLead({
        companyName: app.company_name || app.full_name,
        contactName: app.full_name || app.contact_name,
        contactEmail: app.email,
        contactPhone: app.phone,
        website: app.website,
        source: "pilot_application",
        notes: `Converted from pilot application ${app.id}`,
        pilotApplicationId: app.id,
      });
      toast.success("Lead created in CRM");
      invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create lead");
    }
  };

  const openDetail = (app: any) => {
    setDetailApp(app);
    setShowDetail(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pilot Applications"
        description={`${stats?.total ?? 0} total · ${stats?.pending ?? 0} new`}
      />

      {/* Stats Row */}
      <div className="flex flex-wrap gap-3">
        {(["new", "pending", "reviewing", "approved", "rejected", "waitlist"] as const).map(
          (status) => (
            <button
              key={status}
              type="button"
              onClick={() => setFilterStatus(filterStatus === status ? "all" : status)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                filterStatus === status
                  ? "border-teal-400/40 bg-teal-400/10 text-teal-700 dark:text-teal-200"
                  : "border-border/60 text-muted-foreground hover:border-teal-400/30"
              }`}
            >
              {STATUS_LABELS[status] ?? status}
              <span className="font-mono text-[11px] opacity-70">
                {stats?.[status] ?? 0}
              </span>
            </button>
          ),
        )}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by company, name, or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Applications List */}
      {filteredApps.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Inbox className="mx-auto size-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">
              {search ? "No applications match your search." : "No applications yet."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredApps.map((app: any) => (
            <div
              key={app.id}
              className="flex items-center gap-4 rounded-xl border border-border/60 bg-card p-4 transition-colors hover:border-teal-400/30 cursor-pointer"
              onClick={() => openDetail(app)}
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted/50 text-sm font-semibold text-foreground">
                {(app.full_name ?? app.company_name ?? "?")[0]?.toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground truncate">
                    {app.company_name || "Unknown Company"}
                  </p>
                  <Badge
                    variant="outline"
                    className={`shrink-0 text-[10px] ${STATUS_COLORS[app.status] ?? ""}`}
                  >
                    {STATUS_LABELS[app.status] ?? app.status}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {app.full_name || app.contact_name} · {app.email} ·{" "}
                  {app.created_at
                    ? new Date(app.created_at).toLocaleDateString()
                    : ""}
                </p>
                {app.company_type && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                    {app.company_type}
                    {app.role ? ` · ${app.role}` : ""}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                {app.status === "new" && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCreateLead(app);
                      }}
                    >
                      <Plus className="mr-1 size-3" />
                      CRM
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleReview(app.id, "approved");
                      }}
                    >
                      <Check className="mr-1 size-3" />
                      Approve
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={showDetail} onOpenChange={setShowDetail}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          {detailApp && (
            <>
              <DialogHeader>
                <DialogTitle>{detailApp.company_name || "Application"}</DialogTitle>
                <DialogDescription>
                  {detailApp.full_name} · {detailApp.email}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* Contact Info */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {detailApp.phone && (
                    <InfoItem icon={Phone} label="Phone" value={detailApp.phone} />
                  )}
                  {detailApp.website && (
                    <InfoItem
                      icon={ExternalLink}
                      label="Website"
                      value={detailApp.website}
                    />
                  )}
                  {detailApp.company_type && (
                    <InfoItem icon={Building2} label="Type" value={detailApp.company_type} />
                  )}
                  {detailApp.role && (
                    <InfoItem icon={User} label="Role" value={detailApp.role} />
                  )}
                </div>

                {/* Workflow info */}
                {(detailApp.current_workflow || detailApp.biggest_pain) && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Workflow
                    </h4>
                    {detailApp.current_workflow && (
                      <p className="text-sm text-foreground/80">
                        {detailApp.current_workflow}
                      </p>
                    )}
                    {detailApp.biggest_pain && (
                      <p className="text-sm text-foreground/80">
                        <span className="font-medium">Pain:</span>{" "}
                        {detailApp.biggest_pain}
                      </p>
                    )}
                  </div>
                )}

                {/* Review Notes */}
                {(detailApp.status === "new" || detailApp.status === "reviewing") && (
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      Review Notes
                    </label>
                    <Textarea
                      value={reviewNotes}
                      onChange={(e) => setReviewNotes(e.target.value)}
                      placeholder="Add internal notes about this application..."
                      rows={3}
                    />
                  </div>
                )}
              </div>

              {/* Actions */}
              {(detailApp.status === "new" || detailApp.status === "reviewing") && (
                <DialogFooter className="flex-row gap-2 sm:gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={reviewing}
                    onClick={() => handleReview(detailApp.id, "rejected")}
                  >
                    <X className="mr-1 size-3" />
                    Reject
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={reviewing}
                    onClick={() => handleReview(detailApp.id, "waitlist")}
                  >
                    Waitlist
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={reviewing}
                    onClick={() => {
                      handleCreateLead(detailApp);
                    }}
                  >
                    <Plus className="mr-1 size-3" />
                    Create Lead
                  </Button>
                  <Button
                    size="sm"
                    disabled={reviewing}
                    onClick={() => handleReview(detailApp.id, "approved")}
                  >
                    {reviewing ? (
                      <Loader2 className="mr-1 size-3 animate-spin" />
                    ) : (
                      <Check className="mr-1 size-3" />
                    )}
                    Approve
                  </Button>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InfoItem({
  icon: Icon,
  label,
  value,
}: {
  icon: any;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 size-3.5 text-muted-foreground" />
      <div>
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="text-sm text-foreground">{value}</p>
      </div>
    </div>
  );
}
