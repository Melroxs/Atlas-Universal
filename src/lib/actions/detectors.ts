// ---------------------------------------------------------------------------
// Client-side detectors — the deterministic recommendation rules that used to
// run as a server-side Convex action now run in the browser against the same
// RPCs. Rules are conservative and idempotent: stale recommendations for the
// same detector key are closed before new ones are created.
// ---------------------------------------------------------------------------

import { getSupabaseClient } from "@/lib/supabase";
import { rpcCall } from "@/lib/actions/rpc";

interface DocRow {
  _id: string;
  status?: string;
  title?: string;
  entityCount?: number | null;
  chunkCount?: number | null;
  error?: string | null;
  updatedAt?: number | null;
}

const DETECTOR_KEYS = [
  "document_processing_failed",
  "knowledge_gaps",
  "stale_documents",
];

/** Run the deterministic detectors and return counts. */
export async function runDetectorsClient(): Promise<{
  ran: number;
  created: number;
}> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const docs = ((await rpcCall(supabase, "documents_list_documents")) as DocRow[]) ?? [];
  const now = Date.now();

  // Close anything from a previous run so re-runs are idempotent.
  await rpcCall(supabase, "recommendations_close_stale", {
    detectorKeys: DETECTOR_KEYS,
  });

  let created = 0;

  // 1. Documents whose ingestion failed.
  for (const doc of docs.filter((d) => d.status === "failed")) {
    const res = (await rpcCall(supabase, "recommendations_create", {
      title: "A document failed to process",
      summary: `“${doc.title ?? "Untitled document"}” could not be ingested.`,
      reason: doc.error ?? "The ingestion pipeline reported an error.",
      detectorKey: "document_processing_failed",
      priority: "medium",
      confidence: 0.9,
      risk: "low",
      evidence: [{ kind: "document", documentId: doc._id, title: doc.title, snippet: doc.error, relevance: 0.9 }],
    })) as { created: boolean };
    if (res.created) created++;
  }

  // 2. Documents with no extracted entities — likely thin coverage.
  for (const doc of docs.filter(
    (d) => d.status === "ready" && (!d.entityCount || d.entityCount === 0),
  ).slice(0, 20)) {
    const res = (await rpcCall(supabase, "recommendations_create", {
      title: "Knowledge gap: no entities extracted",
      summary: `“${doc.title ?? "Untitled document"}” was ingested but produced no entities.`,
      reason: "The document may contain mostly unstructured text, or the extraction was too thin to be useful.",
      detectorKey: "knowledge_gaps",
      priority: "low",
      confidence: 0.6,
      risk: "low",
      evidence: [{ kind: "document", documentId: doc._id, title: doc.title, snippet: "No entities extracted.", relevance: 0.6 }],
    })) as { created: boolean };
    if (res.created) created++;
  }

  // 3. Documents untouched for 90+ days.
  for (const doc of docs.filter(
    (d) => d.updatedAt && now - d.updatedAt > 90 * 24 * 3600_000,
  ).slice(0, 20)) {
    const res = (await rpcCall(supabase, "recommendations_create", {
      title: "Document may be stale",
      summary: `“${doc.title ?? "Untitled document"}” has not been updated in over 90 days.`,
      reason: "Re-verify this document still reflects current operations.",
      detectorKey: "stale_documents",
      priority: "low",
      confidence: 0.5,
      risk: "low",
      evidence: [{ kind: "document", documentId: doc._id, title: doc.title, snippet: doc.updatedAt ? `Last updated ${new Date(doc.updatedAt).toLocaleDateString()}.` : undefined, relevance: 0.5 }],
    })) as { created: boolean };
    if (res.created) created++;
  }

  return { ran: DETECTOR_KEYS.length, created };
}
