import { describe, expect, it } from "vitest";
import {
  ALLOWLISTED_DOMAINS,
  adapterFor,
  assertSafeUrl,
  classifyChange,
  classifyChangeByRatio,
  contentHash,
  extractFirstDate,
  freshnessState,
  freshnessWindow,
  htmlPageAdapter,
  isCheckable,
  safeFetch,
  sanitizeContent,
  sourceHealth,
} from "./ingest";

describe("safe URL allowlisting", () => {
  it("accepts HTTPS on allowlisted domains and subdomains", () => {
    expect(assertSafeUrl("https://www.osha.gov/regulations").ok).toBe(true);
    expect(assertSafeUrl("https://myfloridalicense.com/verify").ok).toBe(true);
    expect(assertSafeUrl("https://sub.epa.gov/x").ok).toBe(true);
    expect(assertSafeUrl("https://www.gov.uk/guidance").ok).toBe(true);
  });

  it("rejects non-HTTPS retrieval", () => {
    const r = assertSafeUrl("http://www.osha.gov/x");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/HTTPS/i);
  });

  it("rejects un-allowlisted domains", () => {
    const r = assertSafeUrl("https://random-blog.example.com/regs");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not allowlisted/);
  });

  it("rejects unparseable URLs", () => {
    expect(assertSafeUrl("not a url").ok).toBe(false);
  });
});

describe("content sanitization", () => {
  it("strips scripts, styles, tags and entities", () => {
    const raw = "<html><script>alert('x')</script><style>p{}</style><p>Hello <b>world</b> &amp; friends</p></html>";
    const out = sanitizeContent(raw);
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<style>");
    expect(out).not.toContain("<b>");
    expect(out).toContain("Hello");
    expect(out).toContain("world");
  });

  it("redacts credential-shaped tokens instead of echoing them", () => {
    const raw = "The key is api_key=sk-abcdef123456789 and token: abcdefgh12345678 secret.";
    const out = sanitizeContent(raw);
    expect(out).not.toContain("sk-abcdef123456789");
    expect(out).not.toContain("abcdefgh12345678");
    expect(out).toContain("[redacted]");
  });

  it("collapses whitespace", () => {
    expect(sanitizeContent("a   b\n\n\n  c")).toBe("a b c");
  });
});

describe("content hashing", () => {
  it("is deterministic", () => {
    expect(contentHash("same content")).toBe(contentHash("same content"));
  });

  it("differs for different content", () => {
    expect(contentHash("version one")).not.toBe(contentHash("version two"));
  });

  it("sanitizes before hashing", () => {
    expect(contentHash("<script>x</script>hello")).toBe(contentHash("hello"));
  });
});

describe("change detection", () => {
  it("reports no_change for identical hashes", () => {
    expect(
      classifyChange(
        { contentHash: "abc" },
        { contentHash: "abc" },
        100,
        100,
      ),
    ).toBe("no_change");
  });

  it("treats formatting-only differences as formatting, never substantive", () => {
    expect(classifyChange({ contentHash: "abc" }, { contentHash: "abd" }, 101, 100)).toBe("formatting_only");
  });

  it("classifies a version bump as supersession", () => {
    expect(
      classifyChange(
        { contentHash: "abc", version: "2024" },
        { contentHash: "def", version: "2025" },
        1000,
        1000,
      ),
    ).toBe("supersession");
  });

  it("classifies a first version as a new requirement", () => {
    expect(
      classifyChange(
        { contentHash: "", version: null },
        { contentHash: "def", version: "2025" },
        1000,
        0,
      ),
    ).toBe("new_requirement");
  });

  it("classifies large differences as substantive change", () => {
    expect(classifyChangeByRatio(100, 500)).toBe("substantive_change");
  });

  it("keeps ratio thresholds honest", () => {
    expect(classifyChangeByRatio(100, 100)).toBe("no_change");
    expect(classifyChangeByRatio(100, 101)).toBe("formatting_only");
    expect(classifyChangeByRatio(100, 120)).toBe("clarification");
  });
});

describe("freshness", () => {
  it("derives current / recently_checked / stale from real timestamps", () => {
    const now = 1_800_000_000_000;
    const hour = 3600_000;
    const dailyWindow = freshnessWindow("daily");
    expect(freshnessState(now, "daily", now)).toBe("current");
    expect(freshnessState(now - dailyWindow * 0.5, "daily", now)).toBe("current");
    expect(freshnessState(now - dailyWindow * 1.2, "daily", now)).toBe("recently_checked");
    expect(freshnessState(now - dailyWindow * 2.5, "daily", now)).toBe("stale");
  });

  it("is unavailable when never checked", () => {
    expect(freshnessState(null, "daily", Date.now())).toBe("unavailable");
  });

  it("marks superseded knowledge as superseded, never current", () => {
    expect(freshnessState(Date.now(), "daily", Date.now(), "superseded")).toBe("superseded");
  });
});

describe("source health", () => {
  const now = 1_800_000_000_000;
  const hour = 3600_000;

  it("is unavailable for declared/not-implemented sources", () => {
    expect(sourceHealth({ implementationStatus: "declared" }, now)).toBe("unavailable");
    expect(sourceHealth({ implementationStatus: "not_implemented" }, now)).toBe("unavailable");
  });

  it("is unavailable when never checked or without content", () => {
    expect(sourceHealth({ implementationStatus: "implemented", lastCheckedAt: null, contentHash: "x" }, now)).toBe("unavailable");
    expect(sourceHealth({ implementationStatus: "implemented", lastCheckedAt: now, contentHash: null }, now)).toBe("unavailable");
  });

  it("is healthy only with a fresh successful check and no failures", () => {
    expect(
      sourceHealth({ implementationStatus: "implemented", lastCheckedAt: now, contentHash: "x", consecutiveFailures: 0, updateFrequency: "daily" }, now),
    ).toBe("healthy");
  });

  it("degrades on failures and goes stale past the window", () => {
    expect(
      sourceHealth({ implementationStatus: "implemented", lastCheckedAt: now, contentHash: "x", consecutiveFailures: 1, updateFrequency: "daily" }, now),
    ).toBe("degraded");
    expect(
      sourceHealth({ implementationStatus: "implemented", lastCheckedAt: now - 3 * 24 * hour, contentHash: "x", consecutiveFailures: 0, updateFrequency: "daily" }, now),
    ).toBe("stale");
  });

  it("is unavailable after repeated failures — never healthy by existence", () => {
    expect(
      sourceHealth({ implementationStatus: "implemented", lastCheckedAt: now, contentHash: "x", consecutiveFailures: 3, updateFrequency: "daily" }, now),
    ).toBe("unavailable");
  });
});

describe("adapter registry", () => {
  it("resolves implemented adapters only", () => {
    expect(adapterFor("official_html")).toBe(htmlPageAdapter);
    expect(adapterFor("official_document")).toBeTruthy();
    // Declared but not implemented retrieval methods resolve to null.
    expect(adapterFor("official_api")).toBeNull();
    expect(adapterFor("official_rss")).toBeNull();
  });

  it("isCheckable requires enabled + URL + implemented adapter", () => {
    const base = { retrievalMethod: "official_html", implementationStatus: "implemented" as const };
    expect(isCheckable({ ...base, enabled: true, canonicalUrl: "https://www.osha.gov/x" })).toBe(true);
    expect(isCheckable({ ...base, enabled: false, canonicalUrl: "https://www.osha.gov/x" })).toBe(false);
    expect(isCheckable({ ...base, enabled: true, canonicalUrl: null })).toBe(false);
    expect(isCheckable({ ...base, enabled: true, canonicalUrl: "https://www.osha.gov/x", implementationStatus: "declared" })).toBe(false);
  });

  it("validates normalized content honestly", () => {
    expect(htmlPageAdapter.validate("short").ok).toBe(false);
    expect(htmlPageAdapter.validate("a".repeat(100)).ok).toBe(true);
  });
});

describe("date extraction", () => {
  it("extracts ISO dates", () => {
    const t = extractFirstDate("Published 2026-01-15 on this page.");
    expect(t).not.toBeNull();
  });

  it("returns null when no date is present — honest, never guessed", () => {
    expect(extractFirstDate("no dates here at all")).toBeNull();
  });
});

describe("safe fetch guardrails", () => {
  it("refuses un-allowlisted domains before any network call", async () => {
    const r = await safeFetch("https://evil.example.com/regs");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not allowlisted/i);
  });

  it("refuses non-HTTPS", async () => {
    const r = await safeFetch("http://www.osha.gov/x");
    expect(r.ok).toBe(false);
  });

  it("the allowlist is explicit and non-empty", () => {
    expect(ALLOWLISTED_DOMAINS.length).toBeGreaterThan(5);
    expect(ALLOWLISTED_DOMAINS).toContain("osha.gov");
    expect(ALLOWLISTED_DOMAINS).toContain("epa.gov");
  });
});
