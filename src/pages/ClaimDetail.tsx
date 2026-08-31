// ---------------------------------------------------------------------------
// Claim Experience — Atlas understands this claim
//
// Not a claims-management page. This is Atlas answering:
//   "What does Atlas understand about this claim, and what should I do?"
//
// ┌──────────────────────────────────────────────────────────────┐
// │                                                              │
// │  CLAIM #1842                                                │
// │  UNDERPAID                                                  │
// │  $18,420 potential recovery          HIGH CONFIDENCE        │
// │                                                              │
// │  ATLAS ASSESSMENT                                           │
// │  The carrier appears to have excluded documented scope.      │
// │                                                              │
// │  WHAT ATLAS KNOWS                                           │
// │  ✓ Damage documented                                        │
// │  ✓ Scope supported                                          │
// │  ✓ Carrier discrepancy identified                           │
// │                                                              │
// │  WHAT'S MISSING                                             │
// │  ⚠ Moisture documentation                                   │
// │                                                              │
// │  EVIDENCE                                                   │
// │  7 supporting documents                                     │
// │                                                              │
// │  CLAIM STORY                                                │
// │  Claim opened → Inspection → Estimate → ...                  │
// │                                                              │
// │  ATLAS RECOMMENDS                                           │
// │  [ Prepare Supplement ]  [ Investigate ]                    │
// │                                                              │
// └──────────────────────────────────────────────────────────────┘

import { api } from "@/lib/api";
import type { Id } from "@/lib/data-model";
import { ConfidenceBar, EmptyPanel, Panel, formatDate } from "@/components/atlas-ui";
import { useIntelligence } from "@/lib/atlas-experience";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMutation, useQuery } from "@/hooks/use-supabase";
import {
  ArrowLeft,
  ArrowRight,
  BadgeDollarSign,
  CalendarDays,
  Check,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Flame,
  Loader2,
  Package,
  Radar,
  RefreshCw,
  ScrollText,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import {
  assessReadiness,
  type ReadinessAssessment,
  type RequirementClaimFacts,
  type RequirementContext,
  type RequirementEvidenceDocument,
  type WorkflowKey,
} from "../../supabase/functions/conversation-converse/source/evidence-requirements.ts";
import { PackageBuilder } from "@/components/package-builder";
import { AtlasActionPanel } from "@/components/atlas-experience/AtlasActionPanel";
import { useAtlasActionAuth } from "@/hooks/use-atlas-action-auth";
import { createActionProposals } from "@/lib/atlas-experience/action-availability";
import {
  AtlasEntityShell,
  AtlasAssessment,
  AtlasKnowledge,
  AtlasGaps,
  AtlasTimeline,
  AtlasActionRecommendation,
  AtlasEvidenceSummary,
  AtlasConfidenceExplanation,
} from "@/components/atlas-experience/AtlasEntityExperience";
import { useAtlasContext, type AtlasEntityType } from "@/lib/atlas-experience/context";

function money(n?: number | null): string {
  if (typeof n !== "number") return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// ---------------------------------------------------------------------------
// Atlas derives the entity experience from the claim package
// ---------------------------------------------------------------------------

function deriveAtlasAssessment(pkg: Record<string, any>): string {
  const reconciliation = pkg.reconciliation ?? { outstanding: 0, paid: 0 };
  const findings = Array.isArray(pkg.findings) ? pkg.findings : [];
  const openFindings = findings.filter((f) => f.status === "open");
  const completeness = pkg.completeness ?? { score: 0 };
  const claim = pkg.claim ?? {};

  if (reconciliation.outstanding > 0 && openFindings.length > 0) {
    return `The carrier estimate appears to exclude documented scope. Atlas has identified ${openFindings.length} potential finding${openFindings.length === 1 ? "" : "s"} with an estimated ${money(reconciliation.outstanding)} outstanding.`;
  }
  if (reconciliation.outstanding > 0) {
    return `Atlas estimates ${money(reconciliation.outstanding)} may still be outstanding based on the estimate, supplements, and payments recorded.`;
  }
  if (openFindings.length > 0) {
    return `Atlas has identified ${openFindings.length} potential finding${openFindings.length === 1 ? "" : "s"} that may require attention.`;
  }
  if (completeness.score < 0.5) {
    return `Atlas has limited information about this claim. More evidence would improve the assessment.`;
  }
  return `Atlas has reviewed this claim. No significant discrepancies have been identified.`;
}

function deriveVerdict(pkg: Record<string, any>): string {
  const reconciliation = pkg.reconciliation ?? { outstanding: 0 };
  const findings = Array.isArray(pkg.findings) ? pkg.findings : [];
  const openFindings = findings.filter((f) => f.status === "open");

  if (reconciliation.outstanding > 0 && openFindings.length > 0) return "Underpaid";
  if (reconciliation.outstanding > 0) return "Outstanding balance";
  if (openFindings.length > 0) return "Findings identified";
  return "Reviewed";
}

function deriveKnowledgeItems(pkg: Record<string, any>): Array<{ label: string; status: "known" | "partial" | "missing"; detail?: string }> {
  const claim = pkg.claim ?? {};
  const completeness = pkg.completeness ?? { categories: [] };
  const items: Array<{ label: string; status: "known" | "partial" | "missing"; detail?: string }> = [];

  // Core claim facts
  if (claim.claimNumber) items.push({ label: `Claim ${claim.claimNumber}`, status: "known" });
  if (claim.property) items.push({ label: `Property: ${claim.property}`, status: "known" });
  if (claim.carrier) items.push({ label: `Carrier: ${claim.carrier}`, status: "known" });
  if (claim.causeOfLoss) items.push({ label: `Cause: ${claim.causeOfLoss}`, status: "known" });
  if (claim.adjuster) items.push({ label: `Adjuster: ${claim.adjuster}`, status: "known" });
  if (typeof claim.estimateAmount === "number") items.push({ label: `Estimate: ${money(claim.estimateAmount)}`, status: "known" });
  if (typeof claim.paymentAmount === "number" && claim.paymentAmount > 0) items.push({ label: `Payment received: ${money(claim.paymentAmount)}`, status: "known" });

  // Completeness categories
  const categories = Array.isArray(completeness.categories) ? completeness.categories : [];
  for (const cat of categories) {
    const status = cat.status === "verified" ? "known" : cat.status === "missing" ? "missing" : "partial";
    items.push({ label: cat.label, status, detail: cat.note });
  }

  return items;
}

function deriveGaps(pkg: Record<string, any>): Array<{ label: string; severity: "critical" | "warning" | "info"; description?: string }> {
  const completeness = pkg.completeness ?? { categories: [] };
  const categories = Array.isArray(completeness.categories) ? completeness.categories : [];
  const gaps: Array<{ label: string; severity: "critical" | "warning" | "info"; description?: string }> = [];

  for (const cat of categories) {
    if (cat.status === "missing") {
      gaps.push({ label: cat.label, severity: "critical", description: cat.note });
    }
  }

  return gaps;
}

function deriveTimeline(pkg: Record<string, any>): Array<{ label: string; detail?: string; timestamp?: number; source?: "atlas" | "system" | "user" }> {
  const timeline = Array.isArray(pkg.timeline) ? pkg.timeline : [];
  return timeline.map((e) => ({
    label: e.label,
    detail: e.detail,
    timestamp: e.ts,
    source: (e.source as "atlas" | "system" | "user") ?? "system",
  }));
}

function deriveConfidence(pkg: Record<string, any>): "high" | "medium" | "low" {
  const completeness = pkg.completeness ?? { score: 0 };
  const score = completeness.score ?? 0;
  if (score >= 0.7) return "high";
  if (score >= 0.4) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// ClaimDetail — Atlas Entity Experience
// ---------------------------------------------------------------------------

export default function ClaimDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const claimId = id as Id<"insuranceClaims">;
  const pkg = useQuery(api.insurance.claims.getClaimPackage, { claimId });

  const runAnalysis = useMutation(api.insurance.claims.runClaimAnalysis);
  const createSupplement = useMutation(api.insurance.claims.createSupplement);
  const updateSupplementStatus = useMutation(api.insurance.claims.updateSupplementStatus);
  const recordPayment = useMutation(api.insurance.claims.recordClaimPayment);

  const [analyzing, setAnalyzing] = useState(false);
  const [supOpen, setSupOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [creating, setCreating] = useState(false);
  const [supForm, setSupForm] = useState({ reason: "", amount: "", justification: "" });
  const [docSup, setDocSup] = useState<Id<"claimSupplements"> | null>(null);
  const [pkgOpen, setPkgOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const auth = useAtlasActionAuth();
  const { setEntity } = useAtlasContext();

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

  // Set entity context when claim loads
  const { investigation } = useAtlasContext();
  useEffect(() => {
    if (pkg && pkg.claim) {
      const claim = pkg.claim;
      setEntity({
        id: String(claimId),
        type: "claim" as AtlasEntityType,
        name: claim.claimNumber ? `#${claim.claimNumber}` : undefined,
        meta: {
          claimNumber: claim.claimNumber,
          status: claim.status,
          customer: claim.customer,
          property: claim.property,
          originatingInsight: investigation?.originatingInsight,
        },
      });
      return () => setEntity(null);
    }
  }, [pkg, claimId, setEntity, investigation?.originatingInsight]);

  if (pkg === undefined) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <div className="flex size-10 items-center justify-center rounded-xl bg-teal-400/10 text-teal-600 dark:text-teal-300">
          <Radar className="size-5 animate-pulse" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">I'm reviewing the claim…</p>
          <p className="mt-1 text-xs text-muted-foreground">Connecting evidence and building the picture.</p>
        </div>
      </div>
    );
  }

  if (pkg === null) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <div className="flex size-10 items-center justify-center rounded-xl bg-muted/40 text-muted-foreground/60">
          <Flame className="size-5" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">This claim isn't here</p>
          <p className="mt-1 max-w-xs text-xs text-muted-foreground">
            It doesn't exist or isn't in your workspace. Atlas can only see claims within your organization.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate("/dashboard")} className="gap-1.5">
          <ArrowLeft className="size-3" /> Back to Atlas
        </Button>
      </div>
    );
  }

  const supplements = Array.isArray(pkg.supplements) ? pkg.supplements : [];
  const findings = Array.isArray(pkg.findings) ? pkg.findings : [];
  const evidenceDocs = Array.isArray(pkg.evidenceDocs) ? pkg.evidenceDocs : [];
  const completeness = pkg.completeness ?? { score: 0, complete: 0, total: 0, categories: [] };
  const reconciliation = pkg.reconciliation ?? { paid: 0, outstanding: 0 };
  const claim = pkg.claim;

  // Derive Atlas intelligence
  const assessment = deriveAtlasAssessment(pkg);
  const verdict = deriveVerdict(pkg);
  const knowledgeItems = deriveKnowledgeItems(pkg);
  const gaps = deriveGaps(pkg);
  const timeline = deriveTimeline(pkg);
  const confidence = deriveConfidence(pkg);

  // Intelligence context
  const { items: intelligenceItems } = useIntelligence();
  const claimIntelligence = intelligenceItems.filter(
    (item) => item.navigationTarget?.includes(String(claimId)) || item.category === "supplement_opportunity"
  );

  // Entity-state-aware action proposals
  const claimActions = useMemo(() => {
    const supp = supplements[0];
    return createActionProposals({
      entityType: "claim",
      entityId: String(claimId),
      entityLabel: claim.customer ?? claim.property ?? claim.claimNumber ?? "Claim",
      entityState: {
        status: claim.status,
        hasSupplement: supplements.length > 0,
        supplementStatus: supp?.status ?? "",
        hasOpenFindings: findings.filter((f) => f.status === "open").length > 0,
        hasRecommendation: false,
      },
      userRole: auth.userRole,
      userId: auth.userId,
    });
  }, [claimId, claim, supplements, findings, auth.userRole, auth.userId]);

  const outstanding = reconciliation.outstanding;

  return (
    <>
      {/* Atlas Entity Experience */}
      <AtlasEntityShell
        entityType="Claim"
        entityId={claim.claimNumber ? `#${claim.claimNumber}` : `#${String(claimId).slice(-6)}`}
        verdict={verdict}
        financialImpact={outstanding > 0 ? outstanding : undefined}
        confidence={confidence}
        assessment={assessment}
        statusBadge={
          <Badge variant="outline" className="border-teal-400/30 bg-teal-400/10 font-mono text-[9px] uppercase tracking-wide text-teal-600 dark:text-teal-300">
            {(claim.status ?? "opened").replace(/_/g, " ")}
          </Badge>
        }
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                setAnalyzing(true);
                void runAnalysis({ claimId })
                  .then(() => toast.success("Analysis refreshed"))
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Analysis failed."))
                  .finally(() => setAnalyzing(false));
              }}
              disabled={analyzing}
            >
              {analyzing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Refresh analysis
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => setSupOpen(true)}>
              <ClipboardCheck className="size-3.5" />
              Prepare supplement
            </Button>
          </>
        }
      >
        {/* Atlas Assessment with evidence trail and source traceability */}
        <AtlasAssessment
          supportingEvidence={
            findings.filter((f) => f.status === "open").map((f) => ({
              label: f.title,
              detail: f.description,
              // Source traceability: link findings to the documents that support them
              sourceLabel: f.documentId ? "Document evidence" : undefined,
              sourcePath: f.documentId ? `/dashboard/revenue-recovery/${String(claimId)}` : undefined,
            })).length > 0
              ? findings.filter((f) => f.status === "open").map((f) => ({
                  label: f.title,
                  detail: f.description,
                  sourceLabel: f.documentId ? "Document evidence" : undefined,
                  sourcePath: f.documentId ? `/dashboard/revenue-recovery/${String(claimId)}` : undefined,
                }))
              : [{ label: "No open findings to support this assessment" }]
          }
          onViewSource={(path) => navigate(path)}
        >
          {assessment}
        </AtlasAssessment>

        {/* What Atlas Knows */}
        <AtlasKnowledge items={knowledgeItems} />

        {/* What's Missing */}
        {gaps.length > 0 && <AtlasGaps gaps={gaps} />}

        {/* Evidence Summary with relevance context */}
        <AtlasEvidenceSummary
          documents={evidenceDocs.filter(Boolean).map((d) => ({
            title: d.title ?? "Untitled",
            classification: d.classification ?? undefined,
            relevance: d.classification === "estimate" ? "Contains estimate data relevant to recovery" : d.classification === "photo" ? "Documents observed damage" : d.classification === "report" ? "Provides supporting analysis" : undefined,
          }))}
          emptyMessage="Atlas hasn't found supporting evidence yet. Upload documents or ask Atlas what information is needed to strengthen this claim."
        />

        {/* Confidence Explanation */}
        <AtlasConfidenceExplanation
          confidence={confidence}
          supportingDocs={evidenceDocs.filter(Boolean).length}
          supportingFindings={findings.filter((f) => f.status === "open").length}
          discrepancies={findings.filter((f) => f.status === "open" && f.type === "estimate_discrepancy").length}
        />

        {/* Claim Story */}
        <AtlasTimeline events={timeline} title="Claim Story" />

        {/* Atlas Recommends */}
        <AtlasActionRecommendation
          recommendations={[
            ...(outstanding > 0
              ? [{
                  label: "Prepare Supplement",
                  description: "Atlas can help prepare a supplement for the outstanding amount",
                  primary: true,
                  onClick: () => setSupOpen(true),
                  icon: ClipboardCheck,
                }]
              : []),
            ...(findings.filter((f) => f.status === "open").length > 0
              ? [{
                  label: "Review Findings",
                  description: "Review the findings Atlas has identified",
                  onClick: () => setShowDetails(true),
                  icon: Sparkles,
                }]
              : []),
            {
              label: "Ask Atlas",
              description: "Ask Atlas about this claim",
              onClick: () => navigate(`/dashboard/talk?q=${encodeURIComponent(`Tell me about claim ${claim.claimNumber ?? String(claimId)}`)}`),
              icon: Radar,
            },
          ]}
        />

        {/* Action Panel */}
        {claimActions.length > 0 && (
          <Panel className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="size-4 text-teal-600 dark:text-teal-300" />
              <h3 className="text-sm font-semibold">Atlas Actions</h3>
            </div>
            <AtlasActionPanel
              actions={claimActions}
              userRole={auth.userRole}
              userId={auth.userId}
              layout="vertical"
            />
          </Panel>
        )}

        {/* Progressive disclosure — raw claim data */}
        <button
          type="button"
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight className={`size-3.5 transition-transform ${showDetails ? "rotate-90" : ""}`} />
          {showDetails ? "Hide claim details" : "View claim details"}
        </button>

        {showDetails && (
          <Panel className="p-5">
            <h2 className="text-sm font-semibold text-foreground">Claim details</h2>
            <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Claim number</dt>
                <dd className="mt-0.5 font-mono text-foreground">{claim.claimNumber ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Status</dt>
                <dd className="mt-0.5 text-foreground">{(claim.status ?? "opened").replace(/_/g, " ")}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Date of loss</dt>
                <dd className="mt-0.5 text-foreground">
                  {typeof claim.dateOfLoss === "number" ? formatDate(claim.dateOfLoss) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Cause</dt>
                <dd className="mt-0.5 text-foreground">{claim.causeOfLoss ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Customer</dt>
                <dd className="mt-0.5 text-foreground">{claim.customer ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Property</dt>
                <dd className="mt-0.5 text-foreground">{claim.property ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Carrier</dt>
                <dd className="mt-0.5 text-foreground">{claim.carrier ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Adjuster</dt>
                <dd className="mt-0.5 text-foreground">{claim.adjuster ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Estimate</dt>
                <dd className="mt-0.5 font-mono text-foreground">{money(claim.estimateAmount)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Payment</dt>
                <dd className="mt-0.5 font-mono text-foreground">{money(claim.paymentAmount)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Outstanding</dt>
                <dd className={`mt-0.5 font-mono ${outstanding > 0 ? "font-semibold text-rose-600 dark:text-rose-300" : "text-foreground"}`}>
                  {money(outstanding)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Provenance</dt>
                <dd className="mt-0.5 text-xs text-muted-foreground">{claim.provenance ?? "—"}</dd>
              </div>
            </dl>
          </Panel>
        )}

        {/* Supplements — if any exist */}
        {supplements.length > 0 && (
          <Panel className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Supplements</h2>
              <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                {supplements.length}
              </Badge>
            </div>
            <div className="mt-3 space-y-2.5">
              {supplements.map((s) => (
                <div key={s._id} className="rounded-xl border border-border/60 bg-muted/20 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold text-foreground">{s.reason}</p>
                    <Badge variant="outline" className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
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
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={() => setDocSup(s._id)}>
                      <ScrollText className="size-3" /> View document
                    </Button>
                    {s.status === "draft" && (
                      <Button size="sm" className="h-7 gap-1 text-[11px]" onClick={() =>
                        void updateSupplementStatus({ supplementId: s._id, status: "ready_for_submission" })
                          .then(() => toast.success("Marked ready for submission"))
                          .catch((e) => toast.error(e instanceof Error ? e.message : "Update failed"))
                      }>
                        <ClipboardCheck className="size-3" /> Ready
                      </Button>
                    )}
                    {s.status === "ready_for_submission" && (
                      <Button size="sm" className="h-7 gap-1 text-[11px]" onClick={() =>
                        void updateSupplementStatus({ supplementId: s._id, status: "submitted" })
                          .then(() => toast.success("Marked submitted"))
                          .catch((e) => toast.error(e instanceof Error ? e.message : "Update failed"))
                      }>
                        Mark submitted
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </AtlasEntityShell>

      {/* Supplement creation dialog */}
      <Dialog open={supOpen} onOpenChange={setSupOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Prepare supplement</DialogTitle>
            <DialogDescription>
              Atlas will help prepare a supplement. Nothing is submitted without your review.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5 py-2">
            <Label htmlFor="sup-reason" className="text-xs font-medium">Reason for supplement</Label>
            <Input
              id="sup-reason"
              value={supForm.reason}
              onChange={(e) => setSupForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="e.g. Carrier excluded documented scope"
              className="h-9"
            />
            <Label htmlFor="sup-amount" className="mt-2 text-xs font-medium">Amount (USD)</Label>
            <Input
              id="sup-amount"
              value={supForm.amount}
              onChange={(e) => setSupForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="e.g. 18420"
              inputMode="numeric"
              className="h-9"
            />
            <Label htmlFor="sup-justification" className="mt-2 text-xs font-medium">Justification</Label>
            <Input
              id="sup-justification"
              value={supForm.justification}
              onChange={(e) => setSupForm((f) => ({ ...f, justification: e.target.value }))}
              placeholder="Optional — additional context"
              className="h-9"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSupOpen(false)}>Cancel</Button>
            <Button onClick={() => void submitSupplement()} disabled={creating}>
              {creating ? <Loader2 className="size-4 animate-spin" /> : "Create draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment recording dialog */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
            <DialogDescription>
              Adds to this claim's payment total.
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

      {/* Supplement document viewer */}
      <SupplementDocumentDialog
        claimId={claimId}
        supplementId={docSup}
        open={docSup !== null}
        onClose={() => setDocSup(null)}
      />

      {/* Claim Package builder */}
      <PackageBuilder
        open={pkgOpen}
        onClose={() => setPkgOpen(false)}
        claimId={claimId}
        evidenceDocs={evidenceDocs}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Supplement Document Dialog
// ---------------------------------------------------------------------------

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
          <DialogTitle>Supplement document</DialogTitle>
          <DialogDescription>
            {doc?.disclaimer ?? "Loading the structured supplement document…"}
          </DialogDescription>
        </DialogHeader>
        {!doc ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-teal-600 dark:text-teal-300" />
            Loading document…
          </p>
        ) : (
          <div className="space-y-3 py-1">
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                Status: {(doc.status ?? "draft").replace(/_/g, " ")}
              </Badge>
              {typeof doc.requestedAmount === "number" && (
                <Badge variant="outline" className="font-mono text-[10px] text-emerald-600 dark:text-emerald-300">
                  Requested ${doc.requestedAmount.toLocaleString()}
                </Badge>
              )}
            </div>
            {doc.sections.map((s) => (
              <div key={s.title} className="rounded-lg border border-border/60 bg-muted/20 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-foreground">{s.title}</p>
                <div className="mt-1.5 space-y-1">
                  {s.body.map((line, i) => (
                    <p key={i} className="text-[11px] leading-5 text-muted-foreground">{line}</p>
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
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
