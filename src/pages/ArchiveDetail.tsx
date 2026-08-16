/**
 * Phase 13 — Archive detail page.
 *
 * Tenant-scoped view of one company-data import: processing status, derived
 * summary (every number from real records), warnings, the full file inventory
 * with classifications/duplicates/versions, per-file retry, cancel, and
 * delete (manager+). Provenance is preserved: every ingested file links to
 * its Atlas document.
 */
import { api } from "@/lib/api";
import {
  ArchiveStatusBadge,
  FileIngestBadge,
  PageHeader,
  formatBytes,
  formatDate,
  titleCase,
} from "@/components/atlas-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  CheckCircle2,
  FileText,
  Loader2,
  Lock,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import { invalidateQueries, useAction, useMutation, useQuery } from "@/hooks/use-supabase";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";

const TERMINAL = new Set([
  "completed",
  "completed_with_warnings",
  "failed",
  "cancelled",
]);

const WARNING_ICONS: Record<string, typeof AlertTriangle> = {
  password_protected: Lock,
  corrupt: XCircle,
  unsupported_archive_format: Archive,
  limit_exceeded: ShieldAlert,
  nested_archive: Archive,
  duplicates: CheckCircle2,
  blocked_files: ShieldAlert,
  unsupported_files: Archive,
  too_large_files: AlertTriangle,
  oversized_archive: ShieldAlert,
  empty_archive: Archive,
  truncated: XCircle,
};

export default function ArchiveDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // Poll while the page is open so a client-side processing run (which can
  // outlive a single fetch) and its per-file progress are reflected instead of
  // a stale mount-time snapshot. The detail query is tenant-scoped and capped.
  // The result is normalized at the api boundary (normalizeArchiveDetailResponse)
  // so every collection is ALWAYS an array/object — never undefined (the
  // production crash: `Cannot read properties of undefined (reading 'length')`
  // on archive.warnings right after ingestion completed).
  const detail = useQuery(
    api.archive.getArchiveDetail,
    id ? { archiveId: id as never } : "skip",
    { refreshIntervalMs: 4000 },
  );
  const cancelArchive = useMutation(api.archive.cancelArchive);
  const beginProcessing = useAction(api.archive.beginProcessing);
  const retryFiles = useAction(api.archive.retryFiles);
  const deleteArchive = useMutation(api.archive.deleteArchive);
  const [busy, setBusy] = useState<string | null>(null);

  if (!id) return null;
  if (detail === undefined) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="size-5 animate-spin text-teal-600 dark:text-teal-300" />
      </div>
    );
  }
  // null covers both "not found in this workspace" and a genuine RPC failure
  // (the query hook collapses both). Show an explicit error state with Retry
  // instead of a blank page or a fake empty archive.
  if (detail === null) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <Archive className="size-8 text-muted-foreground/40" />
        <p className="text-sm font-medium">Unable to load archive details</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Atlas couldn't load this archive right now. It may not be available in
          your workspace, or the request failed. Try again — nothing you
          ingested is affected.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => invalidateQueries()} className="gap-2">
            <RefreshCw className="size-4" />
            Retry
          </Button>
          <Button variant="ghost" onClick={() => navigate("/dashboard/knowledge")}>
            <ArrowLeft className="mr-2 size-4" />
            Back to Knowledge
          </Button>
        </div>
      </div>
    );
  }

  // Normalized contract (src/lib/archive/normalize.ts): archive is always an
  // object with warnings: [] / stats: {} / checksum: "" defaults, files is
  // always [], docs is always {}, candidates is always []. Loading is the
  // `detail === undefined` branch above — distinct from a loaded empty archive.
  const archive = detail.archive;
  const files = detail.files;
  const docs = detail.docs as Record<
    string,
    { _id: string; title: string; classification: string; status: string }
  >;
  const candidates = (detail.candidates ?? []) as Array<{
    _id: string;
    claimNumber?: string;
    customer?: string;
    property?: string;
    confidence: number;
    status: string;
    basis: string;
    evidence: string[];
    documentIds: string[];
  }>;
  const pendingCandidates = candidates.filter((c) => c.status === "pending");
  const st = (archive.stats ?? {}) as Record<string, unknown>;
  const active = !TERMINAL.has(archive.status);
  const failedFiles = files.filter((f) => f.ingestStatus === "failed");

  const statChips: Array<[string, number, string]> = [
    ["Ingested into knowledge", num(st.ingested), "text-emerald-600 dark:text-emerald-300"],
    ["Failed", num(st.failed), "text-rose-600 dark:text-rose-300"],
    ["Duplicates", num(st.duplicates), "text-violet-600 dark:text-violet-300"],
    ["Unsupported", num(st.unsupported), "text-muted-foreground"],
    ["Blocked for security", num(st.blocked), "text-rose-600 dark:text-rose-300"],
    ["Too large to ingest", num(st.tooLarge), "text-muted-foreground"],
  ];
  const classifications = (st.classifications ?? {}) as Record<string, number>;
  const potentialClaims = (st.potentialClaims ?? []) as Array<{
    claimNumber: string;
    fileCount: number;
    confidence: number;
    samplePaths?: string[];
  }>;

  const handleCancel = async () => {
    setBusy("cancel");
    try {
      await cancelArchive({ archiveId: id as never });
      invalidateQueries();
      toast.success("Import cancelled", {
        description: "Future processing has stopped; finished files are preserved.",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel the import");
    } finally {
      setBusy(null);
    }
  };

  /**
   * Resume/process an archive that never reached a terminal state (e.g. the
   * browser tab died after inventory submission but before/during processing).
   * The processing loop is idempotent: already-ingested files are skipped and
   * per-file failures are recorded instead of aborting.
   */
  const handleResume = async () => {
    setBusy("resume");
    try {
      const res = await beginProcessing({ archiveId: id as never });
      invalidateQueries();
      toast.success("Processing finished", {
        description:
          res.failed > 0
            ? `${res.ingested} ingested, ${res.failed} failed — failed files can be retried individually.`
            : `${res.ingested} file${res.ingested === 1 ? "" : "s"} ingested${res.candidates ? `, ${res.candidates} potential claim${res.candidates === 1 ? "" : "s"} found.` : "."}`,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not process this archive");
    } finally {
      setBusy(null);
    }
  };

  const handleRetryAll = async () => {
    setBusy("retry");
    try {
      const res = await retryFiles({ archiveId: id as never });
      invalidateQueries();
      toast.success(`${res.requeued} file${res.requeued === 1 ? "" : "s"} queued for retry`, {
        description: "Processing resumes in the background.",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not retry files");
    } finally {
      setBusy(null);
    }
  };

  const handleRetryFile = async (fileId: string) => {
    setBusy(`retry-${fileId}`);
    try {
      const res = await retryFiles({
        archiveId: id as never,
        fileIds: [fileId as never],
      });
      invalidateQueries();
      if (res.requeued === 0) {
        toast.error("This file can't be retried — its extracted content isn't retained.");
      } else {
        toast.success("File queued for retry");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not retry this file");
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Delete this archive record and its inventory? Ingested documents stay in Atlas knowledge.")) return;
    setBusy("delete");
    try {
      await deleteArchive({ archiveId: id as never });
      invalidateQueries();
      toast.success("Archive record deleted");
      navigate("/dashboard/knowledge");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete the archive");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Company data archive"
        title={archive.filename}
        description={`${archive.fileType.toUpperCase()} · ${formatBytes(archive.compressedSize)} compressed · ${formatBytes(archive.extractedSize)} extracted · ${archive.fileCount.toLocaleString()} files`}
        actions={
          <div className="flex items-center gap-2">
            {active && (
              <>
                <Button
                  onClick={() => void handleResume()}
                  disabled={busy !== null}
                  className="gap-2"
                >
                  {busy === "resume" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : archive.status === "inventorying" ? (
                    <Sparkles className="size-4" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                  {archive.status === "inventorying" ? "Process import" : "Resume processing"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void handleCancel()}
                  disabled={busy !== null}
                  className="gap-2 text-rose-600 dark:text-rose-300"
                >
                  {busy === "cancel" ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
                  Cancel import
                </Button>
              </>
            )}
            {!active && failedFiles.length > 0 && (
              <Button
                variant="outline"
                onClick={() => void handleRetryAll()}
                disabled={busy !== null}
                className="gap-2"
              >
                {busy === "retry" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                Retry {failedFiles.length} failed
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => void handleDelete()}
              disabled={busy !== null}
              className="gap-2 text-muted-foreground"
            >
              {busy === "delete" ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Delete record
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <ArchiveStatusBadge status={archive.status} />
        <span className="font-mono text-muted-foreground">
          checksum {archive.checksum.slice(0, 16)}…
        </span>
        <span className="text-muted-foreground">
          uploaded {formatDate(archive.createdAt)}
        </span>
        {archive.completedAt && (
          <span className="text-muted-foreground">
            · completed {formatDate(archive.completedAt)}
          </span>
        )}
        {archive.rawRetained ? (
          <Badge variant="outline" className="border-sky-400/30 bg-sky-400/10 text-sky-600 dark:text-sky-300">
            original archive retained
          </Badge>
        ) : (
          <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground">
            original archive not retained — normalized knowledge kept
          </Badge>
        )}
      </div>

      {active && (
        <div>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin text-teal-600 dark:text-teal-300" />
              {titleCase(archive.status)}
            </span>
            <span className="font-mono text-muted-foreground">
              {Math.round((archive.progress ?? 0) * 100)}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-teal-500 transition-all"
              style={{ width: `${Math.round((archive.progress ?? 0) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {archive.failureReason && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {archive.failureReason}
        </div>
      )}

      {archive.warnings.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
            {archive.warnings.length} warning{archive.warnings.length === 1 ? "" : "s"}
          </p>
          {archive.warnings.map((w, i) => {
            const code = w.includes("password")
              ? "password_protected"
              : w.includes("security")
                ? "blocked_files"
                : w.includes("duplicate")
                  ? "duplicates"
                  : "unsupported_files";
            const Icon = WARNING_ICONS[code] ?? AlertTriangle;
            return (
              <p key={i} className="flex items-start gap-1.5 text-xs text-amber-800/90 dark:text-amber-200/90">
                <Icon className="mt-0.5 size-3.5 shrink-0" />
                {w}
              </p>
            );
          })}
        </div>
      )}

      {/* What Atlas found — real processed records only */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {statChips.map(([label, value, tone]) => (
          <div key={label} className="rounded-xl border border-border/70 bg-card/50 p-3">
            <p className={`font-mono text-2xl font-semibold ${tone}`}>
              {value.toLocaleString()}
            </p>
            <p className="mt-1 text-[11px] leading-tight text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>

      {(classifications.total ?? 0) > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(classifications).map(([cls, count]) => (
            <Badge key={cls} variant="outline" className="capitalize">
              {cls.replace(/_/g, " ")} · {count}
            </Badge>
          ))}
        </div>
      )}

      {potentialClaims.length > 0 && (
        <div className="rounded-xl border border-border/70 bg-card/50 p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="size-4 text-amber-600 dark:text-amber-300" />
            Potential claims found
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Atlas matched document identifiers and folder context — no claim records were created.
            Confirm each one before Atlas treats it as a claim.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {potentialClaims.map((c) => (
              <div key={c.claimNumber} className="rounded-lg border border-border/60 bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-medium">{c.claimNumber}</span>
                  <Badge variant="outline">{c.fileCount} file{c.fileCount === 1 ? "" : "s"}</Badge>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-amber-500"
                    style={{ width: `${Math.round(c.confidence * 100)}%` }}
                  />
                </div>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  confidence {Math.round(c.confidence * 100)}%
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Potential claims reconstructed from this archive */}
      {pendingCandidates.length > 0 && (
        <div className="rounded-xl border border-border/70 bg-card/50 p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="size-4 text-amber-600 dark:text-amber-300" />
            Potential claims from this archive
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Atlas reconstructed these from claim identifiers in the archive. They await
            your approval in Revenue Recovery before becoming claims.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {pendingCandidates.map((c) => (
              <div key={c._id} className="rounded-lg border border-border/60 bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {c.customer ?? c.property ?? `Claim ${c.claimNumber ?? ""}`}
                  </span>
                  <Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300">
                    {Math.round(c.confidence * 100)}% potential
                  </Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{c.basis}</p>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  {c.evidence.length + c.documentIds.length} evidence file{(c.evidence.length + c.documentIds.length) === 1 ? "" : "s"}
                </p>
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 gap-1.5"
            onClick={() => navigate("/dashboard/revenue-recovery")}
          >
            <Sparkles className="size-3.5" />
            Review in Revenue Recovery
          </Button>
        </div>
      )}

      {/* File inventory */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">File inventory</h2>
          <span className="font-mono text-xs text-muted-foreground">
            {files.length.toLocaleString()} files
          </span>
        </div>
        {files.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
            No files were recorded for this archive.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/70 bg-card/50">
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-muted/70 backdrop-blur">
                  <tr className="text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Path</th>
                    <th className="px-3 py-2.5 font-medium">Classification</th>
                    <th className="px-3 py-2.5 font-medium">Size</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {files.map((f) => {
                    const doc = f.documentId ? docs[String(f.documentId)] : undefined;
                    return (
                      <tr key={f._id} className="align-top">
                        <td className="max-w-[360px] px-4 py-2">
                          <p className="truncate font-mono text-[11px]" title={f.path}>
                            {f.path}
                          </p>
                          {f.isDuplicate && f.duplicateOfPath && (
                            <p className="mt-0.5 text-[10px] text-violet-600 dark:text-violet-300">
                              duplicate of {f.duplicateOfPath}
                            </p>
                          )}
                          {f.isSuperseded && f.supersedesPath && (
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                              supersedes {f.supersedesPath}
                            </p>
                          )}
                          {f.versionGroup && (
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                              version group: {f.versionGroup}
                            </p>
                          )}
                          {doc && (
                            <button
                              type="button"
                              onClick={() => navigate(`/dashboard/knowledge/${f.documentId}`)}
                              className="mt-0.5 flex items-center gap-1 text-[10px] text-teal-600 hover:underline dark:text-teal-300"
                            >
                              <FileText className="size-3" />
                              {doc.title.length > 60 ? `${doc.title.slice(0, 60)}…` : doc.title}
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className="capitalize">
                            {f.classification.replace(/_/g, " ")}
                          </Badge>
                          {f.classificationConfidence < 0.6 && (
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                              {Math.round(f.classificationConfidence * 100)}% confidence
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {formatBytes(f.size)}
                        </td>
                        <td className="px-3 py-2">
                          <FileIngestBadge status={f.ingestStatus} />
                        </td>
                        <td className="max-w-[260px] px-3 py-2">
                          {f.error && (
                            <p className="text-[10px] leading-snug text-rose-600 dark:text-rose-300" title={f.error}>
                              {f.error.length > 90 ? `${f.error.slice(0, 90)}…` : f.error}
                            </p>
                          )}
                          {f.blockReason && (
                            <p className="text-[10px] leading-snug text-rose-600 dark:text-rose-300">
                              {f.blockReason}
                            </p>
                          )}
                          {f.ingestStatus === "failed" && f.storageId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="mt-1 h-6 gap-1 px-1.5 text-[10px]"
                              onClick={() => void handleRetryFile(String(f._id))}
                              disabled={busy !== null}
                            >
                              {busy === `retry-${f._id}` ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <RefreshCw className="size-3" />
                              )}
                              Retry
                            </Button>
                          )}
                          {f.ingestStatus === "failed" && !f.storageId && (
                            <p className="text-[10px] text-muted-foreground">
                              content not retained — cannot retry
                            </p>
                          )}
                          {(f.claimHints ?? []).length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {(f.claimHints as Array<{ claimNumber: string; confidence?: number }>).map((h) => (
                                <span key={h.claimNumber} className="rounded bg-amber-400/10 px-1 py-0.5 font-mono text-[9px] text-amber-700 dark:text-amber-300">
                                  {h.claimNumber}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}
