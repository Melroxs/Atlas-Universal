// ---------------------------------------------------------------------------
// Everest — Jurisdiction Engine
//
// Jurisdiction is a hierarchical, internationally extensible context
// (country → state/province → county/district → municipality). Rules may
// depend on any combination of jurisdiction, industry, company size, business
// model and effective date. Applicability evaluation fails closed: when Atlas
// cannot confirm a rule applies, it says so and names the missing factor.
// ---------------------------------------------------------------------------

export type JurisdictionLevel = "country" | "state" | "county" | "municipality";

/** Extensible hierarchy — not every country follows this exactly. */
export const JURISDICTION_LEVELS: JurisdictionLevel[] = [
  "country",
  "state",
  "county",
  "municipality",
];

export interface JurisdictionContext {
  country?: string;
  state?: string;
  county?: string;
  municipality?: string;
  industry?: string;
  companySize?: string;
  businessModel?: string;
  /** Effective date (ms) for time-bounded rules. */
  asOf?: number;
}

/** Parse a "Country > State > County > Municipality" path into nodes. */
export function parseJurisdictionPath(path?: string | null): JurisdictionNode[] {
  if (!path) return [];
  return path
    .split(">")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name, i) => ({
      name,
      level: JURISDICTION_LEVELS[i] ?? "municipality",
    }));
}

export interface JurisdictionNode {
  name: string;
  level: JurisdictionLevel;
}

/** Build the ordered path of a jurisdiction context (highest → lowest). */
export function jurisdictionPath(ctx: JurisdictionContext): string[] {
  const parts = [ctx.country, ctx.state, ctx.county, ctx.municipality].filter(
    (p): p is string => !!p && p.trim().length > 0,
  );
  return parts.map((p) => p.trim());
}

export function jurisdictionSummary(ctx: JurisdictionContext): string {
  const path = jurisdictionPath(ctx);
  return path.length ? path.join(" > ") : "Unspecified jurisdiction";
}

/** Does the context's path include the given place name at any level? */
export function contextIncludesPlace(ctx: JurisdictionContext, place: string): boolean {
  const p = (place ?? "").trim().toLowerCase();
  if (!p) return false;
  return jurisdictionPath(ctx).some((x) => x.toLowerCase() === p);
}

export interface ApplicabilityResult {
  applicable: boolean;
  /** Fail-closed: every non-applicable result explains why. */
  reason: string;
  missingFactors: string[];
}

/**
 * Evaluate whether a jurisdiction/industry-scoped knowledge object applies to
 * a tenant context. Fail-closed: unknown jurisdiction or industry factors
 * yield "not applicable" with the missing factor named.
 */
export function evaluateApplicability(
  knowledge: { jurisdiction?: string; industry?: string; effectiveDate?: number; expirationDate?: number },
  ctx: JurisdictionContext,
): ApplicabilityResult {
  const missingFactors: string[] = [];
  const hasJurisdiction = !!knowledge.jurisdiction?.trim();
  const hasIndustry = !!knowledge.industry?.trim();

  if (hasJurisdiction) {
    const path = parseJurisdictionPath(knowledge.jurisdiction);
    if (path.length === 0) {
      missingFactors.push(`jurisdiction "${knowledge.jurisdiction}" is not a parseable path`);
    } else {
      const top = path[0];
      if (!contextIncludesPlace(ctx, top.name)) {
        missingFactors.push(`operates in "${top.name}"`);
      }
      // Deeper levels require the parent to match AND the deeper place to be known.
      for (const node of path.slice(1)) {
        if (!contextIncludesPlace(ctx, node.name)) {
          missingFactors.push(`${node.level} "${node.name}"`);
          break;
        }
      }
    }
  }

  if (hasIndustry) {
    const ind = (ctx.industry ?? "").toLowerCase();
    const req = knowledge.industry!.toLowerCase();
    if (!ind) {
      missingFactors.push("company industry (required to evaluate applicability)");
    } else if (!ind.includes(req) && !req.includes(ind)) {
      missingFactors.push(`industry "${knowledge.industry}"`);
    }
  }

  // Time-bounded rules.
  if (knowledge.effectiveDate && ctx.asOf && knowledge.effectiveDate > ctx.asOf) {
    missingFactors.push("the rule's effective date has not been reached");
  }
  if (knowledge.expirationDate && ctx.asOf && knowledge.expirationDate < ctx.asOf) {
    missingFactors.push("the rule has expired");
  }

  if (missingFactors.length > 0) {
    return {
      applicable: false,
      reason: `Cannot confirm applicability${missingFactors.length === 1 ? "" : " — missing factors"}: ${missingFactors.join("; ")}.`,
      missingFactors,
    };
  }

  if (!hasJurisdiction && !hasIndustry && !knowledge.effectiveDate && !knowledge.expirationDate) {
    return {
      applicable: true,
      reason: "Universal knowledge — applies to any operating context.",
      missingFactors: [],
    };
  }

  return { applicable: true, reason: "Applies to this operating context.", missingFactors: [] };
}
