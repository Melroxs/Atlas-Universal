"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, type ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { aiAvailable, chat, embedTexts } from "./ai/provider";
import {
  classifyDocument,
  extractAmounts,
  extractCandidates,
  extractDates,
  normalizeEntityKey,
  normalizeEntityName,
  tokenSimilarity,
} from "./ai/heuristics";
import { localEmbed } from "./ai/localEmbed";
import { parseFile } from "./lib/parsers";
import { chunkText, summarize, truncate } from "./lib/text";

const EDITOR_ROLES = ["owner", "admin", "manager", "analyst"] as const;

interface EntityRec {
  entityId: Id<"entities">;
  name: string;
  type: string;
  confidence: number;
}

async function toArrayBuffer(stored: unknown): Promise<ArrayBuffer> {
  if (stored instanceof ArrayBuffer) return stored;
  const blob = stored as Blob;
  if (typeof blob.arrayBuffer === "function") {
    return await blob.arrayBuffer();
  }
  throw new Error("Unsupported file data.");
}

/**
 * Resolve + upsert entities with source-aware identity resolution.
 * 1. Exact match on the canonical identity key (suffix/punctuation-insensitive).
 * 2. Fuzzy token-set match (>= 0.8) within the same entity type — cross-source
 *    aliases like "Harborview Property Group" vs "Harborview" merge here.
 * 3. Otherwise a new entity is created. Merges never happen below the
 *    threshold and always preserve provenance via `aliases` + source document.
 */
async function upsertEntities(
  ctx: ActionCtx,
  tenantId: Id<"tenants">,
  candidates: Array<{ name: string; type: string; confidence: number }>,
  documentId: Id<"documents">,
): Promise<EntityRec[]> {
  const existing = await ctx.runQuery(internal.internal.listEntitiesByTenant, {
    tenantId,
  });
  const idByKey = new Map<string, Id<"entities">>();
  const pool: Array<{ id: Id<"entities">; type: string; name: string }> = [];
  for (const e of existing) {
    idByKey.set(`${e.entityTypeKey}:${normalizeEntityKey(e.name)}`, e._id);
    pool.push({ id: e._id, type: e.entityTypeKey, name: e.name });
  }

  const out: EntityRec[] = [];
  const now = Date.now();
  for (const c of candidates) {
    const name = normalizeEntityName(c.name);
    if (!name) continue;
    const key = `${c.type}:${normalizeEntityKey(name)}`;
    let matchId = idByKey.get(key);

    if (!matchId) {
      // Fuzzy resolution within the same type family only.
      let best: { id: Id<"entities">; sim: number } | null = null;
      for (const p of pool) {
        if (p.type !== c.type) continue;
        const sim = tokenSimilarity(p.name, name);
        if (sim >= 0.8 && (!best || sim > best.sim)) best = { id: p.id, sim };
      }
      if (best) matchId = best.id;
    }

    if (matchId) {
      const existingEntity = existing.find(
        (e) => String(e._id) === String(matchId),
      );
      const aliases: string[] = Array.isArray(existingEntity?.attributes?.aliases)
        ? (existingEntity!.attributes.aliases as string[])
        : [];
      if (
        normalizeEntityKey(existingEntity?.name ?? "") !==
          normalizeEntityKey(name) &&
        !aliases.includes(name)
      ) {
        aliases.push(name);
      }
      await ctx.runMutation(internal.internal.patchEntity, {
        id: matchId,
        patch: {
          lastObservedAt: now,
          sourceDocumentId: documentId,
          confidence: Math.max(existingEntity?.confidence ?? 0.5, c.confidence),
          attributes: { ...(existingEntity?.attributes ?? {}), aliases },
        },
      });
      out.push({
        entityId: matchId,
        name,
        type: c.type,
        confidence: Math.max(c.confidence, 0.5),
      });
    } else {
      const id = await ctx.runMutation(internal.internal.insertEntity, {
        tenantId,
        entityTypeKey: c.type,
        name,
        confidence: c.confidence,
        sourceDocumentId: documentId,
        firstObservedAt: now,
        attributes: { source: "document_extraction", aliases: [] },
      });
      idByKey.set(key, id);
      pool.push({ id, type: c.type, name });
      out.push({ entityId: id, name, type: c.type, confidence: c.confidence });
    }
  }
  return out;
}

/** Ask the AI (when available) for a structured entity list; null on failure. */
async function aiExtractEntities(
  text: string,
): Promise<Array<{ name: string; type: string; confidence: number }> | null> {
  if (!aiAvailable()) return null;
  const prompt = `Extract key business entities from the following company document. Use ONLY these types: claim, carrier, adjuster, policyholder, customer, vendor, contractor, person, organization, system, product, location, document, project, financial, contract, email, phone.
Return ONLY a JSON array, no prose: [{"name": string, "type": string, "confidence": number between 0 and 1}]
Document text:
${truncate(text, 6000)}`;
  try {
    const raw = await chat(
      [{ role: "user", content: prompt }],
      { temperature: 0, maxTokens: 700 },
    );
    if (!raw) return null;
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((e) => e && typeof e.name === "string")
      .slice(0, 40)
      .map((e) => ({
        name: String(e.name),
        type: String(e.type ?? "unknown"),
        confidence: Math.min(Math.max(Number(e.confidence) || 0.5, 0.1), 0.95),
      }));
  } catch {
    return null;
  }
}

async function aiClassify(
  title: string,
  excerpt: string,
): Promise<string | null> {
  const valid = [
    "SOP", "Policy", "Handbook", "Template", "Contract", "Estimate",
    "Invoice", "Report", "Meeting Notes", "Communication",
    "Training Material", "Regulatory Reference", "Spreadsheet",
    "Financial Record", "Unknown",
  ];
  const prompt = `Classify this business document into exactly one category: ${valid.join(", ")}.\nTitle: ${title}\nExcerpt: ${excerpt}\nReply with only the category name.`;
  try {
    const raw = await chat([{ role: "user", content: prompt }], {
      temperature: 0,
      maxTokens: 20,
    });
    if (!raw) return null;
    const hit = valid.find((c) => raw.trim().toLowerCase() === c.toLowerCase());
    return hit ?? null;
  } catch {
    return null;
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
  existingDocId: Id<"documents">;
}

/**
 * THE universal ingestion core. Every source (manual upload, Google Drive,
 * future connectors) converges here: classify → chunk → embed → extract →
 * resolve → assertions → relationships → index. Produces the same normalized
 * Atlas knowledge objects regardless of origin.
 */
export async function ingestText(
  ctx: ActionCtx,
  tenantId: Id<"tenants">,
  opts: IngestOptions,
): Promise<{ classification: string; chunks: number; entities: number }> {
  const { text, title, existingDocId } = opts;
  const fresh = !opts.sourceId; // drive re-syncs skip duplicate assertions/edges

  // 1. Classify (heuristic + AI upgrade)
  let classification = classifyDocument(title, text);
  if (aiAvailable()) {
    const aiClass = await aiClassify(title, truncate(text, 3000));
    if (aiClass) classification = aiClass;
  }

  // 2. Chunk
  const chunks = chunkText(text);

  // 3. Embed (AI when available, deterministic local otherwise)
  let embeddings: number[][] | null = null;
  if (aiAvailable()) embeddings = await embedTexts(chunks);
  if (!embeddings || embeddings.length !== chunks.length) {
    embeddings = chunks.map(localEmbed);
  }

  // 4. Extract entities (AI upgrade when available) with resolution
  const heuristic = extractCandidates(text);
  const aiEntities = await aiExtractEntities(text);
  const candidates = aiEntities && aiEntities.length > 0 ? aiEntities : heuristic;
  const entities = await upsertEntities(ctx, tenantId, candidates, existingDocId);

  // 5. Insert chunks (with chunk-entity co-occurrence relationships)
  for (let i = 0; i < chunks.length; i++) {
    await ctx.runMutation(internal.internal.insertChunk, {
      tenantId,
      documentId: existingDocId,
      chunkIndex: i,
      content: chunks[i],
      embedding: embeddings[i],
    });
  }

  // 6. Knowledge assertions (first ingestion only — avoids re-sync dupes)
  if (fresh) {
    const amounts = extractAmounts(text);
    const dates = extractDates(text);
    const assertions: Array<{
      classification: "FACT" | "RULE" | "OBSERVATION" | "INFERENCE";
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
        statement: `${entities.length} entities were extracted from “${title}” (${entities.slice(0, 5).map((e) => e.name).join(", ")}${entities.length > 5 ? ", …" : ""}).`,
        confidence: 0.8,
        evidence: truncate(text, 400),
      });
    }
    for (const a of assertions) {
      await ctx.runMutation(internal.internal.insertAssertion, {
        tenantId,
        classification: a.classification,
        statement: a.statement,
        confidence: a.confidence,
        sourceDocumentId: existingDocId,
        evidence: a.evidence,
      });
    }

    // 7. Entity co-occurrence relationships (cap per document)
    if (entities.length >= 2) {
      const windowSize = Math.min(entities.length, 6);
      let edges = 0;
      for (let i = 0; i < windowSize - 1 && edges < 12; i++) {
        for (let j = i + 1; j < windowSize && edges < 12; j++) {
          const a = entities[i];
          const b = entities[j];
          if (a.entityId === b.entityId) continue;
          const conf = Math.min(a.confidence, b.confidence);
          await ctx.runMutation(internal.internal.insertRelationship, {
            tenantId,
            subjectEntityId: a.entityId,
            relationshipTypeKey: "relates_to",
            objectEntityId: b.entityId,
            confidence: conf,
            sourceDocumentId: existingDocId,
            evidence: truncate(text, 200),
          });
          edges++;
        }
      }
    }
  }

  // 8. Mark ready + record source identity
  await ctx.runMutation(internal.internal.patchDoc, {
    id: existingDocId,
    patch: {
      status: "ready",
      classification,
      summary: summarize(text),
      chunkCount: chunks.length,
      entityCount: entities.length,
      processedAt: Date.now(),
      sourceId: opts.sourceId,
      sourceModifiedAt: opts.sourceModifiedAt,
      size: opts.size,
    },
  });

  return { classification, chunks: chunks.length, entities: entities.length };
}

export const processDocument = action({
  args: {
    storageId: v.id("_storage"),
    title: v.string(),
    mimeType: v.string(),
    size: v.number(),
    sourceType: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    docId: Id<"documents">;
    classification: string;
    chunks: number;
    entities: number;
    mode: "ai" | "local";
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("You must be signed in.");

    const membership = await ctx.runQuery(internal.internal.getMembershipByUser, {
      userId,
    });
    if (!membership) throw new Error("You don't belong to a workspace yet.");
    const tenantId = membership.tenantId;
    const member = await ctx.runQuery(internal.internal.getMembershipByUserTenant, {
      userId,
      tenantId,
    });
    if (!member || !(EDITOR_ROLES as readonly string[]).includes(member.role)) {
      throw new Error("Viewers can read the knowledge base but not upload files.");
    }

    const docId = await ctx.runMutation(internal.internal.createDoc, {
      tenantId,
      userId,
      title: args.title,
      mimeType: args.mimeType,
      size: args.size,
      sourceType: args.sourceType ?? "upload",
      storageId: args.storageId,
    });

    await ctx.runMutation(internal.internal.createJob, {
      tenantId,
      documentId: docId,
      jobType: "document_processing",
    });

    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: "document_uploaded",
      targetType: "document",
      targetId: docId,
      metadata: { title: args.title },
    });

    try {
      const stored = await ctx.storage.get(args.storageId);
      if (!stored) {
        throw new Error("Uploaded file is missing from storage.");
      }
      const bytes = await toArrayBuffer(stored);

      const { text, mimeType } = await parseFile(
        args.mimeType,
        args.title,
        bytes,
      );
      if (!text.trim()) {
        throw new Error("No readable text found in this file.");
      }

      const result = await ingestText(ctx, tenantId, {
        title: args.title,
        mimeType,
        size: args.size,
        sourceType: args.sourceType ?? "upload",
        text,
        existingDocId: docId,
      });

      await ctx.runMutation(internal.internal.logAudit, {
        tenantId,
        actorType: "system",
        actionType: "document_processed",
        targetType: "document",
        targetId: docId,
        metadata: {
          title: args.title,
          classification: result.classification,
          chunks: result.chunks,
          entities: result.entities,
          mode: aiAvailable() ? "ai" : "local",
        },
      });

      return {
        docId,
        classification: result.classification,
        chunks: result.chunks,
        entities: result.entities,
        mode: aiAvailable() ? "ai" : "local",
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await ctx.runMutation(internal.internal.patchDoc, {
        id: docId,
        patch: { status: "failed", error: message },
      });
      await ctx.runMutation(internal.internal.logAudit, {
        tenantId,
        actorType: "system",
        actionType: "document_failed",
        targetType: "document",
        targetId: docId,
        metadata: { title: args.title, error: message },
      });
      throw new Error(message);
    }
  },
});

/** Re-process an existing document record (retry path). */
export const reprocessDocument = action({
  args: { documentId: v.id("documents") },
  handler: async (
    ctx,
    { documentId },
  ): Promise<{ docId: Id<"documents">; classification: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("You must be signed in.");
    const membership = await ctx.runQuery(internal.internal.getMembershipByUser, {
      userId,
    });
    if (!membership) throw new Error("No workspace.");
    const tenantId = membership.tenantId;
    const member = await ctx.runQuery(internal.internal.getMembershipByUserTenant, {
      userId,
      tenantId,
    });
    if (!member || !(EDITOR_ROLES as readonly string[]).includes(member.role)) {
      throw new Error("Viewers can read the knowledge base but not upload files.");
    }
    const doc = await ctx.runQuery(internal.internal.getDocById, {
      documentId,
    });
    if (!doc) throw new Error("Document not found.");
    if (doc.tenantId !== tenantId) {
      throw new Error("Not your document.");
    }
    if (doc.sourceType === "drive") {
      throw new Error(
        "Drive-synced documents refresh from Google Drive — use Sync on the connection instead.",
      );
    }
    await ctx.runMutation(internal.internal.deleteChunksByDoc, { documentId });
    await ctx.runMutation(internal.internal.patchDoc, {
      id: documentId,
      patch: { status: "processing", error: undefined },
    });
    await ctx.runMutation(internal.internal.createJob, {
      tenantId,
      documentId,
      jobType: "document_reprocess",
    });
    const stored = await ctx.storage.get(doc.storageId!);
    if (!stored) throw new Error("Original file no longer available.");
    const bytes = await toArrayBuffer(stored);
    const { text } = await parseFile(doc.mimeType, doc.title, bytes);
    if (!text.trim()) throw new Error("No readable text found in this file.");
    const result = await ingestText(ctx, tenantId, {
      title: doc.title,
      mimeType: doc.mimeType ?? "text/plain",
      size: doc.size,
      sourceType: doc.sourceType,
      text,
      existingDocId: documentId,
    });
    return { docId: documentId, classification: result.classification };
  },
});
