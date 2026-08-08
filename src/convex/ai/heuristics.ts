// ---------------------------------------------------------------------------
// Deterministic heuristics used when the AI gateway is unavailable: document
// classification, entity candidate extraction, amounts and dates. Everything
// here is labeled with modest confidence — AI extraction (when available)
// upgrades it, and the graph layer keeps the "proposed" status either way.
// ---------------------------------------------------------------------------

const NORMALIZE = (s: string) => s.toLowerCase();

export function classifyDocument(title: string, text: string): string {
  const hay = NORMALIZE(`${title} ${text.slice(0, 4000)}`);
  const score: Record<string, number> = {};
  const bump = (key: string, n: number) => {
    score[key] = (score[key] ?? 0) + n;
  };

  if (/(sop|standard operating|procedure|how we work|workflow)/.test(hay)) bump("SOP", 3);
  if (/(policy|policies|must |shall |required|compliance)/.test(hay)) bump("Policy", 2);
  if (/(handbook|employee manual|onboarding guide|welcome to)/.test(hay)) bump("Handbook", 3);
  if (/(template|checklist|form\b|blank\b|fill in)/.test(hay)) bump("Template", 2);
  if (/(contract|agreement|terms and conditions|signature)/.test(hay)) bump("Contract", 3);
  if (/(invoice|payment due|amount due|net 30|net 45|bill to|balance)/.test(hay)) bump("Invoice", 3);
  if (/(estimate|xactimate|line item|labor rate|material|unit price|total estimate|scope of work)/.test(hay)) bump("Estimate", 3);
  if (/(report|summary of|findings|analysis|conclusion|kpi|metrics)/.test(hay)) bump("Report", 2);
  if (/(meeting|minutes|attendees|agenda|next steps|action items)/.test(hay)) bump("Meeting Notes", 3);
  if (/(training|course|learn|lesson|certification)/.test(hay)) bump("Training Material", 2);
  if (/(regulation|statute|code §|compliance|licensed|permit|requirement per)/.test(hay)) bump("Regulatory Reference", 3);
  if (/(price|cost|revenue|q1|q2|q3|q4|budget|actuals|total)/.test(hay)) bump("Spreadsheet", 1);
  if (/(financial|balance sheet|profit|loss statement|gl|journal)/.test(hay)) bump("Financial Record", 3);
  if (/(dear |hello |thank you for|regards,|sincerely,|re:)/.test(hay)) bump("Communication", 2);

  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 3 ? best[0] : "Unknown";
}

export interface EntityCandidate {
  name: string;
  type: string;
  confidence: number;
}

const TYPE_HINTS: Array<{ type: string; re: RegExp }> = [
  { type: "claim", re: /\b(?:claim|loss)\s*[#№:]?\s*([A-Z]{0,4}\d{3,})/gi },
  { type: "system", re: /\b(Xactimate|Symbility|CoreLogic|JobNimbus|DASH|CompanyCam|QuickBooks|Salesforce|ServiceTitan|Titan)\b/gi },
  { type: "organization", re: /\b([A-Z][A-Za-z0-9&.'-]{2,}(?:\s(?:Insurance|Restoration|Services|Group|LLC|Inc|Company|Co|Pro|Contractors|Solutions)){1,3})\b/g },
  { type: "person", re: /\b([A-Z][a-z]{2,})\s([A-Z][a-z]{2,})\b/g },
  { type: "property", re: /\b(\d{2,5}\s[A-Za-z0-9.'-]+(?:\s[A-Za-z0-9.'-]+)?\s(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Court|Ct|Boulevard|Blvd|Way|Place|Pl))\b/g },
  { type: "email", re: /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g },
  { type: "phone", re: /\b((?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4})\b/g },
];

/** Extract entity candidates from text. Deduped, modest confidence. */
export function extractCandidates(text: string): EntityCandidate[] {
  const found: EntityCandidate[] = [];
  const seen = new Set<string>();

  const add = (name: string, type: string, confidence: number) => {
    const key = `${type}:${name.toLowerCase()}`;
    if (seen.has(key)) return;
    if (name.length < 2 || name.length > 80) return;
    if (/((the|and|for|with|from|this|that)\b){2,}/i.test(name)) return;
    seen.add(key);
    found.push({ name: name.trim(), type, confidence });
  };

  for (const hint of TYPE_HINTS) {
    hint.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = hint.re.exec(text)) !== null) {
      const group = m[1] ?? m[0];
      if (!group) continue;
      let conf = 0.55;
      if (hint.type === "claim") conf = 0.8;
      if (hint.type === "system") conf = 0.9;
      if (hint.type === "email") conf = 0.95;
      if (hint.type === "phone") conf = 0.9;
      if (hint.type === "property") conf = 0.75;
      if (
        hint.type === "person" &&
        /^(The|This|That|When|What|Where|Your|Our|Their|Please|Thank|John Doe|Jane Doe|Policy|Claim|Estimate|Invoice|Work|Date|Total|Amount|Phone|Email|Name|Address|Property|Building|Water|Fire|Company)$/i.test(
          group,
        )
      ) {
        continue;
      }
      add(group, hint.type, conf);
    }
  }

  // Terminology matches from the restoration domain vocabulary.
  const TERMS: Array<{ name: string; type: string }> = [
    { name: "Mitigation", type: "workflow_stage" },
    { name: "Reconstruction", type: "workflow_stage" },
    { name: "Supplement", type: "document" },
    { name: "Inspection", type: "workflow_stage" },
    { name: "Drying log", type: "document" },
    { name: "Scope of work", type: "document" },
    { name: "Authorization", type: "document" },
    { name: "Policyholder", type: "person_role" },
    { name: "Adjuster", type: "person_role" },
    { name: "Carrier", type: "organization_role" },
  ];
  const lower = text.toLowerCase();
  for (const t of TERMS) {
    if (lower.includes(t.name.toLowerCase())) {
      add(t.name, t.type, 0.6);
    }
  }

  return found.slice(0, 60);
}

/** Extract currency amounts like $1,250 or $4.2k. */
export function extractAmounts(text: string): string[] {
  const re = /\$(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+(?:\.\d{2})?|\d+\.\d k)\b/gi;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.add(`$${m[1]}`);
  return [...out].slice(0, 10);
}

/** Extract ISO-ish dates. */
export function extractDates(text: string): string[] {
  const re =
    /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.add(m[1]);
  return [...out].slice(0, 10);
}

export const normalizeEntityName = (s: string) =>
  s.trim().replace(/\s+/g, " ").replace(/\s*[#№:]\s*$/, "");

const LEGAL_SUFFIXES =
  /\b(llc|ltd|inc|corp|corporation|company|co\.?|group|pllc|llp|gmbh|holdings?|international|partners?)\b\.?$/gi;

/**
 * Canonical identity key: lowercase, legal suffixes + punctuation stripped.
 * "ABC Roofing LLC" and "ABC Roofing" both normalize to "abc roofing", which
 * lets cross-source entity resolution recognize them as the same organization.
 */
export function normalizeEntityKey(name: string): string {
  return name
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Token-set similarity (Jaccard over normalized identity tokens), 0..1.
 * Used as a conservative fuzzy-resolver for same-type entities.
 */
export function tokenSimilarity(a: string, b: string): number {
  const ta = normalizeEntityKey(a).split(" ").filter(Boolean);
  const tb = normalizeEntityKey(b).split(" ").filter(Boolean);
  if (!ta.length || !tb.length) return 0;
  const setA = new Set(ta);
  const setB = new Set(tb);
  const inter = [...setA].filter((t) => setB.has(t)).length;
  const union = new Set([...setA, ...setB]).size;
  return inter / union;
}
