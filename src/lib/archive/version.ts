/**
 * Phase 13 — duplicate & version detection.
 *
 * - EXACT duplicates are found by deterministic SHA-256 checksum. The first
 *   occurrence wins; later copies are flagged `duplicate` with provenance
 *   pointing back to the original path — never ingested twice.
 * - VERSIONS (Estimate_v1.pdf / Estimate_v2.pdf, report (1).docx …) are
 *   grouped by stem and ranked so the newest can be marked as the current
 *   version while older copies are preserved as history (supersession
 *   candidates), not silently deleted.
 */
import type { ArchiveFileEntry } from "./types";

export interface VersionGroup {
  stem: string;
  entries: ArchiveFileEntry[];
}

/** Parse version markers out of a filename: v2, V3, (1), (2), _final, _draft. */
export function parseVersion(filename: string): {
  stem: string;
  version?: number;
  kind: "final" | "draft" | "numbered" | "plain";
} {
  const base = filename.replace(/\.[^.]+$/, "");
  // (1), (2), (3)…
  const paren = base.match(/\((\d+)\)\s*$/);
  if (paren) {
    return {
      stem: base.replace(/\(\d+\)\s*$/, "").trim(),
      version: Number(paren[1]),
      kind: "numbered",
    };
  }
  // v1, v2, V3, ver2, version2
  const v = base.match(/[._-]?(?:v|ver|version)[._-]?(\d+)\s*$/i);
  if (v) {
    return {
      stem: base.replace(/[._-]?(?:v|ver|version)[._-]?\d+\s*$/i, "").trim(),
      version: Number(v[1]),
      kind: "numbered",
    };
  }
  // _final, _final2, _final_v2
  const fin = base.match(/[._-]final(?:[._-]?(\d+))?\s*$/i);
  if (fin) {
    return {
      stem: base.replace(/[._-]final(?:[._-]?\d+)?\s*$/i, "").trim(),
      version: fin[1] ? Number(fin[1]) : undefined,
      kind: "final",
    };
  }
  const dr = base.match(/[._-]draft(?:[._-]?(\d+))?\s*$/i);
  if (dr) {
    return {
      stem: base.replace(/[._-]draft(?:[._-]?\d+)?\s*$/i, "").trim(),
      version: dr[1] ? Number(dr[1]) : undefined,
      kind: "draft",
    };
  }
  return { stem: base.trim(), kind: "plain" };
}

export interface VersionAnalysis {
  entries: ArchiveFileEntry[];
  /** stem → groups with ≥2 members (potential supersession chains). */
  groups: VersionGroup[];
}

/**
 * Second pass over extracted entries:
 * 1. Mark exact duplicates by checksum (first path wins).
 * 2. Group remaining files by stem and rank versions (mtime breaks ties).
 */
export function analyzeVersions(entries: ArchiveFileEntry[]): VersionAnalysis {
  const seen = new Map<string, ArchiveFileEntry>();
  const groups = new Map<string, ArchiveFileEntry[]>();

  for (const entry of entries) {
    if (entry.status !== "ok") continue;
    const first = seen.get(entry.checksum);
    if (first) {
      entry.status = "duplicate";
      entry.note = `Duplicate of “${first.path}” (identical checksum ${entry.checksum.slice(0, 10)}…).`;
      entry.duplicateOfPath = first.path;
      continue;
    }
    seen.set(entry.checksum, entry);

    const parsed = parseVersion(entry.filename);
    const stem = parsed.stem.toLowerCase();
    if (stem) {
      entry.versionGroup = stem;
      entry.versionNumber = parsed.version;
      const list = groups.get(stem) ?? [];
      list.push(entry);
      groups.set(stem, list);
    }
  }

  // Rank each group by (version number, mtime) — newest wins.
  const ranked: VersionGroup[] = [];
  for (const [stem, list] of groups) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => {
      const av = a.versionNumber ?? 0;
      const bv = b.versionNumber ?? 0;
      if (av !== bv) return bv - av;
      return (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0);
    });
    sorted.forEach((e, i) => {
      e.isLatestVersion = i === 0;
    });
    ranked.push({ stem, entries: sorted });
  }

  return { entries, groups: ranked };
}
