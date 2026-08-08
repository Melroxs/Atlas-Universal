"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { aiAvailable, chat, embedTexts } from "./ai/provider";
import { cosine, keywordScore, localEmbed } from "./ai/localEmbed";
import { truncate } from "./lib/text";

const MAX_EVIDENCE = 8;

interface ChunkHit {
  _id: string;
  documentId: string;
  content: string;
  score: number;
}

export const askAtlas = action({
  args: { question: v.string() },
  handler: async (ctx, { question }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("You must be signed in.");
    const membership = await ctx.runQuery(internal.internal.getMembershipByUser, {
      userId,
    });
    if (!membership) throw new Error("You don't belong to a workspace yet.");
    const tenantId = membership.tenantId;

    const q = question.trim();
    if (!q) throw new Error("Ask a question first.");

    // ------------------------------------------------------------------
    // 1. Retrieve relevant evidence
    // ------------------------------------------------------------------

    // Keyword pass via the full-text index.
    const kwHits = await ctx.runQuery(internal.internal.searchChunksByTenant, {
      tenantId,
      query: q.slice(0, 60),
      limit: 12,
    });

    // Semantic pass: cosine over recent chunks.
    const recent = await ctx.runQuery(internal.internal.listChunksByTenant, {
      tenantId,
      limit: 300,
    });
    let qEmbed: number[] | null = null;
    if (aiAvailable()) {
      const embs = await embedTexts([q]);
      qEmbed = embs?.[0] ?? null;
    }
    const qVec = qEmbed ?? localEmbed(q);

    const byId = new Map<string, ChunkHit>();
    for (const hit of kwHits) {
      const score = 1 + keywordScore(q, hit.content);
      byId.set(hit._id, {
        _id: hit._id,
        documentId: hit.documentId,
        content: hit.content,
        score,
      });
    }
    for (const chunk of recent) {
      const cos = chunk.embedding ? cosine(qVec, chunk.embedding) : 0;
      if (cos < 0.06) continue;
      const kw = keywordScore(q, chunk.content);
      const score = cos * 2.2 + kw * 0.6;
      const existing = byId.get(chunk._id);
      if (!existing || score > existing.score) {
        byId.set(chunk._id, {
          _id: chunk._id,
          documentId: chunk.documentId,
          content: chunk.content,
          score,
        });
      }
    }
    const chunkHits = [...byId.values()].sort((a, b) => b.score - a.score);

    // Entity pass: entities whose names/aliases overlap question tokens.
    const entities = await ctx.runQuery(internal.internal.listEntitiesByTenant, {
      tenantId,
    });
    const qTokens = q
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2);
    const entityHits = entities
      .map((e) => {
        const name = e.name.toLowerCase();
        const hitTokens = qTokens.filter((t) => name.includes(t)).length;
        return { e, hitTokens };
      })
      .filter((x) => x.hitTokens > 0)
      .sort((a, b) => b.hitTokens - a.hitTokens)
      .slice(0, 4)
      .map((x) => x.e);

    // Intelligence pass: pack items matching the question.
    const packs = await ctx.runQuery(internal.internal.listTenantPacks, {
      tenantId,
    });
    const activeKeys = new Set(
      packs.filter((p) => p.status === "active").map((p) => p.packKey),
    );
    const packItems: Array<{
      _id: string;
      packKey: string;
      title: string;
      summary?: string;
      content: unknown;
    }> = [];
    for (const key of activeKeys) {
      const items = await ctx.runQuery(internal.internal.listPackItems, {
        packKey: key,
      });
      packItems.push(...items);
    }
    const intelHits = packItems
      .map((item) => {
        const hay = `${item.title} ${item.summary ?? ""} ${JSON.stringify(item.content)}`.toLowerCase();
        const hitTokens = qTokens.filter((t) => hay.includes(t)).length;
        return { item, hitTokens };
      })
      .filter((x) => x.hitTokens > 0)
      .sort((a, b) => b.hitTokens - a.hitTokens)
      .slice(0, 3)
      .map((x) => x.item);

    // ------------------------------------------------------------------
    // 2. Assemble evidence list
    // ------------------------------------------------------------------
    interface Evidence {
      kind: string;
      documentId?: string;
      chunkId?: string;
      entityId?: string;
      title: string;
      snippet: string;
      relevance: number;
    }
    const evidence: Evidence[] = [];
    const docCache = new Map<string, string>();
    for (const hit of chunkHits.slice(0, MAX_EVIDENCE)) {
      let docTitle = docCache.get(String(hit.documentId));
      if (!docTitle) {
        const doc = await ctx.runQuery(internal.internal.getDocById, {
          documentId: hit.documentId as never,
        });
        docTitle = doc?.title ?? "Document";
        docCache.set(String(hit.documentId), docTitle);
      }
      evidence.push({
        kind: "chunk",
        documentId: String(hit.documentId),
        chunkId: String(hit._id),
        title: docTitle,
        snippet: truncate(hit.content, 320),
        relevance: hit.score,
      });
    }
    for (const e of entityHits) {
      evidence.push({
        kind: "entity",
        entityId: String(e._id),
        title: e.name,
        snippet: `${e.entityTypeKey.replace(/_/g, " ")} · confidence ${Math.round(e.confidence * 100)}%`,
        relevance: 0.7,
      });
    }
    for (const item of intelHits) {
      const contentStr =
        typeof item.content === "string"
          ? item.content
          : JSON.stringify(item.content).slice(0, 200);
      evidence.push({
        kind: "intelligence",
        title: item.title,
        snippet: `${item.summary ?? ""} ${contentStr}`.slice(0, 240),
        relevance: 0.75,
      });
    }

    // ------------------------------------------------------------------
    // 3. Reason over evidence
    // ------------------------------------------------------------------
    const chunkCount = chunkHits.length;
    let answer: string;
    let classification: "FACT" | "RULE" | "OBSERVATION" | "INFERENCE" | "RECOMMENDATION" = "INFERENCE";
    let confidence = 0;
    let limitations: string | undefined;
    let mode: "ai" | "local" = "local";
    let suggestedActions: string[] = [];

    if (evidence.length === 0) {
      answer =
        "I don't have enough coverage in your knowledge base to answer that yet. " +
        "Your knowledge graph currently contains no documents or entities matching this question. " +
        "Upload relevant documents (SOPs, invoices, estimates, spreadsheets) and I'll be able to ground an answer in evidence.";
      classification = "FACT";
      confidence = 0.1;
      limitations =
        "No matching evidence found in the workspace knowledge base.";
      suggestedActions = ["Upload documents", "Connect a file source"];
    } else if (aiAvailable()) {
      const grounded = await aiAnswer(q, evidence);
      if (grounded) {
        answer = grounded.answer;
        classification = grounded.classification;
        confidence = grounded.confidence;
        mode = "ai";
        limitations = grounded.limitations;
        suggestedActions = grounded.actions;
      } else {
        answer = composeLocalAnswer(q, evidence, chunkCount);
        confidence = 0.5;
        limitations =
          "AI reasoning was unavailable, so this answer is assembled from matched passages.";
      }
    } else {
      answer = composeLocalAnswer(q, evidence, chunkCount);
      confidence = 0.5;
      limitations =
        "AI reasoning is not configured for this workspace — this answer is assembled from matched passages.";
      suggestedActions = ["Ask another question"];
    }

    // ------------------------------------------------------------------
    // 4. Persist + audit
    // ------------------------------------------------------------------
    const sessionId = await ctx.runMutation(internal.internal.insertAskSession, {
      tenantId,
      userId,
      question: q,
      answer,
      classification,
      confidence,
      mode,
      suggestedActions,
      limitations,
    });
    for (const ev of evidence) {
      await ctx.runMutation(internal.internal.insertAskEvidence, {
        sessionId,
        kind: ev.kind,
        documentId: ev.documentId as never,
        chunkId: ev.chunkId as never,
        entityId: ev.entityId as never,
        documentTitle: ev.kind === "chunk" ? ev.title : undefined,
        title: ev.title,
        snippet: ev.snippet,
        relevance: ev.relevance,
      });
    }
    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: "ask_requested",
      targetType: "ask_session",
      targetId: sessionId,
      metadata: { question: q, evidence: evidence.length, mode },
    });

    return {
      sessionId,
      answer,
      classification,
      confidence,
      mode,
      limitations,
      suggestedActions,
      evidence: evidence.map((e) => ({
        ...e,
        documentTitle: e.kind === "chunk" ? e.title : undefined,
      })),
    };
  },
});

// ---------------------------------------------------------------------------

function composeLocalAnswer(
  q: string,
  evidence: Array<{
    kind: string;
    title: string;
    snippet: string;
  }>,
  chunkCount: number,
): string {
  const top = evidence
    .filter((e) => e.kind === "chunk")
    .slice(0, 3);
  if (top.length === 0) {
    return `I found related knowledge but no document passages matching “${q}”. Your knowledge graph includes ${evidence.length} related item${evidence.length === 1 ? "" : "s"}.`;
  }
  const lines = top.map((e, i) => {
    const clean = e.snippet.replace(/\s+/g, " ").trim();
    return `${i + 1}. “${clean}” — ${e.title} [${i + 1}]`;
  });
  return `I found ${chunkCount} relevant passage${chunkCount === 1 ? "" : "s"} across your knowledge base. The strongest matches are:\n\n${lines.join(
    "\n\n",
  )}\n\nThis is assembled from matched passages and has not been confirmed by a person — treat it as an inference to verify against the cited sources.`;
}

async function aiAnswer(
  q: string,
  evidence: Array<{
    kind: string;
    title: string;
    snippet: string;
    relevance: number;
  }>,
): Promise<{
  answer: string;
  classification: "FACT" | "RULE" | "OBSERVATION" | "INFERENCE" | "RECOMMENDATION";
  confidence: number;
  limitations?: string;
  actions: string[];
} | null> {
  const evidenceBlock = evidence
    .map(
      (e, i) =>
        `[${i + 1}] (${e.kind}) ${e.title}: ${truncate(e.snippet, 400)}`,
    )
    .join("\n");

  const system = `You are Atlas, the intelligence layer for a business's operations. You answer questions about the company using ONLY the provided evidence — never invent facts, figures, citations, or regulations.
Rules:
- Ground every statement in the evidence. Cite sources inline as [1], [2], etc.
- If the evidence doesn't answer the question, say so clearly instead of guessing.
- Label uncertainty. Never present an inference as a fact.
- Classify the output as one of: FACT (directly supported by evidence), RULE (authoritative rule/policy), OBSERVATION (observed pattern), INFERENCE (derived conclusion), RECOMMENDATION (suggested action).
- Keep the answer concise and operational (the user is an operations manager).
- Respond with ONLY JSON, no markdown fences: {"answer": string, "classification": string, "confidence": number 0-1, "limitations": string|null, "actions": string[]}`;

  const user = `Question: ${q}\n\nEvidence:\n${evidenceBlock}`;

  try {
    const raw = await chat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { temperature: 0.2, maxTokens: 900 },
    );
    if (!raw) return null;
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(raw.slice(start, end + 1));
    const classifications = ["FACT", "RULE", "OBSERVATION", "INFERENCE", "RECOMMENDATION"];
    const classification = classifications.includes(parsed.classification)
      ? parsed.classification
      : "INFERENCE";
    return {
      answer: String(parsed.answer ?? ""),
      classification,
      confidence: Math.min(Math.max(Number(parsed.confidence) || 0.5, 0), 0.99),
      limitations: parsed.limitations ? String(parsed.limitations) : undefined,
      actions: Array.isArray(parsed.actions)
        ? parsed.actions.map((a: unknown) => String(a)).slice(0, 4)
        : [],
    };
  } catch {
    return null;
  }
}
