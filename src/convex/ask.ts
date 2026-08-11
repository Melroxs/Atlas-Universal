"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";
import { aiAvailable, chat, embedTexts } from "./ai/provider";
import { cosine, keywordScore, localEmbed } from "./ai/localEmbed";
import { truncate } from "./lib/text";
import { classifyQuestion, questionTypeBadge, type QuestionType } from "./everest/questions";
import { freshnessState } from "./everest/ingest";
import { tierLabel } from "./everest/authority";

const MAX_EVIDENCE = 8;

interface ChunkHit {
  _id: string;
  documentId: string;
  content: string;
  score: number;
}

export const askAtlas = action({
  args: { question: v.string() },
  handler: async (ctx, { question }): Promise<{
    sessionId: Id<"askSessions">;
    answer: string;
    classification: "FACT" | "RULE" | "OBSERVATION" | "INFERENCE" | "RECOMMENDATION";
    confidence: number;
    mode: "ai" | "local";
    limitations?: string;
    suggestedActions: string[];
    /** §27 — the layer of knowledge this question was answered from. */
    questionType: QuestionType;
    questionTypeLabel: string;
    /** §28 — structured authority answers for regulatory/mixed questions. */
    authorityAnswers: Array<{
      source: string;
      organization: string;
      authorityTier: string;
      tierLabel: string;
      sourceType: string;
      jurisdiction?: string;
      publicationDate?: number;
      effectiveDate?: number;
      version?: string;
      sourceFact: string;
      atlasInterpretation?: string;
      confidence: number;
      freshness: string;
      sourceUrl?: string;
    }>;
    evidence: Array<{
      kind: string;
      documentId?: string;
      chunkId?: string;
      entityId?: string;
      title: string;
      snippet: string;
      relevance: number;
      documentTitle?: string;
      evidenceType?: string;
    }>;
    /** Structured tool-use proposal (planner) — never auto-executed. */
    toolPlan?: {
      status: string;
      toolId?: string;
      toolName?: string;
      arguments?: Record<string, unknown>;
      confidence?: number;
      expectedOutcome?: string;
      verificationPlan?: string;
      reason?: string;
    } | null;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("You must be signed in.");
    const membership = await ctx.runQuery(internal.internal.getMembershipByUser, {
      userId,
    });
    if (!membership) throw new Error("You don't belong to a workspace yet.");
    const tenantId = membership.tenantId;

    const q = question.trim();
    if (!q) throw new Error("Ask a question first.");

    // §27 — classify the question so Atlas answers from the right layer.
    const questionClassification = classifyQuestion(q);
    const questionType = questionClassification.type;
    const wantsAuthority =
      questionType === "regulatory" || questionType === "mixed";

    // §28 — authoritative knowledge matching the question (regulatory/mixed).
    const authorityAnswers: Array<{
      source: string;
      organization: string;
      authorityTier: string;
      tierLabel: string;
      sourceType: string;
      jurisdiction?: string;
      publicationDate?: number;
      effectiveDate?: number;
      version?: string;
      sourceFact: string;
      atlasInterpretation?: string;
      confidence: number;
      freshness: string;
      sourceUrl?: string;
    }> = [];
    let authorityEvidence: Evidence[] = [];
    if (wantsAuthority) {
      const [allKnowledge, allSources] = await Promise.all([
        ctx.runQuery(internal.internal.listActiveAuthorityKnowledge, {}),
        ctx.runQuery(internal.internal.listAuthoritativeSources, {}),
      ]);
      const sourceById = new Map(allSources.map((s) => [s.sourceId, s]));
      const tokens = q
        .toLowerCase()
        .split(/\W+/)
        .filter((t) => t.length > 3);
      const hay = (k: { title: string; statement: string; industry?: string }) =>
        `${k.title} ${k.statement} ${k.industry ?? ""}`.toLowerCase();
      const hits = allKnowledge
        .map((k) => ({
          k,
          score: tokens.filter((t) => hay(k).includes(t)).length,
        }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4)
        .map((x) => x.k);
      const now = Date.now();
      for (const k of hits) {
        const src = sourceById.get(k.sourceId);
        authorityAnswers.push({
          source: src?.name ?? k.sourceId,
          organization: src?.organization ?? "",
          authorityTier: src?.authorityTier ?? "tier5_general",
          tierLabel: src ? tierLabel(src.authorityTier) : tierLabel("tier5_general"),
          sourceType: src?.sourceType ?? "source",
          jurisdiction: k.jurisdiction,
          publicationDate: k.publicationDate,
          effectiveDate: k.effectiveDate,
          version: k.version,
          sourceFact: k.statement,
          atlasInterpretation: k.interpretation,
          confidence: k.confidence,
          freshness: freshnessState(k.lastCheckedAt, src?.updateFrequency, now, k.status),
          sourceUrl: src?.canonicalUrl,
        });
      }
      authorityEvidence = authorityAnswers.map((a, i) => ({
        kind: "authority",
        title: a.source,
        snippet: `${a.sourceFact}${a.atlasInterpretation ? ` — Atlas interpretation: ${a.atlasInterpretation}` : ""}`.slice(0, 320),
        relevance: 0.9 - i * 0.05,
        evidenceType: "RULE",
      }));
    }

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
    // 1b. Archive context — imported company data (Phase 13)
    // ------------------------------------------------------------------
    const mentionsCompanyData = /(archive|zip|rar|company (data|files)|uploaded|import|company files|data package|what did (you|atlas) find|what\'?s in (the|that)|extracted|ingest)/i.test(
      q,
    );
    let archives: Array<{
      _id: string;
      filename: string;
      status: string;
      checksum: string;
      stats?: Record<string, unknown> | null;
      warnings?: string[];
    }> = [];
    let archiveSummaryText: string | null = null;
    if (mentionsCompanyData) {
      archives = (await ctx.runQuery(internal.archive.internal.listArchivesByTenant, {
        tenantId,
        limit: 10,
      })) as typeof archives;
      if (archives.length > 0) {
        archiveSummaryText = buildArchiveSummaryText(archives);
      }
    }

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
      evidenceType: string;
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
        evidenceType: hit.score >= 0.5 ? "FACT" : "INFERENCE",
      });
    }
    for (const e of entityHits) {
      evidence.push({
        kind: "entity",
        entityId: String(e._id),
        title: e.name,
        snippet: `${e.entityTypeKey.replace(/_/g, " ")} · confidence ${Math.round(e.confidence * 100)}%`,
        relevance: 0.7,
        evidenceType: "OBSERVATION",
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
        evidenceType: "RULE",
      });
    }
    for (const a of archives) {
      const st = a.stats ?? {};
      const snippet =
        a.status === "completed" || a.status === "completed_with_warnings"
          ? `${st.ingested ?? 0} files ingested${(st.potentialClaims as unknown[])?.length ? ` · ${(st.potentialClaims as unknown[]).length} potential claim${(st.potentialClaims as unknown[]).length === 1 ? "" : "s"}` : ""} · checksum ${String(a.checksum).slice(0, 10)}…`
          : `Status: ${a.status}${a.warnings?.length ? ` · ${a.warnings.length} warning${a.warnings.length === 1 ? "" : "s"}` : ""}`;
      evidence.push({
        kind: "archive",
        title: `Imported archive — ${a.filename}`,
        snippet,
        relevance: 0.7,
        evidenceType: "OBSERVATION",
      });
    }
    // Authority evidence sits alongside org evidence for mixed questions.
    if (authorityEvidence.length > 0) {
      evidence.push(...authorityEvidence);
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

    // Direct, deterministic answers about imported company data: real records
    // only — never fabricated metrics. AI can still enrich the same evidence.
    const asksAboutFindings = /(what did (you|atlas) (find|see|learn)|what\'?s (in|inside) (the|that)|what.*(company|archive|zip|upload)|show me (what|the|where)|summar\w+ (the )?(import|archive|upload|company))/i.test(
      q,
    );
    if (asksAboutFindings && archiveSummaryText) {
      answer = archiveSummaryText;
      classification = "OBSERVATION";
      confidence = 0.85;
      limitations =
        "This summary is derived from the actual archive processing records in this workspace.";
      suggestedActions = ["Open the Knowledge base", "Review archive inventory"];
      mode = "local";
    } else if (evidence.length === 0) {
      answer =
        "I don't have enough coverage in your knowledge base to answer that yet. " +
        "Your knowledge graph currently contains no documents or entities matching this question. " +
        "Upload relevant documents (SOPs, invoices, estimates, spreadsheets) and I'll be able to ground an answer in evidence.";
      classification = "INFERENCE";
      confidence = 0.1;
      limitations =
        "No matching evidence found in the workspace knowledge base — this is an UNKNOWN until sources are added.";
      suggestedActions = ["Upload documents", "Connect a file source"];
    } else if (aiAvailable()) {
      const grounded = await aiAnswer(q, evidence, {
        questionType,
        authorityAnswers: authorityAnswers.slice(0, 3),
      });
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
    // 3b. Tool routing (best-effort): can a registered tool do this?
    // ------------------------------------------------------------------
    let toolPlan:
      | {
          status: string;
          toolId?: string;
          toolName?: string;
          arguments?: Record<string, unknown>;
          confidence?: number;
          expectedOutcome?: string;
          verificationPlan?: string;
          reason?: string;
        }
      | undefined;
    if (aiAvailable()) {
      try {
        const plan = (await ctx.runAction(internal.tools.planner.planToolUse, {
          tenantId,
          userId,
          request: q,
          contextEvidence: evidence.slice(0, 6).map((e) =>
            `${e.title}: ${e.snippet}`.slice(0, 200),
          ),
        })) as
          | {
              status: string;
              toolId?: string;
              toolName?: string;
              arguments?: Record<string, unknown>;
              confidence?: number;
              expectedOutcome?: string;
              verificationPlan?: string;
              reason?: string;
            }
          | null
          | undefined;
        if (plan && plan.status === "ready") {
          toolPlan = plan;
        }
      } catch {
        // Tool routing is best-effort and never fails the answer itself.
      }
    }

    // ------------------------------------------------------------------
    // 4. Persist + audit
    // ------------------------------------------------------------------
    // §27/§28 — prepend the layer label so the distinction is explicit.
    if (questionType !== "general") {
      answer = `${questionTypeBadge(questionType)}. ${answer}`;
    }

    const sessionId = await ctx.runMutation(internal.internal.insertAskSession, {
      tenantId,
      userId,
      question: q,
      answer,
      classification,
      confidence,
      mode,
      suggestedActions,
      toolPlan: toolPlan ?? undefined,
      limitations,
      questionType,
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
        evidenceType: ev.evidenceType,
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
      questionType,
      questionTypeLabel: questionClassification.label,
      authorityAnswers,
      toolPlan: toolPlan ?? null,
      evidence: evidence.map((e) => ({
        ...e,
        documentTitle: e.kind === "chunk" ? e.title : undefined,
      })),
    };
  },
});

// ---------------------------------------------------------------------------

/** Build a REAL ingestion summary from processed archive records (Phase 13). */
function buildArchiveSummaryText(
  archives: Array<{
    filename: string;
    status: string;
    stats?: Record<string, unknown> | null;
    warnings?: string[];
  }>,
): string | null {
  const finished = archives.filter((a) =>
    ["completed", "completed_with_warnings", "failed"].includes(a.status),
  );
  if (finished.length === 0) {
    const active = archives[0];
    if (!active) return null;
    return `You've uploaded “${active.filename}”, which is still ${active.status}. I'll report the full summary here as soon as processing finishes.`;
  }

  const parts: string[] = [];
  let totalFiles = 0;
  let totalIngested = 0;
  let totalDuplicates = 0;
  let totalUnsupported = 0;
  let totalBlocked = 0;
  let totalFailed = 0;
  let totalClaims = 0;
  let totalCustomers = 0;
  let totalProjects = 0;
  let totalPolicies = 0;
  let totalEstimates = 0;
  let totalInvoices = 0;
  const warnings: string[] = [];

  for (const a of finished) {
    const st = a.stats ?? {};
    totalFiles += typeof st.totalFiles === "number" ? st.totalFiles : 0;
    totalIngested += typeof st.ingested === "number" ? st.ingested : 0;
    totalDuplicates += typeof st.duplicates === "number" ? st.duplicates : 0;
    totalUnsupported += typeof st.unsupported === "number" ? st.unsupported : 0;
    totalBlocked += typeof st.blocked === "number" ? st.blocked : 0;
    totalFailed += typeof st.failed === "number" ? st.failed : 0;
    totalClaims += Array.isArray(st.potentialClaims) ? st.potentialClaims.length : 0;
    totalCustomers += typeof st.customers === "number" ? st.customers : 0;
    totalProjects += typeof st.projects === "number" ? st.projects : 0;
    totalPolicies += typeof st.policies === "number" ? st.policies : 0;
    totalEstimates += typeof st.estimates === "number" ? st.estimates : 0;
    totalInvoices += typeof st.invoices === "number" ? st.invoices : 0;
    warnings.push(...(a.warnings ?? []));
  }

  parts.push(
    `I processed ${totalFiles.toLocaleString()} files across ${finished.length} imported archive${finished.length === 1 ? "" : "s"}: ${totalIngested.toLocaleString()} were ingested into the knowledge base.`,
  );
  const extras: string[] = [];
  if (totalCustomers > 0) extras.push(`${totalCustomers} customer${totalCustomers === 1 ? "" : "s"}`);
  if (totalProjects > 0) extras.push(`${totalProjects} active project${totalProjects === 1 ? "" : "s"}`);
  if (totalVendors(archives) > 0) extras.push(`${totalVendors(archives)} vendor${totalVendors(archives) === 1 ? "" : "s"}`);
  if (totalPolicies > 0) extras.push(`${totalPolicies} polic${totalPolicies === 1 ? "y" : "ies"}/procedures`);
  if (totalEstimates > 0) extras.push(`${totalEstimates} estimate${totalEstimates === 1 ? "" : "s"}`);
  if (totalInvoices > 0) extras.push(`${totalInvoices} invoice${totalInvoices === 1 ? "" : "s"}`);
  if (extras.length > 0) {
    parts.push(`Atlas found ${extras.join(", ")} in the imported data.`);
  }
  if (totalClaims > 0) {
    parts.push(
      `I identified ${totalClaims} potential claim${totalClaims === 1 ? "" : "s"} from document identifiers and folder context — Atlas has not created any claim records yet; those need your confirmation.`,
    );
  }
  const issues: string[] = [];
  if (totalDuplicates > 0) issues.push(`${totalDuplicates} exact duplicate${totalDuplicates === 1 ? "" : "s"} (ingested once)`);
  if (totalUnsupported > 0) issues.push(`${totalUnsupported} file${totalUnsupported === 1 ? "" : "s"} in unsupported formats`);
  if (totalBlocked > 0) issues.push(`${totalBlocked} file${totalBlocked === 1 ? "" : "s"} blocked for security`);
  if (totalFailed > 0) issues.push(`${totalFailed} file${totalFailed === 1 ? "" : "s"} that failed to process`);
  if (issues.length > 0) {
    parts.push(`Heads up: ${issues.join(", ")}.`);
  }
  if (warnings.length > 0 && parts.length < 4) {
    parts.push(warnings[0]);
  }
  parts.push("Ask me about any of it — I'll show you the source for every answer.");
  return parts.join(" ");
}

/** Vendor count helper for buildArchiveSummaryText (stats may be absent). */
function totalVendors(
  archives: Array<{ stats?: Record<string, unknown> | null }>,
): number {
  return archives.reduce((sum, a) => {
    const st = a.stats ?? {};
    return sum + (typeof st.vendors === "number" ? st.vendors : 0);
  }, 0);
}

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
  context: {
    questionType: QuestionType;
    authorityAnswers: Array<{
      source: string;
      organization: string;
      authorityTier: string;
      tierLabel: string;
      sourceType: string;
      jurisdiction?: string;
      publicationDate?: number;
      effectiveDate?: number;
      version?: string;
      sourceFact: string;
      atlasInterpretation?: string;
      confidence: number;
      freshness: string;
      sourceUrl?: string;
    }>;
  },
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

  const authorityBlock =
    context.authorityAnswers.length > 0
      ? `\n\nAuthoritative sources matched (regulatory/standards question):\n` +
        context.authorityAnswers
          .map(
            (a, i) =>
              `[A${i + 1}] ${a.source} (${a.tierLabel}, ${a.sourceType})${a.jurisdiction ? ` · ${a.jurisdiction}` : ""}${a.version ? ` · version ${a.version}` : ""}${a.effectiveDate ? ` · effective ${new Date(a.effectiveDate).toISOString().slice(0, 10)}` : ""}${a.publicationDate ? ` · published ${new Date(a.publicationDate).toISOString().slice(0, 10)}` : ""}\nSource states: ${a.sourceFact}\nAtlas interpretation: ${a.atlasInterpretation ?? "none"}\nFreshness: ${a.freshness}`,
          )
          .join("\n")
      : "";

  const system = `You are Atlas, the intelligence layer for a business's operations. You answer questions about the company using ONLY the provided evidence — never invent facts, figures, citations, or regulations.
Rules:
- Ground every statement in the evidence. Cite sources inline as [1], [2], etc.
- If the evidence doesn't answer the question, say so clearly instead of guessing.
- Label uncertainty. Never present an inference as a fact.
- Classify the output as one of: FACT (directly supported by evidence), RULE (authoritative rule/policy), OBSERVATION (observed pattern), INFERENCE (derived conclusion), RECOMMENDATION (suggested action).
- Keep the answer concise and operational (the user is an operations manager).
- Question layer: ${context.questionType}. For REGULATORY or MIXED questions, base the answer on the authoritative sources block, quote the SOURCE FACT as the source states it, then clearly label the ATLAS INTERPRETATION separately, and state the source, authority tier, version, jurisdiction, publication/effective dates and freshness. End regulatory answers with: "This is not legal advice." Never claim the company is or is not in compliance — say what the source requires and what would need to be verified.
- Respond with ONLY JSON, no markdown fences: {"answer": string, "classification": string, "confidence": number 0-1, "limitations": string|null, "actions": string[]}`;

  const user = `Question: ${q}\n\nEvidence:\n${evidenceBlock}${authorityBlock}`;

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
