// ---------------------------------------------------------------------------
// Everest — Entity Resolution Engine
//
// §13. Deterministic entity resolution. Atlas merges ONLY on high-confidence
// deterministic matches (exact provider ID, external ID, normalized email,
// domain, normalized name) — never because names merely look similar.
// Ambiguous matches are flagged, never silently resolved.
//
// §14. Entity merge safety. Merges preserve original provider IDs, aliases,
// identifiers, provenance and a merge-history trail. Nothing is destroyed.
//
// §15. Typed relationship catalog shared by the graph + investigation layers.
//
// PURE module — deterministic, dependency-free, unit-testable.
// ---------------------------------------------------------------------------

export type IdentifierKind =
  | "provider"
  | "external"
  | "email"
  | "domain"
  | "phone"
  | "document_ref"
  | "source_ref"
  | "atlas_internal";

export interface EntityIdentifier {
  /** Open-ended kind — identifiers arrive from Convex `any` attributes, so
   *  the union above documents the canonical set without closing it. */
  kind: string;
  value: string;
}

export interface EntityCandidate {
  /** Stable storage id (string in pure context). */
  id: string;
  name: string;
  entityTypeKey?: string;
  /** Identifiers already known for this entity (attributes.identifiers etc.). */
  identifiers?: EntityIdentifier[];
  aliases?: string[];
  summary?: string;
}

// --- Normalization ------------------------------------------------------------

/** Deterministic name normalization: lowercase, strip punctuation, collapse
 *  whitespace. Never used alone to merge — only as one signal. */
export function normalizeName(name: string): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalized email: lowercase + trim. */
export function normalizeEmail(email: string): string {
  return (email ?? "").trim().toLowerCase();
}

/** Normalized domain: lowercase, no protocol/path/www. */
export function normalizeDomain(domain: string): string {
  return (domain ?? "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]
    .trim();
}

export function tokenSet(s: string): Set<string> {
  return new Set(
    normalizeName(s)
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

export function tokenOverlap(a: string, b: string): number {
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let shared = 0;
  for (const t of sa) if (sb.has(t)) shared++;
  return shared / Math.max(sa.size, sb.size);
}

// --- Matching ----------------------------------------------------------------

export interface ResolveHit {
  entityId: string;
  name: string;
  score: number;
  basis: string;
}

export interface ResolveResult {
  /** true when the best match clears the deterministic bar. */
  resolved: boolean;
  /** true when the top two candidates are too close to call. */
  ambiguous: boolean;
  matches: ResolveHit[];
  reason: string;
}

const RESOLVE_THRESHOLD = 0.9;
const AMBIGUITY_GAP = 0.15;

/** The deterministic resolution pipeline — ordered from strongest to weakest
 *  evidence, per §13. High-confidence deterministic matches auto-resolve;
 *  everything else is flagged. */
export function resolveEntity(input: {
  /** The identifier/name evidence we have about the sought entity. */
  query: string;
  identifiers?: EntityIdentifier[];
  candidates: EntityCandidate[];
}): ResolveResult {
  const q = normalizeName(input.query);
  const qTokens = tokenSet(input.query);
  const qIdents = input.identifiers ?? [];
  const hits: ResolveHit[] = [];

  for (const c of input.candidates) {
    const cIdents = c.identifiers ?? [];
    const cAliases = c.aliases ?? [];
    const cName = normalizeName(c.name);
    let best = 0;
    let basis = "";

    // 1. Exact provider ID.
    const provider = qIdents.find((i) => i.kind === "provider")?.value;
    if (provider && cIdents.some((i) => i.kind === "provider" && i.value === provider)) {
      if (1 > best) {
        best = 1;
        basis = "exact provider ID";
      }
    }
    // 2. Exact external ID.
    const external = qIdents.find((i) => i.kind === "external")?.value;
    if (external && cIdents.some((i) => i.kind === "external" && i.value === external)) {
      if (0.98 > best) {
        best = 0.98;
        basis = "exact external ID";
      }
    }
    // 3. Exact normalized email.
    const email = qIdents.find((i) => i.kind === "email")?.value;
    if (email) {
      const norm = normalizeEmail(email);
      if (cIdents.some((i) => i.kind === "email" && normalizeEmail(i.value) === norm)) {
        if (0.97 > best) {
          best = 0.97;
          basis = "exact email";
        }
      } else if (norm.includes("@") && cName === normalizeName(norm.split("@")[0])) {
        if (0.85 > best) {
          best = 0.85;
          basis = "email local-part matches name";
        }
      }
    }
    // 4. Exact domain.
    const domain = qIdents.find((i) => i.kind === "domain")?.value;
    if (domain) {
      const norm = normalizeDomain(domain);
      if (cIdents.some((i) => i.kind === "domain" && normalizeDomain(i.value) === norm)) {
        if (0.9 > best) {
          best = 0.9;
          basis = "exact domain";
        }
      }
    }
    // 5. Normalized name (exact) + alias match.
    if (!q) continue;
    if (cName === q) {
      if (0.85 > best) {
        best = 0.85;
        basis = "normalized name match";
      }
    }
    if (
      cAliases.some((a) => normalizeName(a) === q) ||
      cAliases.some((a) => normalizeName(a) === cName && q === cName)
    ) {
      if (0.84 > best) {
        best = 0.84;
        basis = "known alias match";
      }
    }
    // 6. Strong token overlap (≥ 2 shared significant tokens) — still below the
    //    deterministic bar, so it only surfaces as an ambiguous candidate.
    if (best === 0) {
      const overlap = tokenOverlap(input.query, c.name);
      if (qTokens.size >= 2 && overlap >= 0.75) {
        best = 0.6;
        basis = "strong name similarity";
      } else if (overlap >= 0.4 && qTokens.size >= 1) {
        best = 0.35;
        basis = "partial name similarity";
      }
    }

    if (best > 0) {
      hits.push({ entityId: c.id, name: c.name, score: best, basis });
    }
  }

  hits.sort((a, b) => b.score - a.score);
  if (hits.length === 0) {
    return {
      resolved: false,
      ambiguous: false,
      matches: [],
      reason: "No candidate matched the available identifiers or names.",
    };
  }

  const top = hits[0];
  const near = hits[1] && top.score - hits[1].score <= AMBIGUITY_GAP;
  const resolved = top.score >= RESOLVE_THRESHOLD && !near;

  return {
    resolved,
    ambiguous: near,
    matches: hits.slice(0, 5),
    reason: resolved
      ? `Resolved deterministically to "${top.name}" (${top.basis}, confidence ${Math.round(top.score * 100)}%).`
      : near
        ? `Ambiguous — the top candidates are too close to call (${hits
            .slice(0, 2)
            .map((h) => h.name)
            .join(", ")}). Clarify before acting.`
        : `No high-confidence deterministic match — closest candidate "${top.name}" at ${Math.round(top.score * 100)}% confidence (${top.basis}).`,
  };
}

// --- Merge safety --------------------------------------------------------------

export interface MergeRecord {
  /** Which entity absorbed which. */
  primaryId: string;
  duplicateId: string;
  /** Preserved identifiers contributed by the duplicate. */
  contributedIdentifiers: EntityIdentifier[];
  /** Preserved aliases contributed by the duplicate. */
  contributedAliases: string[];
  /** Preserved attributes contributed by the duplicate (non-conflicting). */
  contributedAttributes: Array<{ key: string; value: unknown }>;
  /** Conflicting attributes that were NOT silently overwritten. */
  preservedConflicts: Array<{ key: string; primaryValue: unknown; duplicateValue: unknown }>;
  mergedAt: number;
  mergedBy?: string;
  note?: string;
}

/** Build a non-destructive merge plan. Never silently destroys source
 *  information: the duplicate keeps its row (flagged merged), its identifiers
 *  and aliases are folded into the primary, and conflicting attribute values
 *  are preserved in the record instead of overwritten. */
export function mergePlan(input: {
  primary: EntityCandidate;
  duplicate: EntityCandidate;
  now?: number;
  mergedBy?: string;
  note?: string;
}): MergeRecord {
  const now = input.now ?? Date.now();
  const pAttrs = (input.primary as unknown as { attributes?: Record<string, unknown> })
    .attributes ?? {};
  const dAttrs = (input.duplicate as unknown as { attributes?: Record<string, unknown> })
    .attributes ?? {};

  const contributedIdentifiers: EntityIdentifier[] = [];
  const seen = new Set((input.primary.identifiers ?? []).map((i) => `${i.kind}:${i.value}`));
  for (const id of input.duplicate.identifiers ?? []) {
    const key = `${id.kind}:${id.value}`;
    if (!seen.has(key)) {
      seen.add(key);
      contributedIdentifiers.push(id);
    }
  }

  const contributedAliases: string[] = [];
  const aliasSeen = new Set((input.primary.aliases ?? []).map((a) => normalizeName(a)));
  for (const a of input.duplicate.aliases ?? []) {
    if (!aliasSeen.has(normalizeName(a))) {
      aliasSeen.add(normalizeName(a));
      contributedAliases.push(a);
    }
  }
  if (!aliasSeen.has(normalizeName(input.duplicate.name))) {
    contributedAliases.push(input.duplicate.name);
  }

  const contributedAttributes: Array<{ key: string; value: unknown }> = [];
  const preservedConflicts: Array<{
    key: string;
    primaryValue: unknown;
    duplicateValue: unknown;
  }> = [];
  for (const [key, value] of Object.entries(dAttrs)) {
    if (!(key in pAttrs)) {
      contributedAttributes.push({ key, value });
    } else if (
      JSON.stringify(pAttrs[key]) !== JSON.stringify(value) &&
      value != null
    ) {
      preservedConflicts.push({ key, primaryValue: pAttrs[key], duplicateValue: value });
    }
  }

  return {
    primaryId: input.primary.id,
    duplicateId: input.duplicate.id,
    contributedIdentifiers,
    contributedAliases,
    contributedAttributes,
    preservedConflicts,
    mergedAt: now,
    mergedBy: input.mergedBy,
    note: input.note,
  };
}

// --- Relationship catalog (§15) -------------------------------------------------

export const RELATIONSHIP_CATALOG = [
  { key: "works_for", label: "works for", category: "people" },
  { key: "manages", label: "manages", category: "people" },
  { key: "owns", label: "owns", category: "ownership" },
  { key: "leads", label: "leads", category: "people" },
  { key: "contains", label: "contains", category: "structure" },
  { key: "part_of", label: "part of", category: "structure" },
  { key: "belongs_to", label: "belongs to", category: "structure" },
  { key: "located_at", label: "located at", category: "structure" },
  { key: "affected_by", label: "affected by", category: "impact" },
  { key: "affects", label: "affects", category: "impact" },
  { key: "modifies", label: "modifies", category: "impact" },
  { key: "supports", label: "supports", category: "impact" },
  { key: "relates_to", label: "relates to", category: "generic" },
  { key: "mentions", label: "mentions", category: "generic" },
  { key: "contacts", label: "contacts", category: "people" },
] as const;

export type RelationshipKey = (typeof RELATIONSHIP_CATALOG)[number]["key"];

export function relationshipLabel(key: string): string {
  return RELATIONSHIP_CATALOG.find((r) => r.key === key)?.label ?? key.replace(/_/g, " ");
}

/** Legacy keys written by earlier ingestion (Phase 1–6) map onto the catalog. */
export const LEGACY_RELATIONSHIP_MAP: Record<string, string> = {
  relates_to: "relates_to",
  belongs_to: "belongs_to",
  part_of: "part_of",
  produces: "affects",
  uses: "supports",
  located_at: "located_at",
  mentions: "mentions",
};
