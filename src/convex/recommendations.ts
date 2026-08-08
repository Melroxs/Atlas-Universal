import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { isManager, requireTenant, requireUser } from "./helpers";

type Priority = "high" | "medium" | "low";

interface DetectorResult {
  detectorKey: string;
  priority: Priority;
  title: string;
  summary: string;
  reason: string;
  confidence: number;
  expectedImpact?: string;
  risk?: string;
  evidence: Array<{
    kind: string;
    documentId?: string;
    chunkId?: string;
    entityId?: string;
    title?: string;
    snippet?: string;
    relevance: number;
  }>;
}

/**
 * Comparison engine: run the workspace's rule-based detectors against its
 * current reality (documents, entities, activated intelligence) and open
 * evidence-backed recommendations. Idempotent — already-open recommendations
 * are left untouched; stale ones (whose condition no longer applies) close.
 */
export const runDetectors = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("You must be signed in.");
    const membership = await ctx.runQuery(internal.internal.getMembershipByUser, {
      userId,
    });
    if (!membership) throw new Error("You don't belong to a workspace yet.");
    const tenantId = membership.tenantId;

    const [docs, entities, packs, profile] = await Promise.all([
      ctx.runQuery(internal.internal.listDocsByTenant, { tenantId }),
      ctx.runQuery(internal.internal.listEntitiesByTenant, { tenantId }),
      ctx.runQuery(internal.internal.listTenantPacks, { tenantId }),
      ctx.runQuery(internal.internal.getProfileByTenant, { tenantId }),
    ]);

    const activeKeys = new Set(
      packs.filter((p) => p.status === "active").map((p) => p.packKey),
    );
    const readyDocs = docs.filter((d) => d.status === "ready");
    const classifications = new Set(readyDocs.map((d) => d.classification));

    const detectors: DetectorResult[] = [];

    // 1. Empty knowledge base
    if (docs.length === 0) {
      detectors.push({
        detectorKey: "knowledge_base_empty",
        priority: "high",
        title: "Start building your knowledge base",
        summary:
          "Atlas has no documents yet, so it can't answer questions or detect risks about the company.",
        reason:
          "The comparison engine found zero knowledge sources in the workspace. Every recommendation and answer depends on ingested documents.",
        confidence: 1,
        expectedImpact: "Enables Ask Atlas and all detection.",
        risk: "Without evidence, Atlas cannot operate.",
        evidence: [],
      });
    }

    // 2. Unclassified documents
    const unclassified = readyDocs.filter((d) => d.classification === "Unknown");
    if (unclassified.length > 0) {
      detectors.push({
        detectorKey: "unclassified_documents",
        priority: "medium",
        title: `${unclassified.length} document${unclassified.length === 1 ? " is" : "s are"} unclassified`,
        summary: `Atlas couldn't confidently classify ${unclassified.length} document${unclassified.length === 1 ? "" : "s"}. Classification drives workflow expectations and gap detection.`,
        reason:
          "Documents are matched against known types (SOP, Policy, Invoice, Estimate…). Unclassified documents can't feed documentation-gap detection.",
        confidence: 0.85,
        expectedImpact: "Better documentation-gap detection.",
        risk: "Low — manual review needed.",
        evidence: unclassified.slice(0, 4).map((d) => ({
          kind: "document",
          documentId: String(d._id),
          title: d.title,
          snippet: `Classification: Unknown · ${d.chunkCount ?? 0} chunks`,
          relevance: 0.8,
        })),
      });
    }

    // 3. Documents with no extracted knowledge
    const emptyDocs = readyDocs.filter(
      (d) => (d.entityCount ?? 0) === 0 && d.classification !== "Unknown",
    );
    if (emptyDocs.length > 0) {
      detectors.push({
        detectorKey: "no_knowledge_extracted",
        priority: "medium",
        title: `${emptyDocs.length} document${emptyDocs.length === 1 ? " has" : "s have"} no extracted entities`,
        summary:
          "These documents were parsed but produced no entities for the knowledge graph.",
        reason:
          "Extraction found no people, organizations, claims, or terminology. The documents may be short, scanned, or in an unsupported format.",
        confidence: 0.7,
        expectedImpact: "Completeness of the knowledge graph.",
        risk: "Low.",
        evidence: emptyDocs.slice(0, 4).map((d) => ({
          kind: "document",
          documentId: String(d._id),
          title: d.title,
          snippet: "No entities extracted during ingestion.",
          relevance: 0.7,
        })),
      });
    }

    // 4. Duplicate entities
    const nameGroups = new Map<string, typeof entities>();
    for (const e of entities) {
      const key = e.name.trim().toLowerCase();
      if (!key) continue;
      const arr = nameGroups.get(key) ?? [];
      arr.push(e);
      nameGroups.set(key, arr);
    }
    const dupGroups = [...nameGroups.values()].filter(
      (g) => new Set(g.map((x) => String(x._id))).size > 1,
    );
    if (dupGroups.length > 0) {
      detectors.push({
        detectorKey: "duplicate_entities",
        priority: "low",
        title: `${dupGroups.length} potential duplicate entit${dupGroups.length === 1 ? "y" : "ies"}`,
        summary:
          "Several entities share the same name and may represent the same real-world object.",
        reason:
          "Entity resolution found name collisions. Merging keeps the knowledge graph clean and answers consistent.",
        confidence: 0.65,
        expectedImpact: "Cleaner knowledge graph and answers.",
        risk: "Low — merging should be confirmed manually.",
        evidence: dupGroups.slice(0, 4).map((g) => ({
          kind: "entity",
          entityId: String(g[0]._id),
          title: g[0].name,
          snippet: `${g.length} records · type ${g[0].entityTypeKey}`,
          relevance: 0.6,
        })),
      });
    }

    // 5. Documentation gaps against active packs
    if (activeKeys.has("insurance-restoration") && readyDocs.length > 0) {
      const claims = entities.filter((e) => e.entityTypeKey === "claim").length;
      if (claims > 0 && !classifications.has("Estimate")) {
        detectors.push({
          detectorKey: "gap_estimates",
          priority: "high",
          title: "No estimate documents in the knowledge base",
          summary:
            "Claims are present but no Estimate documents were found — estimates drive scope, supplements and payment.",
          reason:
            "Restoration workflow expects an estimate per claim. Without them Atlas can't compare scope to actuals.",
          confidence: 0.8,
          expectedImpact: "Scope-vs-actual leakage detection.",
          risk: "Payment delays from unverified scope.",
          evidence: [
            {
              kind: "entity",
              title: `${claims} claim entit${claims === 1 ? "y" : "ies"}`,
              snippet: "Claims detected without matching estimates.",
              relevance: 0.8,
            },
          ],
        });
      }
      if (claims > 0 && !classifications.has("Invoice")) {
        detectors.push({
          detectorKey: "gap_invoices",
          priority: "high",
          title: "No invoice documents in the knowledge base",
          summary:
            "Atlas can't detect unpaid balances, aging, or revenue leakage without invoice data.",
          reason:
            "The restoration payment workflow expects invoicing → payment. Missing invoices block financial-leakage detection.",
          confidence: 0.8,
          expectedImpact: "Cash-flow and leakage visibility.",
          risk: "Unpaid work goes unnoticed.",
          evidence: [
            {
              kind: "entity",
              title: `${claims} claim entit${claims === 1 ? "y" : "ies"}`,
              snippet: "No Invoice classification found.",
              relevance: 0.8,
            },
          ],
        });
      }
      if (!classifications.has("SOP") && !classifications.has("Policy")) {
        detectors.push({
          detectorKey: "gap_sops",
          priority: "medium",
          title: "No SOP or policy documents ingested",
          summary:
            "Company SOPs are the authoritative source for how work should be done. Upload them so Atlas can detect deviations.",
          reason:
            "Rules and workflow expectations come from company policies. Without them, compliance checks run on generic knowledge only.",
          confidence: 0.75,
          expectedImpact: "Workflow deviation detection.",
          risk: "Low.",
          evidence: [],
        });
      }
    }

    // 6. Failed documents
    const failedDocs = docs.filter((d) => d.status === "failed");
    if (failedDocs.length > 0) {
      detectors.push({
        detectorKey: "failed_documents",
        priority: "medium",
        title: `${failedDocs.length} document${failedDocs.length === 1 ? " failed" : "s failed"} to process`,
        summary: "Some uploads could not be parsed into the knowledge base.",
        reason: "Ingestion reported an error for these documents.",
        confidence: 1,
        expectedImpact: "Complete knowledge coverage.",
        risk: "Low.",
        evidence: failedDocs.slice(0, 4).map((d) => ({
          kind: "document",
          documentId: String(d._id),
          title: d.title,
          snippet: d.error ?? "Processing failed.",
          relevance: 0.9,
        })),
      });
    }

    // Apply: create new recommendations.
    let created = 0;
    for (const det of detectors) {
      const existing = await ctx.runQuery(
        internal.internal.listOpenRecsByDetector,
        { tenantId, detectorKey: det.detectorKey },
      );
      if (existing.length > 0) continue;
      const recId = await ctx.runMutation(internal.internal.createRecommendation, {
        tenantId,
        title: det.title,
        summary: det.summary,
        reason: det.reason,
        classification: "RECOMMENDATION",
        detectorKey: det.detectorKey,
        priority: det.priority,
        confidence: det.confidence,
        expectedImpact: det.expectedImpact,
        risk: det.risk,
        requiredApprovalMode: "APPROVE",
      });
      for (const ev of det.evidence) {
        await ctx.runMutation(internal.internal.insertRecommendationEvidence, {
          recommendationId: recId,
          kind: ev.kind,
          documentId: ev.documentId as never,
          chunkId: ev.chunkId as never,
          entityId: ev.entityId as never,
          title: ev.title,
          snippet: ev.snippet,
          relevance: ev.relevance,
        });
      }
      created++;
    }

    // Close recommendations whose condition no longer applies.
    const activeKeys2 = new Set(detectors.map((d) => d.detectorKey));
    const openRecs = await ctx.runQuery(internal.internal.listOpenRecsByTenant, {
      tenantId,
    });
    let closed = 0;
    for (const rec of openRecs) {
      if (!activeKeys2.has(rec.detectorKey)) {
        await ctx.runMutation(internal.internal.patchRecommendation, {
          id: rec._id,
          patch: { status: "dismissed", decidedAt: Date.now() },
        });
        closed++;
      }
    }

    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "system",
      actionType: "detectors_ran",
      targetType: "tenant",
      metadata: {
        created,
        closed,
        industry: profile?.industry ?? null,
      },
    });

    return { created, closed };
  },
});

export const listRecommendations = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const recs = await ctx.db
      .query("recommendations")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(60);
    const withEvidence = await Promise.all(
      recs.map(async (r) => {
        const evidence = await ctx.db
          .query("recommendationEvidence")
          .withIndex("by_recommendation", (q) =>
            q.eq("recommendationId", r._id),
          )
          .collect();
        return { ...r, evidence };
      }),
    );
    return withEvidence;
  },
});

export const recommendationCounts = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const recs = await ctx.db
      .query("recommendations")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const counts = {
      open: 0,
      approved: 0,
      rejected: 0,
      dismissed: 0,
      executed: 0,
    };
    for (const r of recs) counts[r.status]++;
    return counts;
  },
});

const decide = async (
  ctx: MutationCtx,
  recommendationId: Id<"recommendations">,
  status: "approved" | "rejected" | "dismissed" | "executed",
) => {
  const actorId = await requireUser(ctx);
  const tenantId = await requireTenant(ctx, actorId);
  const rec = await ctx.db.get(recommendationId);
  if (!rec || rec.tenantId !== tenantId) {
    throw new Error("Recommendation not found.");
  }
  const manager = await isManager(ctx, actorId, tenantId);
  if (status !== "dismissed" && !manager) {
    throw new Error(
      "Only managers and above can approve or reject recommendations.",
    );
  }
  await ctx.db.patch(rec._id, {
    status,
    decidedBy: actorId,
    decidedAt: Date.now(),
  });
  await ctx.runMutation(internal.internal.logAudit, {
    tenantId,
    actorType: "user",
    actorId,
    actionType: `recommendation_${status}`,
    targetType: "recommendation",
    targetId: recommendationId,
    metadata: { title: rec.title },
  });
};

export const approveRecommendation = mutation({
  args: { recommendationId: v.id("recommendations") },
  handler: async (ctx, args) =>
    decide(ctx, args.recommendationId, "approved"),
});

export const rejectRecommendation = mutation({
  args: { recommendationId: v.id("recommendations") },
  handler: async (ctx, args) =>
    decide(ctx, args.recommendationId, "rejected"),
});

export const dismissRecommendation = mutation({
  args: { recommendationId: v.id("recommendations") },
  handler: async (ctx, args) =>
    decide(ctx, args.recommendationId, "dismissed"),
});

export const markExecuted = mutation({
  args: { recommendationId: v.id("recommendations") },
  handler: async (ctx, args) =>
    decide(ctx, args.recommendationId, "executed"),
});
