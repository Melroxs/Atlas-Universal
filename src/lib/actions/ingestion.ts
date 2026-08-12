// ---------------------------------------------------------------------------
// Client-side ingestion — the universal ingestion core ported to run in the
// browser against Supabase Storage + Postgres RPCs.
//
// Every source (manual upload, archive, future connectors) converges here:
// classify → chunk → embed → extract → resolve → assertions → relationships.
// AI upgrades (server-side embeddings / classification) degrade to the same
// deterministic heuristics the product always used as its fallback.
// ---------------------------------------------------------------------------

import { getSupabaseClient } from "@/lib/supabase";
import {
  classifyDocument,
  extractAmounts,
  extractCandidates,
  extractDates,
  normalizeEntityKey,
  normalizeEntityName,
  tokenSimilarity,
} from "@/lib/ingest/heuristics";
import { localEmbed } from "@/lib/ingest/localEmbed";
import { chunkText, summarize, truncate } from "@/lib/ingest/text";
import { parseFile } from "@/lib/ingest/parsers";

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

async function rpc(
  supabase: NonNullable<ReturnType<typeof getSupabaseClient>>,
  fn: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

export interface ProcessDocumentArgs {
  /** Supabase storage path of the uploaded file (inside the documents bucket). */
  storagePath: string;
  title: string;
  mimeType: string;
  size: number;
  sourceType?: string;
}

/**
 * Create the document record, parse the file, run the deterministic ingestion
 * pipeline and persist chunks / entities / assertions / relationships.
 */
export async function processDocumentClient(
  args: ProcessDocumentArgs,
): Promise<{
  docId: string;
  classification: string;
  chunks: number;
  entities: number;
  mode: "ai" | "local";
}> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const created = (await rpc(supabase, "ingestion_create_document", {
    p_title: args.title,
    p_mimeType: args.mimeType,
    p_size: args.size,
    p_sourceType: args.sourceType ?? "upload",
    p_classification: "Unknown",
    p_status: "processing",
    p_storageId: args.storagePath,
  })) as { docId: string };
  const docId = created.docId;

  try {
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("documents")
      .download(args.storagePath);
    if (downloadError || !fileData) {
      throw new Error("Uploaded file is missing from storage.");
    }
    const bytes = await fileData.arrayBuffer();
    const { text } = await parseFile(args.mimeType, args.title, bytes);
    if (!text.trim()) {
      throw new Error("No readable text found in this file.");
    }

    const result = await ingestTextClient(supabase, {
      title: args.title,
      mimeType: args.mimeType,
      size: args.size,
      sourceType: args.sourceType ?? "upload",
      text,
      existingDocId: docId,
    });

    await rpc(supabase, "ingestion_patch_document", {
      p_document_id: docId,
      p_patch: {
        status: "ready",
        classification: result.classification,
        summary: summarize(text),
        chunkCount: result.chunks,
        entityCount: result.entities,
        processedAt: Date.now(),
        error: null,
      },
    });

    return { docId, ...result, mode: "local" };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await rpc(supabase, "ingestion_patch_document", {
      p_document_id: docId,
      p_patch: { status: "failed", error: message },
    }).catch(() => undefined);
    throw new Error(message);
  }
}

interface IngestOptions {
  title: string;
  mimeType: string;
  size?: number;
  sourceType: string;
  sourceId?: string;
  sourceModifiedAt?: number;
  text: string;
  existingDocId: string;
}

/** The pure pipeline — shared by manual uploads and archive ingestion. */
export async function ingestTextClient(
  supabase: NonNullable<ReturnType<typeof getSupabaseClient>>,
  opts: IngestOptions,
): Promise<{ classification: string; chunks: number; entities: number }> {
  const { text, title, existingDocId } = opts;
  const fresh = !opts.sourceId;

  const classification = classifyDocument(title, text);
  const chunks = chunkText(text);
  const embeddings = chunks.map(localEmbed);

  const candidates = extractCandidates(text);
  const entities = await upsertEntitiesClient(supabase, candidates, existingDocId);

  for (let i = 0; i < chunks.length; i++) {
    await rpc(supabase, "ingestion_insert_chunk", {
      p_document_id: existingDocId,
      p_chunkIndex: i,
      p_content: chunks[i],
      p_embedding: embeddings[i],
      p_tokenCount: null,
    });
  }

  if (fresh) {
    const amounts = extractAmounts(text);
    const dates = extractDates(text);
    const assertions: Array<{
      classification: "FACT" | "OBSERVATION";
      statement: string;
      confidence: number;
      evidence: string;
    }> = [];
    for (const a of amounts.slice(0, 3)) {
      assertions.push({
        classification: "FACT",
        statement: `Financial figure ${a} is referenced in “${title}”.`,
        confidence: 0.6,
        evidence: truncate(text, 400),
      });
    }
    if (dates.length > 0) {
      assertions.push({
        classification: "FACT",
        statement: `Dates referenced in “${title}”: ${dates.slice(0, 3).join(", ")}.`,
        confidence: 0.7,
        evidence: truncate(text, 400),
      });
    }
    if (entities.length > 0) {
      assertions.push({
        classification: "OBSERVATION",
        statement: `${entities.length} entities were extracted from “${title}” (${entities
          .slice(0, 5)
          .map((e) => e.name)
          .join(", ")}${entities.length > 5 ? ", …" : ""}).`,
        confidence: 0.8,
        evidence: truncate(text, 400),
      });
    }
    for (const a of assertions) {
      await rpc(supabase, "ingestion_insert_assertion", {
        p_classification: a.classification,
        p_statement: a.statement,
        p_confidence: a.confidence,
        p_sourceDocumentId: existingDocId,
        p_evidence: a.evidence,
      });
    }

    if (entities.length >= 2) {
      const windowSize = Math.min(entities.length, 6);
      let edges = 0;
      for (let i = 0; i < windowSize - 1 && edges < 12; i++) {
        for (let j = i + 1; j < windowSize && edges < 12; j++) {
          const a = entities[i];
          const b = entities[j];
          if (a.entityId === b.entityId) continue;
          await rpc(supabase, "ingestion_insert_relationship", {
            p_subjectEntityId: a.entityId,
            p_relationshipTypeKey: "relates_to",
            p_objectEntityId: b.entityId,
            p_confidence: Math.min(a.confidence, b.confidence),
            p_sourceDocumentId: existingDocId,
            p_evidence: truncate(text, 200),
          });
          edges++;
        }
      }
    }
  }

  return { classification, chunks: chunks.length, entities: entities.length };
}

interface EntityRec {
  entityId: string;
  name: string;
  type: string;
  confidence: number;
}

/** Resolve + upsert entities with source-aware identity resolution. */
async function upsertEntitiesClient(
  supabase: NonNullable<ReturnType<typeof getSupabaseClient>>,
  candidates: Array<{ name: string; type: string; confidence: number }>,
  documentId: string,
): Promise<EntityRec[]> {
  const { data: existing, error: existingError } = await supabase.rpc(
    "knowledge_list_entities",
    {},
  );
  if (existingError) throw new Error(existingError.message);
  const pool: Array<{ id: string; type: string; name: string }> = [];
  const idByKey = new Map<string, string>();
  for (const e of (existing as Array<Record<string, unknown>>) ?? []) {
    const id = String(e._id);
    idByKey.set(`${e.entityTypeKey}:${normalizeEntityKey(String(e.name))}`, id);
    pool.push({ id, type: String(e.entityTypeKey), name: String(e.name) });
  }

  const out: EntityRec[] = [];
  const now = Date.now();
  for (const c of candidates) {
    const name = normalizeEntityName(c.name);
    if (!name) continue;
    const key = `${c.type}:${normalizeEntityKey(name)}`;
    let matchId = idByKey.get(key);

    if (!matchId) {
      let best: { id: string; sim: number } | null = null;
      for (const p of pool) {
        if (p.type !== c.type) continue;
        const sim = tokenSimilarity(p.name, name);
        if (sim >= 0.8 && (!best || sim > best.sim)) best = { id: p.id, sim };
      }
      if (best) matchId = best.id;
    }

    if (matchId) {
      await rpc(supabase, "ingestion_patch_entity", {
        p_entity_id: matchId,
        p_patch: {
          lastObservedAt: now,
          sourceDocumentId: documentId,
          confidence: Math.max(c.confidence, 0.5),
        },
      });
      out.push({ entityId: matchId, name, type: c.type, confidence: Math.max(c.confidence, 0.5) });
    } else {
      const inserted = (await rpc(supabase, "ingestion_insert_entity", {
        p_entityTypeKey: c.type,
        p_name: name,
        p_confidence: c.confidence,
        p_sourceDocumentId: documentId,
        p_attributes: { source: "document_extraction", aliases: [] },
      })) as { entityId: string };
      idByKey.set(key, inserted.entityId);
      pool.push({ id: inserted.entityId, type: c.type, name });
      out.push({ entityId: inserted.entityId, name, type: c.type, confidence: c.confidence });
    }
  }
  return out;
}
