// ---------------------------------------------------------------------------
// Everest — client-side data impls.
//
// Migration 0005's own header documents the architecture: "Static knowledge
// (business brain, insurance intelligence, value engines, authority seeds)
// ships with the frontend; these RPCs serve tenant context and the global
// authoritative registries the Everest UI renders."
//
// The Business Brain page calls several everest_* functions that were NEVER
// deployed as RPCs (everest_industry_coverage, everest_insurance_intelligence,
// everest_industry_excellence, everest_value_intelligence,
// everest_analyze_claim_recovery). Those surfaces are deterministic
// computations over the static registries that ship with the frontend — so
// this module implements them as client impls (same pattern the api registry
// already uses for everest_business_brain and events_list_policies). Nothing
// is fabricated: coverage/excellence measure the real registered pack items
// (PACK_SEEDS) plus the real authoritative registry rows from the deployed
// `everest_raw_knowledge` RPC; empty registries yield honest zero scores.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import { rpcCall } from "@/lib/actions/rpc";
import { BUSINESS_BRAIN, MATURITY_KEYS, disambiguateTerm } from "@/lib/atlas-data/business";
import {
  INSURANCE_INTELLIGENCE,
  analyzeRecoveryOpportunities,
  type ClaimFacts,
} from "@/lib/atlas-data/everest-insurance";
import { PACK_SEEDS } from "@/lib/atlas-data/packs";
import { deriveCoverage } from "@/lib/atlas-data/coverage";
import { deriveExcellence } from "@/lib/atlas-data/excellence";
import { valueEngineFor, discoverOpportunities } from "@/lib/atlas-data/value";

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function strArray(v: unknown): string[] {
  return asArray(v).filter((x): x is string => typeof x === "string");
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** The full universal Business Brain — the real static atlas data, not stubs. */
export function buildBusinessBrain() {
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
    // The page renders the Sales/Revenue/Profit ambiguity rows; surface the
    // real guidance for the most commonly ambiguous term ("sales").
    disambiguation: disambiguateTerm("sales"),
  };
}

/** Insurance Restoration deep vertical — generalized domain knowledge. */
export function buildInsuranceIntelligence() {
  const ii = INSURANCE_INTELLIGENCE;
  return {
    lifecycle: ii.lifecycle.map(({ stage, description }) => ({ stage, description })),
    evidenceCategories: ii.evidenceCategories.map(({ key, name, description, examples }) => ({
      key,
      name,
      description,
      examples,
    })),
    baseline: {
      entities: ii.baseline.entities,
      knowledgeKinds: {
        domain: ii.baseline.knowledgeKinds.domain,
        organization: ii.baseline.knowledgeKinds.organization,
        evidence: ii.baseline.knowledgeKinds.evidence,
      },
    },
  };
}

interface EverestRegistry {
  sources: Array<Record<string, any>>;
  knowledge: Array<Record<string, any>>;
}

/**
 * Read the real authoritative registry (deployed `everest_raw_knowledge`).
 * If it is unavailable the measurement degrades honestly to the static pack
 * items with zero authority/source counts — never fabricated rows.
 */
async function readRegistry(supabase: SupabaseClient): Promise<EverestRegistry> {
  try {
    const raw = (await rpcCall(supabase, "everest_raw_knowledge")) as Record<string, any> | null;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      return {
        sources: asArray(raw.sources).filter(
          (s): s is Record<string, any> => Boolean(s) && typeof s === "object",
        ),
        knowledge: asArray(raw.knowledge).filter(
          (k): k is Record<string, any> => Boolean(k) && typeof k === "object",
        ),
      };
    }
  } catch (e) {
    console.error(
      "[atlas] everest registry read failed — measuring coverage/excellence from static packs only:",
      e instanceof Error ? e.message : String(e),
    );
  }
  return { sources: [], knowledge: [] };
}

function industryKey(industry: unknown): string {
  return String(industry ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function matchesPack(industry: unknown, packKey: string): boolean {
  const pk = packKey.replace(/[^a-z0-9]/g, "");
  return pk.length > 0 && industryKey(industry) === pk;
}

/** Industry coverage — measured from real registered pack items + registry. */
export async function buildIndustryCoverage(supabase: SupabaseClient) {
  const registry = await readRegistry(supabase);
  return {
    coverage: PACK_SEEDS.map((p) =>
      deriveCoverage({
        packKey: p.key,
        name: p.name,
        itemTypes: p.items.map((i) => i.itemType),
        authorityKnowledgeCount: registry.knowledge.filter((k) => matchesPack(k.industry, p.key))
          .length,
        sourceCount: registry.sources.filter((s) => matchesPack(s.industry, p.key)).length,
        packType: p.packType,
      }),
    ),
  };
}

/** Industry excellence — measured from real registered items + value engines. */
export async function buildIndustryExcellence(supabase: SupabaseClient) {
  const registry = await readRegistry(supabase);
  return {
    excellence: PACK_SEEDS.map((p) => {
      const engine = valueEngineFor(p.key);
      const industrySources = registry.sources.filter((s) => matchesPack(s.industry, p.key));
      return deriveExcellence({
        packKey: p.key,
        name: p.name,
        packType: p.packType,
        itemTypes: p.items.map((i) => i.itemType),
        lifecycleItemCount: p.items.filter((i) => {
          const c = i.content;
          return (
            !!c &&
            typeof c === "object" &&
            (Array.isArray((c as Record<string, unknown>).stages) ||
              Array.isArray((c as Record<string, unknown>).lifecycle))
          );
        }).length,
        authorityKnowledgeCount: registry.knowledge.filter((k) => matchesPack(k.industry, p.key))
          .length,
        sourceCount: industrySources.length,
        industrySources: industrySources.map((s) => ({
          jurisdiction: str(s.jurisdiction),
          lastCheckedAt: typeof s.lastCheckedAt === "number" ? s.lastCheckedAt : null,
          updateFrequency: str(s.updateFrequency),
          status: str(s.status) ?? undefined,
        })),
        hasValueEngine: Boolean(engine),
        valueEngineStatus: engine?.implementationStatus ?? null,
        now: Date.now(),
      });
    }),
  };
}

/** Value engine + opportunity discovery for a pack (deterministic). */
export function buildValueIntelligence(args?: Record<string, unknown>) {
  const packKey = String((args ?? {}).packKey ?? "insurance-restoration");
  const engine = valueEngineFor(packKey) ?? null;
  return { engine, opportunities: discoverOpportunities(packKey) };
}

/** Revenue recovery analysis — the same deterministic engine as the demo. */
export function analyzeRecoveryClient(args?: Record<string, unknown>) {
  const a = (args ?? {}) as Record<string, unknown>;
  const facts: ClaimFacts = {
    expectedScope: strArray(a.expectedScope),
    actualScope: strArray(a.actualScope),
    evidenceSummary: strArray(a.evidenceSummary),
    estimateAmount: typeof a.estimateAmount === "number" ? a.estimateAmount : undefined,
    estimateLineItemCount:
      typeof a.estimateLineItemCount === "number" ? a.estimateLineItemCount : undefined,
    carrierResponse: typeof a.carrierResponse === "string" ? a.carrierResponse : undefined,
    paymentAmount: typeof a.paymentAmount === "number" ? a.paymentAmount : undefined,
    invoicedAmount: typeof a.invoicedAmount === "number" ? a.invoicedAmount : undefined,
    currentStage: typeof a.currentStage === "string" ? a.currentStage : undefined,
    stageAgeDays: typeof a.stageAgeDays === "number" ? a.stageAgeDays : undefined,
  };
  return analyzeRecoveryOpportunities(facts);
}
