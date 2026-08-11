import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { EmptyPanel, PageHeader, Panel, StatCard } from "@/components/atlas-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowRight,
  BadgeDollarSign,
  CheckCircle2,
  ClipboardList,
  DollarSign,
  FileWarning,
  Flame,
  Hourglass,
  Loader2,
  Plus,
  Radar,
  ScanSearch,
  Send,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

function money(n?: number | null): string {
  if (typeof n !== "number") return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function claimStatusTone(status: string): string {
  if (["closed", "approved", "work_completed", "billing"].includes(status))
    return "border-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300";
  if (["submitted", "response_received", "carrier_review"].includes(status))
    return "border-sky-400/30 bg-sky-400/10 text-sky-600 dark:text-sky-300";
  if (
    [
      "supplement_identified",
      "supplement_prepared",
      "ready_for_submission",
      "negotiating",
      "reconciling",
    ].includes(status)
  )
    return "border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300";
  return "border-border/70 bg-muted/40 text-muted-foreground";
}

export default function RevenueRecovery() {
  const navigate = useNavigate();
  const counts = useQuery(api.insurance.claims.claimCounts);
  const claims = useQuery(api.insurance.claims.listClaims, {});
  const candidates = useQuery(api.insurance.candidates.listClaimCandidates, {});
  const candidateCounts = useQuery(api.insurance.candidates.claimCandidateCounts);
  const audit = useQuery(api.audit.listAuditLogs, { limit: 30 });
  const createClaim = useMutation(api.insurance.claims.createClaim);
  const approveCandidate = useMutation(api.insurance.candidates.approveClaimCandidate);
  const rejectCandidate = useMutation(api.insurance.candidates.rejectClaimCandidate);
  const reconstructClaims = useAction(api.insurance.candidates.reconstructClaims);
  const [scanning, setScanning] = useState(false);
  const [busyCandidate, setBusyCandidate] = useState<string | null>(null);

  // New claim dialog
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    customer: "",
    property: "",
    claimNumber: "",
    carrier: "",
    causeOfLoss: "",
  });

  const submit = async () => {
    if (!form.customer.trim() && !form.property.trim() && !form.claimNumber.trim()) {
      toast.error("Add at least a customer, property or claim number.");
      return;
    }
    setCreating(true);
    try {
      const res = await createClaim({
        customer: form.customer.trim() || undefined,
        property: form.property.trim() || undefined,
        claimNumber: form.claimNumber.trim() || undefined,
        carrier: form.carrier.trim() || undefined,
        causeOfLoss: form.causeOfLoss.trim() || undefined,
        provenance: "User-entered via the Revenue Recovery workspace.",
      });
      toast.success("Claim created.");
      setOpen(false);
      setForm({ customer: "", property: "", claimNumber: "", carrier: "", causeOfLoss: "" });
      navigate(`/dashboard/revenue-recovery/${res.claimId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the claim.");
    } finally {
      setCreating(false);
    }
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      const res = await reconstructClaims();
      toast.success(
        res.candidates > 0
          ? `Found ${res.candidates} potential claim${res.candidates === 1 ? "" : "s"} across ${res.scanned} documents`
          : "No potential claims found in the knowledge base",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not scan the knowledge base");
    } finally {
      setScanning(false);
    }
  };

  const handleApprove = async (candidateId: string) => {
    setBusyCandidate(candidateId);
    try {
      const res = await approveCandidate({ candidateId: candidateId as never });
      toast.success(res.created ? "Claim created from the potential claim" : "Evidence linked to the existing claim", {
        description: "The potential claim is now approved and tracked in Revenue Recovery.",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not approve the candidate");
    } finally {
      setBusyCandidate(null);
    }
  };

  const handleReject = async (candidateId: string) => {
    setBusyCandidate(candidateId);
    try {
      await rejectCandidate({ candidateId: candidateId as never });
      toast.success("Potential claim rejected");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reject the candidate");
    } finally {
      setBusyCandidate(null);
    }
  };

  const pendingCandidates = (candidates ?? []).filter((c) => c.status === "pending");
  const needsAttention = (claims ?? []).filter((c) => c.needsAttention);
  const stalled = (claims ?? []).filter((c) => c.stalled);
  const submissionReady = (claims ?? []).filter((c) => c.readySupplements > 0);
  const recoveryActivity = (audit ?? []).filter((l) =>
    /claim|supplement|candidate|payment|finding/i.test(l.actionType ?? ""),
  ).slice(0, 8);

  const field = (key: keyof typeof form, label: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`rr-${key}`} className="text-xs font-medium">
        {label}
      </Label>
      <Input
        id={`rr-${key}`}
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        placeholder={label}
        className="h-9"
      />
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Insurance Restoration · First vertical"
        title="Revenue Recovery"
        description="Atlas identifies, documents, prepares and tracks revenue that may otherwise be missed during the insurance claim and supplement process. Every number below comes from actual claim records — nothing is simulated."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="size-4" />
                New claim
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Create a claim</DialogTitle>
                <DialogDescription>
                  Atlas records only what you enter. Missing fields simply show as
                  missing until evidence arrives.
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3 py-2">
                {field("customer", "Customer / insured")}
                {field("property", "Property")}
                {field("claimNumber", "Claim number")}
                {field("carrier", "Carrier")}
                <div className="col-span-2">{field("causeOfLoss", "Cause of loss")}</div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => void submit()} disabled={creating}>
                  {creating && <Loader2 className="size-4 animate-spin" />}
                  Create claim
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {/* Metrics — all derived from real records */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={ClipboardList}
          label="Open claims"
          value={counts?.openClaims ?? "…"}
          hint={`${counts?.attentionClaims ?? "…"} need attention`}
        />
        <StatCard
          icon={AlertTriangle}
          label="Potential opportunities"
          value={counts?.openFindings ?? "…"}
          hint={`${counts?.drafts ?? 0} drafts · ${counts?.readyForSubmission ?? 0} ready to submit`}
          accent="text-amber-600 dark:text-amber-300"
        />
        <StatCard
          icon={BadgeDollarSign}
          label="Potential recovery value"
          value={money(counts?.potential)}
          hint="Sum of open findings — potential, never guaranteed"
          accent="text-emerald-600 dark:text-emerald-300"
        />
        <StatCard
          icon={DollarSign}
          label="Potentially outstanding"
          value={money(counts?.outstanding)}
          hint={`Approved $${money(counts?.approvedAmount)} · Denied ${money(counts?.deniedAmount)}`}
          accent="text-rose-600 dark:text-rose-300"
        />
      </div>

      {/* Potential claims — discovered from company data, awaiting approval */}
      <Panel
        title="Potential claims awaiting review"
        description="Atlas reconstructs potential claims from deterministic identifiers in your documents and imported archives. Nothing becomes an authoritative claim without your approval."
      >
        <div className="mb-3 flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleScan()}
            disabled={scanning}
            className="gap-2"
          >
            {scanning ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ScanSearch className="size-4" />
            )}
            {scanning ? "Scanning…" : "Scan knowledge base"}
          </Button>
        </div>
        {candidates === undefined ? (
          <div className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-teal-600 dark:text-teal-300" />
            Loading candidates…
          </div>
        ) : pendingCandidates.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Sparkles className="size-6 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              No potential claims waiting on review
              {candidateCounts && candidateCounts.approved > 0
                ? ` — ${candidateCounts.approved} already approved`
                : ". Scan the knowledge base or import a company archive to discover claims."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {pendingCandidates.map((c) => (
              <div key={c._id} className="flex flex-wrap items-center gap-4 px-1 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {c.customer ?? c.property ?? `Claim ${c.claimNumber ?? c.claimKey}`}
                    {c.claimNumber && (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {c.claimNumber}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {c.basis}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="font-mono">
                      {c.evidence.length + c.documentIds.length} evidence file{(c.evidence.length + c.documentIds.length) === 1 ? "" : "s"}
                    </span>
                    <span>·</span>
                    <span className="text-amber-600 dark:text-amber-300">
                      {Math.round(c.confidence * 100)}% confidence
                    </span>
                    {c.archivePaths && c.archivePaths.length > 0 && (
                      <>
                        <span>·</span>
                        <span>from archive import</span>
                      </>
                    )}
                    {c.documentTitles && c.documentTitles.length > 0 && (
                      <span className="hidden truncate sm:inline">
                        · {c.documentTitles.slice(0, 2).join(", ")}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-rose-600 dark:text-rose-300"
                    onClick={() => void handleReject(String(c._id))}
                    disabled={busyCandidate !== null}
                  >
                    {busyCandidate === String(c._id) ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <XCircle className="size-3.5" />
                    )}
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={() => void handleApprove(String(c._id))}
                    disabled={busyCandidate !== null}
                  >
                    {busyCandidate === String(c._id) ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="size-3.5" />
                    )}
                    Approve → claim
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Recovery pipeline */}
      <Panel
        title="Revenue recovery pipeline"
        description="The durable lifecycle Atlas walks a claim through. Supplements never go out without human review."
      >
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {(counts?.recoveryPipeline ?? []).map((stage, i) => (
            <div key={stage} className="flex shrink-0 items-center gap-1">
              <span className="rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-[10px] whitespace-nowrap text-muted-foreground">
                <span className="mr-1 font-mono text-[9px] text-teal-600 dark:text-teal-300">
                  {i + 1}
                </span>
                {stage}
              </span>
              {i < (counts?.recoveryPipeline?.length ?? 0) - 1 && (
                <ArrowRight className="size-3 shrink-0 text-muted-foreground/40" />
              )}
            </div>
          ))}
        </div>
      </Panel>

      {/* Claims table */}
      {claims === undefined ? (
        <div className="flex items-center gap-3 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-teal-600 dark:text-teal-300" />
          Loading claims…
        </div>
      ) : claims.length === 0 ? (
        <EmptyPanel
          icon={Flame}
          title="No claims yet"
          description="Create your first claim (or ask Atlas to build one from an uploaded estimate, invoice or scope). Atlas already understands the full claim lifecycle — it just needs your company's records."
          action={
            <Button className="gap-2" onClick={() => setOpen(true)}>
              <Plus className="size-4" />
              New claim
            </Button>
          }
        />
      ) : (
        <Panel title={`Claims (${claims.length})`}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Claim</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Package</TableHead>
                <TableHead>Findings</TableHead>
                <TableHead>Supplements</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {claims.map((c) => (
                <TableRow
                  key={c._id}
                  className="cursor-pointer transition-colors hover:bg-muted/40"
                  onClick={() => navigate(`/dashboard/revenue-recovery/${c._id}`)}
                >
                  <TableCell>
                    <p className="font-medium text-foreground">
                      {c.customer ?? c.property ?? c.claimNumber ?? "Unnamed claim"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {[c.claimNumber, c.property, c.carrier].filter(Boolean).join(" · ") || "No details yet"}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`font-mono text-[10px] uppercase tracking-wide ${claimStatusTone(c.status ?? "")}`}
                    >
                      {(c.status ?? "opened").replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs text-foreground">
                      {c.completeness}/{c.completenessTotal}
                    </span>
                    <span className="ml-1.5 text-[10px] text-muted-foreground">categories</span>
                    {c.completeness < c.completenessTotal && (
                      <p className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-300">
                        <FileWarning className="size-3" /> needs attention
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    {c.openFindings > 0 ? (
                      <Badge
                        variant="outline"
                        className="border-amber-400/30 bg-amber-400/10 font-mono text-[10px] text-amber-600 dark:text-amber-300"
                      >
                        {c.openFindings} open
                      </Badge>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs text-foreground">
                      {c.draftSupplements + c.readySupplements > 0 ? (
                        <>
                          {c.draftSupplements > 0 && `${c.draftSupplements} draft`}
                          {c.draftSupplements > 0 && c.readySupplements > 0 && " · "}
                          {c.readySupplements > 0 && `${c.readySupplements} ready`}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {c.outstanding > 0 ? (
                      <span className="font-mono text-xs font-semibold text-rose-600 dark:text-rose-300">
                        {money(c.outstanding)}
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Radar className="ml-auto size-4 text-teal-600 dark:text-teal-300" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}

      {/* Command center — attention, stalled, ready, recent activity */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title={`Needs attention (${needsAttention.length})`}
          description="Missing evidence, open findings, reconciliation gaps or supplements ready for review."
        >
          {needsAttention.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No claims need attention right now.
            </p>
          ) : (
            <div className="divide-y divide-border/50">
              {needsAttention.slice(0, 6).map((c) => (
                <button
                  key={String(c._id)}
                  type="button"
                  onClick={() => navigate(`/dashboard/revenue-recovery/${c._id}`)}
                  className="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:bg-muted/30"
                >
                  <span className="min-w-0 truncate text-sm">
                    {c.customer ?? c.property ?? c.claimNumber ?? "Unnamed claim"}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {c.openFindings > 0 && `${c.openFindings} finding${c.openFindings === 1 ? "" : "s"}`}
                    {c.openFindings > 0 && c.readySupplements > 0 && " · "}
                    {c.readySupplements > 0 && `${c.readySupplements} ready`}
                    {c.openFindings === 0 && c.readySupplements === 0 && "incomplete package"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title={`Stalled claims (${stalled.length})`}
          description="Open claims with no activity for 30+ days. Derived from the actual update timestamps."
        >
          {stalled.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No stalled claims — everything open has recent activity.
            </p>
          ) : (
            <div className="divide-y divide-border/50">
              {stalled.slice(0, 6).map((c) => (
                <button
                  key={String(c._id)}
                  type="button"
                  onClick={() => navigate(`/dashboard/revenue-recovery/${c._id}`)}
                  className="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:bg-muted/30"
                >
                  <span className="min-w-0 truncate text-sm">
                    {c.customer ?? c.property ?? c.claimNumber ?? "Unnamed claim"}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-[11px] text-amber-600 dark:text-amber-300">
                    <Hourglass className="size-3" />
                    last updated {new Date(c.updatedAt ?? c.createdAt).toLocaleDateString()}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title={`Submission-ready supplements (${submissionReady.length})`}
          description="Drafts approved by your team and ready for submission. Nothing is sent automatically."
        >
          {submissionReady.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No supplements are ready to submit right now.
            </p>
          ) : (
            <div className="divide-y divide-border/50">
              {submissionReady.map((c) => (
                <button
                  key={String(c._id)}
                  type="button"
                  onClick={() => navigate(`/dashboard/revenue-recovery/${c._id}`)}
                  className="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:bg-muted/30"
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    <Send className="size-3.5 shrink-0 text-teal-600 dark:text-teal-300" />
                    <span className="truncate">
                      {c.customer ?? c.property ?? c.claimNumber ?? "Unnamed claim"}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {c.readySupplements} supplement{c.readySupplements === 1 ? "" : "s"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title="Recent recovery activity"
          description="The latest actions on claims, supplements and findings — straight from the audit log."
        >
          {recoveryActivity.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No recovery activity yet.
            </p>
          ) : (
            <div className="divide-y divide-border/50">
              {recoveryActivity.map((l) => (
                <div key={String(l._id)} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate text-sm">
                    {(l.actionType ?? "event").replace(/_/g, " ")}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {l.actorName ?? "system"} ·{" "}
                    {new Date(l._creationTime).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Honest framing */}
      <p className="text-center text-[11px] leading-5 text-muted-foreground">
        Findings are labeled <span className="font-medium text-amber-600 dark:text-amber-300">potential</span> —
        final applicability depends on the estimate, policy/coverage context, documentation and carrier review.
        Atlas never auto-submits a supplement.
      </p>
    </div>
  );
}
