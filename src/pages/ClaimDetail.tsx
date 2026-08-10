import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  ConfidenceBar,
  EmptyPanel,
  PageHeader,
  Panel,
  formatDate,
} from "@/components/atlas-ui";
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
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  BadgeDollarSign,
  CalendarDays,
  Check,
  ClipboardCheck,
  FileText,
  Flame,
  History,
  Landmark,
  Loader2,
  Radar,
  RefreshCw,
  ScrollText,
  Search,
  ShieldAlert,
  Sparkles,
  User,
  X,
} from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";

function money(n?: number | null): string {
  if (typeof n !== "number") return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

const PACKAGE_TONE: Record<string, string> = {
  verified: "border-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300",
  derived: "border-sky-400/30 bg-sky-400/10 text-sky-600 dark:text-sky-300",
  inferred: "border-violet-400/30 bg-violet-400/10 text-violet-600 dark:text-violet-300",
  missing: "border-rose-400/30 bg-rose-400/10 text-rose-600 dark:text-rose-300",
  conflicting: "border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300",
};

const COMPLETENESS_TONE: Record<string, string> = {
  verified: "border-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300",
  extracted: "border-sky-400/30 bg-sky-400/10 text-sky-600 dark:text-sky-300",
  inferred: "border-violet-400/30 bg-violet-400/10 text-violet-600 dark:text-violet-300",
  missing: "border-rose-400/30 bg-rose-400/10 text-rose-600 dark:text-rose-300",
  needs_review: "border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300",
};

const SUPPLEMENT_TONE: Record<string, string> = {
  draft: "border-muted-foreground/30 bg-muted text-muted-foreground",
  ready_for_submission:
    "border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300",
  submitted: "border-sky-400/30 bg-sky-400/10 text-sky-600 dark:text-sky-300",
  carrier_review: "border-sky-400/30 bg-sky-400/10 text-sky-600 dark:text-sky-300",
  approved: "border-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300",
  partially_approved:
    "border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300",
  denied: "border-rose-400/30 bg-rose-400/10 text-rose-600 dark:text-rose-300",
  additional_docs_requested:
    "border-orange-400/30 bg-orange-400/10 text-orange-600 dark:text-orange-300",
  payment_received:
    "border-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300",
  closed: "border-muted-foreground/30 bg-muted text-muted-foreground",
};

export default function ClaimDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const claimId = id as Id<"insuranceClaims">;
  const pkg = useQuery(api.insurance.claims.getClaimPackage, { claimId });

  const runAnalysis = useMutation(api.insurance.claims.runClaimAnalysis);
  const updateFindingStatus = useMutation(api.insurance.claims.updateFindingStatus);
  const createSupplement = useMutation(api.insurance.claims.createSupplement);
  const updateSupplementStatus = useMutation(api.insurance.claims.updateSupplementStatus);
  const recordPayment = useMutation(api.insurance.claims.recordClaimPayment);
  const updateClaim = useMutation(api.insurance.claims.updateClaim);

  const [analyzing, setAnalyzing] = useState(false);
  const [supOpen, setSupOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [creating, setCreating] = useState(false);
  const [supForm, setSupForm] = useState({ reason: "", amount: "", justification: "" });
  const [docSup, setDocSup] = useState<Id<"claimSupplements"> | null>(null);

  const submitSupplement = async () => {
    if (!supForm.reason.trim()) {
      toast.error("A supplement needs a reason.");
      return;
    }
    setCreating(true);
    try {
      await createSupplement({
        claimId,
        reason: supForm.reason.trim(),
        amount: supForm.amount ? Number(supForm.amount) : undefined,
        justification: supForm.justification.trim() || undefined,
        affectedLineItems: [],
        evidence: [],
      });
      toast.success("Supplement draft created — requires human review before submission.");
      setSupOpen(false);
      setSupForm({ reason: "", amount: "", justification: "" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the supplement.");
    } finally {
      setCreating(false);
    }
  };

  const submitPayment = async () => {
    const amt = Number(payAmount);
    if (!amt || amt <= 0) {
      toast.error("Enter a positive payment amount.");
      return;
    }
    try {
      await recordPayment({ claimId, amount: amt });
      toast.success("Payment recorded.");
      setPayOpen(false);
      setPayAmount("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the payment.");
    }
  };

  if (pkg === undefined) {
    return (
      <div className="flex items-center gap-3 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin text-teal-600 dark:text-teal-300" />
        Loading claim package…
      </div>
    );
  }

  if (pkg === null) {
    return (
      <EmptyPanel
        icon={Flame}
        title="Claim not found"
        description="This claim doesn't exist or isn't in your workspace."
        action={<Button variant="outline" onClick={() => navigate("/dashboard/revenue-recovery")}>Back to Revenue Recovery</Button>}
      />
    );
  }

  const { supplements, findings, evidenceDocs, completeness, reconciliation, timeline, packageModel } = pkg;
  const openFindings = findings.filter((f) => f.status === "open");
  const scorePct = Math.round(completeness.score * 100);
  // pkg is narrowed non-null above, so the claim always exists here.
  const claim = pkg.claim;

  return (
    <div className="space-y-6">
      <div>
        <button
          type="button"
          onClick={() => navigate("/dashboard/revenue-recovery")}
          className="mb-2 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-teal-600 dark:hover:text-teal-300"
        >
          <ArrowLeft className="size-3.5" />
          Revenue Recovery
        </button>
        <PageHeader
          eyebrow="Insurance claim package"
          title={claim.customer ?? claim.property ?? claim.claimNumber ?? "Unnamed claim"}
          description={`${claim.claimNumber ?? "No claim number"} · ${claim.property ?? "No property"} · ${claim.carrier ?? "No carrier"}`}
          actions={
            <>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => {
                  setAnalyzing(true);
                  void runAnalysis({ claimId })
                    .then(() => toast.success("Analysis refreshed — findings are potential, not guarantees."))
                    .catch((e) => toast.error(e instanceof Error ? e.message : "Analysis failed."))
                    .finally(() => setAnalyzing(false));
                }}
                disabled={analyzing}
              >
                {analyzing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                Run analysis
              </Button>
              <Dialog open={supOpen} onOpenChange={setSupOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-2">
                    <ClipboardCheck className="size-4" />
                    Draft supplement
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Draft a supplement</DialogTitle>
                    <DialogDescription>
                      This creates a draft — Atlas never submits without your review.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-3 py-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor="sup-reason" className="text-xs font-medium">Reason</Label>
                      <Input
                        id="sup-reason"
                        value={supForm.reason}
                        onChange={(e) => setSupForm((f) => ({ ...f, reason: e.target.value }))}
                        placeholder="e.g. Additional drying equipment days"
                        className="h-9"
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="sup-amount" className="text-xs font-medium">Requested amount (optional)</Label>
                      <Input
                        id="sup-amount"
                        value={supForm.amount}
                        onChange={(e) => setSupForm((f) => ({ ...f, amount: e.target.value }))}
                        placeholder="e.g. 2400"
                        inputMode="numeric"
                        className="h-9"
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="sup-just" className="text-xs font-medium">Justification (optional)</Label>
                      <Input
                        id="sup-just"
                        value={supForm.justification}
                        onChange={(e) => setSupForm((f) => ({ ...f, justification: e.target.value }))}
                        placeholder="What supports this request?"
                        className="h-9"
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setSupOpen(false)}>Cancel</Button>
                    <Button onClick={() => void submitSupplement()} disabled={creating}>
                      {creating && <Loader2 className="size-4 animate-spin" />}
                      Create draft
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          }
        />
      </div>

      {/* Overview stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Panel className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Estimate</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
            {money(claim.estimateAmount)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {typeof claim.estimateLineItemCount === "number"
              ? `${claim.estimateLineItemCount} line items`
              : "No estimate ingested"}
          </p>
        </Panel>
        <Panel className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Supplement status</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
            {money(reconciliation.approved)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Requested {money(reconciliation.requested)} · Denied {money(reconciliation.denied)}
          </p>
        </Panel>
        <Panel className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Payment received</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
            {money(claim.paymentAmount)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Invoiced {money(claim.invoicedAmount)}
          </p>
        </Panel>
        <Panel className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Potentially outstanding</p>
          <p className={`mt-2 text-2xl font-semibold tabular-nums tracking-tight ${
            reconciliation.outstanding > 0 ? "text-rose-600 dark:text-rose-300" : ""
          }`}>
            {money(reconciliation.outstanding)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Estimated vs payments received</p>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column: overview + completeness + evidence */}
        <div className="space-y-6 lg:col-span-2">
          <Panel title="Claim overview">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Status</dt>
                <dd className="mt-0.5">
                  <Badge
                    variant="outline"
                    className="border-teal-400/30 bg-teal-400/10 font-mono text-[10px] uppercase tracking-wide text-teal-600 dark:text-teal-300"
                  >
                    {(claim.status ?? "opened").replace(/_/g, " ")}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Claim number</dt>
                <dd className="mt-0.5 font-mono text-foreground">{claim.claimNumber ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Date of loss</dt>
                <dd className="mt-0.5 flex items-center gap-1.5 text-foreground">
                  <CalendarDays className="size-3.5 text-muted-foreground" />
                  {typeof claim.dateOfLoss === "number" ? formatDate(claim.dateOfLoss) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Cause of loss</dt>
                <dd className="mt-0.5 text-foreground">{claim.causeOfLoss ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Adjuster</dt>
                <dd className="mt-0.5 text-foreground">{claim.adjuster ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Policy</dt>
                <dd className="mt-0.5 text-foreground">{claim.policy ?? "—"}</dd>
              </div>
            </dl>
            <p className="mt-4 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
              <ShieldAlert className="mr-1 inline size-3 -translate-y-px text-amber-500" />
              {claim.provenance ?? "No provenance recorded yet."}
            </p>
          </Panel>

          {/* Phase 12 — claim package field states */}
          <Panel
            title="Claim package"
            description="Every material field is labeled — verified (source-backed), derived (calculated), missing (not on file) or conflicting (sources disagree). Atlas never presents a missing or inferred value as fact."
          >
            <div className="mb-3 flex flex-wrap gap-1.5">
              {(Object.entries(packageModel.states) as Array<[string, number]>)
                .filter(([, n]) => n > 0)
                .map(([state, n]) => (
                  <span
                    key={state}
                    className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${PACKAGE_TONE[state] ?? ""}`}
                  >
                    {state} · {n}
                  </span>
                ))}
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {packageModel.fields.map((f) => (
                <div
                  key={f.key}
                  className="flex items-start justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-foreground">{f.label}</p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                      {f.value ?? "—"}
                    </p>
                    <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground/80">{f.note}</p>
                  </div>
                  <Badge
                    variant="outline"
                    className={`shrink-0 font-mono text-[9px] uppercase tracking-wide ${PACKAGE_TONE[f.state] ?? ""}`}
                  >
                    {f.state}
                  </Badge>
                </div>
              ))}
            </div>
          </Panel>

          {/* Completeness */}
          <Panel
            title="Claim package completeness"
            description={completeness.summary}
          >
            <div className="mb-4 flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${scorePct >= 75 ? "bg-emerald-400" : scorePct >= 45 ? "bg-amber-400" : "bg-rose-400"}`}
                  style={{ width: `${scorePct}%` }}
                />
              </div>
              <span className="font-mono text-sm font-semibold text-foreground">
                {completeness.complete}/{completeness.total}
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {completeness.categories.map((c) => (
                <div
                  key={c.key}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground">{c.label}</p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{c.note}</p>
                  </div>
                  <Badge
                    variant="outline"
                    className={`shrink-0 font-mono text-[9px] uppercase tracking-wide ${COMPLETENESS_TONE[c.status] ?? ""}`}
                  >
                    {c.status.replace(/_/g, " ")}
                  </Badge>
                </div>
              ))}
            </div>
          </Panel>

          {/* Evidence */}
          <Panel
            title="Evidence"
            description="Documents linked to this claim. Evidence categories also drive completeness."
          >
            {evidenceDocs.filter(Boolean).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No evidence linked yet — attach documents from Knowledge, or have Atlas
                build the claim from an uploaded estimate or invoice.
              </p>
            ) : (
              <div className="space-y-1.5">
                {evidenceDocs.filter((d): d is NonNullable<typeof d> => Boolean(d)).map((d) => (
                  <div
                    key={String(d._id)}
                    className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
                  >
                    <FileText className="size-4 shrink-0 text-teal-600 dark:text-teal-300" />
                    <span className="truncate text-xs font-medium text-foreground">{d.title}</span>
                    {d.classification && (
                      <Badge variant="outline" className="ml-auto font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                        {d.classification}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
            {(claim.evidenceSummary?.length ?? 0) > 0 && (
              <p className="mt-3 text-[11px] text-muted-foreground">
                Evidence categories: {claim.evidenceSummary!.join(", ")}
              </p>
            )}
          </Panel>

          {/* Phase 12 — claim timeline */}
          <Panel
            title="Claim timeline"
            description="Chronological, evidence-grounded history. Violet markers are Atlas-generated events; teal markers are source-system events."
          >
            {timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No timeline events yet — record evidence, findings or supplements and they'll appear here.
              </p>
            ) : (
              <ol className="relative space-y-4 border-l border-border/60 pl-5">
                {timeline.map((e, i) => (
                  <li key={`${e.ts}-${i}`} className="relative">
                    <span
                      className={`absolute -left-[25px] top-1 size-2.5 rounded-full ring-4 ring-background ${
                        e.source === "atlas" ? "bg-violet-400" : "bg-teal-400"
                      }`}
                    />
                    <p className="text-xs font-medium text-foreground">{e.label}</p>
                    {e.detail && (
                      <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{e.detail}</p>
                    )}
                    <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/60">
                      {formatDate(e.ts)}
                      {e.source === "atlas" && (
                        <span className="ml-1.5 rounded border border-violet-400/30 bg-violet-400/10 px-1 py-px font-mono text-[9px] uppercase tracking-wide text-violet-600 dark:text-violet-300">
                          Atlas
                        </span>
                      )}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        {/* Right column: findings + supplements + reconciliation */}
        <div className="space-y-6">
          {/* Atlas intelligence / findings */}
          <Panel
            title="Atlas intelligence"
            description="Potential recovery opportunities — always labeled potential, never guaranteed."
          >
            {openFindings.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No open findings. Run analysis after ingesting an estimate or evidence to surface gaps.
              </p>
            ) : (
              <div className="space-y-3">
                {openFindings.map((f) => (
                  <div key={f._id} className="rounded-xl border border-amber-400/25 bg-amber-400/5 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                        <Sparkles className="size-3.5 shrink-0 text-amber-500" />
                        {f.title}
                      </p>
                      <Badge
                        variant="outline"
                        className="shrink-0 border-muted-foreground/30 font-mono text-[9px] uppercase tracking-wide text-muted-foreground"
                      >
                        potential
                      </Badge>
                    </div>
                    <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">{f.description}</p>
                    {(f.evidence ?? []).length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {(f.evidence ?? []).map((e, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-[11px] leading-4 text-foreground/80">
                            <Check className="mt-0.5 size-3 shrink-0 text-emerald-500" />
                            {e}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                      <ConfidenceBar value={f.confidence} />
                      {typeof f.estimatedAmount === "number" && (
                        <span className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-300">
                          ~{money(f.estimatedAmount)}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-[10px] italic leading-4 text-muted-foreground">{f.limitation}</p>
                    <div className="mt-2.5 flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 text-[11px]"
                        onClick={() =>
                          void updateFindingStatus({ findingId: f._id, status: "addressed" })
                            .then(() => toast.success("Finding marked addressed."))
                            .catch((e) => toast.error(e instanceof Error ? e.message : "Update failed."))
                        }
                      >
                        <Check className="size-3" /> Addressed
                      </Button>
                      <span className="text-[10px] text-muted-foreground">
                        Next: {f.recommendedNextStep}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* Supplements */}
          <Panel title="Supplements" description="Drafts require human review — nothing is submitted automatically.">
            {supplements.length === 0 ? (
              <p className="text-sm text-muted-foreground">No supplements yet.</p>
            ) : (
              <div className="space-y-2.5">
                {supplements.map((s) => (
                  <div key={s._id} className="rounded-xl border border-border/60 bg-muted/20 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold text-foreground">{s.reason}</p>
                      <Badge
                        variant="outline"
                        className={`shrink-0 font-mono text-[9px] uppercase tracking-wide ${SUPPLEMENT_TONE[s.status ?? "draft"] ?? ""}`}
                      >
                        {(s.status ?? "draft").replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                      <div>
                        <p className="text-muted-foreground">Requested</p>
                        <p className="font-mono font-medium text-foreground">{money(s.amount)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Approved</p>
                        <p className="font-mono font-medium text-emerald-600 dark:text-emerald-300">{money(s.approvedAmount)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Outstanding</p>
                        <p className="font-mono font-medium text-rose-600 dark:text-rose-300">{money(s.outstandingAmount)}</p>
                      </div>
                    </div>
                    {s.justification && (
                      <p className="mt-2 text-[11px] leading-5 text-muted-foreground">{s.justification}</p>
                    )}
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 text-[11px]"
                        onClick={() => setDocSup(s._id)}
                      >
                        <ScrollText className="size-3" /> View document
                      </Button>
                    </div>
                    {(s.status === "draft" || s.status === "ready_for_submission") && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {s.status === "draft" && (
                          <Button
                            size="sm"
                            className="h-7 gap-1 text-[11px]"
                            onClick={() =>
                              void updateSupplementStatus({ supplementId: s._id, status: "ready_for_submission" })
                                .then(() => toast.success("Supplement marked ready for submission."))
                                .catch((e) => toast.error(e instanceof Error ? e.message : "Update failed."))
                            }
                          >
                            <ClipboardCheck className="size-3" /> Ready for submission
                          </Button>
                        )}
                        {s.status === "ready_for_submission" && (
                          <>
                            <Button
                              size="sm"
                              className="h-7 gap-1 text-[11px]"
                              onClick={() =>
                                void updateSupplementStatus({ supplementId: s._id, status: "submitted" })
                                  .then(() => toast.success("Supplement marked submitted — carrier response tracking started."))
                                  .catch((e) => toast.error(e instanceof Error ? e.message : "Update failed."))
                              }
                            >
                              <Landmark className="size-3" /> Mark submitted
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 text-[11px]"
                              onClick={() =>
                                void updateSupplementStatus({ supplementId: s._id, status: "draft" })
                                  .then(() => toast.success("Returned to draft."))
                                  .catch((e) => toast.error(e instanceof Error ? e.message : "Update failed."))
                              }
                            >
                              <X className="size-3" /> Back to draft
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                    {["submitted", "carrier_review", "response_received", "approved", "partially_approved", "denied", "additional_docs_requested"].includes(s.status ?? "") && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 text-[11px]"
                          onClick={() =>
                            void updateSupplementStatus({ supplementId: s._id, status: "approved", approvedAmount: s.amount ?? undefined })
                              .then(() => toast.success("Carrier approval recorded."))
                              .catch((e) => toast.error(e instanceof Error ? e.message : "Update failed."))
                          }
                        >
                          <Check className="size-3" /> Record approved
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 text-[11px]"
                          onClick={() =>
                            void updateSupplementStatus({ supplementId: s._id, status: "denied" })
                              .then(() => toast.success("Carrier denial recorded."))
                              .catch((e) => toast.error(e instanceof Error ? e.message : "Update failed."))
                          }
                        >
                          <X className="size-3" /> Record denied
                        </Button>
                      </div>
                    )}
                    <p className="mt-2 text-[10px] italic text-muted-foreground">{s.provenance}</p>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* Reconciliation */}
          <Panel title="Reconciliation" description="Estimate vs supplements vs approved vs payment.">
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Estimate</span>
                <span className="font-mono text-foreground">{money(reconciliation.estimate)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Supplement requested</span>
                <span className="font-mono text-foreground">{money(reconciliation.requested)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Approved</span>
                <span className="font-mono text-emerald-600 dark:text-emerald-300">{money(reconciliation.approved)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Payment received</span>
                <span className="font-mono text-foreground">{money(reconciliation.paid)}</span>
              </div>
              <div className="flex justify-between border-t border-border/60 pt-2">
                <span className="font-medium text-foreground">Potentially outstanding</span>
                <span className={`font-mono font-semibold ${reconciliation.outstanding > 0 ? "text-rose-600 dark:text-rose-300" : "text-emerald-600 dark:text-emerald-300"}`}>
                  {money(reconciliation.outstanding)}
                </span>
              </div>
            </div>
            {reconciliation.notes.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {reconciliation.notes.map((n, i) => (
                  <p key={i} className="flex items-start gap-1.5 text-[11px] leading-4 text-muted-foreground">
                    <Radar className="mt-0.5 size-3 shrink-0 text-teal-500" />
                    {n}
                  </p>
                ))}
              </div>
            )}
            <Dialog open={payOpen} onOpenChange={setPayOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="mt-3 gap-2">
                  <BadgeDollarSign className="size-4" />
                  Record payment
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle>Record a payment</DialogTitle>
                  <DialogDescription>
                    Adds to this claim's recorded payment total. Reconciliation updates immediately.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-1.5 py-2">
                  <Label htmlFor="pay-amount" className="text-xs font-medium">Amount (USD)</Label>
                  <Input
                    id="pay-amount"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    placeholder="e.g. 5000"
                    inputMode="numeric"
                    className="h-9"
                  />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
                  <Button onClick={() => void submitPayment()}>Record payment</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </Panel>
        </div>
      </div>

      {/* Phase 12 — structured supplement document for review */}
      <SupplementDocumentDialog
        claimId={claimId}
        supplementId={docSup}
        open={docSup !== null}
        onClose={() => setDocSup(null)}
      />
    </div>
  );
}

/** Structured supplement document — sections assembled from verified records. */
function SupplementDocumentDialog({
  claimId,
  supplementId,
  open,
  onClose,
}: {
  claimId: Id<"insuranceClaims">;
  supplementId: Id<"claimSupplements"> | null;
  open: boolean;
  onClose: () => void;
}) {
  const doc = useQuery(
    api.insurance.claims.getSupplementDocument,
    supplementId ? { claimId, supplementId } : "skip",
  );
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Supplement document · draft for review</DialogTitle>
          <DialogDescription>
            {doc?.disclaimer ?? "Loading the structured supplement document…"}
          </DialogDescription>
        </DialogHeader>
        {doc === undefined ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-teal-600 dark:text-teal-300" />
            Loading document…
          </p>
        ) : (
          <div className="space-y-3 py-1">
            <div className="flex flex-wrap gap-1.5">
              <Badge
                variant="outline"
                className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
              >
                Status: {(doc.status ?? "draft").replace(/_/g, " ")}
              </Badge>
              {typeof doc.requestedAmount === "number" && (
                <Badge
                  variant="outline"
                  className="font-mono text-[10px] text-emerald-600 dark:text-emerald-300"
                >
                  Requested ${doc.requestedAmount.toLocaleString()}
                </Badge>
              )}
            </div>
            {doc.sections.map((s) => (
              <div
                key={s.title}
                className="rounded-lg border border-border/60 bg-muted/20 p-3"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-foreground">
                  {s.title}
                </p>
                <div className="mt-1.5 space-y-1">
                  {s.body.map((line, i) => (
                    <p key={i} className="text-[11px] leading-5 text-muted-foreground">
                      {line}
                    </p>
                  ))}
                </div>
              </div>
            ))}
            <p className="rounded-lg border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-[10px] italic leading-4 text-amber-700 dark:text-amber-200">
              {doc.disclaimer}
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
