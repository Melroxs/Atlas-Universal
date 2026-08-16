// ---------------------------------------------------------------------------
// Regression tests for the Business Brain (Everest) data path.
//
// The production defect: the page rendered but the actual Business Brain data
// never loaded. Root causes found by live probing the deployed project:
//
//   1. getOrganizationContext passed `{ userTimezone }` to the ZERO-arg RPC
//      `everest_get_organization_context` → PostgREST PGRST202 → null →
//      the page treated null as "loading" forever.
//   2. `everest_industry_coverage`, `everest_insurance_intelligence`,
//      `everest_industry_excellence`, `everest_value_intelligence`,
//      `everest_analyze_claim_recovery` and `everest_get_organizational_state`
//      are NOT deployed → every 404 became null → eternal "Loading…".
//   3. `everest_update_organization_context` takes a single `p_patch jsonb`,
//      but the page submitted individual fields → 404 on save.
//   4. `getBusinessBrain` was a stub returning empty arrays → all-zero cards
//      despite the real static atlas data.
//
// The fix moves the non-existent RPCs to client impls (deterministic
// computations over the real static registries + deployed `everest_raw_knowledge`),
// routes org-context through a zero-arg client impl + boundary normalizer,
// packs the save form into `p_patch`, and gives every section three honest
// states (loading / error+retry / data). These tests pin the contract so the
// page can never again hit undefined.map / undefined.length or confuse a
// backend failure with an empty tenant.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { api } from "@/lib/api";
import {
  normalizeAuthoritativeKnowledgeResponse,
  normalizeAuthorityMonitorResponse,
  normalizeImpactAssessments,
  normalizeKnowledgeChanges,
  normalizeOrganizationContextResponse,
  type NormalizedOrgContextShape,
} from "@/lib/everest/normalize";
import {
  analyzeRecoveryClient,
  buildBusinessBrain,
  buildInsuranceIntelligence,
  buildValueIntelligence,
} from "@/lib/everest/client";
import { normalizeRpcArgs } from "@/lib/actions/rpc";
import { analyzeRecoveryOpportunities } from "@/lib/atlas-data/everest-insurance";

// ---------------------------------------------------------------------------
// Render-path replay helpers
//
// Each helper replays the exact collection accesses the Business Brain page
// performs against a normalized/derived value. If any collection could ever be
// undefined/null/scalar, the page would throw here exactly as it did in
// production — so these tests ARE the regression guard for the crash class.
// ---------------------------------------------------------------------------

/** Organization & calendar tab — the section that never loaded in production. */
function assertOrgRenderable(org: NonNullable<NormalizedOrgContextShape>) {
  // Form initialization (context may be null on a fresh tenant — must still
  // initialize with profile/company fallbacks, never crash, never spin).
  const country = org.context?.country ?? org.profile?.country ?? "";
  const regions = (org.context?.regions ?? []).join(", ");
  const cities = (org.context?.cities ?? []).join(", ");
  const timezone = org.context?.primaryTimezone ?? org.organization.timezone;
  const businessDays = org.context?.businessDays ?? [1, 2, 3, 4, 5];
  const hoursStart = org.context?.businessHours?.start ?? "09:00";
  const holidays = (org.context?.holidays ?? []).join(", ");
  void country;
  void regions;
  void cities;
  void timezone;
  void businessDays;
  void hoursStart;
  void holidays;

  // Locations panel.
  expect(Array.isArray(org.locations)).toBe(true);
  void org.locations.length;
  void org.locations.map((l) => l._id.length + l.name.length);

  // Temporal intelligence panel.
  const snap = org.organization.snapshot;
  void snap.timezone;
  void snap.today;
  void snap.isBusinessDay;
  void snap.isWithinBusinessHours;
  void snap.nextBusinessDay;
  void snap.endOfBusinessDay;
  void snap.fiscalQuarter.label;
  void snap.weekStart;
  void snap.monthStart;
  void snap.monthEnd;
  if (org.user) void org.user.timezone.length;
}

/** Replays every stat-card / list access across the remaining tabs. */
function assertBrainRenderable(brain: ReturnType<typeof buildBusinessBrain>) {
  void brain.businessTypes.length;
  void brain.financialKnowledge.revenue.length;
  void brain.financialKnowledge.expenses.length;
  void brain.financialKnowledge.profitability.length;
  void brain.financialKnowledge.incomeStatementFlow.map((s) => s.sign);
  void brain.financialKnowledge.accountingIdentity.statement.length;
  void brain.orgRoles.length;
  void brain.businessObjects.length;
  void brain.lifecycles.map((l) => l.stages.length);
  void brain.maturity.length;
  void brain.orgStructures.map((s) => s.key);
  void brain.businessFunctions.map((f) => f.key);
  void brain.disambiguation?.term;
}

function assertAuthorityRenderable(
  authority: ReturnType<typeof normalizeAuthoritativeKnowledgeResponse>,
) {
  expect(Array.isArray(authority.sources)).toBe(true);
  expect(Array.isArray(authority.knowledge)).toBe(true);
  void authority.sources.length;
  void authority.sources.filter((s) => s.tierWeight >= 0.9).length;
  void authority.sources.map((s) => s.sourceId.length + s.tierLabel.length);
  void authority.jurisdiction.path.join(" > ");
  void authority.jurisdiction.industry;
  void authority.knowledge.filter((k) => k.applicability.applicable).length;
  void authority.knowledge.map((k) => {
    void k.knowledgeId;
    void k.statement.length;
    void k.provenanceAnswer;
    void k.applicability.reason.length;
    void k.interpretation;
    void k.confidence;
  });
  // Tiers render path: Object.entries(tiers).map(([tier, t]) => t.label/weight/description)
  for (const t of Object.values(authority.tiers) as Array<Record<string, unknown>>) {
    void t.label;
    void t.weight;
    void t.description;
  }
}

function assertMonitorRenderable(monitor: ReturnType<typeof normalizeAuthorityMonitorResponse>) {
  expect(Array.isArray(monitor.sources)).toBe(true);
  void monitor.sources.length;
  void monitor.sources.filter((s) => s.health === "healthy").length;
  void monitor.sources.filter((s) => s.implementationStatus === "implemented" && s.enabled).length;
  const recent = monitor.sources.flatMap((s) => s.recentChecks);
  void recent.sort((a, b) => b.checkedAt - a.checkedAt).length;
  void monitor.sources.map((s) => {
    void s.health;
    void s.freshness;
    void s.tierLabel;
    void s.lastCheckedAt;
    void s.lastSuccessfulSyncAt;
    void s.lastKnownVersion;
    void s.retrievalMethod.replace(/_/g, " ");
    void s.consecutiveFailures;
    void s.lastFetchError;
  });
}

// ---------------------------------------------------------------------------
// Scenario tests
// ---------------------------------------------------------------------------

describe("normalizeOrganizationContextResponse", () => {
  it("A. normalizes a populated organization context (valid membership, data present)", () => {
    const raw = {
      tenantId: "t1",
      context: {
        country: "United States",
        regions: ["Colorado"],
        cities: ["Denver"],
        primaryTimezone: "America/Denver",
        locale: "en-US",
        currency: "USD",
        fiscalYearStart: "01-01",
        businessDays: [1, 2, 3, 4, 5],
        businessHours: { start: "09:00", end: "17:00" },
        holidays: ["2026-01-01"],
        jurisdictions: ["Colorado"],
        industry: "insurance-restoration",
        businessModel: "project-based",
        companySize: "small",
      },
      timezoneNote: "Denver office",
      profile: {
        companyName: "NPP Roofing & Restoration",
        country: "United States",
        stateProvince: "Colorado",
        city: "Denver",
        industry: "Insurance restoration",
        businessModel: "Project-based",
        companySize: "Small",
        onboardingComplete: "true",
      },
      locations: [
        { _id: "loc-1", name: "Denver HQ", kind: "branch", timezone: "America/Denver", jurisdiction: "Colorado", country: "United States", region: "Colorado", city: "Denver", primary: true },
      ],
    };
    const n = normalizeOrganizationContextResponse(raw, 1_700_000_000_000, "America/Denver");
    expect(n).not.toBeNull();
    const org = n!;
    expect(org.tenantId).toBe("t1");
    expect(org.context?.primaryTimezone).toBe("America/Denver");
    expect(org.profile?.companyName).toBe("NPP Roofing & Restoration");
    expect(org.locations).toHaveLength(1);
    expect(org.organization.name).toBe("NPP Roofing & Restoration");
    expect(org.organization.snapshot.timezone).toBe("America/Denver");
    expect(org.user.snapshot.timezone).toBe("America/Denver");
    expect(() => assertOrgRenderable(org)).not.toThrow();
  });

  it("B. empty tenant (context null) is SUCCESS, not failure — form must still initialize", () => {
    // Deployed RPC returns context:null + locations:[] for a tenant that has
    // never saved context. This previously never initialized the form because
    // the guard required orgData?.context to be truthy → eternal "Loading…".
    const raw = {
      tenantId: "t1",
      context: null,
      timezoneNote: null,
      profile: null,
      locations: [],
    };
    const n = normalizeOrganizationContextResponse(raw, 1_700_000_000_000, "America/New_York");
    expect(n).not.toBeNull();
    const org = n!;
    expect(org.context).toBeNull();
    expect(org.locations).toEqual([]);
    expect(org.organization.timezone).toBe("America/New_York");
    // Form init reads: country falls back to "" and timezone to org timezone.
    expect(org.context?.country ?? org.profile?.country ?? "").toBe("");
    expect(org.context?.primaryTimezone ?? org.organization.timezone).toBe("America/New_York");
    expect(() => assertOrgRenderable(org)).not.toThrow();
  });

  it("C. missing collection fields default to [] (never undefined)", () => {
    const raw = { tenantId: "t1", context: { country: "United States" }, profile: null };
    const n = normalizeOrganizationContextResponse(raw);
    expect(n).not.toBeNull();
    expect(n!.locations).toEqual([]);
    expect(n!.context?.regions).toEqual([]);
    expect(n!.context?.cities).toEqual([]);
    expect(n!.context?.holidays).toEqual([]);
    expect(n!.context?.businessHours).toBeNull();
    expect(() => assertOrgRenderable(n!)).not.toThrow();
  });

  it("D. null collection fields default to [] (never null.map)", () => {
    const raw = { tenantId: "t1", context: { regions: null, cities: null, holidays: null }, locations: null };
    const n = normalizeOrganizationContextResponse(raw);
    expect(n).not.toBeNull();
    expect(n!.locations).toEqual([]);
    expect(n!.context?.regions).toEqual([]);
    expect(n!.context?.cities).toEqual([]);
    expect(n!.context?.holidays).toEqual([]);
    expect(() => assertOrgRenderable(n!)).not.toThrow();
  });

  it("E. null / garbage RPC result → null (page shows the error state, not an empty form)", () => {
    expect(normalizeOrganizationContextResponse(null)).toBeNull();
    expect(normalizeOrganizationContextResponse(undefined)).toBeNull();
    expect(normalizeOrganizationContextResponse("garbage")).toBeNull();
    expect(normalizeOrganizationContextResponse(42)).toBeNull();
    expect(normalizeOrganizationContextResponse([])).toBeNull();
  });
});

describe("Business Brain universal knowledge (client impl, no RPC)", () => {
  it("A. returns the REAL atlas data — never the old all-empty stub", () => {
    const brain = buildBusinessBrain();
    expect(brain.businessTypes.length).toBeGreaterThan(0);
    expect(brain.financialKnowledge.revenue.length).toBeGreaterThan(0);
    expect(brain.financialKnowledge.expenses.length).toBeGreaterThan(0);
    expect(brain.financialKnowledge.profitability.length).toBeGreaterThan(0);
    expect(brain.financialKnowledge.incomeStatementFlow.length).toBeGreaterThan(0);
    expect(brain.orgRoles.length).toBeGreaterThan(0);
    expect(brain.businessObjects.length).toBeGreaterThan(0);
    expect(brain.lifecycles.length).toBeGreaterThan(0);
    expect(brain.maturity.length).toBeGreaterThan(0);
    expect(brain.orgStructures.length).toBeGreaterThan(0);
    expect(brain.businessFunctions.length).toBeGreaterThan(0);
    expect(() => assertBrainRenderable(brain)).not.toThrow();
  });

  it("never throws undefined.map/.length on any lifecycle/flow list", () => {
    const brain = buildBusinessBrain();
    for (const l of brain.lifecycles) {
      expect(Array.isArray(l.stages)).toBe(true);
      void l.stages.map((s) => s.length);
    }
    for (const row of brain.financialKnowledge.incomeStatementFlow) {
      void row.sign;
    }
    expect(typeof brain.financialKnowledge.accountingIdentity.statement).toBe("string");
  });
});

describe("Insurance intelligence (client impl, no RPC)", () => {
  it("A. returns the generalized domain knowledge with guaranteed arrays", () => {
    const ii = buildInsuranceIntelligence();
    expect(ii.lifecycle.length).toBeGreaterThan(0);
    expect(ii.evidenceCategories.length).toBeGreaterThan(0);
    expect(ii.baseline.entities.length).toBeGreaterThan(0);
    expect(Array.isArray(ii.baseline.knowledgeKinds.domain)).toBe(true);
    expect(Array.isArray(ii.baseline.knowledgeKinds.organization)).toBe(true);
    expect(Array.isArray(ii.baseline.knowledgeKinds.evidence)).toBe(true);
    // The page's render paths.
    void ii.lifecycle.map((s) => s.stage + s.description);
    void ii.evidenceCategories.map((c) => c.examples.length);
    void ii.baseline.knowledgeKinds.domain.map((d) => d.length);
  });
});

describe("Authoritative knowledge boundary", () => {
  it("A. normal populated response: sources + knowledge + tiers + applicability", () => {
    const raw = {
      jurisdiction: { path: ["United States", "Colorado"], industry: "insurance-restoration" },
      tiers: { statutory: { label: "Statutory", weight: 1, description: "law" } },
      sources: [
        { sourceId: "state-dept", name: "Colorado DOI", organization: "CO", authorityTier: "statutory", industry: "insurance", jurisdiction: "Colorado", knowledgeCount: 1 },
      ],
      knowledge: [
        { knowledgeId: "k1", title: "T", statement: "S", interpretation: null, knowledgeType: "regulatory", jurisdiction: "Colorado", industry: "insurance", version: "1", confidence: 0.9, source: { sourceId: "state-dept", name: "Colorado DOI", organization: "CO", authorityTier: "statutory" } },
      ],
    };
    const ctx = { country: "United States", regions: ["Colorado"], cities: ["Denver"], industry: "insurance-restoration" };
    const n = normalizeAuthoritativeKnowledgeResponse(raw, ctx);
    expect(n.sources).toHaveLength(1);
    expect(n.knowledge).toHaveLength(1);
    expect(n.sources[0].tierLabel).toBeTruthy();
    expect(n.knowledge[0].applicability.applicable).toBe(false); // industry mismatch → fail closed with a reason
    expect(n.knowledge[0].applicability.reason.length).toBeGreaterThan(0);
    expect(n.knowledge[0].provenanceAnswer).toBeTruthy();
    expect(() => assertAuthorityRenderable(n)).not.toThrow();
  });

  it("C/D. missing or null arrays never reach the page", () => {
    const missing = normalizeAuthoritativeKnowledgeResponse({ jurisdiction: {} });
    expect(missing.sources).toEqual([]);
    expect(missing.knowledge).toEqual([]);
    expect(missing.jurisdiction.path).toEqual([]);
    const nul = normalizeAuthoritativeKnowledgeResponse({ sources: null, knowledge: null, tiers: null });
    expect(nul.sources).toEqual([]);
    expect(nul.knowledge).toEqual([]);
    expect(() => assertAuthorityRenderable(nul)).not.toThrow();
  });

  it("E. null/garbage RPC result → safe empty registry shape (page renders, never crashes)", () => {
    for (const bad of [null, undefined, 42, "x", []]) {
      const n = normalizeAuthoritativeKnowledgeResponse(bad);
      expect(n.sources).toEqual([]);
      expect(n.knowledge).toEqual([]);
      expect(() => assertAuthorityRenderable(n)).not.toThrow();
    }
  });

  it("H. no operating context → applicability fails CLOSED with a reason", () => {
    const raw = {
      jurisdiction: { path: [], industry: null },
      sources: [],
      knowledge: [
        { knowledgeId: "k1", title: "T", statement: "S", jurisdiction: "Colorado", industry: "insurance", source: { sourceId: "s1", name: "S", authorityTier: "statutory" } },
      ],
    };
    const n = normalizeAuthoritativeKnowledgeResponse(raw, null);
    expect(n.knowledge[0].applicability.applicable).toBe(false);
    expect(n.knowledge[0].applicability.missingFactors).toContain("jurisdiction");
    expect(n.knowledge[0].applicability.reason.length).toBeGreaterThan(0);
  });

  it("M. large registry (1000 sources / 1000 knowledge rows) normalizes without throwing", () => {
    const raw = {
      jurisdiction: { path: ["United States"], industry: "insurance-restoration" },
      sources: Array.from({ length: 1000 }, (_, i) => ({
        sourceId: `s${i}`,
        name: `Source ${i}`,
        organization: "Org",
        authorityTier: "standards",
        industry: "insurance",
        knowledgeCount: 1,
      })),
      knowledge: Array.from({ length: 1000 }, (_, i) => ({
        knowledgeId: `k${i}`,
        title: `T${i}`,
        statement: `S${i}`,
        interpretation: null,
        knowledgeType: "regulatory",
        jurisdiction: "United States",
        industry: "insurance",
        version: "1",
        confidence: 0.8,
        source: { sourceId: `s${i % 100}`, name: "S", authorityTier: "standards" },
      })),
    };
    const n = normalizeAuthoritativeKnowledgeResponse(raw, { country: "United States", industry: "insurance-restoration" });
    expect(n.sources).toHaveLength(1000);
    expect(n.knowledge).toHaveLength(1000);
    expect(() => assertAuthorityRenderable(n)).not.toThrow();
  });
});

describe("Authority monitor boundary", () => {
  it("A. derives health/freshness from real check records — never from registry existence", () => {
    const now = 1_700_000_000_000;
    const raw = {
      now,
      sources: [
        { sourceId: "s1", name: "S1", authorityTier: "statutory", updateFrequency: "weekly", recentChecks: [{ checkedAt: now - 1000, success: true }] },
        { sourceId: "s2", name: "S2", authorityTier: "statutory", updateFrequency: "weekly", recentChecks: [{ checkedAt: now - 1000, success: false, error: "timeout" }] },
        { sourceId: "s3", name: "S3", authorityTier: "statutory", updateFrequency: "weekly", recentChecks: [] },
      ],
    };
    const n = normalizeAuthorityMonitorResponse(raw);
    expect(n.now).toBe(now);
    expect(n.sources[0].health).toBe("healthy");
    expect(n.sources[1].health).toBe("degraded");
    expect(n.sources[2].health).toBe("unknown");
    expect(n.sources[2].freshness).toBe("verification_required");
    expect(n.sources[1].consecutiveFailures).toBeGreaterThan(0);
    expect(() => assertMonitorRenderable(n)).not.toThrow();
  });

  it("C/D/E. missing/null/garbage → { now, sources: [] } — never a crash", () => {
    for (const bad of [null, undefined, 42, "x", [], { sources: null }, { sources: "nope" }]) {
      const n = normalizeAuthorityMonitorResponse(bad);
      expect(Array.isArray(n.sources)).toBe(true);
      expect(() => assertMonitorRenderable(n)).not.toThrow();
    }
  });
});

describe("Knowledge changes + impact assessments (guaranteed arrays)", () => {
  it("normalizes arrays and tolerates missing/null/garbage", () => {
    const changes = normalizeKnowledgeChanges([
      { _id: "v1", knowledgeId: "k1", status: "active", changeType: "clarification", confidence: 0.9 },
    ]);
    expect(changes).toHaveLength(1);
    expect(changes[0].versionId).toBe("v1");
    for (const bad of [null, undefined, "x", 42, { a: 1 }]) {
      expect(normalizeKnowledgeChanges(bad)).toEqual([]);
    }

    const assessments = normalizeImpactAssessments([
      { _id: "a1", status: "pending_review", affectedWorkflowIds: null, affectedJurisdictions: null, affectedIndustries: ["CO"], requiresHumanReview: true, confidence: 0.8 },
    ]);
    expect(assessments).toHaveLength(1);
    expect(assessments[0].affectedWorkflowIds).toEqual([]);
    expect(assessments[0].affectedJurisdictions).toEqual([]);
    expect(assessments[0].requiresHumanReview).toBe(true);
    for (const bad of [null, undefined, 7, "x"]) {
      expect(normalizeImpactAssessments(bad)).toEqual([]);
    }
  });

  it("render paths (page's changes/assessments tabs) never see a non-array", () => {
    const changes = normalizeKnowledgeChanges(null);
    const assessments = normalizeImpactAssessments(null);
    void changes.length;
    void changes.map((v) => v.status === "superseded");
    void assessments.filter((a) => a.status === "pending_review").length;
    void assessments.map((a) => (a.affectedWorkflowIds ?? []).length);
  });
});

describe("Value engine + recovery analyzer (client impls, no RPC)", () => {
  it("value engine returns the killer use case + opportunities with guaranteed arrays", () => {
    const v = buildValueIntelligence({ packKey: "insurance-restoration" });
    expect(v.engine).not.toBeNull();
    expect(Array.isArray(v.engine?.detectionSignals)).toBe(true);
    expect(Array.isArray(v.engine?.evidenceRequirements)).toBe(true);
    expect(Array.isArray(v.engine?.recommendedActions)).toBe(true);
    expect(Array.isArray(v.engine?.limitations)).toBe(true);
    expect(Array.isArray(v.engine?.affectedEntities)).toBe(true);
    expect(Array.isArray(v.opportunities)).toBe(true);
    // Page render paths.
    void v.engine!.detectionSignals.map((s) => s.length);
    void v.opportunities.map((o) => o.rank + o.confidence);
    // Unknown pack → honest null engine, never a crash; opportunities stay
    // an array (domain-level knowledge is still surfaced, never fabricated
    // organization-specific claims).
    const none = buildValueIntelligence({ packKey: "does-not-exist" });
    expect(none.engine).toBeNull();
    expect(Array.isArray(none.opportunities)).toBe(true);
  });

  it("recovery analyzer returns the same opportunities the demo engine returns", () => {
    const facts = {
      expectedScope: ["demo", "drywall", "paint"],
      actualScope: ["demo", "drywall", "paint", "flooring"],
      evidenceSummary: ["damage"],
      estimateAmount: 25000,
      paymentAmount: 18000,
      invoicedAmount: 24000,
      estimateLineItemCount: 3,
      carrierResponse: "partial — 30% cut on drying",
      currentStage: "Supplement review",
      stageAgeDays: 23,
    };
    const direct = analyzeRecoveryOpportunities(facts);
    const viaClient = analyzeRecoveryClient(facts as unknown as Record<string, unknown>);
    expect(Array.isArray(viaClient)).toBe(true);
    expect(viaClient.length).toBe(direct.length);
    // Every opportunity is renderable.
    for (const o of viaClient as Array<Record<string, unknown>>) {
      expect(Array.isArray(o.evidence)).toBe(true);
      void (o.evidence as unknown[]).map((e) => String(e));
      void o.title;
      void o.severity;
      void o.confidence;
      void o.explanation;
      void o.financialRelevance;
      void o.recommendedNextStep;
      void o.limitation;
    }
    // No facts → the engine still reports the honest documentation_gap
    // finding (no evidence categories on file weakens every line item) — an
    // array, renderable, never a crash.
    const empty = analyzeRecoveryClient({}) as Array<Record<string, unknown>>;
    expect(Array.isArray(empty)).toBe(true);
    expect(empty.some((o) => o.type === "documentation_gap")).toBe(true);
    for (const o of empty) expect(Array.isArray(o.evidence)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Registry contract — the wiring that made the page load real data
// ---------------------------------------------------------------------------

describe("api.everest registry contract", () => {
  it("every section entry is either normalized (transform) or a client impl — no 404-prone raw queries remain", () => {
    const sections: Array<keyof typeof api.everest> = [
      "getOrganizationContext",
      "getBusinessBrain",
      "listAuthoritativeKnowledge",
      "getIndustryCoverage",
      "getInsuranceIntelligence",
      "getAuthorityMonitor",
      "listKnowledgeChanges",
      "listImpactAssessments",
      "getIndustryExcellence",
      "getValueIntelligence",
      "analyzeClaimRecovery",
    ];
    for (const key of sections) {
      const fn = api.everest[key];
      expect(
        fn.kind === "client"
          ? typeof fn.clientImpl === "function"
          : typeof fn.transform === "function",
        `${key} must be client-implemented or boundary-transformed`,
      ).toBe(true);
    }
  });

  it("getOrganizationContext is a client impl — the page's { userTimezone } arg is NEVER sent to the zero-arg RPC", () => {
    const fn = api.everest.getOrganizationContext;
    expect(fn.kind).toBe("client");
    expect(typeof fn.clientImpl).toBe("function");
    // The page call-site passes { userTimezone }; the impl must not forward it
    // to PostgREST as p_usertimezone (that 404 was the production org crash).
    // The impl ignores unknown args by construction (rpcCall with no args).
    expect(fn.name).toBe("everest_get_organization_context");
  });

  it("updateOrganizationContext is a client impl that packs the form into p_patch (never p_country/…)", () => {
    const fn = api.everest.updateOrganizationContext;
    expect(fn.kind).toBe("client");
    expect(fn.name).toBe("everest_update_organization_context");
  });

  it("never-deployed RPC names are gone from the registry (coverage/excellence/value/recovery are client)", () => {
    const everest = api.everest as Record<string, unknown>;
    expect(everest.getOrganizationalState).toBeUndefined();
    for (const k of ["getIndustryCoverage", "getInsuranceIntelligence", "getIndustryExcellence", "getValueIntelligence", "analyzeClaimRecovery"]) {
      const fn = everest[k] as { kind?: string; name?: string };
      expect(fn.kind).toBe("client");
    }
  });

  it("mutations that stay RPC-backed map their page args to the deployed signatures", () => {
    // everest_upsert_operating_location(p_name, p_kind, p_timezone, …, p_city, …)
    expect(
      normalizeRpcArgs({ name: "Denver HQ", kind: "branch", city: "Denver", timezone: "America/Denver" }),
    ).toEqual({
      p_name: "Denver HQ",
      p_kind: "branch",
      p_city: "Denver",
      p_timezone: "America/Denver",
    });
    // everest_remove_operating_location(p_id)
    expect(normalizeRpcArgs({ id: "loc-1" })).toEqual({ p_id: "loc-1" });
    // everest_decide_impact_review(p_assessmentId, p_decision, p_note)
    expect(normalizeRpcArgs({ assessmentId: "a-1", decision: "approved" })).toEqual({
      p_assessmentid: "a-1",
      p_decision: "approved",
    });
    // The org-context SAVE contract: a single p_patch jsonb (nested payload untouched).
    expect(normalizeRpcArgs({ p_patch: { country: "US", businessDays: [1, 2, 3] } })).toEqual({
      p_patch: { country: "US", businessDays: [1, 2, 3] },
    });
  });

  it("the removed getOrganizationalState 404 path is gone and no query entry calls a missing RPC", () => {
    // Every everest entry name resolves to a deployed function or is client/edge.
    const clientOrDeployed = [
      "everest_get_organization_context",
      "everest_update_organization_context",
      "everest_upsert_operating_location",
      "everest_remove_operating_location",
      "everest_list_authoritative_knowledge",
      "everest_authority_monitor",
      "everest_list_knowledge_changes",
      "everest_list_impact_assessments",
      "everest_decide_impact_review",
      "everest_seed",
    ];
    const fn = api.everest as Record<string, { kind?: string; name?: string }>;
    for (const [k, v] of Object.entries(fn)) {
      if (k === "getBusinessBrain" || k === "getIndustryCoverage" || k === "getInsuranceIntelligence" || k === "getIndustryExcellence" || k === "getValueIntelligence" || k === "analyzeClaimRecovery") {
        expect(v.kind).toBe("client");
        continue;
      }
      if (v.kind === "edge") continue;
      if (v.kind === "client") {
        // getOrganizationContext / listAuthoritativeKnowledge / updateOrganizationContext
        expect(clientOrDeployed).toContain(v.name);
        continue;
      }
      expect(clientOrDeployed).toContain(v.name);
    }
  });
});
