import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation } from "./_generated/server";
import { requireTenant, requireUser } from "./helpers";

export const updateCompanyProfile = mutation({
  args: {
    companyName: v.optional(v.string()),
    country: v.optional(v.string()),
    stateProvince: v.optional(v.string()),
    city: v.optional(v.string()),
    operatingGeography: v.optional(v.string()),
    industry: v.optional(v.string()),
    subIndustry: v.optional(v.string()),
    companySize: v.optional(v.string()),
    employeeCount: v.optional(v.number()),
    businessModel: v.optional(v.string()),
    servicesProducts: v.optional(v.array(v.string())),
    website: v.optional(v.string()),
    onboardingStep: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const profile = await ctx.db
      .query("companyProfiles")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .first();
    if (!profile) throw new Error("Workspace profile missing.");

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.companyName !== undefined) patch.companyName = args.companyName;
    if (args.country !== undefined) patch.country = args.country;
    if (args.stateProvince !== undefined) patch.stateProvince = args.stateProvince;
    if (args.city !== undefined) patch.city = args.city;
    if (args.operatingGeography !== undefined)
      patch.operatingGeography = args.operatingGeography;
    if (args.industry !== undefined) patch.industry = args.industry;
    if (args.subIndustry !== undefined) patch.subIndustry = args.subIndustry;
    if (args.companySize !== undefined) patch.companySize = args.companySize;
    if (args.employeeCount !== undefined) patch.employeeCount = args.employeeCount;
    if (args.businessModel !== undefined) patch.businessModel = args.businessModel;
    if (args.servicesProducts !== undefined)
      patch.servicesProducts = args.servicesProducts;
    if (args.website !== undefined) patch.website = args.website;
    if (args.onboardingStep !== undefined)
      patch.onboardingStep = args.onboardingStep;

    await ctx.db.patch(profile._id, patch);
  },
});

export const saveCompanySystem = mutation({
  args: {
    name: v.string(),
    category: v.optional(v.string()),
    vendor: v.optional(v.string()),
    status: v.union(
      v.literal("active"),
      v.literal("planned"),
      v.literal("none"),
    ),
  },
  handler: async (ctx, { name, category, vendor, status }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    if (status !== "none") {
      const existing = await ctx.db
        .query("companySystems")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .filter((q) => q.eq(q.field("name"), name))
        .first();
      if (!existing) {
        await ctx.db.insert("companySystems", {
          tenantId,
          name,
          category,
          vendor,
          status,
        });
      }
    }
    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: "system_added",
      targetType: "company_system",
      metadata: { name, category, vendor, status },
    });
  },
});

/**
 * Finish onboarding: mark complete and initialize the tenant's Intelligence
 * Model by activating the packs that apply to its industry/geography.
 */
export const completeOnboarding = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const profile = await ctx.db
      .query("companyProfiles")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .first();
    if (!profile) throw new Error("Workspace profile missing.");

    await ctx.db.patch(profile._id, {
      onboardingStep: 5,
      onboardingComplete: true,
      updatedAt: Date.now(),
    });

    // Intelligence Model initialization — always-on universal packs first.
    const activation: Array<{ packKey: string }> = [
      { packKey: "atlas-core" },
      { packKey: "general-business" },
    ];
    const industry = (profile.industry ?? "").toLowerCase();
    // Order matters: "property management" must be checked before the generic
    // "property" match used by insurance restoration.
    if (industry.includes("property management")) {
      activation.push({ packKey: "property-management" });
    } else if (
      industry.includes("restoration") ||
      industry.includes("construction") ||
      industry.includes("mitigation") ||
      industry.includes("roof") ||
      industry.includes("property")
    ) {
      activation.push({ packKey: "insurance-restoration" });
    } else if (industry.includes("legal") || industry.includes("law")) {
      activation.push({ packKey: "legal" });
    } else if (industry.includes("health")) {
      activation.push({ packKey: "healthcare" });
    } else if (
      industry.includes("software") ||
      industry.includes("saas") ||
      industry.includes("technology")
    ) {
      activation.push({ packKey: "saas" });
    } else if (industry.includes("real estate")) {
      activation.push({ packKey: "real-estate" });
    } else if (industry.includes("solar")) {
      activation.push({ packKey: "solar" });
    } else if (industry.includes("manufacturing")) {
      activation.push({ packKey: "manufacturing" });
    } else if (industry.includes("logistic") || industry.includes("supply chain")) {
      activation.push({ packKey: "logistics" });
    } else if (industry.includes("financial")) {
      activation.push({ packKey: "financial-services" });
    } else if (
      industry.includes("professional services") ||
      industry.includes("consulting")
    ) {
      activation.push({ packKey: "professional-services" });
    }
    if ((profile.country ?? "").toLowerCase().includes("united")) {
      activation.push({ packKey: "us-federal" });
    }

    for (const a of activation) {
      await ctx.runMutation(internal.internal.activateTenantPack, {
        tenantId,
        packKey: a.packKey,
        userId,
      });
    }

    // Register a manual file-source connection so ingestion is available.
    const conn = await ctx.db
      .query("connections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .filter((q) => q.eq(q.field("provider"), "manual_upload"))
      .first();
    if (!conn) {
      await ctx.db.insert("connections", {
        tenantId,
        name: "Manual file uploads",
        provider: "manual_upload",
        category: "document_storage",
        status: "connected",
        notes: "Files uploaded directly to Atlas.",
        settings: { kind: "upload" },
      });
    }

    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: "onboarding_completed",
      targetType: "tenant",
      targetId: tenantId,
      metadata: {
        industry: profile.industry,
        activatedPacks: activation.map((a) => a.packKey),
      },
    });

    return { activatedPacks: activation.map((a) => a.packKey) };
  },
});
