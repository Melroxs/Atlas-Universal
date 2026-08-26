// ---------------------------------------------------------------------------
// Atlas Contradiction Engine — Shared Pure Module
//
// Extracted from supabase/functions/conversation-converse/source/contradictions.ts
// to enable reuse by both the Edge Function and the Evidence Pipeline.
//
// No Supabase calls, no Edge Function runtime assumptions, no UI dependencies.
// Pure deterministic logic that can be unit-tested independently.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GapSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFORMATIONAL";

export interface ContradictionDoc {
  _id?: string;
  title?: string | null;
  classification?: string | null;
  /** Extracted text (chunks joined). */
  text?: string | null;
}

export interface ContradictionValue {
  value: string;
  documentId?: string;
  documentTitle: string;
}

export interface EvidenceContradiction {
  /** Stable dedupe key (field + claim + values). */
  key: string;
  /** Claim number the values were grouped under, when determinable. */
  claim?: string;
  field: string;
  kind: "amount" | "quantity" | "date" | "text";
  values: ContradictionValue[];
  severity: GapSeverity;
  /** Human-readable reconciliation note citing both sources. */
  detail: string;
}

export interface ClaimFactsLike {
  claimNumber?: string | null;
  dateOfLoss?: number | null;
  estimateAmount?: number | null;
  invoicedAmount?: number | null;
  paymentAmount?: number | null;
  approvedAmount?: number | null;
  deductible?: number | null;
}

// ---------------------------------------------------------------------------
// Labeled-value extraction (deterministic)
// ---------------------------------------------------------------------------

interface Pick {
  claim?: string;
  value: string;
  doc: ContradictionDoc;
  amount?: number;
}

const LABEL_PATTERNS: Array<{
  field: string;
  kind: EvidenceContradiction["kind"];
  re: RegExp;
  amount?: boolean;
}> = [
  {
    field: "Estimate total",
    kind: "amount",
    re: /(?:total\s+)?estimate\s*(?:total)?[:$]\s*\$?\s*([\d,]+(?:\.\d{2})?)/i,
    amount: true,
  },
  {
    field: "Invoice total",
    kind: "amount",
    re: /invoice\s+total[:$]\s*\$?\s*([\d,]+(?:\.\d{2})?)/i,
    amount: true,
  },
  {
    field: "Payment amount",
    kind: "amount",
    re: /payment\s+amount[:$]\s*\$?\s*([\d,]+(?:\.\d{2})?)/i,
    amount: true,
  },
  {
    field: "Roofing amount",
    kind: "amount",
    re: /roofing\s*[:$]\s*\$?\s*([\d,]+(?:\.\d{2})?)/i,
    amount: true,
  },
  {
    field: "Deductible",
    kind: "amount",
    re: /deductible[:$]?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i,
    amount: true,
  },
  {
    field: "Roof area (SQ)",
    kind: "quantity",
    re: /(\d+(?:\.\d+)?)\s*SQ\b/gi,
    amount: false,
  },
  {
    field: "Loss date",
    kind: "date",
    re: /\b(Jan\w*|Feb\w*|Mar\w*|Apr\w*|May|Jun\w*|Jul\w*|Aug\w*|Sep\w*|Oct\w*|Nov\w*|Dec\w*)\s+\d{1,2}(,?\s+\d{4})?\b/g,
    amount: false,
  },
];

function num(v: string): number | null {
  const n = Number.parseFloat(v.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function claimNumberIn(text: string): string | undefined {
  return (
    text.match(/(?:claim|re:|claim number)\s*[:#]?\s*([A-Z]{2,6}[- ]?\d{1,4}[- ]?\d{4,12})/i)?.[1] ??
    text.match(/(?:CL|CLM|CN)\d{4,12}/i)?.[0] ??
    undefined
  );
}

function severityFor(
  field: string,
  kind: EvidenceContradiction["kind"],
  a: number | null,
  b: number | null,
): GapSeverity {
  if (kind === "quantity" && a !== null && b !== null && Math.abs(a - b) >= 1) return "HIGH";
  if (kind === "quantity" && a !== null && b !== null) return "MEDIUM";
  if (kind === "date") return "MEDIUM";
  if (kind === "amount" && a !== null && b !== null) {
    const bigger = Math.max(Math.abs(a), Math.abs(b));
    if (bigger > 0 && Math.abs(a - b) / bigger >= 0.1) return "HIGH";
    return "MEDIUM";
  }
  return "LOW";
}

function detailFor(
  field: string,
  kind: EvidenceContradiction["kind"],
  values: ContradictionValue[],
): string {
  const listed = values
    .map((v) => `${v.value} (in ${v.documentTitle})`)
    .join(" and as ");
  let diff = "";
  const nums = values.map((v) => num(v.value)).filter((n): n is number => n !== null);
  if (nums.length === 2) {
    if (kind === "amount") {
      const [a, b] = nums;
      const bigger = Math.max(Math.abs(a), Math.abs(b));
      if (bigger > 0) {
        const pct = Math.round((Math.abs(a - b) / bigger) * 100);
        diff = ` — a difference of ${fmtMoney(Math.abs(a - b))} (${pct}%)`;
      }
    } else if (kind === "quantity") {
      const [a, b] = nums;
      diff = ` — a difference of ${Math.abs(a - b)} ${values[0]?.value.includes("SQ") ? "SQ" : "units"}`;
    }
  }
  return `${field} appears as ${listed}${diff}. Both sources are preserved; reconcile before relying on either value (a difference is not automatically an error — supplements, allowances and adjustments are legitimate causes).`;
}

function keyFor(field: string, claim: string | undefined, values: ContradictionValue[]): string {
  const v = values
    .map((x) => x.value.replace(/[^a-z0-9]/gi, "").toLowerCase())
    .sort()
    .join("-");
  return `${field.toLowerCase().replace(/\s+/g, "_")}:${(claim ?? "global").toLowerCase()}:${v}`;
}

// ---------------------------------------------------------------------------
// Document-vs-document
// ---------------------------------------------------------------------------

/**
 * Scan tenant documents for conflicting labeled values, grouped by the claim
 * number found in each document. Reports only fields with 2+ DISTINCT values
 * for the same claim; every value cites the document it came from.
 */
export function scanDocumentsForContradictions(
  docs: ContradictionDoc[],
): EvidenceContradiction[] {
  const byField = new Map<string, Pick[]>();
  const push = (field: string, pick: Pick) => {
    const list = byField.get(field) ?? [];
    list.push(pick);
    byField.set(field, list);
  };

  const relevant = docs.filter((d) =>
    /estimate|xactimate|invoice|payment|supplement|fnol|scope|inspection|correspondence|policy|loss|deductible/i.test(
      `${d.title ?? ""} ${d.classification ?? ""}`,
    ),
  );

  for (const d of relevant) {
    const text = `${d.text ?? ""}`;
    if (!text.trim()) continue;
    const claim =
      claimNumberIn(text) ?? claimNumberIn(`${d.title ?? ""} ${d.classification ?? ""}`);
    for (const { field, kind, re, amount } of LABEL_PATTERNS) {
      const reCopy = new RegExp(
        re.source,
        re.flags.includes("g") ? re.flags : re.flags + "g",
      );
      const matches = [...text.matchAll(reCopy)];
      const seen = new Set<string>();
      for (const m of matches) {
        const raw = m[1] ?? m[0];
        const value =
          kind === "amount" ? `$${raw}` : kind === "quantity" ? m[0] : m[0] || raw;
        if (seen.has(value)) continue;
        seen.add(value);
        push(field, {
          claim,
          value,
          doc: d,
          amount: amount ? (num(raw) ?? undefined) : undefined,
        });
      }
    }
  }

  const hits: EvidenceContradiction[] = [];
  const seenKeys = new Set<string>();

  for (const [field, picks] of byField) {
    const grouped = new Map<string | undefined, Pick[]>();
    for (const p of picks) {
      const list = grouped.get(p.claim) ?? [];
      list.push(p);
      grouped.set(p.claim, list);
    }
    for (const [claim, group] of grouped) {
      const distinct = [...new Map(group.map((p) => [p.value, p])).values()];
      if (distinct.length < 2) continue;
      const kind = LABEL_PATTERNS.find((l) => l.field === field)?.kind ?? "text";
      const values: ContradictionValue[] = distinct.map((p) => ({
        value: p.value,
        documentId: p.doc._id,
        documentTitle: p.doc.title ?? "Document",
      }));
      const key = keyFor(field, claim, values);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const nums = values.map((v) => num(v.value));
      hits.push({
        key,
        claim,
        field,
        kind,
        values,
        severity: severityFor(field, kind, nums[0] ?? null, nums[1] ?? null),
        detail: detailFor(field, kind, values),
      });
    }
  }

  // Cross-field checks (same claim): estimate vs invoice, roofing vs payment.
  const cross = (aField: string, bField: string, label: string) => {
    const pa = byField.get(aField) ?? [];
    const pb = byField.get(bField) ?? [];
    for (const ca of pa) {
      for (const cb of pb) {
        if (ca.claim === cb.claim && ca.value !== cb.value && ca.claim) {
          const values: ContradictionValue[] = [
            {
              value: ca.value,
              documentId: ca.doc._id,
              documentTitle: ca.doc.title ?? "Document",
            },
            {
              value: cb.value,
              documentId: cb.doc._id,
              documentTitle: cb.doc.title ?? "Document",
            },
          ];
          const key = keyFor(label, ca.claim, values);
          if (seenKeys.has(key)) return;
          seenKeys.add(key);
          const an = num(ca.value);
          const bn = num(cb.value);
          hits.push({
            key,
            claim: ca.claim,
            field: label,
            kind: "amount",
            values,
            severity: severityFor(label, "amount", an, bn),
            detail: detailFor(label, "amount", values),
          });
          return;
        }
      }
    }
  };
  cross("Estimate total", "Invoice total", "Estimate vs invoice");
  cross("Roofing amount", "Payment amount", "Roofing vs carrier payment");

  return hits.sort((a, b) => {
    const sev = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFORMATIONAL: 4 } as const;
    return (sev[a.severity] ?? 5) - (sev[b.severity] ?? 5);
  });
}

// ---------------------------------------------------------------------------
// Claim-record vs documents
// ---------------------------------------------------------------------------

/** Compare a persisted claim record against values found in its documents. */
export function compareClaimAgainstDocuments(
  claim: ClaimFactsLike,
  docs: ContradictionDoc[],
): EvidenceContradiction[] {
  const out: EvidenceContradiction[] = [];
  const claimNum = claim.claimNumber ?? null;

  const textOf = (d: ContradictionDoc[]) => d.map((dd) => dd.text ?? "").join("\n");
  const allText = textOf(docs);

  const docAmount = (re: RegExp): number | null => {
    const m = allText.match(re);
    if (!m) return null;
    const n = Number.parseFloat((m[1] ?? "").replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  const docDocFor = (re: RegExp): ContradictionDoc | undefined =>
    docs.find((d) => re.test(`${d.text ?? ""}`));

  const mk = (
    field: string,
    kind: EvidenceContradiction["kind"],
    a: number | string,
    b: number | string,
    aDoc: ContradictionDoc | undefined,
    bDoc: ContradictionDoc | undefined,
    claimLabel?: string,
  ): void => {
    const values: ContradictionValue[] = [
      { value: String(a), documentId: aDoc?._id, documentTitle: aDoc?.title ?? "Claim record" },
      { value: String(b), documentId: bDoc?._id, documentTitle: bDoc?.title ?? "Document" },
    ];
    const key = keyFor(field, claimLabel ?? claimNum ?? undefined, values);
    const an = num(String(a));
    const bn = num(String(b));
    out.push({
      key,
      claim: claimLabel ?? claimNum ?? undefined,
      field,
      kind,
      values,
      severity: severityFor(field, kind, an, bn),
      detail: detailFor(field, kind, values),
    });
  };

  const pushIfDifferent = (
    field: string,
    kind: EvidenceContradiction["kind"],
    claimValue: number | null | undefined,
    docValue: number | null,
    doc: ContradictionDoc | undefined,
  ) => {
    if (claimValue === null || claimValue === undefined || docValue === null) return;
    if (Math.abs(claimValue - docValue) > 0.01) {
      mk(field, kind, fmtMoney(claimValue), fmtMoney(docValue), undefined, doc);
    }
  };

  pushIfDifferent(
    "Estimate total (claim vs document)",
    "amount",
    claim.estimateAmount,
    docAmount(LABEL_PATTERNS[0].re),
    docDocFor(LABEL_PATTERNS[0].re),
  );
  pushIfDifferent(
    "Invoice total (claim vs document)",
    "amount",
    claim.invoicedAmount,
    docAmount(LABEL_PATTERNS[1].re),
    docDocFor(LABEL_PATTERNS[1].re),
  );
  pushIfDifferent(
    "Payment amount (claim vs document)",
    "amount",
    claim.paymentAmount,
    docAmount(LABEL_PATTERNS[2].re),
    docDocFor(LABEL_PATTERNS[2].re),
  );
  pushIfDifferent(
    "Deductible (claim vs document)",
    "amount",
    claim.deductible,
    docAmount(LABEL_PATTERNS[4].re),
    docDocFor(LABEL_PATTERNS[4].re),
  );

  // Loss date: claim epoch-ms vs a month-day in the documents (same day check).
  if (typeof claim.dateOfLoss === "number") {
    const dates = [...allText.matchAll(LABEL_PATTERNS[6].re)];
    const claimDate = new Date(claim.dateOfLoss);
    for (const m of dates.slice(0, 6)) {
      const parsed = Date.parse(m[0]);
      if (Number.isNaN(parsed)) continue;
      const docDate = new Date(parsed);
      if (
        claimDate.getUTCFullYear() === docDate.getUTCFullYear() &&
        claimDate.getUTCMonth() === docDate.getUTCMonth() &&
        claimDate.getUTCDate() !== docDate.getUTCDate()
      ) {
        const doc = docs.find((d) => d.text?.includes(m[0]));
        mk(
          "Loss date (claim vs document)",
          "date",
          claimDate.toLocaleDateString(),
          m[0],
          undefined,
          doc,
        );
        break;
      }
    }
  }

  return out;
}
