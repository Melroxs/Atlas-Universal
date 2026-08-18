// ---------------------------------------------------------------------------
// PackageBuilder — dialog component for previewing and downloading a
// generated claim or supplement package.
//
// Shows:
//  - Package type + claim info
//  - Executive summary
//  - Findings with evidence and recommended actions
//  - Missing information (honestly labeled)
//  - Discrepancies with both values preserved
//  - Why Atlas included each section
//  - Requested scope (supplements)
//  - Timeline
//  - Financial Reconciliation
//  - Download buttons (HTML package + supporting evidence ZIP)
// ---------------------------------------------------------------------------

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
import { Separator } from "@/components/ui/separator";
import {
  generatePackage,
  downloadPackageHtml,
  downloadSupportingEvidence,
  type GeneratePackageResult,
} from "@/lib/insurance/package-client";
import type { PackageModel } from "@/lib/insurance/package-types";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  FileText,
  FileWarning,
  Loader2,
  Package,
  ShieldAlert,
  Sparkles,
  Zap,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

function money(n?: number | null): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

const STATE_TONE: Record<string, string> = {
  verified: "border-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300",
  extracted: "border-sky-400/30 bg-sky-400/10 text-sky-600 dark:text-sky-300",
  derived: "border-sky-400/30 bg-sky-400/10 text-sky-600 dark:text-sky-300",
  inferred: "border-violet-400/30 bg-violet-400/10 text-violet-600 dark:text-violet-300",
  missing: "border-rose-400/30 bg-rose-400/10 text-rose-600 dark:text-rose-300",
  conflicted: "border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300",
  needs_review: "border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PackageBuilderProps {
  open: boolean;
  onClose: () => void;
  claimId: string;
  /** When set, generates a supplement package tied to this recommendation. */
  recommendationId?: string;
  /** Label shown on the trigger button (e.g., "Generate Claim Package"). */
  label?: string;
  /** Pre-generated result (skip generation). */
  existingResult?: GeneratePackageResult | null;
  /** Evidence docs from the claim package (for ZIP download). */
  evidenceDocs?: Array<{ _id?: string; title?: string; storageId?: string }>;
}

// ---------------------------------------------------------------------------
// PackageBuilder component
// ---------------------------------------------------------------------------

export function PackageBuilder({
  open,
  onClose,
  claimId,
  recommendationId,
  existingResult,
  evidenceDocs,
}: PackageBuilderProps) {
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GeneratePackageResult | null>(
    existingResult ?? null,
  );
  const [showFindings, setShowFindings] = useState(true);
  const [showEvidence, setShowEvidence] = useState(true);
  const [showMissing, setShowMissing] = useState(true);
  const [showExplanations, setShowExplanations] = useState(true);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showReconciliation, setShowReconciliation] = useState(false);

  // Step-by-step generation progress
  const [generationSteps, setGenerationSteps] = useState<Array<{ label: string; done: boolean }>>([]);

  const pkg = result?.pkg ?? null;
  const html = result?.html ?? null;

  const handleGenerate = async () => {
    setGenerating(true);
    const steps = [
      "Gathering claim information",
      "Collecting findings",
      "Indexing evidence documents",
      "Checking discrepancies",
      "Building package",
    ];
    setGenerationSteps(steps.map((label) => ({ label, done: false })));
    try {
      for (let i = 0; i < steps.length; i++) {
        await new Promise((r) => setTimeout(r, 180 + i * 40));
        setGenerationSteps((prev) => prev.map((s, j) => j <= i ? { ...s, done: true } : s));
      }
      const res = await generatePackage({
        claimId,
        recommendationId,
      });
      setResult(res);
      toast.success(
        `${res.pkg.packageType === "supplement" ? "Supplement" : "Claim"} package generated successfully.`,
      );
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Package generation failed.",
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadHtml = () => {
    if (!html || !pkg) return;
    downloadPackageHtml(html, pkg);
    toast.success("Package downloaded — open the HTML file in a browser to print as PDF.");
  };

  const handleDownloadEvidence = async () => {
    if (!pkg) return;
    try {
      await downloadSupportingEvidence(pkg, evidenceDocs ?? []);
      toast.success("Supporting documents downloaded.");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not download supporting documents.",
      );
    }
  };

  const handleOpenInNewTab = () => {
    if (!html) return;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="size-5 text-teal-600 dark:text-teal-300" />
            {recommendationId
              ? "Generate Supplement Package"
              : "Generate Claim Package"}
          </DialogTitle>
          <DialogDescription>
            Atlas assembles a professional package from the real claim data, evidence,
            and findings. Every field comes from documented sources.
          </DialogDescription>
        </DialogHeader>

        {/* Generation state — initial */}
        {!result && !generating && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Package className="size-12 text-muted-foreground/30" />
            <p className="max-w-sm text-center text-sm text-muted-foreground">
              {recommendationId
                ? "Generate a supplement package from this approved recommendation and its supporting evidence."
                : "Generate a professional claim package from the real claim data, evidence, and findings."}
            </p>
            <Button onClick={() => void handleGenerate()} className="gap-2">
              <Sparkles className="size-4" />
              Generate Package
            </Button>
          </div>
        )}

        {/* Generation state — step-by-step progress */}
        {generating && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="size-8 animate-spin text-teal-600 dark:text-teal-300" />
            <p className="text-sm font-medium text-foreground">Assembling package…</p>
            <div className="w-full max-w-xs space-y-1.5">
              {generationSteps.map((step, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px]">
                  {step.done ? (
                    <Check className="size-3 shrink-0 text-emerald-500" />
                  ) : (
                    <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
                  )}
                  <span className={step.done ? "text-muted-foreground" : "text-foreground font-medium"}>
                    {step.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Package preview */}
        {pkg && !generating && (
          <div className="space-y-5">
            {/* Cover info */}
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <Badge
                  variant="outline"
                  className={`font-mono text-[10px] uppercase tracking-wide ${
                    pkg.packageType === "supplement"
                      ? "border-violet-400/30 bg-violet-400/10 text-violet-600 dark:text-violet-300"
                      : "border-sky-400/30 bg-sky-400/10 text-sky-600 dark:text-sky-300"
                  }`}
                >
                  {pkg.packageType === "supplement" ? "Supplement Package" : "Claim Package"}
                </Badge>
                <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-300">
                  Ready
                </Badge>
              </div>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                {pkg.coverPage.claimNumber && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Claim Number</dt>
                    <dd className="font-mono font-medium">{pkg.coverPage.claimNumber}</dd>
                  </div>
                )}
                {pkg.coverPage.customer && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Insured</dt>
                    <dd className="font-medium">{pkg.coverPage.customer}</dd>
                  </div>
                )}
                {pkg.coverPage.property && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Property</dt>
                    <dd>{pkg.coverPage.property}</dd>
                  </div>
                )}
                {pkg.coverPage.carrier && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Carrier</dt>
                    <dd>{pkg.coverPage.carrier}</dd>
                  </div>
                )}
                {pkg.coverPage.policyNumber && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Policy</dt>
                    <dd className="font-mono">{pkg.coverPage.policyNumber}</dd>
                  </div>
                )}
                {pkg.coverPage.dateOfLoss && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Date of Loss</dt>
                    <dd>{pkg.coverPage.dateOfLoss}</dd>
                  </div>
                )}
              </dl>
              <p className="mt-3 font-mono text-[10px] text-muted-foreground/60">
                Generated {pkg.coverPage.generatedDate} · {pkg.evidenceItems.length} evidence items · {pkg.scopeFindings.length} findings · {pkg.missingInformation.length} missing
              </p>
            </div>

            {/* Executive Summary */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Executive Summary</h4>
              <p className="text-sm leading-6 text-foreground/80">{pkg.executiveSummary}</p>
            </div>

            {/* Supplement-specific: Requested Scope */}
            {pkg.packageType === "supplement" && pkg.requestedAdditionalScope.length > 0 && (
              <>
                <Separator />
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300 mb-2">
                    Requested Additional Scope
                  </h4>
                  <ul className="space-y-1">
                    {pkg.requestedAdditionalScope.map((s, i) => (
                      <li key={i} className="flex items-start gap-2 text-[11px] leading-5 text-foreground/80">
                        <span className="mt-1 size-1.5 shrink-0 rounded-full bg-violet-400" />
                        {s}
                      </li>
                    ))}
                  </ul>
                  {pkg.whyThisScopeIsRequired && (
                    <div className="mt-3 rounded-lg border border-violet-400/25 bg-violet-400/5 px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300 mb-1">Why This Scope Is Required</p>
                      <p className="text-[11px] leading-5 text-muted-foreground">{pkg.whyThisScopeIsRequired}</p>
                    </div>
                  )}
                </div>
              </>
            )}

            <Separator />

            {/* Claim Information */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Claim Information</h4>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {pkg.claimInformation.map((f) => (
                  <div
                    key={f.label}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-1.5"
                  >
                    <span className="text-[11px] text-muted-foreground">{f.label}</span>
                    <span className="min-w-0 truncate text-[11px] font-medium text-foreground">
                      {f.value ?? "—"}
                      {f.state !== "verified" && f.state !== "extracted" && (
                        <Badge
                          variant="outline"
                          className={`ml-1.5 font-mono text-[8px] uppercase ${STATE_TONE[f.state] ?? ""}`}
                        >
                          {f.state}
                        </Badge>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            {/* Findings (collapsible) */}
            {pkg.scopeFindings.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowFindings(!showFindings)}
                  className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors mb-2"
                >
                  <Zap className="size-3.5 text-amber-500" />
                  Findings · {pkg.scopeFindings.length}
                  {showFindings ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                </button>
                {showFindings && (
                  <div className="space-y-2">
                    {pkg.scopeFindings.map((f) => (
                      <div key={f.findingKey} className="rounded-lg border border-amber-400/25 bg-amber-400/5 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs font-semibold text-foreground">{f.title}</p>
                          <span className="shrink-0 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 font-mono text-[9px] text-amber-700 dark:text-amber-300">
                            {Math.round(f.confidence * 100)}% confidence
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{f.description}</p>
                        {f.estimatedAmount != null && (
                          <p className="mt-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-300">
                            Estimated impact: {money(f.estimatedAmount)}
                          </p>
                        )}
                        {f.evidence.length > 0 && (
                          <div className="mt-1.5">
                            <p className="text-[10px] font-medium text-muted-foreground mb-0.5">Supporting evidence:</p>
                            <ul className="space-y-0.5">
                              {f.evidence.map((e, i) => (
                                <li key={i} className="flex items-center gap-1 text-[10px] text-muted-foreground/80">
                                  <FileText className="size-2.5 shrink-0 text-teal-600 dark:text-teal-300" />
                                  {e}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <p className="mt-1 text-[10px] italic text-muted-foreground/70">{f.limitation}</p>
                        <p className="mt-1.5 text-[10px] font-medium text-indigo-600 dark:text-indigo-300">
                          Recommended action: {f.recommendedNextStep}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Discrepancies */}
            {pkg.discrepancies.length > 0 && (
              <div>
                <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300 mb-2">
                  <FileWarning className="size-3.5" />
                  Discrepancies · {pkg.discrepancies.length}
                </h4>
                <div className="space-y-1.5">
                  {pkg.discrepancies.map((d, i) => (
                    <div key={i} className="rounded-lg border border-amber-400/25 bg-amber-400/5 px-3 py-2">
                      <p className="text-[11px] font-semibold text-foreground">{d.field}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        <strong>{d.valueA}</strong> ({d.sourceA}) vs <strong>{d.valueB}</strong> ({d.sourceB})
                      </p>
                      <p className="mt-0.5 text-[10px] text-amber-700 dark:text-amber-300">{d.difference}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Separator />

            {/* Evidence (collapsible) */}
            {pkg.evidenceItems.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowEvidence(!showEvidence)}
                  className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors mb-2"
                >
                  <FileText className="size-3.5 text-teal-600 dark:text-teal-300" />
                  Evidence · {pkg.evidenceItems.length} documents
                  {showEvidence ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                </button>
                {showEvidence && (
                  <div className="space-y-1">
                    {pkg.evidenceItems.map((e, i) => (
                      <div
                        key={e.documentId || i}
                        className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-1.5"
                      >
                        <FileText className="size-3.5 shrink-0 text-teal-600 dark:text-teal-300" />
                        <span className="truncate text-[11px] font-medium text-foreground">{e.title}</span>
                        {e.classification && (
                          <Badge variant="outline" className="ml-auto shrink-0 font-mono text-[8px] uppercase tracking-wide text-muted-foreground">
                            {e.classification}
                          </Badge>
                        )}
                        {e.supportsFinding && (
                          <span className="hidden sm:inline shrink-0 text-[9px] text-muted-foreground/60">
                            supports: {e.supportsFinding}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Missing Information */}
            {pkg.missingInformation.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowMissing(!showMissing)}
                  className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300 hover:text-foreground transition-colors mb-2"
                >
                  <ShieldAlert className="size-3.5" />
                  Missing Information · {pkg.missingInformation.length}
                  {showMissing ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                </button>
                {showMissing && (
                  <div className="space-y-1.5">
                    {pkg.missingInformation.map((m, i) => (
                      <div key={i} className="rounded-lg border border-rose-400/20 bg-rose-400/5 px-3 py-2">
                        <p className="text-[11px] font-semibold text-rose-700 dark:text-rose-300">
                          {m.category} — Missing
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{m.description}</p>
                        <p className="mt-0.5 text-[10px] italic text-muted-foreground/60">Why needed: {m.whyNeeded}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Why Atlas Included This (collapsible) */}
            {pkg.explanations.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowExplanations(!showExplanations)}
                  className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300 hover:text-foreground transition-colors mb-2"
                >
                  <Sparkles className="size-3.5" />
                  Why Atlas Included This · {pkg.explanations.length}
                  {showExplanations ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                </button>
                {showExplanations && (
                  <div className="space-y-2">
                    {pkg.explanations.map((x, i) => (
                      <div key={i} className="rounded-lg border-l-3 border-violet-400 bg-violet-400/5 p-3">
                        <p className="text-xs font-semibold text-foreground">{x.finding}</p>
                        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{x.whyItMatters}</p>
                        {x.evidence.length > 0 && (
                          <p className="mt-1 text-[10px] text-muted-foreground/70">
                            Evidence: {x.evidence.join("; ")}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Claim Timeline */}
            {pkg.claimTimeline.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowTimeline(!showTimeline)}
                  className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors mb-2"
                >
                  <Clock className="size-3.5 text-sky-500" />
                  Claim Timeline · {pkg.claimTimeline.length} events
                  {showTimeline ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                </button>
                {showTimeline && (
                  <div className="space-y-1.5">
                    {pkg.claimTimeline.map((t, i) => (
                      <div key={i} className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60 w-20">{t.date}</span>
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium text-foreground">{t.event}</p>
                          <p className="text-[9px] text-muted-foreground/60">{t.source}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Financial Reconciliation */}
            {(typeof pkg.coverPage.claimNumber === "string" || pkg.reconciliationNotes.length > 0) && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowReconciliation(!showReconciliation)}
                  className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors mb-2"
                >
                  <Zap className="size-3.5 text-emerald-500" />
                  Financial Reconciliation
                  {showReconciliation ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                </button>
                {showReconciliation && (
                  <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div><span className="text-muted-foreground">Estimate</span></div>
                      <div className="text-right font-mono">{pkg.claimInformation.find((f) => f.label === "Estimate")?.value ?? "—"}</div>
                      <div><span className="text-muted-foreground">Payment Received</span></div>
                      <div className="text-right font-mono">{pkg.claimInformation.find((f) => f.label === "Payment Received")?.value ?? "—"}</div>
                      <div><span className="text-muted-foreground">Invoiced</span></div>
                      <div className="text-right font-mono">{pkg.claimInformation.find((f) => f.label === "Invoiced Amount")?.value ?? "—"}</div>
                      <div><span className="text-muted-foreground">Approved by Carrier</span></div>
                      <div className="text-right font-mono">{pkg.claimInformation.find((f) => f.label === "Approved by Carrier")?.value ?? "—"}</div>
                    </div>
                    {pkg.reconciliationNotes.length > 0 && (
                      <div className="mt-2 space-y-1 border-t border-border/60 pt-2">
                        {pkg.reconciliationNotes.map((n, i) => (
                          <p key={i} className="text-[10px] text-muted-foreground leading-4">{n}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Disclaimer */}
            <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
              <p className="text-[10px] leading-4 text-muted-foreground">{pkg.disclaimer}</p>
            </div>
          </div>
        )}

        <DialogFooter className="flex flex-wrap gap-2 sm:justify-between">
          <Button variant="outline" onClick={onClose} className="gap-2">
            <X className="size-3.5" />
            Close
          </Button>
          {result && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={handleOpenInNewTab} className="gap-2">
                <FileText className="size-3.5" />
                Preview in New Tab
              </Button>
              <Button variant="outline" onClick={() => void handleDownloadEvidence()} className="gap-2">
                <Download className="size-3.5" />
                Supporting Evidence
              </Button>
              <Button onClick={handleDownloadHtml} className="gap-2">
                <Download className="size-3.5" />
                Download Package
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
