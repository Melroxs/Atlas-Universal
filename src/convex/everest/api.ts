// ---------------------------------------------------------------------------
// Everest — Intelligence Foundation API
// ---------------------------------------------------------------------------

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action, mutation, query } from "../_generated/server";
import { AUTHORITATIVE_KNOWLEDGE_SEEDS, AUTHORITATIVE_SOURCE_SEEDS, AUTHORITY_TIERS, SOURCE_RETRIEVAL_META, buildProvenance, provenanceAnswer, tierLabel, tierWeight } from "./authority";
import { BUSINESS_BRAIN, MATURITY_KEYS, disambiguateTerm, maturityGuidance } from "./business";
import { temporalSnapshot, tzForLocation } from "./calendar";
import { deriveCoverage } from "./coverage";
import { CLAIM_EVIDENCE_CATEGORIES, CLAIM_LIFECYCLE, CLAIM_BASELINE, analyzeRecoveryOpportunities } from "./insurance";
import { evaluateApplicability } from "./jurisdiction";
import { freshnessState, sourceHealth } from "./ingest";
import { deriveExcellence } from "./excellence";
import { discoverOpportunities, VALUE_ENGINES, valueEngineFor } from "./value";
import { memoryRecordFromApproval } from "./memory";
import { composeInsights } from "./insight";
import { requireTenant, requireUser, isManager } from "../helpers";

const industryKey = (s?: string | null) =>
  (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Organization context + operating locations + profile + temporal snapshot.
 *  `userTimezone` is the individual user's own timezone (client-provided),
 *  kept separate from the organization timezone. */
export const getOrganizationContext = query({
  args: { userTimezone: v.optional(v.string()) },
  handler: async (ctx, { userTimezone }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const [context, locations, profile] = await Promise.all([
      ctx.db.query("organizationContexts").withIndex("by_tenant", (q) => q.eq("tenantId", tenantId)).first(),
      ctx.db.query("operatingLocations").withIndex("by_tenant", (q) => q.eq("tenantId", tenantId)).collect(),
      ctx.db.query("companyProfiles").withIndex("by_tenant", (q) => q.eq("tenantId", tenantId)).first(),
    ]);

    // Fall back to profile location when no context row exists yet.
    const country = context?.country ?? profile?.country;
    const timezone =
      context?.primaryTimezone ??
      tzForLocation(country, profile?.stateProvince, profile?.city).timezone;
    const businessHours =
      context?.businessHours ?? { start: "09:00", end: "17:00" };
    const calendarCfg = {
      timezone,
      businessDays: context?.businessDays,
      businessHours,
      holidays: (context?.holidays as string[] | undefined) ?? [],
      fiscalYearStart: context?.fiscalYearStart,
    };

    const orgSnapshot = temporalSnapshot(Date.now(), calendarCfg);
    const userSnapshot = userTimezone
      ? temporalSnapshot(Date.now(), { timezone: userTimezone })
      : null;

    return {
      tenantId,
      context: context ?? null,
      timezoneNote: context?.timezoneNote ?? null,
      profile: profile
        ? {
            companyName: profile.companyName,
            country: profile.country,
            stateProvince: profile.stateProvince,
            city: profile.city,
            industry: profile.industry,
            businessModel: profile.businessModel,
            companySize: profile.companySize,
            onboardingComplete: profile.onboardingComplete,
          }
        : null,
      locations,
      organization: {
        timezone,
        snapshot: orgSnapshot,
      },
      user: userSnapshot ? { timezone: userTimezone!, snapshot: userSnapshot } : null,
    };
  },
});

/** Update organization context. Explicit timezone wins; otherwise Atlas
 *  derives it from the company's location automatically. */
export const updateOrganizationContext = mutation({
  args: {
    country: v.optional(v.string()),
    regions: v.optional(v.array(v.string())),
    cities: v.optional(v.array(v.string())),
    primaryTimezone: v.optional(v.string()),
    locale: v.optional(v.string()),
    currency: v.optional(v.string()),
    fiscalYearStart: v.optional(v.string()),
    businessDays: v.optional(v.array(v.number())),
    businessHours: v.optional(v.object({ start: v.string(), end: v.string() })),
    holidays: v.optional(v.array(v.string())),
    jurisdictions: v.optional(v.array(v.string())),
    industry: v.optional(v.string()),
    businessModel: v.optional(v.string()),
    companySize: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const existing = await ctx.db
      .query("organizationContexts")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .first();

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    const set = (key: string, val: unknown) => {
      if (val !== undefined) patch[key] = val;
    };
    set("country", args.country);
    set("regions", args.regions);
    set("cities", args.cities);
    set("locale", args.locale);
    set("currency", args.currency);
    set("fiscalYearStart", args.fiscalYearStart);
    set("businessDays", args.businessDays);
    set("businessHours", args.businessHours);
    set("holidays", args.holidays);
    set("jurisdictions", args.jurisdictions);
    set("industry", args.industry);
    set("businessModel", args.businessModel);
    set("companySize", args.companySize);

    // Timezone: explicit user choice wins; else derive from the location.
    if (args.primaryTimezone) {
      patch.primaryTimezone = args.primaryTimezone;
      patch.timezoneNote = "Configured explicitly.";
    } else {
      const country = args.country ?? existing?.country;
      if (country) {
        const regions = args.regions ?? existing?.regions ?? [];
        const cities = args.cities ?? existing?.cities ?? [];
        const { timezone, note } = tzForLocation(
          country,
          regions[0],
          cities[0],
        );
        patch.primaryTimezone = timezone;
        patch.timezoneNote = note;
      }
    }

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("organizationContexts", {
        tenantId,
        country: patch.country as string | undefined,
        regions: patch.regions as string[] | undefined,
        cities: patch.cities as string[] | undefined,
        primaryTimezone: patch.primaryTimezone as string | undefined,
        timezoneNote: patch.timezoneNote as string | undefined,
        locale: patch.locale as string | undefined,
        currency: patch.currency as string | undefined,
        fiscalYearStart: patch.fiscalYearStart as string | undefined,
        businessDays: patch.businessDays as number[] | undefined,
        businessHours: patch.businessHours as { start: string; end: string } | undefined,
        holidays: patch.holidays as string[] | undefined,
        jurisdictions: patch.jurisdictions as string[] | undefined,
        industry: patch.industry as string | undefined,
        businessModel: patch.businessModel as string | undefined,
        companySize: patch.companySize as string | undefined,
        updatedAt: Date.now(),
      });
    }

    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: "org_context_updated",
      targetType: "organization_context",
      metadata: { timezone: patch.primaryTimezone, fields: Object.keys(patch).filter((k) => k !== "updatedAt") },
    });

    return { timezone: patch.primaryTimezone as string | undefined };
  },
});

/** Add or update an operating location. */
export const upsertOperatingLocation = mutation({
  args: {
    id: v.optional(v.id("operatingLocations")),
    name: v.string(),
    kind: v.string(),
    timezone: v.optional(v.string()),
    jurisdiction: v.optional(v.string()),
    country: v.optional(v.string()),
    region: v.optional(v.string()),
    city: v.optional(v.string()),
    businessHours: v.optional(v.object({ start: v.string(), end: v.string() })),
    primary: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const fields = {
      tenantId,
      name: args.name,
      kind: args.kind,
      timezone: args.timezone ?? undefined,
      jurisdiction: args.jurisdiction ?? undefined,
      country: args.country ?? undefined,
      region: args.region ?? undefined,
      city: args.city ?? undefined,
      businessHours: args.businessHours ?? undefined,
      primary: args.primary ?? undefined,
    };
    if (args.id) {
      const existing = await ctx.db.get(args.id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("Location not found.");
      await ctx.db.patch(args.id, { ...fields, tenantId: existing.tenantId });
    } else {
      await ctx.db.insert("operatingLocations", fields);
    }
    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: args.id ? "location_updated" : "location_added",
      targetType: "operating_location",
      metadata: { name: args.name, kind: args.kind },
    });
  },
});

/** Remove an operating location. */
export const removeOperatingLocation = mutation({
  args: { id: v.id("operatingLocations") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const existing = await ctx.db.get(id);
    if (!existing || existing.tenantId !== tenantId) throw new Error("Location not found.");
    await ctx.db.delete(id);
    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: "location_removed",
      targetType: "operating_location",
      metadata: { name: existing.name },
    });
  },
});

/** The universal business brain — static structured knowledge, versioned. */
export const getBusinessBrain = query({
  args: { term: v.optional(v.string()) },
  handler: async (_ctx, { term }) => {
    const disambiguation = term ? disambiguateTerm(term) : null;
    return {
      version: BUSINESS_BRAIN.version,
      businessTypes: BUSINESS_BRAIN.businessTypes,
      financialKnowledge: BUSINESS_BRAIN.financialKnowledge,
      orgStructures: BUSINESS_BRAIN.orgStructures,
      orgRoles: BUSINESS_BRAIN.orgRoles,
      businessFunctions: BUSINESS_BRAIN.businessFunctions,
      businessObjects: BUSINESS_BRAIN.businessObjects,
      objectRelationships: BUSINESS_BRAIN.objectRelationships,
      lifecycles: BUSINESS_BRAIN.lifecycles,
      maturity: BUSINESS_BRAIN.maturity,
      maturityKeys: MATURITY_KEYS,
      disambiguation,
    };
  },
});

/** Maturity-based adaptation guidance. */
export const getMaturityGuidance = query({
  args: { sizeKey: v.optional(v.string()) },
  handler: async (_ctx, { sizeKey }) => maturityGuidance(sizeKey),
});

/** Authoritative source registry + knowledge, each annotated with its
 *  applicability to this tenant's operating context and its provenance. */
export const listAuthoritativeKnowledge = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const [sources, knowledge, context] = await Promise.all([
      ctx.db.query("authoritativeSources").collect(),
      ctx.db.query("authoritativeKnowledge").collect(),
      ctx.db.query("organizationContexts").withIndex("by_tenant", (q) => q.eq("tenantId", tenantId)).first(),
    ]);

    const sourceById = new Map(sources.map((s) => [s.sourceId, s]));
    const now = Date.now();
    const jurisCtx = {
      country: context?.country ?? undefined,
      state: context?.regions?.[0] ?? undefined,
      municipality: context?.cities?.[0] ?? undefined,
      industry: context?.industry ?? undefined,
      companySize: context?.companySize ?? undefined,
      businessModel: context?.businessModel ?? undefined,
      asOf: now,
    };

    const knowledgeRows = knowledge
      .filter((k) => k.status === "active")
      .map((k) => {
        const src = sourceById.get(k.sourceId);
        const provenance = src
          ? buildProvenance(
              {
                sourceId: k.sourceId,
                version: k.version,
                publicationDate: k.publicationDate,
                effectiveDate: k.effectiveDate,
                status: k.status,
                supersedes: k.supersedes,
                supersededBy: k.supersededBy,
              },
              src,
              now,
            )
          : null;
        const applicability = evaluateApplicability(k, jurisCtx);
        return {
          ...k,
          source: src ?? null,
          provenance,
          provenanceAnswer: provenance ? provenanceAnswer(provenance) : null,
          applicability,
        };
      });

    const sourceRows = sources.map((s) => ({
      ...s,
      tierLabel: tierLabel(s.authorityTier),
      tierWeight: tierWeight(s.authorityTier),
      knowledgeCount: knowledge.filter((k) => k.sourceId === s.sourceId && k.status === "active").length,
    }));

    return {
      jurisdiction: {
        path: [jurisCtx.country, jurisCtx.state, jurisCtx.municipality].filter(Boolean),
        industry: jurisCtx.industry,
      },
      tiers: AUTHORITY_TIERS,
      sources: sourceRows,
      knowledge: knowledgeRows,
    };
  },
});

/** Honest industry coverage derived from real registered items + sources. */
export const getIndustryCoverage = query({
  args: {},
  handler: async (ctx) => {
    const [packs, items, sources, knowledge] = await Promise.all([
      ctx.db.query("intelligencePacks").collect(),
      ctx.db.query("intelligenceItems").collect(),
      ctx.db.query("authoritativeSources").collect(),
      ctx.db.query("authoritativeKnowledge").collect(),
    ]);

    const itemsByPack = new Map<string, string[]>();
    for (const item of items) {
      const list = itemsByPack.get(item.packKey) ?? [];
      list.push(item.itemType);
      itemsByPack.set(item.packKey, list);
    }
    const activeKnowledge = knowledge.filter((k) => k.status === "active");
    const sourceByIndustry = new Map<string, number>();
    for (const s of sources) {
      if (!s.industry) continue;
      const key = industryKey(s.industry);
      sourceByIndustry.set(key, (sourceByIndustry.get(key) ?? 0) + 1);
    }
    const knowledgeByIndustry = new Map<string, number>();
    for (const k of activeKnowledge) {
      if (!k.industry) continue;
      const key = industryKey(k.industry);
      knowledgeByIndustry.set(key, (knowledgeByIndustry.get(key) ?? 0) + 1);
    }

    const coverage = packs.map((pack) => {
      const key = industryKey(pack.name.replace(/industry|pack|services/gi, "").trim());
      return deriveCoverage({
        packKey: pack.key,
        name: pack.name,
        itemTypes: itemsByPack.get(pack.key) ?? [],
        authorityKnowledgeCount: knowledgeByIndustry.get(key) ?? 0,
        sourceCount: sourceByIndustry.get(key) ?? 0,
        packType: pack.packType,
      });
    });

    return { coverage, generatedAt: Date.now() };
  },
});

/** Insurance deep-vertical knowledge: lifecycle, evidence model, baseline. */
export const getInsuranceIntelligence = query({
  args: {},
  handler: async (_ctx) => ({
    lifecycle: CLAIM_LIFECYCLE,
    evidenceCategories: CLAIM_EVIDENCE_CATEGORIES,
    baseline: CLAIM_BASELINE,
  }),
});

/** Revenue recovery intelligence — deterministic, evidence-labeled, honest. */
export const analyzeClaimRecovery = query({
  args: {
    expectedScope: v.optional(v.array(v.string())),
    actualScope: v.optional(v.array(v.string())),
    evidenceSummary: v.optional(v.array(v.string())),
    estimateAmount: v.optional(v.number()),
    estimateLineItemCount: v.optional(v.number()),
    carrierResponse: v.optional(v.string()),
    paymentAmount: v.optional(v.number()),
    invoicedAmount: v.optional(v.number()),
    currentStage: v.optional(v.string()),
    stageAgeDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await requireTenant(ctx, userId);
    return analyzeRecoveryOpportunities(args);
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Seed the authoritative source registry + knowledge. Idempotent. */
export const seedEverest = mutation({
  args: {},
  handler: async (ctx) => {
    let seededSources = 0;
    let seededKnowledge = 0;
    for (const s of AUTHORITATIVE_SOURCE_SEEDS) {
      const existing = await ctx.db
        .query("authoritativeSources")
        .withIndex("by_source_id", (q) => q.eq("sourceId", s.sourceId))
        .first();
      if (existing) continue;
      const meta = SOURCE_RETRIEVAL_META[s.sourceId];
      await ctx.db.insert("authoritativeSources", {
        ...s,
        industries: meta?.industries,
        subjects: meta?.subjects,
        retrievalMethod: meta?.retrievalMethod,
        implementationStatus: meta?.implementationStatus ?? "declared",
        enabled: meta?.enabled ?? false,
        active: true,
      });
      seededSources++;
    }
    for (const k of AUTHORITATIVE_KNOWLEDGE_SEEDS) {
      const existing = await ctx.db
        .query("authoritativeKnowledge")
        .withIndex("by_knowledge_id", (q) => q.eq("knowledgeId", k.knowledgeId))
        .first();
      if (existing) continue;
      await ctx.db.insert("authoritativeKnowledge", {
        ...k,
        retrievalDate: Date.now(),
        status: "active",
        reviewStatus: "approved",
        freshness: "unavailable",
      });
      seededKnowledge++;
    }
    return { seededSources, seededKnowledge };
  },
});

// ---------------------------------------------------------------------------
// Phase 8 — Authority monitoring, knowledge changes, governance, excellence
// ---------------------------------------------------------------------------

/** Trigger a check of one authoritative source now (manager action). */
export const runAuthorityCheckNow = action({
  args: { sourceId: v.string() },
  handler: async (ctx, { sourceId }): Promise<{ status: string; sourceId: string; error?: string; createdVersionIds?: string[] }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("You must be signed in.");
    return (await ctx.runAction(internal.everest.sync.runAuthorityCheck, { sourceId })) as {
      status: string;
      sourceId: string;
      error?: string;
      createdVersionIds?: string[];
    };
  },
});

/** Authority monitor: sources with honest health/freshness + check history. */
export const getAuthorityMonitor = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const [sources, checks] = await Promise.all([
      ctx.db.query("authoritativeSources").collect(),
      ctx.db.query("authorityChecks").withIndex("by_checked", (q) => q.gte("checkedAt", 0)).order("desc").take(200),
    ]);
    const now = Date.now();
    const checkBySource = new Map<string, typeof checks>();
    for (const c of checks) {
      const list = checkBySource.get(c.sourceId) ?? [];
      if (list.length < 8) list.push(c);
      checkBySource.set(c.sourceId, list);
    }
    return {
      now,
      sources: sources.map((s) => {
        const lastCheck = checks.find((c) => c.sourceId === s.sourceId);
        const health = sourceHealth(s, now);
        const fresh = freshnessState(s.lastCheckedAt, s.updateFrequency, now);
        return {
          sourceId: s.sourceId,
          name: s.name,
          organization: s.organization,
          authorityTier: s.authorityTier,
          tierLabel: tierLabel(s.authorityTier),
          sourceType: s.sourceType,
          jurisdiction: s.jurisdiction,
          industry: s.industry,
          subjects: s.subjects ?? [],
          retrievalMethod: s.retrievalMethod ?? "undeclared",
          implementationStatus: s.implementationStatus ?? "declared",
          enabled: s.enabled ?? false,
          canonicalUrl: s.canonicalUrl,
          updateFrequency: s.updateFrequency,
          health,
          freshness: fresh,
          lastCheckedAt: s.lastCheckedAt,
          lastSuccessfulSyncAt: s.lastSuccessfulSyncAt,
          lastKnownVersion: s.lastKnownVersion,
          contentHash: s.contentHash,
          lastChangeType: s.lastChangeType,
          consecutiveFailures: s.consecutiveFailures ?? 0,
          lastLatencyMs: s.lastLatencyMs,
          lastFetchError: s.lastFetchError,
          recentChecks: checkBySource.get(s.sourceId) ?? [],
        };
      }),
    };
  },
});

/** Immutable knowledge version history — the living-knowledge change log. */
export const listKnowledgeChanges = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireUser(ctx);
    const versions = await ctx.db.query("knowledgeVersions").order("desc").take(limit ?? 50);
    const sources = await ctx.db.query("authoritativeSources").collect();
    const sourceById = new Map(sources.map((s) => [s.sourceId, s]));
    return versions.map((v) => ({
      ...v,
      sourceName: sourceById.get(v.sourceId)?.name ?? null,
      sourceTier: sourceById.get(v.sourceId)?.authorityTier ?? null,
    }));
  },
});

/** Impact assessments visible to the workspace (tenant-scoped visibility). */
export const listImpactAssessments = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const assessments = await ctx.db.query("impactAssessments").order("desc").take(100);
    const sources = await ctx.db.query("authoritativeSources").collect();
    const sourceById = new Map(sources.map((s) => [s.sourceId, s]));
    // Tenant-scoped visibility: only assessments that actually touch this
    // workspace. Global assessments (no affected tenant) stay out of
    // workspace views — no cross-tenant leakage of operational context.
    return assessments
      .filter((a) => (a.affectedTenantIds ?? []).includes(tenantId))
      .map((a) => ({
        ...a,
        sourceName: sourceById.get(a.sourceId)?.name ?? a.sourceId,
        tierLabel: a.authorityTier ? tierLabel(a.authorityTier as never) : null,
      }));
  },
});

/** Human governance: approve/reject a pending impact assessment (manager+). */
export const decideImpactReview = mutation({
  args: {
    assessmentId: v.id("impactAssessments"),
    decision: v.union(v.literal("approved"), v.literal("rejected"), v.literal("disputed")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { assessmentId, decision, note }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const manager = await isManager(ctx, userId, tenantId);
    if (!manager) throw new Error("Manager role required to decide authority reviews.");
    const assessment = await ctx.db.get(assessmentId);
    if (!assessment) throw new Error("Assessment not found.");
    if ((assessment.affectedTenantIds ?? []).length > 0 && !(assessment.affectedTenantIds ?? []).includes(tenantId)) {
      throw new Error("Assessment is not scoped to this workspace.");
    }
    await ctx.db.patch(assessmentId, {
      status: decision,
      reviewNote: note,
      decidedBy: userId,
      decidedAt: Date.now(),
    });
    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: `authority_review_${decision}`,
      targetType: "impact_assessment",
      targetId: assessmentId,
      metadata: { sourceId: assessment.sourceId, changeType: assessment.changeType, note },
    });

    // §25 Knowledge → Memory: ONLY an approved, applicable assessment is
    // promoted into the tenant's knowledge graph as confirmed memory, with
    // full provenance retained. Rejected/disputed assessments never become
    // organizational memory.
    if (decision === "approved" && assessment.knowledgeId) {
      const knowledgeId = assessment.knowledgeId;
      const [source, knowledge] = await Promise.all([
        ctx.db
          .query("authoritativeSources")
          .withIndex("by_source_id", (q) => q.eq("sourceId", assessment.sourceId))
          .first(),
        ctx.db
          .query("authoritativeKnowledge")
          .withIndex("by_knowledge_id", (q) => q.eq("knowledgeId", knowledgeId))
          .first(),
      ]);
      if (source && knowledge) {
        const memory = memoryRecordFromApproval({
          tenantId: String(tenantId),
          statement: knowledge.statement,
          interpretation: knowledge.interpretation,
          confidence: assessment.confidence,
          source: {
            sourceId: source.sourceId,
            sourceName: source.name,
            authorityTier: source.authorityTier,
            tierLabel: tierLabel(source.authorityTier),
            version: knowledge.version,
            publicationDate: knowledge.publicationDate ?? null,
            effectiveDate: knowledge.effectiveDate ?? null,
            canonicalUrl: source.canonicalUrl,
          },
          changeType: assessment.changeType,
          reviewNote: note,
          decidedBy: String(userId),
          decidedAt: Date.now(),
        });
        await ctx.runMutation(internal.internal.insertAuthorityMemory, {
          tenantId,
          classification: memory.classification,
          statement: memory.statement,
          confidence: memory.confidence,
          evidence: memory.evidence,
          dedupeStatement: memory.provenance,
        });
      }
    }
  },
});

/** Industry excellence: multi-axis depth + value engines + discovery. */
export const getIndustryExcellence = query({
  args: { packKey: v.optional(v.string()) },
  handler: async (ctx, { packKey }) => {
    await requireUser(ctx);
    const [packs, items, sources, knowledge, checks] = await Promise.all([
      ctx.db.query("intelligencePacks").collect(),
      ctx.db.query("intelligenceItems").collect(),
      ctx.db.query("authoritativeSources").collect(),
      ctx.db.query("authoritativeKnowledge").collect(),
      ctx.db.query("authorityChecks").collect(),
    ]);
    const now = Date.now();
    const itemsByPack = new Map<string, string[]>();
    const lifecycleCount = new Map<string, number>();
    for (const item of items) {
      const list = itemsByPack.get(item.packKey) ?? [];
      list.push(item.itemType);
      itemsByPack.set(item.packKey, list);
      const content = item.content as { stages?: unknown } | undefined;
      if (Array.isArray(content?.stages)) {
        lifecycleCount.set(item.packKey, (lifecycleCount.get(item.packKey) ?? 0) + 1);
      }
    }
    const activeKnowledge = knowledge.filter((k) => k.status === "active");
    const lastCheckBySource = new Map<string, number>();
    for (const c of checks) {
      const prev = lastCheckBySource.get(c.sourceId) ?? 0;
      if (c.checkedAt > prev) lastCheckBySource.set(c.sourceId, c.checkedAt);
    }
    const norm = (s?: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

    const excellence = packs
      .filter((p) => (packKey ? p.key === packKey : true))
      .map((p) => {
        const key = norm(p.name.replace(/industry|pack|services/gi, "").trim());
        const industrySources = sources.filter((s) => norm(s.industry) === key || norm(s.industry) === norm(p.name));
        const sourceLastCheck = industrySources.map((s) => ({
          lastCheckedAt: lastCheckBySource.get(s.sourceId) ?? s.lastCheckedAt,
          updateFrequency: s.updateFrequency,
          status: s.active ? "active" : "expired",
        }));
        const engine = valueEngineFor(p.key);
        return {
          ...deriveExcellence({
            packKey: p.key,
            name: p.name,
            packType: p.packType,
            itemTypes: itemsByPack.get(p.key) ?? [],
            lifecycleItemCount: lifecycleCount.get(p.key) ?? 0,
            authorityKnowledgeCount: activeKnowledge.filter((k) => norm(k.industry) === key).length,
            sourceCount: industrySources.length,
            industrySources: sourceLastCheck,
            hasValueEngine: !!engine,
            valueEngineStatus: engine?.implementationStatus ?? null,
            now,
          }),
          valueEngine: engine ?? null,
        };
      });

    return { excellence, generatedAt: now };
  },
});

/** Value engines + ranked discovery for one pack. */
export const getValueIntelligence = query({
  args: { packKey: v.string() },
  handler: async (ctx, { packKey }) => {
    await requireUser(ctx);
    const engine = valueEngineFor(packKey);
    return {
      engine,
      allEngines: VALUE_ENGINES,
      opportunities: discoverOpportunities(packKey),
    };
  },
});

// ---------------------------------------------------------------------------
// Phase 8 continued — Knowledge → Memory (§25) & Knowledge → Intelligence (§26)
// ---------------------------------------------------------------------------

/** Tenant memory: authority knowledge promoted to the knowledge graph after
 *  human approval, with provenance retained. Reuses knowledgeAssertions. */
export const listTenantMemory = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const assertions = await ctx.db
      .query("knowledgeAssertions")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(100);
    return assertions.map((a) => ({
      ...a,
      origin: a.evidence?.startsWith("Source:") ? "authority" : "knowledge",
    }));
  },
});

/**
 * §26 Knowledge → Intelligence. Composes an evidence-grounded insight view
 * from: organization state (entities, approvals, decisions, events,
 * workflows), industry knowledge (active packs), authority knowledge
 * (applicability-checked), jurisdiction, temporal context, and memory. Every
 * insight lists the evidence that supports it — never fabricates.
 */
export const getComposedIntelligence = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);

    const [context, entities, assertions, decisions, approvals, events, workflows, packs, tenantPacks, allAuthorityKnowledge, sources] =
      await Promise.all([
        ctx.db.query("organizationContexts").withIndex("by_tenant", (q) => q.eq("tenantId", tenantId)).first(),
        ctx.db.query("entities").withIndex("by_tenant", (q) => q.eq("tenantId", tenantId)).take(300),
        ctx.db.query("knowledgeAssertions").withIndex("by_tenant", (q) => q.eq("tenantId", tenantId)).take(100),
        ctx.db.query("decisions").withIndex("by_tenant", (q) => q.eq("tenantId", tenantId)).filter((q) => q.eq(q.field("status"), "open")).take(50),
        ctx.db.query("workflowApprovals").withIndex("by_tenant_status", (q) => q.eq("tenantId", tenantId).eq("status", "pending")).take(50),
        ctx.db.query("events").withIndex("by_tenant_received", (q) => q.eq("tenantId", tenantId)).order("desc").take(30),
        ctx.db.query("workflowInstances").withIndex("by_tenant_created", (q) => q.eq("tenantId", tenantId)).order("desc").take(30),
        ctx.db.query("intelligencePacks").collect(),
        ctx.db.query("tenantPacks").withIndex("by_tenant", (q) => q.eq("tenantId", tenantId)).collect(),
        ctx.db.query("authoritativeKnowledge").filter((q) => q.eq(q.field("status"), "active")).collect(),
        ctx.db.query("authoritativeSources").collect(),
      ]);

    const now = Date.now();
    const activeKeys = new Set(
      tenantPacks.filter((p) => p.status === "active").map((p) => p.packKey),
    );
    const packsById = new Map(packs.map((p) => [p.key, p]));
    const sourceById = new Map(sources.map((s) => [s.sourceId, s]));

    // Industry knowledge from ACTIVE packs only.
    const industryKnowledge = packs
      .filter((p) => activeKeys.has(p.key))
      .map((p) => ({ key: p.key, title: p.name, summary: p.description }));

    // Jurisdiction + temporal context.
    const timezone =
      context?.primaryTimezone ??
      tzForLocation(context?.country, context?.regions?.[0], context?.cities?.[0]).timezone;
    const jurisCtx = {
      country: context?.country ?? undefined,
      state: context?.regions?.[0] ?? undefined,
      municipality: context?.cities?.[0] ?? undefined,
      industry: context?.industry ?? undefined,
      asOf: now,
    };

    const authorityKnowledge = allAuthorityKnowledge
      .map((k) => {
        const src = sourceById.get(k.sourceId);
        const applicability = evaluateApplicability(k, jurisCtx);
        return {
          knowledgeId: k.knowledgeId,
          title: k.title,
          statement: k.statement,
          interpretation: k.interpretation,
          sourceName: src?.name ?? k.sourceId,
          authorityTier: src?.authorityTier ?? "tier5_general",
          version: k.version,
          effectiveDate: k.effectiveDate,
          confidence: k.confidence,
          applies: applicability.applicable,
          applicabilityReason: applicability.reason,
        };
      })
      .slice(0, 40);

    const insights = composeInsights({
      now,
      timezone,
      organizationState: {
        entityCount: entities.length,
        assertionCount: assertions.length,
        openDecisions: decisions.map((d) => ({ id: String(d._id), title: d.title, summary: d.summary })),
        pendingApprovals: approvals.map((a) => ({ id: String(a._id), title: a.title, createdAt: a.createdAt })),
        recentEvents: events.map((e) => ({ id: String(e._id), eventType: e.eventType, receivedAt: e.receivedAt })),
        activeWorkflows: workflows
          .filter((w) => w.status === "running" || w.status === "waiting")
          .map((w) => ({ id: String(w._id), name: w.definitionId })),
      },
      industryKnowledge,
      authorityKnowledge,
      memory: assertions.map((a) => ({
        id: String(a._id),
        statement: a.statement,
        classification: a.classification,
        confidence: a.confidence,
      })),
      jurisdiction: {
        path: [jurisCtx.country, jurisCtx.state, jurisCtx.municipality].filter((p): p is string => !!p),
        industry: jurisCtx.industry,
      },
    });

    return {
      generatedAt: now,
      timezone,
      context: {
        entityCount: entities.length,
        assertionCount: assertions.length,
        openDecisionCount: decisions.length,
        pendingApprovalCount: approvals.length,
        recentEventCount: events.length,
        activeWorkflowCount: workflows.filter((w) => w.status === "running" || w.status === "waiting").length,
        activePacks: industryKnowledge.map((p) => p.title),
        jurisdiction: { path: [jurisCtx.country, jurisCtx.state, jurisCtx.municipality].filter((p): p is string => !!p), industry: jurisCtx.industry },
      },
      insights,
      packNames: packsById,
    };
  },
});
