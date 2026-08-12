// ---------------------------------------------------------------------------
// Everest — Question Classification (Ask Atlas routing)
//
// Determines what KIND of question a user is asking so Ask Atlas answers from
// the right layer of knowledge:
//   domain        — general industry knowledge (packs)          "What is a supplement?"
//   organization  — this company's own data (knowledge graph)   "Which claims are pending?"
//   regulatory    — authoritative rules/standards              "What does OSHA require?"
//   mixed         — combines authority + organization          "Which of our jobs is affected by the new rule?"
//   general       — unclassified (fall back to all evidence)
//
// PURE module — deterministic, dependency-free, unit-testable.
// ---------------------------------------------------------------------------

export type QuestionType =
  | "domain"
  | "organization"
  | "regulatory"
  | "mixed"
  | "general";

export interface QuestionClassification {
  type: QuestionType;
  /** Short human label, e.g. "Regulatory question". */
  label: string;
  /** Why Atlas classified it this way (transparent, shown to the user). */
  reasoning: string;
  /** Matching signals that drove the classification. */
  signals: string[];
}

// --- Signal dictionaries ------------------------------------------------------

const REGULATORY_SIGNALS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(regulation|regulatory|regulations)\b/i, label: "regulation" },
  { pattern: /\b(law|statute|statutory|legislation|ordinance)\b/i, label: "law/statute" },
  { pattern: /\b(compliance|compliant|comply with|must comply)\b/i, label: "compliance" },
  { pattern: /\b(requirement|requirements|required by|requires)\b/i, label: "requirement" },
  { pattern: /\b(standard|standards body|accredited)\b/i, label: "standard" },
  { pattern: /\b(osha|epa|ftc|irs|nfpa|iicrc|iso|ashrae|icc|dbpr|tdlr)\b/i, label: "regulator acronym" },
  { pattern: /\b(licen[cs]e|licens[ei]ng|certification|certified)\b/i, label: "licensing" },
  { pattern: /\b(permit|permits|permitted|prohibited|ban|banned)\b/i, label: "permit/prohibition" },
  { pattern: /\b(legal|legally|liable|liability|penalty|penalties|fine|fines)\b/i, label: "legal/penalty" },
  { pattern: /\b(effective date|effective as of|effective from)\b/i, label: "effective date" },
  { pattern: /\b(mandat(e|ory)|obligation|obliged)\b/i, label: "mandate" },
  { pattern: /\b(record.?keeping|data security|privacy law|consumer protection)\b/i, label: "regulatory topic" },
];

const ORGANIZATION_SIGNALS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(our|ours|we|us|my|mine|this company|our company)\b/i, label: "first-person company" },
  { pattern: /\b(company|workspace|tenant|team|staff|employees?)\b/i, label: "company noun" },
  { pattern: /\b(customers?|clients?|accounts?|invoices?|payments?|receivables?|suppliers?|vendors?)\b/i, label: "operational object" },
  { pattern: /\b(claims?|projects?|jobs?|work orders?|tickets?|orders?|deals?|leads?)\b/i, label: "work object" },
  { pattern: /\b(current(ly)?|pending|open|active|outstanding|overdue|upcoming)\b/i, label: "state query" },
  { pattern: /\b(how many|how much|which of|list|status of|details? about|summarize|what do we|are we|do we)\b/i, label: "org query phrasing" },
  { pattern: /\b(documents?|chunks?|knowledge base|uploaded|files?)\b/i, label: "knowledge base object" },
];

const DOMAIN_SIGNALS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(what is|what's|define|definition of|meaning of|what does .* mean)\b/i, label: "definition" },
  { pattern: /\b(how does|how do|how to|what are|what's the difference|difference between)\b/i, label: "how/what" },
  { pattern: /\b(terminology|term|vocabulary|jargon)\b/i, label: "terminology" },
  { pattern: /\b(supplement|xactimate|fnol|mitigation|drying log|scope of work|estimate)\b/i, label: "domain term" },
  { pattern: /\b(bookings?|recognized revenue|deferred revenue|gross margin|ebitda|working capital|accrual)\b/i, label: "finance domain term" },
  { pattern: /\b(generally|typical|typically|usually|industry|benchmark|best practice|standard practice)\b/i, label: "general-knowledge phrasing" },
];

// --- Classification -----------------------------------------------------------

function matches(q: string, signals: Array<{ pattern: RegExp; label: string }>) {
  return signals.filter((s) => s.pattern.test(q)).map((s) => s.label);
}

/** Classify a question into the layer of knowledge it should be answered from. */
export function classifyQuestion(question: string): QuestionClassification {
  const q = (question ?? "").trim();
  if (!q) {
    return {
      type: "general",
      label: "General question",
      reasoning: "No question text to classify.",
      signals: [],
    };
  }

  const reg = matches(q, REGULATORY_SIGNALS);
  const org = matches(q, ORGANIZATION_SIGNALS);
  const dom = matches(q, DOMAIN_SIGNALS);

  // Mixed: an authority/rule question about THIS company's operations.
  if (reg.length > 0 && org.length > 0) {
    return {
      type: "mixed",
      label: "Mixed question — authority × organization",
      reasoning:
        "The question asks about a rule or requirement AND this company's own situation. Atlas combines authoritative knowledge with organization data, keeping each layer labeled.",
      signals: [...reg, ...org],
    };
  }
  if (reg.length > 0) {
    return {
      type: "regulatory",
      label: "Regulatory question",
      reasoning:
        "The question is about a rule, standard, law or requirement. Atlas answers from the authoritative source registry with explicit provenance — never implies legal advice.",
      signals: reg,
    };
  }
  if (org.length > 0) {
    return {
      type: "organization",
      label: "Organization question",
      reasoning:
        "The question is about this company's own data. Atlas answers from the workspace knowledge graph with cited evidence.",
      signals: org,
    };
  }
  if (dom.length > 0) {
    return {
      type: "domain",
      label: "Domain question",
      reasoning:
        "The question asks for general industry knowledge. Atlas answers from the configured intelligence packs and marks it as domain knowledge, not organization-specific fact.",
      signals: dom,
    };
  }
  return {
    type: "general",
    label: "General question",
    reasoning:
      "No strong signal for a specific layer — Atlas searches all available evidence.",
    signals: [],
  };
}

/** Short badge label for UI chips. */
export function questionTypeBadge(type: QuestionType): string {
  switch (type) {
    case "domain":
      return "Domain knowledge";
    case "organization":
      return "Organization data";
    case "regulatory":
      return "Authority / regulatory";
    case "mixed":
      return "Authority × organization";
    default:
      return "General";
  }
}
