import { api } from "@/convex/_generated/api";
import {
  ClassificationBadge,
  ConfidenceBar,
  DocStatusBadge,
  KnowledgeBadge,
  PageHeader,
  formatBytes,
  formatDate,
} from "@/components/atlas-ui";
import { Button } from "@/components/ui/button";
import { useQuery } from "convex/react";
import {
  ArrowLeft,
  BookOpen,
  FileText,
  Hash,
  Loader2,
  Network,
} from "lucide-react";
import { useNavigate, useParams } from "react-router";

const ENTITY_TONE: Record<string, string> = {
  claim: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  carrier: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  adjuster: "border-violet-400/30 bg-violet-400/10 text-violet-300",
  policyholder: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  property: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  financial: "border-teal-400/30 bg-teal-400/10 text-teal-300",
  organization: "border-cyan-400/30 bg-cyan-400/10 text-cyan-300",
  person: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  system: "border-indigo-400/30 bg-indigo-400/10 text-indigo-300",
  document: "border-slate-400/30 bg-slate-400/10 text-slate-300",
};

export default function KnowledgeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const detail = useQuery(
    api.documents.getDocumentDetail,
    id ? { documentId: id as never } : "skip",
  );

  if (!id) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
        <FileText className="size-8" />
        <p className="text-sm">No document selected.</p>
        <Button variant="outline" size="sm" onClick={() => navigate("/dashboard/knowledge")}>
          Back to knowledge base
        </Button>
      </div>
    );
  }

  if (detail === undefined) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <p className="text-sm">Loading document…</p>
      </div>
    );
  }

  if (detail === null) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
        <FileText className="size-8" />
        <p className="text-sm">Document not found.</p>
        <Button variant="outline" size="sm" onClick={() => navigate("/dashboard/knowledge")}>
          Back to knowledge base
        </Button>
      </div>
    );
  }

  const { doc, chunks, entities, assertions } = detail;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="mb-3 -ml-2 gap-1.5 text-muted-foreground"
          onClick={() => navigate("/dashboard/knowledge")}
        >
          <ArrowLeft className="size-3.5" />
          Knowledge base
        </Button>
        <PageHeader
          eyebrow="Document"
          title={doc.title}
          description={doc.summary ?? "No summary extracted for this document."}
          actions={
            <div className="flex items-center gap-2">
              <ClassificationBadge classification={doc.classification} />
              <DocStatusBadge status={doc.status} />
            </div>
          }
        />
      </div>

      {/* Meta strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ["Size", formatBytes(doc.size)],
          ["Chunks", `${chunks.length}`],
          ["Entities", `${entities.length}`],
          ["Added", formatDate(doc._creationTime)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-border/70 bg-card/50 px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</p>
            <p className="mt-1 text-sm font-medium">{v}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Chunks */}
        <div className="lg:col-span-3">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Hash className="size-4 text-cyan-300" />
            Semantic chunks
          </h2>
          {chunks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
              {doc.status === "processing"
                ? "Still processing — chunks will appear here shortly."
                : "No chunks extracted for this document."}
            </div>
          ) : (
            <div className="space-y-3">
              {chunks.map((c) => (
                <div
                  key={c._id}
                  className="rounded-xl border border-border/70 bg-card/50 p-4"
                >
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
                      chunk {c.chunkIndex + 1} / {chunks.length}
                    </span>
                    {c.tokenCount ? (
                      <span className="font-mono text-[10px] text-muted-foreground/60">
                        ~{c.tokenCount} tokens
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">{c.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Entities + assertions */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          <div>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Network className="size-4 text-teal-300" />
              Extracted entities
            </h2>
            {entities.length === 0 ? (
              <p className="text-sm text-muted-foreground">No entities extracted yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {entities.map((e) => (
                  <div
                    key={e._id}
                    className={
                      "rounded-lg border px-2.5 py-1.5 text-xs " +
                      (ENTITY_TONE[e.entityTypeKey] ?? "border-border/70 bg-muted/40 text-muted-foreground")
                    }
                  >
                    <p className="font-medium">{e.name}</p>
                    <p className="mt-0.5 font-mono text-[10px] opacity-70">
                      {e.entityTypeKey.replace(/_/g, " ")} · {Math.round(e.confidence * 100)}%
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <BookOpen className="size-4 text-violet-300" />
              Knowledge assertions
            </h2>
            {assertions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No assertions linked to this document.</p>
            ) : (
              <div className="space-y-2">
                {assertions.map((a) => (
                  <div key={a._id} className="rounded-lg border border-border/70 bg-card/50 p-3">
                    <div className="mb-1.5 flex items-center justify-between">
                      <KnowledgeBadge classification={a.classification} />
                      <ConfidenceBar value={a.confidence} />
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">{a.statement}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {doc.status === "failed" && (
            <div className="rounded-lg border border-rose-400/30 bg-rose-400/10 p-3 text-xs text-rose-300">
              <p className="font-semibold">Processing failed</p>
              <p className="mt-1">{doc.error ?? "Unknown error"}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
