// ---------------------------------------------------------------------------
// Everest — Business Brain boundary normalizers.
//
// Every RPC the Business Brain page consumes returns jsonb where optional
// collections can be MISSING or null (the same class of production defect that
// crashed ArchiveDetail: `Cannot read properties of undefined (reading
// 'length')`). These normalizers run at the api.ts boundary and guarantee:
//
//   - every collection is ALWAYS an array ([] when absent/null/scalar)
//   - every optional object is an honest object or null (never undefined)
//   - tenant/registry rows are enriched with the static metadata the page
//     renders (tier labels/weights, retrieval meta, computed applicability,
//     health/freshness derived from real check records)
//
// They never fabricate records: a missing source stays missing, an empty
// registry stays empty, and applicability FAILS CLOSED when the operating
// context cannot be verified.
// ---------------------------------------------------------------------------

import { temporalSnapshot } from "@/lib/atlas-data/calendar";
import { AUTHORITY_TIERS, SOURCE_RETRIEVAL_META } from "@/lib/atlas-data/authority";
import { freshnessState, freshnessWindow } from "@/lib/atlas-data/excellence";

/** Coerce any value to an array — null/undefined/scalars become []. */
export function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Coerce any value to a plain object — null/undefined/arrays become {}. */
export function asObj(v: unknown): Record<string, any> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {};
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function strArray(v: unknown): string[] {
  return asArray<unknown>(v).filter((x): x is string => typeof x === "string");
}

/** The browser's own timezone — used for the user-side temporal snapshot. */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  } catch {
    return "UTC";
  }
}

// ---------------------------------------------------------------------------
// Organization context
// ---------------------------------------------------------------------------

export interface NormalizedOrgContextShape {
  tenantId: string | null;
  context: {
    country: string | null;
    regions: string[];
    cities: string[];
    primaryTimezone: string | null;
    locale: string | null;
    currency: string | null;
    fiscalYearStart: string | null;
    businessDays: number[];
    businessHours: { start: string; end: string } | null;
    holidays: string[];
    jurisdictions: string[];
    timezoneNote: string | null;
    industry: string | null;
    businessModel: string | null;
    companySize: string | null;
  } | null;
  profile: {
    companyName: string | null;
    country: string | null;
    stateProvince: string | null;
    city: string | null;
    industry: string | null;
    businessModel: string | null;
    companySize: string | null;
    onboardingComplete: string | null;
  } | null;
  organization: {
    name: string;
    timezone: string;
    snapshot: ReturnType<typeof temporalSnapshot>;
  };
  locations: Array<{
    _id: string;
    name: string;
    kind: string;
    timezone: string | null;
    jurisdiction: string | null;
    country: string | null;
    region: string | null;
    city: string | null;
    primary: boolean | null;
  }>;
  user: {
    timezone: string;
    snapshot: ReturnType<typeof temporalSnapshot>;
  };
  timezoneNote: string | null;
}

/**
 * Deployed `everest_get_organization_context()` returns
 * `{ tenantId, context, timezoneNote, profile, locations }` — NOT the
 * Convex-era `{ context, organization, user, locations }` shape the page was
 * written against. This maps the deployed response to the page contract and
 * derives the temporal snapshots (organization + user) from the real context
 * via the same deterministic calendar engine used everywhere else.
 *
 * `null` in → `null` out (backend failure → the page shows an error state).
 * A successful-but-empty response (`{ context: null, locations: [] }`) is
 * NOT null — it becomes a normalized shape with honest empty fields so the
 * form still renders with defaults.
 */
export function normalizeOrganizationContextResponse(
  raw: unknown,
  now: number = Date.now(),
  tz: string = browserTimezone(),
): NormalizedOrgContextShape | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = asObj(raw);

  const contextRaw = src.context == null ? null : asObj(src.context);
  const businessHoursRaw = contextRaw ? asObj(contextRaw.businessHours) : {};
  const profileRaw = src.profile == null ? null : asObj(src.profile);

  const context =
    contextRaw == null
      ? null
      : {
          country: str(contextRaw.country),
          regions: strArray(contextRaw.regions),
          cities: strArray(contextRaw.cities),
          primaryTimezone: str(contextRaw.primaryTimezone),
          locale: str(contextRaw.locale),
          currency: str(contextRaw.currency),
          fiscalYearStart: str(contextRaw.fiscalYearStart),
          businessDays: asArray<unknown>(contextRaw.businessDays).filter(
            (d): d is number => typeof d === "number",
          ),
          businessHours:
            str(businessHoursRaw.start) || str(businessHoursRaw.end)
              ? {
                  start: str(businessHoursRaw.start) ?? "09:00",
                  end: str(businessHoursRaw.end) ?? "17:00",
                }
              : null,
          holidays: strArray(contextRaw.holidays),
          jurisdictions: strArray(contextRaw.jurisdictions),
          timezoneNote: str(contextRaw.timezoneNote),
          industry: str(contextRaw.industry),
          businessModel: str(contextRaw.businessModel),
          companySize: str(contextRaw.companySize),
        };

  const profile =
    profileRaw == null
      ? null
      : {
          companyName: str(profileRaw.companyName),
          country: str(profileRaw.country),
          stateProvince: str(profileRaw.stateProvince),
          city: str(profileRaw.city),
          industry: str(profileRaw.industry),
          businessModel: str(profileRaw.businessModel),
          companySize: str(profileRaw.companySize),
          onboardingComplete: str(profileRaw.onboardingComplete),
        };

  const orgTz = context?.primaryTimezone ?? tz ?? "UTC";
  const userTz = tz ?? "UTC";

  const locations = asArray<unknown>(src.locations).map((l) => {
    const o = asObj(l);
    return {
      _id: str(o._id) ?? String(o.id ?? ""),
      name: str(o.name) ?? "",
      kind: str(o.kind) ?? "branch",
      timezone: str(o.timezone),
      jurisdiction: str(o.jurisdiction),
      country: str(o.country),
      region: str(o.region),
      city: str(o.city),
      primary: typeof o.primary === "boolean" ? o.primary : null,
    };
  });

  return {
    tenantId: str(src.tenantId),
    context,
    profile,
    organization: {
      name: profile?.companyName ?? "Your organization",
      timezone: orgTz,
      snapshot: temporalSnapshot(now, {
        timezone: orgTz,
        businessDays: context?.businessDays,
        businessHours: context?.businessHours ?? undefined,
        holidays: context?.holidays,
        fiscalYearStart: context?.fiscalYearStart,
      }),
    },
    locations,
    user: {
      timezone: userTz,
      snapshot: temporalSnapshot(now, { timezone: userTz }),
    },
    timezoneNote: str(src.timezoneNote),
  };
}

// ---------------------------------------------------------------------------
// Authoritative knowledge (jurisdiction, tiers, sources, knowledge)
// ---------------------------------------------------------------------------

/** Operating-context slice used for applicability evaluation. */
export interface ApplicabilityContext {
  country?: string | null;
  regions?: string[] | null;
  cities?: string[] | null;
  industry?: string | null;
}

/**
 * Fail-closed applicability: knowledge is only "applicable" when its
 * jurisdiction/industry can be verified against the operating context. With
 * no context configured, nothing is applicable — with a reason, never a
 * silent pass.
 */
export function computeApplicability(
  knowledge: { jurisdiction?: string | null; industry?: string | null },
  context: ApplicabilityContext | null | undefined,
): { applicable: boolean; reason: string; missingFactors: string[] } {
  const kJur = (knowledge.jurisdiction ?? "").trim().toLowerCase();
  const kInd = (knowledge.industry ?? "").trim().toLowerCase();
  const ctx = context ? asObj(context) : {};
  const path = [
    str(ctx.country),
    ...strArray(ctx.regions),
    ...strArray(ctx.cities),
  ].filter((x): x is string => Boolean(x)).map((x) => x.toLowerCase());
  const ctxIndustry = str(ctx.industry)?.toLowerCase() ?? null;

  const missingFactors: string[] = [];
  let applicable = true;
  let reason = "";

  if (kJur) {
    const kParts = kJur
      .split(">")
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    if (path.length === 0) {
      applicable = false;
      missingFactors.push("jurisdiction");
      reason = "Operating context has no jurisdiction configured — applicability cannot be verified.";
    } else if (!kParts.some((p) => path.includes(p))) {
      applicable = false;
      reason = `Knowledge applies to ${knowledge.jurisdiction} — not the configured operating context.`;
    }
  }

  if (applicable && kInd) {
    if (!ctxIndustry) {
      applicable = false;
      missingFactors.push("industry");
      reason = "Operating context has no industry configured — applicability cannot be verified.";
    } else if (kInd !== ctxIndustry) {
      applicable = false;
      reason = `Knowledge is ${knowledge.industry}-specific — the operating context is ${ctx.industry}.`;
    }
  }

  return { applicable, reason, missingFactors };
}

function enrichSource(o: Record<string, any>): Record<string, any> {
  const tier =
    typeof o.authorityTier === "string" ? AUTHORITY_TIERS[o.authorityTier as keyof typeof AUTHORITY_TIERS] : undefined;
  const meta = typeof o.sourceId === "string" ? SOURCE_RETRIEVAL_META[o.sourceId] : undefined;
  return {
    ...o,
    sourceId: str(o.sourceId) ?? String(o._id ?? ""),
    tierLabel: tier?.label ?? str(o.tierLabel) ?? str(o.authorityTier) ?? null,
    tierWeight: tier?.weight ?? (typeof o.tierWeight === "number" ? o.tierWeight : 0),
    retrievalMethod: meta?.retrievalMethod ?? str(o.retrievalMethod) ?? "declared",
    implementationStatus: meta?.implementationStatus ?? str(o.implementationStatus) ?? "declared",
    enabled: typeof o.enabled === "boolean" ? o.enabled : (meta?.enabled ?? true),
    subjects: strArray(o.subjects).length ? strArray(o.subjects) : (meta?.subjects ?? []),
    knowledgeCount: typeof o.knowledgeCount === "number" ? o.knowledgeCount : 0,
  };
}

function enrichKnowledge(
  k: Record<string, any>,
  context: ApplicabilityContext | null | undefined,
): Record<string, any> {
  const source = asObj(k.source);
  const tier =
    typeof source.authorityTier === "string"
      ? AUTHORITY_TIERS[source.authorityTier as keyof typeof AUTHORITY_TIERS]
      : undefined;
  const sourceObj = {
    sourceId: str(source.sourceId),
    name: str(source.name),
    organization: str(source.organization),
    authorityTier: str(source.authorityTier),
    tierLabel: tier?.label ?? null,
    sourceType: str(source.sourceType),
    canonicalUrl: str(source.canonicalUrl),
  };
  const version = str(k.version);
  const provenanceAnswer = sourceObj.name
    ? `${sourceObj.name}${tier ? ` (${tier.label})` : ""}${version ? `, version ${version}` : ""}. Retrieved from the authoritative registry.`
    : null;
  return {
    ...k,
    knowledgeId: str(k.knowledgeId) ?? String(k._id ?? ""),
    title: str(k.title) ?? "",
    statement: str(k.statement) ?? "",
    source: sourceObj,
    tierLabel: tier?.label ?? str(k.tierLabel) ?? null,
    tierWeight: tier?.weight ?? (typeof k.tierWeight === "number" ? k.tierWeight : 0),
    applicability: computeApplicability(
      { jurisdiction: str(k.jurisdiction), industry: str(k.industry) },
      context,
    ),
    provenanceAnswer,
  };
}

/**
 * Deployed `everest_list_authoritative_knowledge()` returns
 * `{ jurisdiction: {path, industry}, tiers, sources, knowledge }`. Arrays are
 * guaranteed, tier labels/weights and retrieval metadata are merged from the
 * static registries (the deployed RPC keeps tiers static client-side), and
 * every knowledge row gets a computed fail-closed applicability + provenance
 * answer. `context` is the tenant's org context (may be null → fail closed).
 */
export function normalizeAuthoritativeKnowledgeResponse(
  raw: unknown,
  context?: ApplicabilityContext | null,
): {
  jurisdiction: { path: string[]; industry: string | null };
  tiers: Record<string, any>;
  sources: Record<string, any>[];
  knowledge: Record<string, any>[];
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { jurisdiction: { path: [], industry: null }, tiers: {}, sources: [], knowledge: [] };
  }
  const src = asObj(raw);
  const jRaw = asObj(src.jurisdiction);
  return {
    jurisdiction: {
      path: strArray(jRaw.path),
      industry: str(jRaw.industry),
    },
    tiers: asObj(src.tiers),
    sources: asArray<unknown>(src.sources).map((s) => enrichSource(asObj(s))),
    knowledge: asArray<unknown>(src.knowledge).map((k) => enrichKnowledge(asObj(k), context)),
  };
}

// ---------------------------------------------------------------------------
// Authority monitor
// ---------------------------------------------------------------------------

/**
 * Deployed `everest_authority_monitor()` returns `{ now, sources }` where each
 * source only carries the registry row + `recentChecks: []`. Health/freshness
 * are DERIVED from actual check records (never from registry existence), with
 * static retrieval metadata merged in.
 */
export function normalizeAuthorityMonitorResponse(raw: unknown): {
  now: number;
  sources: Record<string, any>[];
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { now: Date.now(), sources: [] };
  const src = asObj(raw);
  const now = num(src.now) ?? Date.now();
  const sources = asArray<unknown>(src.sources).map((s) => {
    const o = asObj(s);
    const tier =
      typeof o.authorityTier === "string"
        ? AUTHORITY_TIERS[o.authorityTier as keyof typeof AUTHORITY_TIERS]
        : undefined;
    const meta = typeof o.sourceId === "string" ? SOURCE_RETRIEVAL_META[o.sourceId] : undefined;
    const checks = asArray<unknown>(o.recentChecks).map((c) => asObj(c));
    const lastCheckedAt = num(o.lastCheckedAt) ?? num(checks[0]?.checkedAt) ?? null;
    const lastSuccessfulAt =
      num(o.lastSuccessfulSyncAt) ??
      num(checks.find((c) => c.success === true || c.ok === true)?.checkedAt) ??
      null;
    const consecutiveFailures =
      typeof o.consecutiveFailures === "number"
        ? o.consecutiveFailures
        : checks.filter((c) => c.success !== true && c.ok !== true).length;
    const latestFailed = checks.length > 0 && checks[0].success !== true && checks[0].ok !== true;

    let health = "unknown";
    if (lastCheckedAt != null) {
      if (latestFailed) health = "degraded";
      else if (lastSuccessfulAt == null) health = "degraded";
      else {
        const age = now - lastCheckedAt;
        const window = freshnessWindow(o.updateFrequency);
        health = age <= window * 1.5 ? "healthy" : "stale";
      }
    }
    const freshness =
      lastCheckedAt == null
        ? "verification_required"
        : freshnessState(lastCheckedAt, o.updateFrequency, now, str(o.status) ?? undefined);

    return {
      ...o,
      sourceId: str(o.sourceId) ?? String(o._id ?? ""),
      tierLabel: tier?.label ?? str(o.tierLabel) ?? str(o.authorityTier) ?? null,
      tierWeight: tier?.weight ?? (typeof o.tierWeight === "number" ? o.tierWeight : 0),
      retrievalMethod: meta?.retrievalMethod ?? str(o.retrievalMethod) ?? "declared",
      implementationStatus: meta?.implementationStatus ?? str(o.implementationStatus) ?? "declared",
      enabled: typeof o.enabled === "boolean" ? o.enabled : (meta?.enabled ?? true),
      subjects: strArray(o.subjects).length ? strArray(o.subjects) : (meta?.subjects ?? []),
      health,
      freshness,
      lastCheckedAt,
      lastSuccessfulSyncAt: lastSuccessfulAt,
      consecutiveFailures,
      recentChecks: checks,
      lastKnownVersion: str(o.lastKnownVersion) ?? null,
      contentHash: str(o.contentHash) ?? null,
      lastChangeType: str(o.lastChangeType) ?? null,
      lastLatencyMs: num(o.lastLatencyMs),
      lastFetchError: str(o.lastFetchError) ?? null,
    };
  });
  return { now, sources };
}

// ---------------------------------------------------------------------------
// Knowledge changes + impact assessments
// ---------------------------------------------------------------------------

/** Coerce a possibly-missing array RPC result into a guaranteed array. */
export function normalizeKnowledgeChanges(raw: unknown): Record<string, any>[] {
  return asArray<unknown>(raw).map((v) => {
    const o = asObj(v);
    return {
      ...o,
      versionId: str(o.versionId) ?? String(o._id ?? ""),
      sourceName: str(o.sourceName),
      sourceTier: str(o.sourceTier),
      confidence: typeof o.confidence === "number" ? o.confidence : 0,
      supersedesId: str(o.supersedesId),
      supersededById: str(o.supersededById),
    };
  });
}

export function normalizeImpactAssessments(raw: unknown): Record<string, any>[] {
  return asArray<unknown>(raw).map((v) => {
    const o = asObj(v);
    return {
      ...o,
      _id: str(o._id) ?? String(o.id ?? ""),
      affectedWorkflowIds: asArray(o.affectedWorkflowIds),
      affectedJurisdictions: asArray(o.affectedJurisdictions),
      affectedIndustries: asArray(o.affectedIndustries),
      requiresHumanReview: o.requiresHumanReview === true,
      confidence: typeof o.confidence === "number" ? o.confidence : 0,
    };
  });
}
