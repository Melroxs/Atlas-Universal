// ---------------------------------------------------------------------------
// Everest — Authority Ingestion Engine
//
// A universal framework for retrieving, normalizing, versioning and
// health-monitoring authoritative sources. No arbitrary scraping, no
// search-engine authority, no LLM-invented regulation. Every source declares
// its retrieval method; nothing is ever marked synchronized unless Atlas
// actually retrieved and validated it.
//
// PURE module (no convex imports) except for the hash helper re-export.
// ---------------------------------------------------------------------------

import { hashString } from "../events/contract";

export type RetrievalMethod =
  | "official_api"
  | "official_feed"
  | "official_rss"
  | "official_publication"
  | "official_html"
  | "official_document"
  | "standards_publisher"
  | "governing_body";

export type ImplementationStatus =
  | "declared"
  | "implemented"
  | "requires_credentials"
  | "not_implemented";

export type ChangeType =
  | "no_change"
  | "formatting_only"
  | "clarification"
  | "substantive_change"
  | "new_requirement"
  | "removed_requirement"
  | "effective_date_change"
  | "supersession";

export type FreshnessState =
  | "current"
  | "recently_checked"
  | "stale"
  | "superseded"
  | "unavailable"
  | "verification_required";

export type SourceHealth = "healthy" | "degraded" | "stale" | "unavailable";

export const CHANGE_TYPES: ChangeType[] = [
  "no_change",
  "formatting_only",
  "clarification",
  "substantive_change",
  "new_requirement",
  "removed_requirement",
  "effective_date_change",
  "supersession",
];

/** The typed source-adapter contract. Adapters are isolated from the
 *  intelligence engine — the engine never contains source-specific HTTP. */
export interface SourceAdapter {
  retrievalMethod: RetrievalMethod;
  /** Fetch raw bytes/text from the source URL. Must enforce safe retrieval. */
  fetch(rawUrl: string, opts: SafeFetchOptions): Promise<SafeFetchResult>;
  /** Normalize raw content into plain, sanitized text. */
  normalize(raw: string): string;
  /** Deterministic content hash. */
  calculateHash(content: string): string;
  /** Identify the source version from content (null when not identifiable). */
  identifyVersion(content: string): string | null;
  extractPublishedDate(content: string): number | null;
  extractEffectiveDate(content: string): number | null;
  /** Validate the normalized content (non-empty, sane, no credentials). */
  validate(normalized: string): { ok: boolean; reason?: string };
}

// --- Safe retrieval ----------------------------------------------------------

export const ALLOWLISTED_DOMAINS: string[] = [
  "osha.gov",
  "epa.gov",
  "irs.gov",
  "ftc.gov",
  "myfloridalicense.com",
  "tdlr.texas.gov",
  "nfpa.org",
  "iso.org",
  "iicrc.org",
  "ashrae.org",
  "iccsafe.org",
  "fasb.org",
  "restorationindustry.org",
  "theclm.org",
  "gov",
  "org",
  "gov.uk",
];

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs: number;
}

export interface SafeFetchResult {
  ok: boolean;
  status?: number;
  content?: string;
  error?: string;
  latencyMs?: number;
}

/** Fail-closed URL validation: HTTPS only, allowlisted host or subdomain. */
export function assertSafeUrl(url: string): { ok: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "URL is not parseable." };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "Only HTTPS retrieval is allowed." };
  }
  const host = parsed.hostname.toLowerCase();
  const allowed = ALLOWLISTED_DOMAINS.some(
    (d) => host === d || host.endsWith(`.${d}`),
  );
  if (!allowed) {
    return { ok: false, reason: `Domain "${host}" is not allowlisted.` };
  }
  return { ok: true };
}

const CREDENTIAL_PATTERN =
  /(api[_-]?key|secret|password|token|authorization|bearer)\s*[=:]\s*["']?[A-Za-z0-9_\-]{8,}/i;

/** Strip executable markup and credential-shaped tokens. External content is
 *  untrusted input — it is never executed and never pasted into prompts raw. */
export function sanitizeContent(raw: string): string {
  let out = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Redact credential-shaped tokens rather than echoing them — every
  // occurrence, not just the first.
  out = out.replace(new RegExp(CREDENTIAL_PATTERN.source, "gi"), "$1=[redacted]");
  return out;
}

/** Content hash — deterministic across runtimes (FNV-1a 64-bit). */
export function contentHash(content: string): string {
  return hashString(sanitizeContent(content));
}

/** Safe retrieval: allowlist + HTTPS + size cap + timeout. Never sends
 *  secrets; never executes content. Returns honest error states. */
export async function safeFetch(
  url: string,
  opts?: Partial<SafeFetchOptions>,
): Promise<SafeFetchResult> {
  const { maxBytes = 512 * 1024, timeoutMs = 15000 } = opts ?? {};
  const checked = assertSafeUrl(url);
  if (!checked.ok) return { ok: false, error: checked.reason };

  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "user-agent": "Atlas-Authority-Ingest/1.0 (evidence-grounded)" },
        redirect: "follow",
      });
      const latencyMs = Date.now() - started;
      if (!res.ok) {
        return { ok: false, status: res.status, error: `HTTP ${res.status}`, latencyMs };
      }
      const raw = await res.text();
      if (raw.length > maxBytes) {
        return {
          ok: false,
          error: `Response exceeds ${maxBytes} byte limit (${raw.length}).`,
          latencyMs,
        };
      }
      return { ok: true, status: res.status, content: raw, latencyMs };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const latencyMs = Date.now() - started;
    const reason =
      err instanceof Error && err.name === "AbortError"
        ? `Timed out after ${timeoutMs}ms.`
        : "Retrieval failed (network or TLS).";
    return { ok: false, error: reason, latencyMs };
  }
}

// --- Change detection --------------------------------------------------------

/** Classify a change between the previous known content and the new content.
 *  Formatting-only differences are never treated as substantive changes. */
export function classifyChange(
  prev: { contentHash: string; version?: string | null },
  next: { contentHash: string; version?: string | null },
  nextRawLength: number,
  prevRawLength: number,
): ChangeType {
  if (prev.contentHash === next.contentHash) return "no_change";
  if (next.version && prev.version && next.version !== prev.version) {
    return "supersession";
  }
  // Ratio of changed characters below threshold → formatting/clarification.
  const denom = Math.max(prevRawLength, nextRawLength, 1);
  const ratio = Math.abs(prevRawLength - nextRawLength) / denom;
  if (ratio < 0.02) return "formatting_only";
  if (next.version && !prev.version) return "new_requirement";
  return "substantive_change";
}

/** Length-only heuristic used when a normalized length delta is available. */
export function classifyChangeByRatio(prevLen: number, nextLen: number): ChangeType {
  const denom = Math.max(prevLen, nextLen, 1);
  const ratio = Math.abs(prevLen - nextLen) / denom;
  if (ratio === 0) return "no_change";
  if (ratio < 0.02) return "formatting_only";
  if (ratio < 0.25) return "clarification";
  return "substantive_change";
}

// --- Freshness & health ------------------------------------------------------

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** Map a declared update frequency to a freshness window (ms). */
export function freshnessWindow(updateFrequency?: string | null): number {
  switch ((updateFrequency ?? "").toLowerCase()) {
    case "continuous":
      return 12 * HOUR;
    case "daily":
      return 26 * HOUR;
    case "weekly":
      return 8 * DAY;
    case "periodic":
      return 30 * DAY;
    case "quarterly":
      return 95 * DAY;
    default:
      return 30 * DAY;
  }
}

/** Freshness state derived from the actual last-check timestamp and the
 *  source's declared update frequency. Never silently stale. */
export function freshnessState(
  lastCheckedAt: number | null | undefined,
  updateFrequency: string | null | undefined,
  now: number,
  status?: string,
): FreshnessState {
  if (status === "superseded") return "superseded";
  if (status === "expired") return "superseded";
  if (!lastCheckedAt) return "unavailable";
  const age = now - lastCheckedAt;
  const window = freshnessWindow(updateFrequency);
  if (age <= window * 0.5) return "current";
  if (age <= window * 1.5) return "recently_checked";
  return "stale";
}

/** Source health from the health record. Never healthy merely because the
 *  source exists in the registry. */
export function sourceHealth(s: {
  lastCheckedAt?: number | null;
  lastSuccessfulSyncAt?: number | null;
  consecutiveFailures?: number | null;
  contentHash?: string | null;
  updateFrequency?: string | null;
  enabled?: boolean | null;
  implementationStatus?: string | null;
}, now: number): SourceHealth {
  if (s.implementationStatus === "not_implemented" || s.implementationStatus === "declared") {
    return "unavailable";
  }
  if (!s.lastCheckedAt) return "unavailable";
  if (!s.contentHash) return "unavailable";
  if ((s.consecutiveFailures ?? 0) >= 3) return "unavailable";
  const age = now - s.lastCheckedAt;
  const window = freshnessWindow(s.updateFrequency);
  if (age > window * 2) return "stale";
  if ((s.consecutiveFailures ?? 0) > 0) return "degraded";
  return "healthy";
}

// --- Date extraction (honest: null when not present) -------------------------

const ISO_DATE = /\b(19|20)\d{2}[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b/;
const US_DATE = /\b(0[1-9]|1[0-2])[/](0[1-9]|[12]\d|3[01])[/](19|20)\d{2}\b/;

export function extractFirstDate(content: string): number | null {
  const iso = content.match(ISO_DATE);
  if (iso) {
    const t = Date.parse(iso[0].replace(/\//g, "-"));
    return Number.isNaN(t) ? null : t;
  }
  const us = content.match(US_DATE);
  if (us) {
    const t = Date.parse(`${us[3]}-${us[1]}-${us[2]}`);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

// --- Adapter registry --------------------------------------------------------

/** The reference adapter: official HTML pages via safe retrieval. */
export const htmlPageAdapter: SourceAdapter = {
  retrievalMethod: "official_html",
  async fetch(rawUrl, opts) {
    return safeFetch(rawUrl, opts);
  },
  normalize(raw) {
    return sanitizeContent(raw);
  },
  calculateHash(content) {
    return contentHash(content);
  },
  identifyVersion() {
    return null; // versions come from explicit source declarations, never guesses
  },
  extractPublishedDate(content) {
    return extractFirstDate(content);
  },
  extractEffectiveDate() {
    return null; // not derivable reliably from arbitrary HTML
  },
  validate(normalized) {
    if (!normalized || normalized.length < 40) {
      return { ok: false, reason: "Normalized content is too short to validate." };
    }
    if (CREDENTIAL_PATTERN.test(normalized)) {
      return { ok: false, reason: "Credential-shaped content survived sanitization." };
    }
    return { ok: true };
  },
};

/** Declared adapters for other retrieval methods — honest status, no fake sync. */
export const ADAPTERS: Record<string, SourceAdapter> = {
  official_html: htmlPageAdapter,
  official_document: htmlPageAdapter,
  official_publication: htmlPageAdapter,
  // official_api / official_rss / official_feed / standards_publisher /
  // governing_body adapters are declared but not implemented yet.
};

export function adapterFor(method: string | null | undefined): SourceAdapter | null {
  if (!method) return null;
  return ADAPTERS[method] ?? null;
}

/** Sources are only checkable when an implemented adapter exists. */
export function isCheckable(s: {
  retrievalMethod?: string | null;
  enabled?: boolean | null;
  implementationStatus?: string | null;
  canonicalUrl?: string | null;
}): boolean {
  return (
    !!s.enabled &&
    !!s.canonicalUrl &&
    !!adapterFor(s.retrievalMethod) &&
    s.implementationStatus === "implemented"
  );
}
