/**
 * Phase 13 — Compressed Company Data upload surface.
 *
 * Flow: user picks a .zip/.rar → analyzeArchive() runs ENTIRELY in the browser
 * (extract, security checks, classification, dedupe, claim hints — nothing
 * leaves the device yet) → the user reviews "what Atlas found" → on approval
 * the vetted files are uploaded to tenant storage and the inventory is
 * submitted → beginProcessing starts the durable server-side job.
 *
 * Wake-word-style safety applies here too: before this component's "Start
 * ingestion" step, no archive content is sent anywhere.
 */
import { api } from "@/lib/api";
import { analyzeArchive, buildUploadPlan } from "@/lib/archive/engine";
import {
  ArchiveCorruptError,
  ArchivePasswordError,
} from "@/lib/archive/extract";
import { formatBytes } from "@/lib/archive/limits";
import { describeArchiveError } from "@/lib/archive/errors";
import type {
  ArchiveAnalysis,
  ArchiveFileEntry,
  ArchiveWarning,
} from "@/lib/archive/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, FileArchive, FileUp, Loader2, Lock, ShieldAlert, Sparkles, TriangleAlert } from "lucide-react";
import { useAction, useMutation } from "@/hooks/use-supabase";
import { uploadToStorage } from "@/lib/actions/upload";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

type Phase =
  | "idle"
  | "analyzing"
  | "review"
  | "uploading"
  | "submitting"
  | "error";

const WARNING_ICONS: Record<ArchiveWarning["code"], typeof AlertTriangle> = {
  password_protected: Lock,
  corrupt: TriangleAlert,
  unsupported_archive_format: FileArchive,
  limit_exceeded: ShieldAlert,
  nested_archive: FileArchive,
  duplicates: CheckCircle2,
  blocked_files: ShieldAlert,
  unsupported_files: FileArchive,
  too_large_files: AlertTriangle,
  oversized_archive: ShieldAlert,
  empty_archive: FileArchive,
  truncated: TriangleAlert,
};

const BATCH_SIZE = 400;
const UPLOAD_CONCURRENCY = 4;

/** Upload bytes to tenant storage (documents bucket unless overridden). */
async function uploadBytes(
  bucket: "documents" | "archives",
  bytes: Uint8Array,
  mimeType: string,
): Promise<string> {
  const { storageId } = await uploadToStorage({
    bucket,
    bytes,
    mimeType: mimeType || "application/octet-stream",
  });
  return storageId;
}

export default function ArchiveUpload() {
  const navigate = useNavigate();
  const beginArchive = useMutation(api.archive.beginArchive);
  const submitInventoryBatch = useMutation(api.archive.submitInventoryBatch);
  const beginProcessing = useAction(api.archive.beginProcessing);

  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [analysis, setAnalysis] = useState<ArchiveAnalysis | null>(null);
  const [plan, setPlan] = useState<{ ingest: ArchiveFileEntry[]; skipped: ArchiveFileEntry[] } | null>(null);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number }>({ label: "", done: 0, total: 1 });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const reset = () => {
    setPhase("idle");
    setAnalysis(null);
    setPlan(null);
    setProgress({ label: "", done: 0, total: 1 });
    setError(null);
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFile = async (selected: File | undefined | null) => {
    if (!selected) return;
    setError(null);
    setPhase("analyzing");
    setAnalysis(null);
    setPlan(null);
    setFile(selected);
    try {
      const result = await analyzeArchive(selected, {
        onProgress: (label, done, total) =>
          setProgress({ label, done, total }),
      });
      setAnalysis(result);
      setPlan(buildUploadPlan(result));
      setPhase("review");
      if (result.warnings.some((w) => w.code === "password_protected")) {
        setError(
          "This archive is password protected. Atlas cannot process it without the correct password, and passwords are never stored.",
        );
      }
    } catch (e) {
      setPhase("error");
      setError(
        e instanceof ArchivePasswordError ||
          e instanceof ArchiveCorruptError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Atlas could not read this archive. It may be corrupt or use an unsupported compression method.",
      );
    }
  };

  /** Upload vetted files, submit the manifest, kick off the durable job. */
  const startIngestion = async () => {
    if (!analysis || !plan) return;
    if (analysis.entries.length === 0) {
      setPhase("error");
      setError(
        "This archive has no files Atlas could inventory, so there is nothing to ingest. Atlas has not recorded it as imported data.",
      );
      return;
    }
    setSubmitting(true);
    setPhase("uploading");
    try {
      // 1. Retain the raw archive only when it's under the retention cap.
      //    Larger archives are never stored — the extracted inventory and
      //    normalized knowledge remain the source of truth (Phase 13 §28).
      const clientWarnings = analysis.warnings.map((w) => w.message);
      let rawStorageId: string | undefined;
      if (file && analysis.compressedSize <= analysis.limits.rawRetainLimit) {
        const rawBytes = new Uint8Array(await file.arrayBuffer());
        rawStorageId = await uploadBytes("archives", rawBytes, "application/zip");
      } else if (file) {
        clientWarnings.push(
          `The original archive (${formatBytes(analysis.compressedSize)}) is larger than the ${formatBytes(analysis.limits.rawRetainLimit)} retention cap — Atlas keeps the extracted knowledge and inventory instead of the raw file.`,
        );
      }

      // 2. Upload every vetted file with bounded concurrency.
      const storageIds = new Map<string, string>();
      let uploaded = 0;
      const ingest = plan.ingest;
      const queue = [...ingest];
      async function worker() {
        while (queue.length > 0) {
          const entry = queue.shift();
          if (!entry || !entry.bytes) continue;
          const id = await uploadBytes("documents", entry.bytes, entry.mimeType);
          storageIds.set(entry.path, id);
          uploaded++;
          setProgress({ label: "Uploading", done: uploaded, total: Math.max(ingest.length, 1) });
        }
      }
      await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker));

      // 3. Create the tenant-scoped archive record.
      const created = await beginArchive({
        filename: analysis.filename,
        fileType: analysis.fileType === "unknown" ? "zip" : analysis.fileType,
        size: analysis.compressedSize,
        checksum: analysis.checksum,
        rawStorageId: rawStorageId as never,
        clientWarnings,
      });

      // 4. Submit the inventory in bounded batches.
      setPhase("submitting");
      setProgress({ label: "Recording inventory", done: 0, total: Math.max(analysis.entries.length, 1) });
      let submitted = 0;
      for (let i = 0; i < analysis.entries.length; i += BATCH_SIZE) {
        const batch = analysis.entries.slice(i, i + BATCH_SIZE);
        await submitInventoryBatch({
          archiveId: created.archiveId,
          clientWarnings,
          files: batch.map((e) => ({
            path: e.path,
            filename: e.filename,
            extension: e.extension,
            mimeType: e.mimeType,
            size: e.size,
            checksum: e.checksum,
            depth: e.depth,
            supported: e.supported,
            classification: e.classification,
            classificationBasis: e.classificationBasis,
            classificationConfidence: e.classificationConfidence,
            status: e.status,
            note: e.note,
            duplicateOfPath: e.duplicateOfPath,
            versionGroup: e.versionGroup,
            isSuperseded: e.isLatestVersion === false,
            supersedesPath: undefined,
            claimHints: e.claimHints,
            storageId: storageIds.get(e.path) as never,
            blocked: e.status === "blocked",
            blockReason: e.status === "blocked" ? e.note : undefined,
          })),
        });
        submitted += batch.length;
        setProgress({ label: "Recording inventory", done: submitted, total: analysis.entries.length });
      }

      // 5. Start the durable ingestion job (user can leave the page).
      await beginProcessing({ archiveId: created.archiveId });
      toast.success("Company data import started", {
        description: "Atlas is ingesting the archive in the background. You can leave this page.",
      });
      navigate(`/dashboard/knowledge/archives/${created.archiveId}`);
    } catch (e) {
      setPhase("error");
      setError(
        e instanceof Error ? e.message : "The import could not be started. Please try again.",
      );
      toast.error("Import failed", {
        description: e instanceof Error ? e.message : "Unknown error.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const counts = analysis
    ? {
        ok: analysis.entries.filter((e) => e.status === "ok" && e.supported).length,
        duplicates: analysis.entries.filter((e) => e.status === "duplicate").length,
        unsupported: analysis.entries.filter((e) => e.status === "unsupported").length,
        blocked: analysis.entries.filter((e) => e.status === "blocked").length,
        tooLarge: analysis.entries.filter((e) => e.status === "too_large").length,
      }
    : null;

  const claimHints = analysis
    ? [...new Map(analysis.entries.flatMap((e) => e.claimHints).map((h) => [h.claimNumber, h])).values()]
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 8)
    : [];

  const ingestible = plan?.ingest.length ?? 0;
  const warningCount = analysis?.warnings.length ?? 0;

  return (
    <div className="rounded-xl border border-dashed border-border/80 bg-card/40 p-5">
      {phase === "idle" && (
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-amber-400/10 text-amber-600 dark:text-amber-300 ring-1 ring-amber-400/20">
            <FileArchive className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Import company data</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Upload a <span className="font-mono">.zip</span> or{" "}
              <span className="font-mono">.rar</span> with your company's files —
              claims, estimates, invoices, policies, photos, spreadsheets.
              Atlas inspects everything locally first and shows you what it
              found before treating anything as authoritative.
            </p>
          </div>
          <Button onClick={() => fileRef.current?.click()} className="gap-2">
            <FileUp className="size-4" />
            Choose archive
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,.rar"
            className="hidden"
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
        </div>
      )}

      {phase === "analyzing" && (
        <div className="flex items-center gap-4">
          <Loader2 className="size-5 animate-spin text-teal-600 dark:text-teal-300" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {progress.label || "Reading"}… {progress.total > 0 && progress.done > 0 ? `${progress.done}/${progress.total}` : ""}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Extracting and inspecting the archive in your browser — nothing
              is uploaded until you approve.
            </p>
          </div>
        </div>
      )}

      {phase === "review" && analysis && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">{analysis.filename}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatBytes(analysis.compressedSize)} compressed ·{" "}
                {analysis.fileType.toUpperCase()} · checksum{" "}
                <span className="font-mono">{analysis.checksum.slice(0, 12)}…</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300">
                {counts?.ok ?? 0} ingestible
              </Badge>
              {counts && counts.duplicates > 0 && (
                <Badge variant="outline" className="border-violet-400/30 bg-violet-400/10 text-violet-600 dark:text-violet-300">
                  {counts.duplicates} duplicates
                </Badge>
              )}
              {counts && counts.unsupported > 0 && (
                <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground">
                  {counts.unsupported} unsupported
                </Badge>
              )}
              {counts && (counts.blocked + counts.tooLarge) > 0 && (
                <Badge variant="outline" className="border-rose-400/30 bg-rose-400/10 text-rose-600 dark:text-rose-300">
                  {counts.blocked + counts.tooLarge} skipped
                </Badge>
              )}
            </div>
          </div>

          {warningCount > 0 && (
            <div className="flex flex-col gap-2">
              {analysis.warnings.map((w, i) => {
                const Icon = WARNING_ICONS[w.code] ?? AlertTriangle;
                const tone =
                  w.code === "duplicates"
                    ? "text-violet-500"
                    : w.code === "blocked_files" || w.code === "oversized_archive" || w.code === "limit_exceeded"
                      ? "text-rose-500"
                      : "text-amber-500";
                return (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <Icon className={`mt-0.5 size-3.5 shrink-0 ${tone}`} />
                    <span className="text-muted-foreground">{w.message}</span>
                  </div>
                );
              })}
            </div>
          )}

          {claimHints.length > 0 && (
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Sparkles className="size-3.5 text-teal-600 dark:text-teal-300" />
                Possible claims from document identifiers
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {claimHints.map((h) => (
                  <Badge key={h.claimNumber} variant="outline" className="font-mono">
                    {h.claimNumber} · {Math.round(h.confidence * 100)}%
                  </Badge>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground/80">
                Atlas does not create claim records from this alone — these need
                your confirmation after ingestion.
              </p>
            </div>
          )}

          {analysis.entries.length > 0 && (
            <div className="max-h-48 overflow-auto rounded-lg border border-border/60">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                  <tr className="text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Path</th>
                    <th className="px-3 py-2 font-medium">Classification</th>
                    <th className="px-3 py-2 font-medium">Size</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {analysis.entries.slice(0, 60).map((e, i) => (
                    <tr key={i}>
                      <td className="max-w-[320px] truncate px-3 py-1.5 font-mono text-[11px]">
                        {e.path}
                      </td>
                      <td className="px-3 py-1.5 capitalize text-muted-foreground">
                        {e.classification}
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {formatBytes(e.size)}
                      </td>
                      <td className="px-3 py-1.5">
                        <Badge
                          variant="outline"
                          className={[
                            e.status === "ok" && "border-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300",
                            e.status === "duplicate" && "border-violet-400/30 bg-violet-400/10 text-violet-600 dark:text-violet-300",
                            e.status === "blocked" && "border-rose-400/30 bg-rose-400/10 text-rose-600 dark:text-rose-300",
                            e.status === "unsupported" && "border-muted-foreground/30 text-muted-foreground",
                            e.status === "too_large" && "border-muted-foreground/30 text-muted-foreground",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {e.status.replace(/_/g, " ")}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {analysis.entries.length > 60 && (
                <p className="px-3 py-2 text-[11px] text-muted-foreground">
                  …and {analysis.entries.length - 60} more — the full inventory
                  is recorded on the archive page.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {ingestible > 0
                ? `${ingestible} file${ingestible === 1 ? "" : "s"} will be uploaded and ingested into Atlas knowledge. You can leave this page while it processes.`
                : "No files are ingestible from this archive — Atlas will record the inventory and its warnings only."}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={reset} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={() => void startIngestion()} disabled={submitting} className="gap-2">
                {submitting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                Start ingestion
              </Button>
            </div>
          </div>
        </div>
      )}

      {(phase === "uploading" || phase === "submitting") && (
        <div className="flex items-center gap-4">
          <Loader2 className="size-5 animate-spin text-teal-600 dark:text-teal-300" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {phase === "uploading" ? "Uploading vetted files…" : "Recording inventory…"}{" "}
              {progress.total > 0 ? `${progress.done}/${progress.total}` : ""}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Only the files you approved are being sent. Large archives run as
              a background job once the manifest is submitted.
            </p>
          </div>
          <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-teal-500 transition-all"
              style={{
                width: `${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {phase === "error" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-rose-400/10 text-rose-600 dark:text-rose-300 ring-1 ring-rose-400/20">
              <AlertTriangle className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {describeArchiveError(error).title}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {describeArchiveError(error).detail}
              </p>
              {error && (
                <details className="mt-2 rounded-md border border-muted/60 bg-muted/30 p-2">
                  <summary className="cursor-pointer text-[11px] text-muted-foreground">
                    Technical detail (for administrators)
                  </summary>
                  <p className="mt-1 break-words text-[11px] text-muted-foreground">
                    {String(error)}
                  </p>
                </details>
              )}
            </div>
          </div>
          <div>
            <Button variant="outline" onClick={reset}>
              Try another archive
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
