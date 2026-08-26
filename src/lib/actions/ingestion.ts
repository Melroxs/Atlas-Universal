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
import { rpcCall } from "@/lib/actions/rpc";

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
  kind?: string;
  warnings?: string[];
}> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const created = (await rpcCall(supabase, "ingestion_create_document", {
    title: args.title,
    mimeType: args.mimeType,
    size: args.size,
    sourceType: args.sourceType ?? "upload",
    classification: "Unknown",
    status: "processing",
    storageId: args.storagePath,
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
    const parsed = await parseFile(args.mimeType, args.title, bytes);

    // Images: the file is real evidence but has no extractable text — never
    // pretend binary pixels are text. Stored + represented as evidence with
    // an honest extraction state.
    if (parsed.image) {
      await rpcCall(supabase, "ingestion_patch_document", {
        documentId: docId,
        patch: {
          status: "ready",
          classification: "Image Evidence",
          summary:
            "Image evidence stored. No text/OCR content extracted — OCR is not configured in this environment.",
          chunkCount: 0,
          entityCount: 0,
          processedAt: Date.now(),
          error: null,
        },
      });
      return {
        docId,
        classification: "Image Evidence",
        chunks: 0,
        entities: 0,
        mode: "local",
        kind: "image",
        warnings: ["content_extraction_unavailable"],
      };
    }

    if (!parsed.text.trim()) {
      throw new Error("No readable text found in this file.");
    }

    const result = await ingestTextClient(supabase, {
      title: args.title,
      mimeType: parsed.mimeType,
      size: args.size,
      sourceType: args.sourceType ?? "upload",
      text: parsed.text,
      existingDocId: docId,
    });

    await rpcCall(supabase, "ingestion_patch_document", {
      documentId: docId,
      patch: {
        status: "ready",
        classification: result.classification,
        summary: summarize(parsed.text),
        chunkCount: result.chunks,
        entityCount: result.entities,
        processedAt: Date.now(),
        error: null,
      },
    });

    return { docId, ...result, mode: "local", kind: parsed.kind };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await rpcCall(supabase, "ingestion_patch_document", {
      documentId: docId,
      patch: { status: "failed", error: message },
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
    await rpcCall(supabase, "ingestion_insert_chunk", {
      documentId: existingDocId,
      chunkIndex: i,
      content: chunks[i],
      embedding: embeddings[i],
      tokenCount: null,
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
      await rpcCall(supabase, "ingestion_insert_assertion", {
        classification: a.classification,
        statement: a.statement,
        confidence: a.confidence,
        sourceDocumentId: existingDocId,
        evidence: a.evidence,
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
          await rpcCall(supabase, "ingestion_insert_relationship", {
            subjectEntityId: a.entityId,
            relationshipTypeKey: "relates_to",
            objectEntityId: b.entityId,
            confidence: Math.min(a.confidence, b.confidence),
            sourceDocumentId: existingDocId,
            evidence: truncate(text, 200),
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
      await rpcCall(supabase, "ingestion_patch_entity", {
        entityId: matchId,
        patch: {
          lastObservedAt: now,
          sourceDocumentId: documentId,
          confidence: Math.max(c.confidence, 0.5),
        },
      });
      out.push({ entityId: matchId, name, type: c.type, confidence: Math.max(c.confidence, 0.5) });
    } else {
      const inserted = (await rpcCall(supabase, "ingestion_insert_entity", {
        entityTypeKey: c.type,
        name: name,
        confidence: c.confidence,
        sourceDocumentId: documentId,
        attributes: { source: "document_extraction", aliases: [] },
      })) as { entityId: string };
      idByKey.set(key, inserted.entityId);
      pool.push({ id: inserted.entityId, type: c.type, name });
      out.push({ entityId: inserted.entityId, name, type: c.type, confidence: c.confidence });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Industry Document Ingestion — extends the standard pipeline to populate
// the Atlas Industry Knowledge layer (Layer 1: global, shared).
// ---------------------------------------------------------------------------

export interface IndustryDocumentArgs {
  /** Storage path of the uploaded file. */
  storagePath: string;
  /** Document title. */
  title: string;
  /** MIME type. */
  mimeType: string;
  /** File size in bytes. */
  size: number;
  /** Source classification (e.g., INDUSTRY_STANDARD, REGULATORY, etc.). */
  sourceClassification?: string;
  /** Industry focus (e.g., "insurance_restoration", "construction"). */
  industry?: string;
  /** Jurisdiction (e.g., "United States", "Florida"). */
  jurisdiction?: string;
  /** Source URL if the document was retrieved from the web. */
  sourceUrl?: string;
  /** Source ID from the authoritative sources registry. */
  sourceId?: string;
}

/**
 * Process a document as Atlas Industry Knowledge.
 *
 * This runs the standard document processing pipeline AND inserts the
 * parsed content into the industry knowledge tables:
 *   atlasIndustryDocuments
 *   atlasIndustryChunks
 *   atlasIndustryKnowledge
 *   atlasIndustryProvenance
 *
 * The document status is set to `needs_review` — industry knowledge must
 * be approved by a Super Admin/Atlas Admin before it becomes published
 * and available to customers.
 */
export async function processIndustryDocument(
  args: IndustryDocumentArgs,
): Promise<{
  docId: string;
  industryDocId: string;
  classification: string;
  chunks: number;
  knowledgeItems: number;
  status: string;
  warnings?: string[];
}> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  // 1. Run standard document processing pipeline
  const result = await processDocumentClient({
    storagePath: args.storagePath,
    title: args.title,
    mimeType: args.mimeType,
    size: args.size,
    sourceType: "industry_upload",
  });

  // 2. Create the industry document record
  const industryDoc = (await rpcCall(supabase, "industry_create_document", {
    title: args.title,
    filename: args.title,
    mimeType: args.mimeType,
    size: args.size,
    storagePath: args.storagePath,
    sourceType: "upload",
    sourceUrl: args.sourceUrl ?? null,
    sourceId: args.sourceId ?? null,
    classification: args.sourceClassification ?? "ATLAS_CURATED",
    status: "needs_review",
    industry: args.industry ?? null,
    jurisdiction: args.jurisdiction ?? null,
    standardDocId: result.docId,
  })) as { docId: string };

  // 3. Get chunks from the standard document and insert industry chunks
  const chunksResult = (await rpcCall(supabase, "documents_get_document_detail", {
    documentId: result.docId,
  })) as { chunks?: Array<{ content?: string; chunkIndex?: number }> } | null;

  let industryChunksInserted = 0;
  if (chunksResult?.chunks && Array.isArray(chunksResult.chunks)) {
    for (const chunk of chunksResult.chunks) {
      if (!chunk.content) continue;
      await rpcCall(supabase, "industry_insert_chunk", {
        documentId: industryDoc.docId,
        chunkIndex: chunk.chunkIndex ?? industryChunksInserted,
        content: chunk.content,
        tokenCount: null,
      }).catch(() => undefined);
      industryChunksInserted++;
    }
  }

  // 4. Extract knowledge items from the document text
  // Use simple heuristics to identify knowledge items from the document
  const text = (chunksResult?.chunks ?? [])
    .map((c) => c.content ?? "")
    .join("\n");

  const knowledgeItems = extractKnowledgeItems(text, args.title, {
    sourceClassification: (args.sourceClassification ?? "ATLAS_CURATED") as string,
    industry: args.industry,
    jurisdiction: args.jurisdiction,
    documentId: industryDoc.docId,
    sourceId: args.sourceId,
  });

  let knowledgeInserted = 0;
  for (const item of knowledgeItems) {
    await rpcCall(supabase, "industry_insert_knowledge", {
      documentId: industryDoc.docId,
      layer: "atlas_industry",
      sourceClassification: item.sourceClassification,
      title: item.title,
      statement: item.statement,
      interpretation: item.interpretation ?? null,
      knowledgeType: item.knowledgeType,
      industry: item.industry ?? null,
      jurisdiction: item.jurisdiction ?? null,
      confidence: item.confidence,
      status: "needs_review",
      sourceId: item.sourceId ?? null,
      tags: item.tags ?? [],
    }).catch(() => undefined);
    knowledgeInserted++;
  }

  // 5. Create provenance record
  if (args.sourceId) {
    await rpcCall(supabase, "industry_upsert_provenance", {
      sourceId: args.sourceId,
      sourceName: args.title,
      organization: "Unknown",
      authorityTier: "standard",
      sourceType: "uploaded_document",
      canonicalUrl: args.sourceUrl ?? null,
      status: "active",
    }).catch(() => undefined);
  }

  return {
    docId: result.docId,
    industryDocId: industryDoc.docId,
    classification: result.classification,
    chunks: industryChunksInserted,
    knowledgeItems: knowledgeInserted,
    status: "needs_review",
    warnings: result.warnings,
  };
}

/**
 * Simple heuristic extraction of knowledge items from document text.
 * Identifies requirements, standards, definitions, and procedures.
 */
function extractKnowledgeItems(
  text: string,
  title: string,
  meta: {
    sourceClassification: string;
    industry?: string;
    jurisdiction?: string;
    documentId: string;
    sourceId?: string;
  },
): Array<{
  title: string;
  statement: string;
  interpretation?: string;
  knowledgeType: string;
  sourceClassification: string;
  confidence: number;
  industry?: string;
  jurisdiction?: string;
  sourceId?: string;
  tags?: string[];
}> {
  const items: Array<{
    title: string;
    statement: string;
    interpretation?: string;
    knowledgeType: string;
    sourceClassification: string;
    confidence: number;
    industry?: string;
    jurisdiction?: string;
    sourceId?: string;
    tags?: string[];
  }> = [];

  // Split into sentences and look for knowledge patterns
  const sentences = text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && s.length < 500);

  const requirementPatterns = /\b(must|shall|required|mandatory|shall not|must not|prohibited|minimum|at least)\b/i;
  const definitionPatterns = /\b(is defined as|means|refers to|is the|consists of|includes)\b/i;
  const procedurePatterns = /\b(step \d|first,|second,|third,|finally,|before|after|ensure|verify|inspect)\b/i;
  const standardPatterns = /\b(standard|code|regulation|guideline|specification|requirement| criterion)\b/i;

  for (const sentence of sentences) {
    let knowledgeType = "general";
    let confidence = 0.6;

    if (requirementPatterns.test(sentence)) {
      knowledgeType = "requirement";
      confidence = 0.75;
    } else if (definitionPatterns.test(sentence)) {
      knowledgeType = "definition";
      confidence = 0.7;
    } else if (procedurePatterns.test(sentence)) {
      knowledgeType = "procedure";
      confidence = 0.65;
    } else if (standardPatterns.test(sentence)) {
      knowledgeType = "standard_reference";
      confidence = 0.7;
    } else {
      // Only include sentences that look like they contain useful knowledge
      if (!/^(the|this|that|it|we|they|there|here)\b/i.test(sentence)) continue;
      if (sentence.split(" ").length < 8) continue;
    }

    items.push({
      title: `${title} — ${knowledgeType.charAt(0).toUpperCase() + knowledgeType.slice(1)}`,
      statement: sentence,
      knowledgeType,
      sourceClassification: meta.sourceClassification,
      confidence,
      industry: meta.industry,
      jurisdiction: meta.jurisdiction,
      sourceId: meta.sourceId,
      tags: [knowledgeType],
    });

    // Limit to prevent excessive extraction
    if (items.length >= 20) break;
  }

  return items;
}
