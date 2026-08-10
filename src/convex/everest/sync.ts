"use node";

// ---------------------------------------------------------------------------
// Everest — Authority Sync Engine (node actions)
//
// The continuous-intelligence loop: retrieve (safe, allowlisted) → normalize
// → hash → classify → publish immutable versions → assess impact → emit
// authority events + notifications. Adapters are isolated; the engine holds
// no source-specific HTTP. Nothing is ever marked synchronized unless Atlas
// actually retrieved and validated it. All DB access is via internal
// everest.syncDb queries/mutations (actions cannot write to the DB directly).
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { SOURCE_RETRIEVAL_META } from "./authority";
import {
  adapterFor,
  classifyChange,
  isCheckable,
  sanitizeContent,
} from "./ingest";
import { buildImpactAssessment } from "./impact";
import { evaluateApplicability } from "./jurisdiction";
import { WORKFLOW_BY_ID } from "../workflows/registry";

/** Resolve tenants whose organization context matches a knowledge item's
 *  jurisdiction/industry applicability (fail-closed). */
async function affectedTenantsFor(
  ctx: ActionCtx,
  knowledge: { jurisdiction?: string | null; industry?: string | null; effectiveDate?: number | null },
): Promise<Array<{ tenantId: Id<"tenants">; matchedBy: string[] }>> {
  const contexts = await ctx.runQuery(internal.everest.syncDb.listOrgContexts);
  const out: Array<{ tenantId: Id<"tenants">; matchedBy: string[] }> = [];
  for (const c of contexts) {
    const res = evaluateApplicability(
      {
        jurisdiction: knowledge.jurisdiction ?? undefined,
        industry: knowledge.industry ?? undefined,
        effectiveDate: knowledge.effectiveDate ?? undefined,
      },
      {
        country: c.country ?? undefined,
        state: c.regions?.[0] ?? undefined,
        municipality: c.cities?.[0] ?? undefined,
        industry: c.industry ?? undefined,
        companySize: c.companySize ?? undefined,
        businessModel: c.businessModel ?? undefined,
        asOf: Date.now(),
      },
    );
    if (res.applicable) {
      out.push({ tenantId: c.tenantId, matchedBy: [res.reason] });
    }
  }
  return out;
}

function changeTypeIsReviewable(changeType: string): boolean {
  return (
    changeType === "substantive_change" ||
    changeType === "new_requirement" ||
    changeType === "removed_requirement" ||
    changeType === "supersession"
  );
}

type CheckOutcome =
  | { status: "unknown_source" }
  | { status: "not_checkable"; sourceId: string }
  | { status: "unavailable"; sourceId: string; error?: string }
  | { status: "validation_failed"; sourceId: string }
  | { status: "no_change"; sourceId: string }
  | { status: string; sourceId: string; createdVersionIds: string[] };

export const runAuthorityCheck = internalAction({
  args: { sourceId: v.string() },
  handler: async (ctx, { sourceId }): Promise<CheckOutcome> => {
    const source = await ctx.runQuery(internal.everest.syncDb.getSource, { sourceId });
    if (!source) return { status: "unknown_source" as const };

    // Honest states: declared/not_implemented sources are never synced.
    if (!isCheckable(source)) {
      await ctx.runMutation(internal.everest.syncDb.recordAuthorityCheck, {
        sourceId,
        success: false,
        ok: false,
        error:
          source.implementationStatus === "implemented"
            ? "Source is not enabled or has no canonical URL."
            : `Adapter not implemented (${source.implementationStatus ?? "declared"}).`,
      });
      return { status: "not_checkable" as const, sourceId };
    }

    const adapter = adapterFor(source.retrievalMethod)!;
    const fetched = await adapter.fetch(source.canonicalUrl!, {
      maxBytes: 512 * 1024,
      timeoutMs: 20000,
    });
    const now = Date.now();

    if (!fetched.ok || !fetched.content) {
      await ctx.runMutation(internal.everest.syncDb.recordAuthorityCheck, {
        sourceId,
        success: false,
        ok: false,
        statusCode: fetched.status,
        latencyMs: fetched.latencyMs,
        error: fetched.error ?? "No content.",
      });
      // Freshness on tied knowledge rows → unavailable (never silently current).
      const knowledge = await ctx.runQuery(internal.everest.syncDb.listKnowledgeBySource, { sourceId });
      for (const k of knowledge) {
        await ctx.runMutation(internal.everest.syncDb.patchKnowledgeFreshness, {
          knowledgeId: k.knowledgeId,
          freshness: "unavailable",
        });
      }
      return { status: "unavailable" as const, sourceId, error: fetched.error };
    }

    // Normalize + validate + hash.
    const normalized = adapter.normalize(fetched.content);
    const validated = adapter.validate(normalized);
    const newHash = adapter.calculateHash(normalized);
    const publishedAt = adapter.extractPublishedDate(normalized);
    const version = source.lastKnownVersion;

    if (!validated.ok) {
      await ctx.runMutation(internal.everest.syncDb.recordAuthorityCheck, {
        sourceId,
        success: false,
        ok: false,
        statusCode: fetched.status,
        latencyMs: fetched.latencyMs,
        error: validated.reason,
      });
      return { status: "validation_failed" as const, sourceId };
    }

    // Change detection against the previous known hash.
    const prevHash = source.contentHash;
    const changeType = prevHash
      ? classifyChange(
          { contentHash: prevHash, version: source.lastKnownVersion },
          { contentHash: newHash, version },
          normalized.length,
          100,
        )
      : "new_requirement"; // first retrieval of a previously-unsynced source

    const createdVersionIds: string[] = [];
    const affectedTenants = await affectedTenantsFor(ctx, {
      jurisdiction: source.jurisdiction,
      industry: source.industry,
    });

    if (changeType === "no_change") {
      await ctx.runMutation(internal.everest.syncDb.recordAuthorityCheck, {
        sourceId,
        success: true,
        ok: true,
        statusCode: fetched.status,
        latencyMs: fetched.latencyMs,
        contentHash: newHash,
        version: source.lastKnownVersion,
        changeType: "no_change",
      });
      return { status: "no_change" as const, sourceId };
    }

    // Substantive change path: version + assess + notify.
    const knowledge = await ctx.runQuery(internal.everest.syncDb.listKnowledgeBySource, { sourceId });

    for (const k of knowledge) {
      const res = await ctx.runMutation(internal.everest.syncDb.publishKnowledgeVersion, {
        knowledgeId: k.knowledgeId,
        sourceId,
        version: source.lastKnownVersion,
        contentHash: newHash,
        sourceContent: sanitizeContent(normalized).slice(0, 8000),
        normalizedFact: k.statement,
        atlasInterpretation: k.interpretation,
        knowledgeType: k.knowledgeType,
        jurisdiction: k.jurisdiction,
        industry: k.industry,
        publishedAt,
        effectiveAt: k.effectiveDate ?? undefined,
        expiresAt: k.expirationDate ?? undefined,
        changeType,
        confidence: k.confidence,
        reviewStatus: changeTypeIsReviewable(changeType) ? "pending_review" : "approved",
        supersedesId: k.supersedesId,
      });
      if (res.created) createdVersionIds.push(res.versionId);
    }

    // Workflow linking (never auto-modifies workflows — only flags them).
    const workflows = Object.values(WORKFLOW_BY_ID).map((w) => ({
      id: w.id,
      name: w.name,
      industry: w.industry ?? "universal",
    }));

    for (const k of knowledge) {
      const assessment = buildImpactAssessment({
        source: {
          sourceId,
          name: source.name,
          authorityTier: source.authorityTier,
          industry: source.industry,
          jurisdiction: source.jurisdiction,
        },
        knowledge: {
          knowledgeId: k.knowledgeId,
          title: k.title,
          statement: k.statement,
          industry: k.industry,
          jurisdiction: k.jurisdiction,
          effectiveDate: k.effectiveDate,
        },
        changeType,
        affectedTenants,
        workflows,
        registeredIndustries: [],
        subjects: SOURCE_RETRIEVAL_META[sourceId]?.subjects ?? [],
      });

      const { assessmentId } = await ctx.runMutation(
        internal.everest.syncDb.insertImpactAssessment,
        {
          sourceId,
          sourceName: source.name,
          authorityTier: source.authorityTier,
          knowledgeId: k.knowledgeId,
          knowledgeTitle: k.title,
          changeType,
          affectedJurisdictions: assessment.affectedJurisdictions,
          affectedIndustries: assessment.affectedIndustries,
          affectedTenantIds: assessment.affectedTenantIds as Id<"tenants">[],
          affectedWorkflowIds: assessment.affectedWorkflowIds,
          evidence: assessment.evidence,
          confidence: assessment.confidence,
          severity: assessment.severity,
          urgency: assessment.urgency,
          recommendedAction: assessment.recommendedAction,
          requiresHumanReview: assessment.requiresHumanReview,
        },
      );

      // Emit authority events + notifications per affected tenant.
      for (const t of affectedTenants) {
        const dayKey = new Date(now).toISOString().slice(0, 10);
        const base = `authority:${sourceId}:${k.knowledgeId}:${changeType}:${t.tenantId}:${dayKey}`;
        await ctx.runMutation(internal.everest.syncDb.recordAuthorityEvent, {
          tenantId: t.tenantId,
          eventType: "authority.changed",
          sourceResourceId: sourceId,
          occurredAt: now,
          payload: { sourceId, knowledgeId: k.knowledgeId, changeType },
          dedupeKey: base,
        });
        await ctx.runMutation(internal.everest.syncDb.recordAuthorityEvent, {
          tenantId: t.tenantId,
          eventType: "authority.version_published",
          sourceResourceId: sourceId,
          occurredAt: now,
          payload: {
            sourceId,
            versionId: createdVersionIds[0],
            version: source.lastKnownVersion,
          },
          dedupeKey: `${base}:v`,
        });
        if (changeType === "supersession") {
          await ctx.runMutation(internal.everest.syncDb.recordAuthorityEvent, {
            tenantId: t.tenantId,
            eventType: "authority.superseded",
            sourceResourceId: sourceId,
            occurredAt: now,
            payload: {
              sourceId,
              knowledgeId: k.knowledgeId,
              supersededById: createdVersionIds[0],
            },
            dedupeKey: `${base}:s`,
          });
        }
        if (assessment.requiresHumanReview) {
          await ctx.runMutation(internal.everest.syncDb.recordAuthorityEvent, {
            tenantId: t.tenantId,
            eventType: "authority.review_required",
            sourceResourceId: sourceId,
            occurredAt: now,
            payload: {
              sourceId,
              knowledgeId: k.knowledgeId,
              assessmentId,
              severity: assessment.severity,
            },
            dedupeKey: `${base}:r`,
            notify: {
              severity: assessment.severity === "high" ? "high" : "medium",
              title: `Authority change requires review: ${k.title}`,
              description: `${assessment.severity.toUpperCase()} — ${assessment.recommendedAction}`,
            },
          });
        }
      }
    }

    await ctx.runMutation(internal.everest.syncDb.recordAuthorityCheck, {
      sourceId,
      success: true,
      ok: true,
      statusCode: fetched.status,
      latencyMs: fetched.latencyMs,
      contentHash: newHash,
      version: source.lastKnownVersion,
      changeType,
      createdVersionIds,
    });

    // Publish the source's new hash + freshness on tied knowledge.
    const srcRow = await ctx.runQuery(internal.everest.syncDb.getSource, { sourceId });
    if (srcRow) {
      await ctx.runMutation(internal.everest.syncDb.patchSourceHash, {
        sourceId,
        contentHash: newHash,
        lastChangedAt: now,
        lastChangeType: changeType,
      });
    }

    return { status: changeType as string, sourceId, createdVersionIds };
  },
});
