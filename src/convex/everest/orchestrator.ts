// ---------------------------------------------------------------------------
// Everest — Conversational Orchestrator
//
// §25. ONE central orchestration service. Every surface (Ask, dashboard,
// workflows, future voice) calls the same layer: intent → context →
// entities → memory/knowledge → temporal/org state → plan → policy →
// answer/investigate/workflow/action → response. No parallel business logic
// for voice, chat or UI.
//
// §26. Request intents: informational · investigative · operational · action
//   · approval · status · monitoring · mixed · clarification.
//
// §28/§29/§30. The plan never executes anything: it only proposes, marks what
//   needs confirmation/approval, and delegates execution to the existing
//   workflow engine and action runtime. NEVER LLM → API directly.
//
// PURE module — deterministic, dependency-free, unit-testable.
// ---------------------------------------------------------------------------

import { classifyQuestion } from "./questions";

export type RequestIntent =
  | "informational"
  | "investigative"
  | "operational"
  | "action"
  | "approval"
  | "status"
  | "monitoring"
  | "mixed"
  | "clarification";

export interface IntentClassification {
  intent: RequestIntent;
  label: string;
  reasoning: string;
  signals: string[];
}

// --- Intent signals -----------------------------------------------------------

const INTENT_SIGNALS: Array<{ intent: RequestIntent; patterns: RegExp[]; label: string }> = [
  {
    intent: "status",
    patterns: [
      /\b(what happened|what changed|what's new|what is new|since yesterday|today|this week|overnight|summary of)\b/i,
      /\b(who did what|what did atlas do|what is the status of everything)\b/i,
      /\b(status update|any updates|what's going on|what is going on)\b/i,
    ],
    label: "status request",
  },
  {
    intent: "investigative",
    patterns: [
      /\b(why|how come|what's blocking|what is blocking|what is preventing|what's preventing)\b/i,
      /\b(why hasn'?t|why didn'?t|why did|why is|why are|why was)\b/i,
      /\b(investigate|dig into|look into|troubleshoot|figure out|trace|root cause|what went wrong)\b/i,
      /\b(delayed|stalled|stuck|blocked|frozen|not moving|no progress)\b/i,
    ],
    label: "investigative request",
  },
  {
    intent: "approval",
    patterns: [
      /\b(approval|approvals|approve|approved|waiting on me|needs my sign.?off|sign.?off|decide on)\b/i,
      /\b(pending approvals|what needs approval|who needs to approve)\b/i,
    ],
    label: "approval request",
  },
  {
    intent: "action",
    patterns: [
      /\b(send|create|schedule|start|stop|pause|cancel|archive|delete|close|open|submit|file|upload|sync|push|pay|email|message)\b/i,
      /\b(please do|go ahead and|do it now|execute|run this|perform)\b/i,
    ],
    label: "action request",
  },
  {
    intent: "operational",
    patterns: [
      /\b(start (the|a|our)? ?(review|process|workflow|document|claim|approval)|run the|begin the|kick off|initiate)\b/i,
      /\b(normal process|usual process|standard procedure|our process|the process for)\b/i,
    ],
    label: "operational request",
  },
  {
    intent: "monitoring",
    patterns: [
      /\b(keep (an )?eye on|watch|monitor|track|alert me|notify me when|flag if)\b/i,
    ],
    label: "monitoring request",
  },
  {
    intent: "informational",
    patterns: [
      /\b(what is|what's|define|explain|tell me about|how does|how do|what does|when does|where is|who is)\b/i,
      /\b(normal|typical|usually|generally|standard practice|best practice)\b/i,
    ],
    label: "informational request",
  },
];

/** §26 — classify the user's request intent deterministically. */
export function classifyIntent(question: string): IntentClassification {
  const q = (question ?? "").trim();
  if (!q) {
    return {
      intent: "clarification",
      label: "Clarification needed",
      reasoning: "No request text to interpret.",
      signals: [],
    };
  }

  const hits: Array<{ intent: RequestIntent; label: string }> = [];
  for (const s of INTENT_SIGNALS) {
    if (s.patterns.some((p) => p.test(q))) {
      hits.push({ intent: s.intent, label: s.label });
    }
  }

  // Explicit "why" wins toward investigation; explicit action verbs toward action.
  if (hits.length === 0) {
    return {
      intent: "informational",
      label: "Informational request",
      reasoning:
        "No strong intent signal — Atlas treats this as an informational request and answers from the knowledge layers.",
      signals: [],
    };
  }

  const unique = [...new Map(hits.map((h) => [h.intent, h])).values()];
  if (unique.length === 1) {
    const h = unique[0];
    return {
      intent: h.intent,
      label: `${h.label[0].toUpperCase()}${h.label.slice(1)}`,
      reasoning: `Signals detected: ${h.label}.`,
      signals: [h.label],
    };
  }

  // Mixed: investigation + action/operational verbs → "why did this happen and what should we do?"
  const kinds = new Set(unique.map((h) => h.intent));
  if (kinds.has("investigative") && (kinds.has("action") || kinds.has("operational"))) {
    return {
      intent: "mixed",
      label: "Mixed request — investigate + act",
      reasoning:
        "The request asks why something happened AND what to do about it. Atlas investigates first, then proposes a confirmed next step — it never jumps to execution.",
      signals: unique.map((h) => h.label),
    };
  }
  if (kinds.has("status") && kinds.has("investigative")) {
    return {
      intent: "mixed",
      label: "Mixed request — status + investigation",
      reasoning: "The request blends a status summary with a why. Atlas summarizes, then digs into the flagged items.",
      signals: unique.map((h) => h.label),
    };
  }

  // Precedence: investigation > action > approval > status > monitoring > informational.
  const PRECEDENCE: Record<RequestIntent, number> = {
    investigative: 9,
    action: 8,
    operational: 8,
    approval: 7,
    status: 6,
    monitoring: 5,
    mixed: 4,
    clarification: 3,
    informational: 1,
  };
  const top = [...unique].sort((a, b) => PRECEDENCE[a.intent] - PRECEDENCE[b.intent]).pop()!;
  return {
    intent: top.intent,
    label: `${top.label[0].toUpperCase()}${top.label.slice(1)}`,
    reasoning: `Multiple signals detected; Atlas prioritizes ${top.label}.`,
    signals: unique.map((h) => h.label),
  };
}

// --- Orchestration plan ---------------------------------------------------------

export type OrchestrationMode =
  | "answer"
  | "investigate"
  | "clarify"
  | "propose_workflow"
  | "prepare_action";

export interface OrchestrationPlan {
  mode: OrchestrationMode;
  reason: string;
  /** Existing workflow engine proposal — never auto-started. */
  proposedWorkflow?: {
    definitionId: string;
    label: string;
    expectedOutcome: string;
    confirmationRequired: boolean;
  };
  /** Existing action runtime proposal — never auto-executed. */
  proposedAction?: {
    toolId: string;
    label: string;
    risk: "low" | "medium" | "high";
    confirmationRequired: boolean;
    approvalRequired: string | null;
  };
  /** Structured clarification when ambiguity could be consequential. */
  clarification?: {
    message: string;
    options: string[];
    consequential: boolean;
  };
  /** Entity ambiguity surfaced from the resolution engine. */
  ambiguousEntities?: Array<{ name: string; basis: string }>;
}

export interface OrchestrateInput {
  question: string;
  intent: IntentClassification;
  questionType: string;
  /** Resolution result — ambiguous matches should force clarification. */
  resolutionAmbiguous?: boolean;
  resolutionMatches?: Array<{ name: string; basis: string }>;
  /** Registered workflow definitions the tenant can start. */
  workflowCandidates?: Array<{ definitionId: string; label: string; expectedOutcome: string }>;
  /** Registered tools the action runtime can execute. */
  actionCandidates?: Array<{ toolId: string; label: string; risk: "low" | "medium" | "high" }>;
  /** Existing pending approvals count (for approval intents). */
  pendingApprovalCount?: number;
  /** Has the question already been investigated? */
  investigationReady?: boolean;
}

const WORKFLOW_START_VERBS = /\b(start|begin|run|initiate|kick off|launch|open)\b/i;
const WORKFLOW_NOUNS = /\b(review|process|workflow|approval|claim|document|onboarding|onboarding|closeout|reconciliation)\b/i;

/** §25/§28/§29 — one deterministic plan for every request. Policy evaluation is
 *  limited to marking what needs confirmation/approval; execution always goes
 *  through the existing engines. */
export function orchestrate(input: OrchestrateInput): OrchestrationPlan {
  const intent = input.intent.intent;
  const q = input.question;

  // §31 — consequential ambiguity must clarify, never guess.
  if (input.resolutionAmbiguous && input.resolutionMatches && input.resolutionMatches.length >= 2) {
    return {
      mode: "clarify",
      reason:
        "The request references an entity that could not be resolved unambiguously, and acting on the wrong one would be consequential.",
      clarification: {
        message: `I found ${input.resolutionMatches.length} possible matches for that reference: ${input.resolutionMatches
          .map((m) => m.name)
          .join(", ")}. Which one do you mean?`,
        options: input.resolutionMatches.slice(0, 5).map((m) => m.name),
        consequential: true,
      },
      ambiguousEntities: input.resolutionMatches,
    };
  }

  switch (intent) {
    case "investigative":
      return {
        mode: "investigate",
        reason: "The request is a why/what's-blocking question — Atlas runs a multi-source investigation before answering.",
      };
    case "mixed":
      return {
        mode: input.investigationReady ? "investigate" : "investigate",
        reason:
          "Atlas investigates first (why did this happen), then proposes the next step from the findings — never jumping to execution.",
      };
    case "status":
      return {
        mode: "answer",
        reason: "A status request — Atlas summarizes the current organizational state from real records.",
      };
    case "approval": {
      const count = input.pendingApprovalCount ?? 0;
      return {
        mode: "answer",
        reason:
          count > 0
            ? `There ${count === 1 ? "is" : "are"} ${count} pending approval${count === 1 ? "" : "s"} — Atlas lists them with their deadlines.`
            : "No pending approvals were found in the current state.",
      };
    }
    case "operational": {
      const candidate = matchWorkflow(q, input.workflowCandidates ?? []);
      if (candidate) {
        return {
          mode: "propose_workflow",
          reason: `The request asks to run a process — Atlas identified "${candidate.label}" and proposes starting it through the existing workflow engine with confirmation.`,
          proposedWorkflow: {
            definitionId: candidate.definitionId,
            label: candidate.label,
            expectedOutcome: candidate.expectedOutcome,
            confirmationRequired: true,
          },
        };
      }
      return {
        mode: "clarify",
        reason:
          "The request asks to run a process, but no registered workflow clearly matches — Atlas asks which process is meant rather than inventing one.",
        clarification: {
          message:
            "I want to start the right process, but I couldn't confidently match one from the registered workflows. Which process do you mean?",
          options: (input.workflowCandidates ?? []).slice(0, 5).map((w) => w.label),
          consequential: false,
        },
      };
    }
    case "action": {
      const candidate = matchAction(q, input.actionCandidates ?? []);
      if (candidate) {
        const approvalRequired =
          candidate.risk === "high" ? "manager_approval" : candidate.risk === "medium" ? "confirmation" : null;
        return {
          mode: "prepare_action",
          reason: `The request asks Atlas to act — it prepared "${candidate.label}" through the action runtime. Nothing executes without ${approvalRequired ?? "authorization"}.`,
          proposedAction: {
            toolId: candidate.toolId,
            label: candidate.label,
            risk: candidate.risk,
            confirmationRequired: candidate.risk !== "low",
            approvalRequired,
          },
        };
      }
      return {
        mode: "clarify",
        reason: "An action was requested but no registered tool clearly matches — Atlas asks which action is meant.",
        clarification: {
          message:
            "I can prepare that action, but I couldn't confidently match it to a registered tool. Which action did you mean?",
          options: (input.actionCandidates ?? []).slice(0, 5).map((a) => a.label),
          consequential: true,
        },
      };
    }
    case "monitoring":
      return {
        mode: "answer",
        reason:
          "A monitoring request — Atlas explains what it tracks and how it will surface changes (events, sweeps, notifications).",
      };
    case "clarification":
      return {
        mode: "clarify",
        reason: "The request needs clarification before Atlas can proceed.",
        clarification: {
          message: "I need a bit more context to answer that well — what specifically would you like to know or do?",
          options: [],
          consequential: false,
        },
      };
    case "informational":
    default:
      return {
        mode: "answer",
        reason: `Informational request — Atlas answers from the ${input.questionType} knowledge layer with evidence.`,
      };
  }
}

function matchWorkflow(
  q: string,
  candidates: Array<{ definitionId: string; label: string; expectedOutcome: string }>,
) {
  const starts = WORKFLOW_START_VERBS.test(q) && WORKFLOW_NOUNS.test(q);
  if (!starts) return null;
  const tokens = q.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
  let best: { definitionId: string; label: string; expectedOutcome: string; score: number } | null = null;
  for (const c of candidates) {
    const hay = `${c.label} ${c.definitionId}`.toLowerCase();
    const score = tokens.filter((t) => hay.includes(t)).length;
    if (score > 0 && (!best || score > best.score)) {
      best = { ...c, score };
    }
  }
  return best && best.score > 0 ? { definitionId: best.definitionId, label: best.label, expectedOutcome: best.expectedOutcome } : null;
}

function matchAction(
  q: string,
  candidates: Array<{ toolId: string; label: string; risk: "low" | "medium" | "high" }>,
) {
  const tokens = q.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
  let best: { toolId: string; label: string; risk: "low" | "medium" | "high"; score: number } | null = null;
  for (const c of candidates) {
    const hay = `${c.label} ${c.toolId}`.toLowerCase();
    const score = tokens.filter((t) => hay.includes(t)).length;
    if (score > 0 && (!best || score > best.score)) {
      best = { ...c, score };
    }
  }
  return best && best.score > 0 ? { toolId: best.toolId, label: best.label, risk: best.risk } : null;
}

/** §33 — a truthful "I'll remember that" requires a memory write. This helper
 *  builds the memory record ONLY when the statement has a valid source/origin;
 *  otherwise Atlas must NOT claim it will remember. */
export function rememberable(input: {
  statement: string;
  origin: "explicit" | "observed" | "imported" | "inferred" | "system-derived";
  provenance?: string;
}): { canRemember: boolean; reason: string } {
  if (!input.statement || input.statement.trim().length < 3) {
    return { canRemember: false, reason: "No meaningful statement to remember." };
  }
  if (input.origin === "inferred" && !input.provenance) {
    return {
      canRemember: false,
      reason: "This is an inference without a source — Atlas will not silently store it as organizational fact.",
    };
  }
  return { canRemember: true, reason: "The statement has an identifiable origin and can be written through the memory service." };
}
