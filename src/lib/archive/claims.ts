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
// Order matters: the alphanumeric carrier-prefixed form (GAP-26-51847,
// CL-2019-48211) must be checked BEFORE the bare long-number pattern, which
// would otherwise grab the numeric tail ("51847") and produce a false hint.
const CLAIM_PATTERNS: Array<{ re: RegExp; label: string }> = [
  {
    // Alphanumeric claim id: 2-6 letters, then 1-4 digits, then 4-12 digits.
    // e.g. GAP-26-51847, CL-2019-48211, LSM12345-67890. The negative
    // lookahead stops the label words “claim”/“clm” from being consumed as
    // the letter prefix, so Claim_12345 resolves to 12345 (via the pattern
    // below), never to the literal string “Claim_12345”.
    re: /\b(?!claim|clm)[A-Z]{2,6}[-_. ]?\d{1,4}[-_. ]?\d{4,12}(?=[._-]|\b)/i,
    label: "claim number",
  },
  { re: /(?:claim|clm)[-_. ]?(\d{3,12})/i, label: "claim number" },
  // Followed by a separator/end so "CL88210044_invoice.pdf" still matches.
  { re: /\b(?:CL|CLM|CN)\d{4,12}(?=[._-]|\b)/i, label: "claim id" },
  { re: /\b\d{4,12}(?=[._-]|\b)/, label: "long number" },
];

/** Folder-segment claim id: "Claim-12345", "12345", "GAP-26-51847". */
// The negative lookahead after the optional “claim” prefix keeps the label
// word from being captured as the id: “Claim-12345” must resolve to 12345
// (the pattern below), never to the literal segment text.
const FOLDER_ID_PATTERNS: Array<{ re: RegExp; label: string }> = [
  {
    re: /^(?:claim[-_. ]?)?(?!claim[-_. ]?)([A-Z]{2,6}[-_. ]?\d{1,4}[-_. ]?\d{4,12})$/i,
    label: "claim number",
  },
  { re: /^(?:claim[-_. ]?)?(\d{3,12})$/i, label: "claim number" },
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

  // 2. Folder-level claim identity. Supports "Claims/12345",
  //    "…/Claim-12345/…", and alphanumeric ids like "Claims/GAP-26-51847".
  //    The LAST id-bearing segment under the Claims path wins, so
  //    "Claims/2026/Claim-12345" resolves to 12345, never the year. A bare
  //    4-digit year (Claims/2026) is treated as a year, not a claim id,
  //    unless the segment explicitly says “claim”.
  if (hints.length === 0 && folder) {
    const segments = folder.split("/");
    // “Claims”, “OldClaims”, “claims”… — old/prior claim folders are claim
    // folders too, so OldClaims/CL-2019-48211 resolves to CL-2019-48211 and
    // never merges into the current claim.
    const claimIdx = segments.findIndex((s) => /^(?:old[-_. ]?)?claims?$/i.test(s));
    const rest = claimIdx >= 0 ? segments.slice(claimIdx + 1) : [];
    let folderId: { num: string; label: string } | null = null;
    for (let i = rest.length - 1; i >= 0; i--) {
      const seg = rest[i];
      let m: RegExpMatchArray | null = null;
      for (const p of FOLDER_ID_PATTERNS) {
        m = seg.match(p.re);
        if (m) break;
      }
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
