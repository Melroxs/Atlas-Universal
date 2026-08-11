/**
 * Phase 13 — claim reconstruction hints.
 *
 * Atlas does NOT assume files in the same folder belong to the same claim.
 * It extracts deterministic identifiers (claim numbers, invoice numbers,
 * policy references) from filenames and folder context, and only then builds
 * a CLAIM HINT — evidence that may relate to a claim. Merging / creating a
 * claim record still requires sufficient evidence or human confirmation.
 */
import type { ClaimHint } from "./types";

/** Claim-number patterns that are specific enough to trust. */
const CLAIM_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /(?:claim|clm)[-_. ]?(\d{3,12})/i, label: "claim number" },
  // Followed by a separator/end so "CL88210044_invoice.pdf" still matches.
  { re: /\b(?:CL|CLM|CN)\d{4,12}(?=[._-]|\b)/i, label: "claim id" },
  { re: /\b\d{4,12}(?=[._-]|\b)/, label: "long number" },
];

const SUPPORTING_CONTEXT =
  /claims?|estimate|supplement|xactimate|invoice|payment|depreciat|adjuster|scope|loss|policy/i;

const CLAIM_FOLDER = /(?:^|\/)(?:claims?|claim[-_. ]?\d+|losses?)[/\\]/i;

export interface ClaimExtraction {
  hints: ClaimHint[];
  /** Folder context seen (e.g. "Claims/2026/Claim-12345"). */
  context: string[];
}

/**
 * Extract evidence-based claim hints from a file's path. A hint requires at
 * least one of: an explicit claim number in the filename, a claim folder, or
 * claim-adjacent keywords combined with a long numeric id.
 */
export function extractClaimHints(path: string): ClaimExtraction {
  const segments = path.split("/");
  const filename = segments.pop() ?? path;
  const folder = segments.join("/");
  const context: string[] = [];

  // Folder context signals (kept as evidence, not truth).
  const claimFolderMatch = folder.match(CLAIM_FOLDER);
  if (claimFolderMatch) context.push(claimFolderMatch[0].replace(/\/$/, ""));

  const hints: ClaimHint[] = [];
  const seen = new Set<string>();

  // 1. Explicit claim number in the filename.
  for (const p of CLAIM_PATTERNS) {
    const m = filename.match(p.re);
    if (m) {
      const num = m[1] ?? m[0];
      if (!seen.has(num)) {
        seen.add(num);
        const supporting = SUPPORTING_CONTEXT.test(path);
        hints.push({
          claimNumber: num,
          confidence: p.label === "claim number" ? 0.8 : supporting ? 0.6 : 0.35,
          reasons: [
            p.label === "claim number"
              ? `Filename contains a claim number (“${num}”).`
              : `Filename contains identifier “${num}”${supporting ? " in a claim-related context." : "."}`,
          ],
        });
      }
    }
  }

  // 2. Folder-level claim identity. Supports both "Claims/12345" and
  //    "…/Claim-12345/…" styles. The LAST id-bearing segment under the
  //    Claims path wins, so "Claims/2026/Claim-12345" resolves to 12345,
  //    never the year. A bare 4-digit year (Claims/2026) is treated as a
  //    year, not a claim id, unless the segment explicitly says “claim”.
  if (hints.length === 0 && folder) {
    const segments = folder.split("/");
    const claimIdx = segments.findIndex((s) => /^claims?$/i.test(s));
    const rest = claimIdx >= 0 ? segments.slice(claimIdx + 1) : [];
    let folderId: { num: string; label: string } | null = null;
    for (let i = rest.length - 1; i >= 0; i--) {
      const seg = rest[i];
      const m = seg.match(/^(?:claim[-_. ]?)?(\d{3,12})$/i);
      if (!m) continue;
      const num = m[1];
      if (/^(19|20)\d{2}$/.test(num) && !/claim/i.test(seg)) continue;
      folderId = { num, label: seg };
      break;
    }
    if (folderId) {
      hints.push({
        claimNumber: folderId.num,
        confidence: 0.7,
        reasons: [`Located under a claim folder (“…/${folderId.label}”).`],
      });
      context.push(folderId.label);
    } else if (CLAIM_FOLDER.test(folder + "/")) {
      // Inside a Claims folder but no explicit number — low confidence.
      hints.push({
        claimNumber: "",
        confidence: 0.3,
        reasons: ["Located under a claim folder, but no claim number was found."],
      });
    }
  }

  return { hints, context };
}

/**
 * Aggregate claim hints across an entire archive: group by claim number and
 * count how many files reference each. This is the basis for the honest
 * "N potential claims found" summary — never an automatic claim record.
 */
export function aggregateClaimHints(
  paths: string[],
): Array<{ claimNumber: string; fileCount: number; samplePaths: string[] }> {
  const byClaim = new Map<string, { count: number; paths: string[] }>();
  for (const path of paths) {
    const { hints } = extractClaimHints(path);
    for (const h of hints) {
      if (!h.claimNumber) continue;
      const rec = byClaim.get(h.claimNumber) ?? { count: 0, paths: [] };
      rec.count++;
      if (rec.paths.length < 5) rec.paths.push(path);
      byClaim.set(h.claimNumber, rec);
    }
  }
  return [...byClaim.entries()]
    .map(([claimNumber, v]) => ({ claimNumber, fileCount: v.count, samplePaths: v.paths }))
    .sort((a, b) => b.fileCount - a.fileCount);
}
