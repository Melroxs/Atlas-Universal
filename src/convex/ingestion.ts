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
  normalizeEntityName,
} from "./ai/heuristics";
import { localEmbed } from "./ai/localEmbed";
import { parseFile } from "./lib/parsers";
import { chunkText, summarize, truncate } from "./lib/text";

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

async function upsertEntities(
  ctx: ActionCtx,
  tenantId: Id<"tenants">,
  candidates: Array<{ name: string; type: string; confidence: number }>,
  documentId: Id<"documents">,
): Promise<EntityRec[]> {
  const existing = await ctx.runQuery(internal.internal.listEntitiesByTenant, {
    tenantId,
  });
  const byKey = new Map<string, string>();
  for (const e of existing) {
    byKey.set(
      `${e.entityTypeKey}:${normalizeEntityName(e.name).toLowerCase()}`,
      e._id,
    );
  }

  const out: EntityRec[] = [];
  const now = Date.now();
  for (const c of candidates) {
    const name = normalizeEntityName(c.name);
    if (!name) continue;
    const key = `${c.type}:${name.toLowerCase()}`;
    const existingId = byKey.get(key);
    if (existingId) {
      await ctx.runMutation(internal.internal.patchEntity, {
        id: existingId as Id<"entities">,
        patch: { lastObservedAt: now, sourceDocumentId: documentId },
      });
      out.push({
        entityId: existingId as Id<"entities">,
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
        attributes: { source: "document_extraction" },
      });
      byKey.set(key, id);
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
  const prompt = `Extract key business entities from the following company document. Use ONLY these types: claim, carrier, adjuster, policyholder, property, inspection, estimate, supplement, person, organization, system, product, location, document, project, financial.
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

export const processDocument = action({
  args: {
    storageId: v.id("_storage"),
    title: v.string(),
    mimeType: v.string(),
    size: v.number(),
    sourceType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("You must be signed in.");

    const membership = await ctx.runQuery(internal.internal.getMembershipByUser, {
      userId,
    });
    if (!membership) throw new Error("You don't belong to a workspace yet.");
    const tenantId = membership.tenantId;

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

      // 1. Classify
      let classification = classifyDocument(args.title, text);
      if (aiAvailable()) {
        const aiClass = await aiClassify(args.title, truncate(text, 3000));
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

      // 4. Extract entities (AI upgrade when available)
      const heuristic = extractCandidates(text);
      const aiEntities = await aiExtractEntities(text);
      const candidates = aiEntities && aiEntities.length > 0 ? aiEntities : heuristic;

      const entities = await upsertEntities(ctx, tenantId, candidates, docId);

      // 5. Insert chunks (with chunk-entity co-occurrence relationships)
      for (let i = 0; i < chunks.length; i++) {
        await ctx.runMutation(internal.internal.insertChunk, {
          tenantId,
          documentId: docId,
          chunkIndex: i,
          content: chunks[i],
          embedding: embeddings[i],
        });
      }

      // 6. Knowledge assertions from the text
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
          statement: `Financial figure ${a} is referenced in “${args.title}”.`,
          confidence: 0.6,
          evidence: truncate(text, 400),
        });
      }
      if (dates.length > 0) {
        assertions.push({
          classification: "FACT",
          statement: `Dates referenced in “${args.title}”: ${dates.slice(0, 3).join(", ")}.`,
          confidence: 0.7,
          evidence: truncate(text, 400),
        });
      }
      if (entities.length > 0) {
        assertions.push({
          classification: "OBSERVATION",
          statement: `${entities.length} entities were extracted from “${args.title}” (${entities.slice(0, 5).map((e) => e.name).join(", ")}${entities.length > 5 ? ", …" : ""}).`,
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
          sourceDocumentId: docId,
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
              sourceDocumentId: docId,
              evidence: truncate(text, 200),
            });
            edges++;
          }
        }
      }

      // 8. Mark ready
      await ctx.runMutation(internal.internal.patchDoc, {
        id: docId,
        patch: {
          status: "ready",
          classification,
          summary: summarize(text),
          chunkCount: chunks.length,
          entityCount: entities.length,
          processedAt: Date.now(),
        },
      });

      await ctx.runMutation(internal.internal.logAudit, {
        tenantId,
        actorType: "system",
        actionType: "document_processed",
        targetType: "document",
        targetId: docId,
        metadata: {
          title: args.title,
          classification,
          chunks: chunks.length,
          entities: entities.length,
          mode: aiAvailable() ? "ai" : "local",
        },
      });

      return {
        docId,
        classification,
        chunks: chunks.length,
        entities: entities.length,
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
  const prompt = `Classify this business document into exactly one category: ${valid.join(", ")}.
Title: ${title}
Excerpt: ${excerpt}
Reply with only the category name.`;
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

/** Re-process an existing document record (retry path). */
export const reprocessDocument = action({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("You must be signed in.");
    const membership = await ctx.runQuery(internal.internal.getMembershipByUser, {
      userId,
    });
    if (!membership) throw new Error("No workspace.");
    const doc = await ctx.runQuery(internal.internal.getDocById, {
      documentId,
    });
    if (!doc) throw new Error("Document not found.");
    if (doc.tenantId !== membership.tenantId) {
      throw new Error("Not your document.");
    }
    await ctx.runMutation(internal.internal.deleteChunksByDoc, { documentId });
    await ctx.runMutation(internal.internal.patchDoc, {
      id: documentId,
      patch: { status: "processing", error: undefined },
    });
    await ctx.runMutation(internal.internal.createJob, {
      tenantId: membership.tenantId,
      documentId,
      jobType: "document_reprocess",
    });
    const stored = await ctx.storage.get(doc.storageId!);
    if (!stored) throw new Error("Original file no longer available.");
    const bytes = await toArrayBuffer(stored);
    const { text } = await parseFile(doc.mimeType, doc.title, bytes);
    if (!text.trim()) throw new Error("No readable text found in this file.");
    const classification = classifyDocument(doc.title, text);
    const chunks = chunkText(text);
    const embeddings = chunks.map(localEmbed);
    for (let i = 0; i < chunks.length; i++) {
      await ctx.runMutation(internal.internal.insertChunk, {
        tenantId: membership.tenantId,
        documentId,
        chunkIndex: i,
        content: chunks[i],
        embedding: embeddings[i],
      });
    }
    await ctx.runMutation(internal.internal.patchDoc, {
      id: documentId,
      patch: {
        status: "ready",
        classification,
        summary: summarize(text),
        chunkCount: chunks.length,
        processedAt: Date.now(),
      },
    });
    return { docId: documentId, classification };
  },
});
