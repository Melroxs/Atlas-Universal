// ---------------------------------------------------------------------------
// Everest — Intelligence Foundation API
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { mutation, query } from "../_generated/server";
import { AUTHORITATIVE_KNOWLEDGE_SEEDS, AUTHORITATIVE_SOURCE_SEEDS, AUTHORITY_TIERS, buildProvenance, provenanceAnswer, tierLabel, tierWeight } from "./authority";
import { BUSINESS_BRAIN, MATURITY_KEYS, disambiguateTerm, maturityGuidance } from "./business";
import { temporalSnapshot, tzForLocation } from "./calendar";
import { deriveCoverage } from "./coverage";
import { CLAIM_EVIDENCE_CATEGORIES, CLAIM_LIFECYCLE, CLAIM_BASELINE, analyzeRecoveryOpportunities } from "./insurance";
import { evaluateApplicability } from "./jurisdiction";
import { requireTenant, requireUser } from "../helpers";

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
    carrierResponse: v.optional(v.string()),
    paymentAmount: v.optional(v.number()),
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
      await ctx.db.insert("authoritativeSources", {
        ...s,
        lastCheckedAt: Date.now(),
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
      });
      seededKnowledge++;
    }
    return { seededSources, seededKnowledge };
  },
});
