// ---------------------------------------------------------------------------
// Phase 10 — Conversational Voice OS · ONE conversational brain.
//
// Text, voice and UI all route through `converse`. It delegates to the EXISTING
// verified engines — Ask Atlas (grounded QA + authority), Everest (org state,
// investigation, entity resolution, memory), the Phase 4 action runtime (plan →
// risk → confirmation → execution → verification → audit) and the durable
// workflow engine. No parallel conversational business logic is created here.
//
// Security: every turn is authenticated, tenant-scoped and role-aware. Voice is
// never a bypass — a user who cannot act via the UI cannot act via voice.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireTenant, requireUser } from "./helpers";
import { classifyQuestion } from "./everest/questions";
import { STATUS_LABELS } from "./insurance/claims";
import { greeting as briefingGreeting } from "./ops/briefing";

// ---------------------------------------------------------------------------
// Types shared with the client
// ---------------------------------------------------------------------------

export type ConversationIntent =
  | "greeting"
  | "confirmation"
  | "cancellation"
  | "selection"
  | "organizational"
  | "investigative"
  | "workflow"
  | "claims"
  | "action"
  | "regulatory"
  | "informational"
  | "unclear";

export interface IntentResult {
  intent: ConversationIntent;
  confidence: number;
  signals: string[];
}

export interface EntityRef {
  id: string;
  name: string;
  entityTypeKey?: string;
  status?: string;
}

export interface PendingState {
  kind:
    | "none"
    | "confirm_action"
    | "confirm_workflow"
    | "clarify_entity"
    | "clarify_general"
    | "approval";
  message?: string;
  title?: string;
  /** Tool plan awaiting confirmation (stored until the user decides). */
  plan?: {
    toolId: string;
    toolName?: string;
    arguments?: Record<string, unknown>;
    expectedOutcome?: string;
    verificationPlan?: string;
    confidence?: number;
  } | null;
  actionId?: string;
  workflow?: { definitionId: string; name: string; entityName?: string };
  options?: Array<{ id?: string; label: string }>;
  question?: string;
  /** Custom claim/recovery action awaiting confirmation. */
  actionType?: string;
  claim?: { claimId?: string; supplementId?: string; label?: string; resolve?: boolean };
}

export interface TemporalInfo {
  label?: string;
  from?: number;
  to?: number;
}

export interface ConversationResponse {
  sessionId: Id<"conversationSessions">;
  intent: ConversationIntent;
  intentLabel: string;
  confidence: number;
  answer: string;
  /** Concise voice rendering of the answer. */
  spoken: string;
  classification?: "FACT" | "RULE" | "OBSERVATION" | "INFERENCE" | "RECOMMENDATION";
  mode?: "ai" | "local";
  limitations?: string;
  suggestedActions: string[];
  questionType?: string;
  questionTypeLabel?: string;
  authorityAnswers: Array<Record<string, unknown>>;
  evidence: Array<Record<string, unknown>>;
  toolPlan: Record<string, unknown> | null;
  entityRefs: EntityRef[];
  temporal?: TemporalInfo;
  pending: PendingState;
  memoryNote?: string;
}

// ---------------------------------------------------------------------------
// Deterministic intent classification (pure — unit tested)
// ---------------------------------------------------------------------------

const GREETING_RE =
  /\b(hi|hello|hey|good (morning|afternoon|evening)|howdy)\b/i;
const CONFIRM_RE =
  /^(yes|yeah|yep|yup|correct|right|confirmed|confirm|proceed|go ahead|goahead|do it|please do|sure|ok|okay|fine|affirmative|that'?s right|agree|approved|approve)\b/i;
const CANCEL_RE =
  /^(no|nope|nah|cancel|stop|abort|decline|never mind|nevermind|forget it|don'?t|dont|not that|wrong|undo|that'?s wrong)\b/i;
const SELECTION_RE =
  /(\b(first|second|third|fourth|fifth|sixth|last|final)\b|\boption\s*\d|the one (about|with)|\bnumber\s*\d)/i;
const WORKFLOW_RE =
  /(start|run|begin|launch|trigger|kick ?off|initiate|activate|restart|resume)\s+(the\s+)?[a-z ]{2,40}?(workflow|process|procedure|flow|routine)/i;
const ORGANIZATIONAL_RE =
  /(what'?s going on|what'?s happening|how'?s (the|our|everything)|status (update|of|overview)|what changed|what'?s new|what needs (my |our |)attention|what'?s waiting on (me|us|you)|waiting on (me|us)|what should (i|we) (know|worry|watch)|anything (important|urgent|i should know)|biggest (issues|problems|risks)|overview|what happened (today|yesterday|this week)|what did (atlas|you|we) (do|change|send|complete|finish)|did (the|that|this) (workflow|action|email|request) (complete|finish|go through|send|run)|what'?s on (my|our) plate)/i;
const INVESTIGATIVE_RE =
  /(why (is|has|did|didn|hasn|was|were|does|do|are)|what'?s wrong|what went wrong|what'?s blocking|what'?s holding|blocking|stuck|stalled|stagnant|investigat|root cause|what happened to|why\b)/i;
const CLAIMS_RE =
  /(\bclaims?\b|supplement|leaving on the table|revenue recovery|carrier response|date of loss|claim number)/i;
const ACTION_RE =
  /^(send|email|schedule|create|update|approve|reject|cancel|close|start|stop|remind|notify|invite|post|record|log|file|submit|pay|mark|assign|move|copy|delete|add|set|tag|archive|restore)\b/i;

/** Classify the transcript into a conversation intent. */
export function classifyIntent(
  text: string,
  context?: { pending?: PendingState | null } | null,
): IntentResult {
  const q = text.trim();
  const low = q.toLowerCase();
  const signals: string[] = [];
  const pending = context?.pending;
  const hasPending = pending && pending.kind !== "none";

  if (!q) return { intent: "unclear", confidence: 1, signals: ["empty"] };
  if (GREETING_RE.test(q) && q.split(/\s+/).length <= 6) {
    signals.push("greeting phrase");
    return { intent: "greeting", confidence: 0.95, signals };
  }
  if (hasPending && CONFIRM_RE.test(low)) {
    signals.push("confirmation of pending");
    return { intent: "confirmation", confidence: 0.98, signals };
  }
  if (hasPending && CANCEL_RE.test(low)) {
    signals.push("cancellation of pending");
    return { intent: "cancellation", confidence: 0.98, signals };
  }
  if (hasPending && pending?.kind?.startsWith("clarify") && SELECTION_RE.test(low)) {
    signals.push("option selection");
    return { intent: "selection", confidence: 0.95, signals };
  }
  if (hasPending && pending?.kind?.startsWith("clarify")) {
    // Anything else while clarifying an entity is treated as a selection
    // attempt when it names one of the options; otherwise keep clarifying.
    signals.push("clarification context");
    return { intent: "selection", confidence: 0.6, signals };
  }
  if (WORKFLOW_RE.test(low)) {
    signals.push("workflow request");
    return { intent: "workflow", confidence: 0.9, signals };
  }
  // Insurance restoration vertical — but "why…" phrasing keeps investigating.
  if (CLAIMS_RE.test(low) && !INVESTIGATIVE_RE.test(q)) {
    signals.push("insurance claim phrasing");
    return { intent: "claims", confidence: 0.82, signals };
  }
  if (ORGANIZATIONAL_RE.test(low)) {
    signals.push("organizational state query");
    return { intent: "organizational", confidence: 0.85, signals };
  }
  if (INVESTIGATIVE_RE.test(q)) {
    signals.push("why / investigation phrasing");
    return { intent: "investigative", confidence: 0.8, signals };
  }
  if (ACTION_RE.test(low) || /\b(send|create|update|approve|start|close|cancel|submit)\b/.test(low)) {
    signals.push("action phrasing");
    return { intent: "action", confidence: 0.72, signals };
  }
  // Regulatory/mixed questions reuse the existing Ask classifier.
  const cls = classifyQuestion(q);
  if (cls.type === "regulatory" || cls.type === "mixed") {
    signals.push("regulatory phrasing");
    return { intent: "regulatory", confidence: 0.85, signals };
  }
  return { intent: "informational", confidence: 0.7, signals };
}

export const INTENT_LABELS: Record<ConversationIntent, string> = {
  greeting: "Greeting",
  confirmation: "Confirmation",
  cancellation: "Cancellation",
  selection: "Selection",
  organizational: "Organizational intelligence",
  investigative: "Investigation",
  workflow: "Workflow",
  claims: "Claims & recovery",
  action: "Action",
  regulatory: "Regulatory",
  informational: "Information",
  unclear: "Clarification needed",
};

// ---------------------------------------------------------------------------
// Temporal resolution (pure — unit tested). Operates in the org timezone.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function zonedParts(now: number, timezone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(now));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  let hour = get("hour");
  if (hour === 24) hour = 0; // some engines report midnight as 24:00
  return { y: get("year"), mo: get("month"), d: get("day"), h: hour, mi: get("minute") };
}

/** Timestamp in the org timezone for a (date, hh:mm) expressed in UTC terms. */
function zonedAt(p: { y: number; mo: number; d: number }, h: number, mi: number) {
  return Date.UTC(p.y, p.mo - 1, p.d, h, mi);
}

export interface TemporalWindow {
  label: string;
  from: number;
  to: number;
}

/**
 * Resolve relative-time phrases ("today", "this week", "by Friday",
 * "next business day") into absolute UTC ranges in the org timezone.
 * Returns an empty array when no temporal phrase is found.
 */
export function resolveTemporalWindow(
  text: string,
  now: number,
  timezone = "UTC",
): TemporalWindow[] {
  const low = text.toLowerCase();
  const p = zonedParts(now, timezone);
  const dayStart = zonedAt(p, 0, 0);
  const dayEnd = dayStart + DAY_MS - 1;
  const weekday = new Date(dayStart).getUTCDay(); // 0 = Sunday
  const monday = dayStart - ((weekday + 6) % 7) * DAY_MS;
  const monthStart = Date.UTC(p.y, p.mo - 1, 1);
  const monthEnd = Date.UTC(p.y, p.mo, 1) - 1;
  const windows: TemporalWindow[] = [];

  if (/\btoday\b/.test(low)) windows.push({ label: "today", from: dayStart, to: dayEnd });
  if (/\byesterday\b/.test(low))
    windows.push({ label: "yesterday", from: dayStart - DAY_MS, to: dayEnd - DAY_MS });
  if (/\bthis week\b/.test(low)) windows.push({ label: "this week", from: monday, to: monday + 7 * DAY_MS - 1 });
  if (/\blast week\b/.test(low))
    windows.push({ label: "last week", from: monday - 7 * DAY_MS, to: monday - 1 });
  if (/\bthis month\b/.test(low)) windows.push({ label: "this month", from: monthStart, to: monthEnd });
  if (/\blast month\b/.test(low))
    windows.push({ label: "last month", from: Date.UTC(p.y, p.mo - 2, 1), to: monthStart - 1 });
  if (/\brecent(ly)?\b/.test(low))
    windows.push({ label: "recently", from: now - 7 * DAY_MS, to: now });
  if (/\bend of (the )?day\b|(^|\s)eod(\s|$)/.test(low))
    windows.push({ label: "end of day", from: now, to: dayEnd });

  const byDay = /\bby (sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(low);
  if (byDay) {
    const target = WEEKDAYS.indexOf(byDay[1]);
    let offset = (target - weekday + 7) % 7;
    if (offset === 0) offset = 7; // "by Friday" on Friday means end of Friday
    const start = dayStart + offset * DAY_MS;
    windows.push({ label: `by ${byDay[1]}`, from: now, to: start + DAY_MS - 1 });
  }

  if (/\bnext business day\b/.test(low)) {
    let cursor = dayStart + DAY_MS;
    while (new Date(cursor).getUTCDay() === 0 || new Date(cursor).getUTCDay() === 6) {
      cursor += DAY_MS;
    }
    windows.push({ label: "next business day", from: cursor, to: cursor + DAY_MS - 1 });
  }

  // Deduplicate by label, keep first.
  const seen = new Set<string>();
  return windows.filter((w) => (seen.has(w.label) ? false : (seen.add(w.label), true)));
}

// ---------------------------------------------------------------------------
// Selection & confirmation helpers (pure — unit tested)
// ---------------------------------------------------------------------------

const ORDINAL: Array<[RegExp, number]> = [
  [/first|\b1st\b|\bnumber one\b/, 0],
  [/second|\b2nd\b/, 1],
  [/third|\b3rd\b/, 2],
  [/fourth|\b4th\b/, 3],
  [/fifth|\b5th\b/, 4],
];

/** Resolve "the second one" / "option 3" / a name mention to an option index. */
export function resolveSelection(text: string, options: string[]): number {
  const low = text.toLowerCase();
  for (const [re, idx] of ORDINAL) {
    if (re.test(low) && idx < options.length) return idx;
  }
  const optNum = /\boption\s*(\d+)\b/.exec(low);
  if (optNum) {
    const n = Number(optNum[1]) - 1;
    if (n >= 0 && n < options.length) return n;
  }
  if (/\blast one\b/.test(low) && options.length > 0) return options.length - 1;
  const toks = low.split(/\W+/).filter((t) => t.length > 2);
  let best = -1;
  let bestScore = 0;
  options.forEach((o, i) => {
    const lt = o.toLowerCase();
    const score = toks.filter((t) => lt.includes(t)).length;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return bestScore >= 1 ? best : -1;
}

/** Render a concise spoken version of a written answer. */
export function spokenFor(answer: string): string {
  const cleaned = answer
    .replace(/^[A-Z][A-Z_ ]+\.\s*/, "") // strip layer badges like "ORGANIZATION QUESTION."
    .replace(/\[(?:A?\d+)\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  const sentences = cleaned.split(/(?<=[.!?])\s+/);
  const spoken = sentences.slice(0, 2).join(" ");
  return spoken.length > 320 ? `${spoken.slice(0, 320).trim()}…` : spoken;
}

/**
 * Memory-vs-live-state honesty: never present inferred, stale or disputed
 * memory as authoritative. Returns a human note (or undefined when clean).
 */
export function memoryConflictNote(
  memories: Array<{ status?: string; origin?: string; memoryType?: string }>,
): string | undefined {
  const disputed = memories.filter(
    (m) => m.status === "contradicted" || m.status === "disputed",
  );
  const stale = memories.filter(
    (m) => m.status === "stale" || m.status === "expired",
  );
  const inferred = memories.filter(
    (m) => m.origin === "inferred" && (m.status === "active" || !m.status),
  );
  const notes: string[] = [];
  if (disputed.length > 0) {
    notes.push(
      `${disputed.length} recorded ${disputed.length === 1 ? "memory is" : "memories are"} disputed or contradicted — treat as unverified.`,
    );
  }
  if (stale.length > 0) {
    notes.push(
      `${stale.length} recorded ${stale.length === 1 ? "memory is" : "memories are"} marked outdated — live verified system state takes priority.`,
    );
  }
  if (inferred.length > 0) {
    notes.push("Some memory was inferred rather than confirmed — live system state wins if they conflict.");
  }
  return notes.length > 0 ? notes.join(" ") : undefined;
}

// ---------------------------------------------------------------------------
// Session access control (pure — unit tested). Voice/text never bypasses
// tenant or user boundaries.
// ---------------------------------------------------------------------------

export function canAccessSession(
  session: { tenantId: Id<"tenants">; userId: Id<"users"> } | null | undefined,
  tenantId: Id<"tenants">,
  userId: Id<"users">,
): boolean {
  return Boolean(session && session.tenantId === tenantId && session.userId === userId);
}

// ---------------------------------------------------------------------------
// Session persistence helpers (public surface)
// ---------------------------------------------------------------------------

export const listConversationSessions = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    return await ctx.db
      .query("conversationSessions")
      .withIndex("by_tenant_user", (q) => q.eq("tenantId", tenantId).eq("userId", userId))
      .order("desc")
      .take(limit ?? 30);
  },
});

export const getConversationSession = query({
  args: { sessionId: v.id("conversationSessions") },
  handler: async (ctx, { sessionId }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const doc = await ctx.db.get(sessionId);
    if (!canAccessSession(doc, tenantId, userId)) return null;
    return doc;
  },
});

export const deleteConversationSession = mutation({
  args: { sessionId: v.id("conversationSessions") },
  handler: async (ctx, { sessionId }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const doc = await ctx.db.get(sessionId);
    if (!canAccessSession(doc, tenantId, userId)) {
      throw new Error("Session not found.");
    }
    await ctx.db.delete(sessionId);
  },
});

// ---------------------------------------------------------------------------
// Internal session plumbing (internal — never client-callable)
// ---------------------------------------------------------------------------

export const internalGetConversationSessionById = internalQuery({
  args: { sessionId: v.id("conversationSessions") },
  handler: async (ctx, { sessionId }) => await ctx.db.get(sessionId),
});

export const internalCreateConversationSession = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    userId: v.id("users"),
    title: v.string(),
    firstMessage: v.object({
      role: v.literal("user"),
      text: v.string(),
      ts: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("conversationSessions", {
      tenantId: args.tenantId,
      userId: args.userId,
      title: args.title,
      messages: [args.firstMessage],
      context: { pending: { kind: "none" }, pageContext: undefined },
      updatedAt: Date.now(),
    });
  },
});

export const internalAppendConversationMessage = internalMutation({
  args: {
    sessionId: v.id("conversationSessions"),
    message: v.object({
      role: v.union(v.literal("user"), v.literal("assistant")),
      text: v.string(),
      spoken: v.optional(v.string()),
      intent: v.optional(v.string()),
      kind: v.optional(v.string()),
      ts: v.number(),
    }),
    context: v.optional(v.any()),
    title: v.optional(v.string()),
  },
  handler: async (ctx, { sessionId, message, context, title }) => {
    const doc = await ctx.db.get(sessionId);
    if (!doc) throw new Error("Conversation session not found.");
    await ctx.db.patch(sessionId, {
      messages: [...doc.messages, message].slice(-60),
      context: context ?? doc.context,
      title: title ?? doc.title,
      updatedAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// The conversation brain
// ---------------------------------------------------------------------------

interface ContextShape {
  pageContext?: string;
  entityContext?: EntityRef | null;
  pending?: PendingState;
  lastResult?: { kind: string; refs: string[] } | null;
  /** Active insurance claim (and optional draft supplement) in this thread. */
  claimContext?: { claimId: string; supplementId?: string } | null;
}

interface Conv {
  /** runQuery */
  rq: (fn: unknown, args?: unknown) => Promise<unknown>;
  /** runAction */
  ra: (fn: unknown, args?: unknown) => Promise<unknown>;
  /** runMutation */
  rm: (fn: unknown, args?: unknown) => Promise<unknown>;
  /** scheduler.runAfter(0, ...) */
  schedule: (fn: unknown, args: unknown) => void;
}

/** Shape every route handler returns (minus the session/intent envelope). */
type RouteResult = {
  answer: string;
  spoken: string;
  classification?: ConversationResponse["classification"];
  mode?: ConversationResponse["mode"];
  limitations?: string;
  suggestedActions: string[];
  questionType?: string;
  questionTypeLabel?: string;
  authorityAnswers: Array<Record<string, unknown>>;
  evidence: Array<Record<string, unknown>>;
  toolPlan: ConversationResponse["toolPlan"];
  entityRefs: EntityRef[];
  pending: PendingState;
  intentKind?: string;
  memoryNote?: string;
  claimContext?: { claimId: string; supplementId?: string } | null;
};

const EMPTY_PENDING: PendingState = { kind: "none" };

export const converse = action({
  args: {
    sessionId: v.optional(v.id("conversationSessions")),
    transcript: v.string(),
    pageContext: v.optional(v.string()),
    entityContextId: v.optional(v.id("entities")),
  },
  handler: async (ctx, args): Promise<ConversationResponse> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("You must be signed in.");
    const membership = await ctx.runQuery(internal.internal.getMembershipByUser, {
      userId,
    });
    if (!membership) throw new Error("You don't belong to a workspace yet.");
    const tenantId = membership.tenantId as Id<"tenants">;
    const role = membership.role as string;
    const now = Date.now();

    const conv: Conv = {
      rq: (fn, a) => ctx.runQuery(fn as never, a as never),
      ra: (fn, a) => ctx.runAction(fn as never, a as never),
      rm: (fn, a) => ctx.runMutation(fn as never, a as never),
      schedule: (fn, a) => ctx.scheduler.runAfter(0, fn as never, a as never),
    };

    const orgContext = (await ctx.runQuery(
      internal.internal.getOrganizationContextByTenant,
      { tenantId },
    )) as { primaryTimezone?: string } | null;
    const timezone = orgContext?.primaryTimezone ?? "UTC";

    const q = args.transcript.trim();
    if (!q) {
      return {
        sessionId: args.sessionId as Id<"conversationSessions">,
        intent: "unclear",
        intentLabel: INTENT_LABELS.unclear,
        confidence: 1,
        answer: "I didn't catch that — could you say it again?",
        spoken: "I didn't catch that. Could you say it again?",
        suggestedActions: [],
        authorityAnswers: [],
        evidence: [],
        toolPlan: null,
        entityRefs: [],
        pending: { kind: "clarify_general", message: "Please repeat your request." },
      };
    }

    // ---- Load or create the session (tenant + user scoped) ----------------
    let sessionId = args.sessionId as Id<"conversationSessions"> | undefined;
    let doc: { _id: Id<"conversationSessions">; title: string; context?: unknown } | null = null;
    if (sessionId) {
      doc = (await conv.rq(
        internal.conversation.internalGetConversationSessionById,
        { sessionId },
      )) as { _id: Id<"conversationSessions">; title: string; context?: unknown } | null;
      if (!doc) {
        // Stale id — start fresh rather than failing the conversation.
        sessionId = undefined;
      }
    }
    const context = (doc?.context ?? {}) as ContextShape;
    let entityContext = context.entityContext ?? null;

    if (args.entityContextId) {
      const entities = (await conv.rq(internal.internal.listEntitiesByTenant, {
        tenantId,
      })) as Array<{ _id: Id<"entities">; name: string; entityTypeKey?: string; status?: string }>;
      const pinned = entities.find((e) => e._id === args.entityContextId);
      if (pinned) {
        entityContext = {
          id: String(pinned._id),
          name: pinned.name,
          entityTypeKey: pinned.entityTypeKey,
          status: pinned.status,
        };
      }
    }

    if (!sessionId || !doc) {
      const created = await conv.rm(
        internal.conversation.internalCreateConversationSession,
        {
          tenantId,
          userId,
          title: q.slice(0, 80),
          firstMessage: { role: "user", text: q, ts: now },
        },
      );
      sessionId = created as Id<"conversationSessions">;
    } else {
      await conv.rm(internal.conversation.internalAppendConversationMessage, {
        sessionId,
        message: { role: "user", text: q, ts: now },
      });
    }

    // ---- Classify ---------------------------------------------------------
    const intentResult = classifyIntent(q, { pending: context.pending ?? EMPTY_PENDING });
    const intent = intentResult.intent;
    const temporalWindows = resolveTemporalWindow(q, now, timezone);
    const temporal: TemporalInfo | undefined = temporalWindows[0]
      ? {
          label: temporalWindows[0].label,
          from: temporalWindows[0].from,
          to: temporalWindows[0].to,
        }
      : undefined;

    // ---- Route ------------------------------------------------------------
    let response: RouteResult;

    switch (intent) {
      case "greeting": {
        const g = await greetingFor(conv, timezone);
        response = {
          answer: g.answer,
          spoken: g.spoken,
          suggestedActions: [],
          authorityAnswers: [],
          evidence: [],
          toolPlan: null,
          entityRefs: [],
          pending: EMPTY_PENDING,
        };
        break;
      }

      case "confirmation":
      case "cancellation": {
        response = await handleConfirmation(
          conv,
          { userId, tenantId, role, tenantIdStr: String(tenantId) },
          intent,
          context.pending ?? EMPTY_PENDING,
        );
        break;
      }

      case "selection": {
        response = await handleSelection(
          conv,
          q,
          context.pending ?? EMPTY_PENDING,
          entityContext,
        );
        break;
      }

      case "organizational": {
        response = await handleOrganizational(conv, temporal);
        break;
      }

      case "investigative": {
        response = await handleInvestigation(conv, q, entityContext);
        break;
      }

      case "workflow": {
        response = await handleWorkflow(conv, q, entityContext);
        break;
      }

      case "claims": {
        response = await handleClaims(
          conv,
          q,
          context,
          { userId, tenantId, role, tenantIdStr: String(tenantId) },
        );
        break;
      }

      case "action": {
        response = await handleAction(conv, q, entityContext);
        break;
      }

      case "regulatory": {
        response = await handleAsk(conv, q, entityContext, temporal, true);
        break;
      }

      default: {
        response = await handleAsk(conv, q, entityContext, temporal, false);
        break;
      }
    }

    // ---- Persist the assistant turn + audit -------------------------------
    const nextContext: ContextShape = {
      pageContext: args.pageContext ?? context.pageContext,
      entityContext,
      pending: response.pending ?? EMPTY_PENDING,
      lastResult: response.entityRefs.length
        ? { kind: response.intentKind ?? intent, refs: response.entityRefs.map((e) => e.id) }
        : (context.lastResult ?? null),
      claimContext: response.claimContext ?? context.claimContext,
    };
    delete response.intentKind;
    delete response.claimContext;

    const memoryNote = response.memoryNote ?? (await memoryNoteFor(conv, tenantId));

    await conv.rm(internal.conversation.internalAppendConversationMessage, {
      sessionId,
      message: {
        role: "assistant",
        text: response.answer,
        spoken: response.spoken || spokenFor(response.answer),
        intent,
        kind:
          response.pending?.kind === "confirm_action" || response.pending?.kind === "confirm_workflow"
            ? "confirmation_request"
            : response.pending?.kind?.startsWith("clarify")
              ? "clarification_request"
              : "answer",
        ts: Date.now(),
      },
      context: nextContext,
      title: doc?.title ?? q.slice(0, 80),
    });

    await conv.rm(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: "conversation_turn",
      targetType: "conversation_session",
      targetId: String(sessionId),
      metadata: {
        intent,
        transcript: q.slice(0, 500),
        pending: response.pending?.kind ?? "none",
        entityRefs: response.entityRefs.map((e) => e.id),
      },
    });

    return {
      sessionId,
      intent,
      intentLabel: INTENT_LABELS[intent],
      confidence: intentResult.confidence,
      ...response,
      temporal,
      memoryNote,
    };
  },
});

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function greetingFor(
  conv: Conv,
  timezone: string,
): Promise<{ answer: string; spoken: string }> {
  const state = (await conv.rq(api.everest.api.getOrganizationalState, {})) as {
    counts?: { openDecisions?: number; pendingApprovals?: number; failedWorkflows?: number };
    timezone?: string;
  };
  const counts = state.counts ?? {};
  const tz = state.timezone ?? timezone;
  const g = briefingGreeting(Date.now(), tz);
  const attention = [
    counts.pendingApprovals ? `${counts.pendingApprovals} approval${counts.pendingApprovals === 1 ? "" : "s"} waiting` : null,
    counts.openDecisions ? `${counts.openDecisions} open decision${counts.openDecisions === 1 ? "" : "s"}` : null,
    counts.failedWorkflows ? `${counts.failedWorkflows} failed workflow${counts.failedWorkflows === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  const digest = attention.length
    ? ` Right now: ${attention.join(", ")}.`
    : " Everything looks steady right now.";
  return {
    answer: `${g}${digest} Ask me about the business, or try “What's going on?”`,
    spoken: `${g}${digest}`,
  };
}

async function handleConfirmation(
  conv: Conv,
  identity: { userId: Id<"users">; tenantId: Id<"tenants">; role: string; tenantIdStr: string },
  intent: "confirmation" | "cancellation",
  pending: PendingState,
): Promise<RouteResult> {
  const proceed = intent === "confirmation";

  if (!pending || pending.kind === "none") {
    const answer = proceed
      ? "There's nothing waiting for confirmation right now. I'll only act when you ask me to."
      : "Nothing to cancel — there are no pending actions in this conversation.";
    return {
      answer,
      spoken: answer,
      suggestedActions: [],
      authorityAnswers: [],
      evidence: [],
      toolPlan: null,
      entityRefs: [],
      pending: EMPTY_PENDING,
    };
  }

  if (pending.kind === "confirm_action") {
    if (pending.actionId) {
      if (proceed) {
        const res = (await conv.ra(api.tools.execute.confirmToolAction, {
          actionId: pending.actionId,
        })) as { outcome: string; reason?: string; explanation?: string; result?: unknown; status?: string; verificationStatus?: string };
        return actionResultResponse(res, "confirmed");
      }
      const res = (await conv.ra(api.tools.execute.cancelToolAction, {
        actionId: pending.actionId,
      })) as { outcome: string; reason?: string };
      return actionResultResponse(res, "cancelled");
    }
    if (pending.plan?.toolId) {
      if (proceed) {
        const res = (await conv.ra(api.tools.execute.executeTool, {
          toolId: pending.plan.toolId,
          input: (pending.plan.arguments ?? {}) as Record<string, unknown>,
          context: {},
        })) as {
          outcome: string;
          reason?: string;
          actionId?: string;
          riskLevel?: string;
          confirmation?: { message?: string };
          explanation?: string;
          result?: unknown;
          status?: string;
          verificationStatus?: string;
        };
        if (res.outcome === "awaiting_confirmation") {
          return {
            answer: `The action is ready but ${res.confirmation?.message ?? "requires confirmation"}. Confirm it from Actions, or say “confirm”.`,
            spoken: `This action requires confirmation before it runs.`,
            suggestedActions: [],
            authorityAnswers: [],
            evidence: [],
            toolPlan: null,
            entityRefs: [],
            pending: {
              kind: "confirm_action",
              actionId: res.actionId,
              title: pending.plan.toolName ?? "Action",
              message: res.confirmation?.message,
            },
          };
        }
        return actionResultResponse(res, "executed");
      }
      return {
        answer: `Understood — I won't run ${pending.plan.toolName ?? "that action"}.`,
        spoken: `Understood. I won't run that action.`,
        suggestedActions: [],
        authorityAnswers: [],
        evidence: [],
        toolPlan: null,
        entityRefs: [],
        pending: EMPTY_PENDING,
      };
    }
  }

  if (pending.kind === "confirm_action" && pending.actionType === "claim_submit_supplement" && pending.claim?.supplementId) {
    const claimId = pending.claim.claimId;
    if (proceed) {
      try {
        await conv.rm(api.insurance.claims.updateSupplementStatus, {
          supplementId: pending.claim.supplementId as Id<"claimSupplements">,
          status: "ready_for_submission",
        });
        await conv.rm(internal.internal.logAudit, {
          tenantId: identity.tenantId,
          actorType: "user",
          actorId: identity.userId,
          actionType: "supplement_marked_ready_for_submission",
          targetType: "claimSupplement",
          targetId: String(pending.claim.supplementId),
          metadata: { claimId, confirmedVia: "conversation" },
        });
        const answer = `Done. The supplement for ${pending.claim.label ?? "this claim"} is now marked ready for submission and appears in Revenue Recovery. No connector is connected to the carrier yet, so nothing was transmitted — the workspace must submit it through the connected process.`;
        return {
          answer,
          spoken: spokenFor(answer) || "The supplement is ready for submission.",
          suggestedActions: ["Open Revenue Recovery"],
          authorityAnswers: [],
          evidence: [],
          toolPlan: null,
          entityRefs: claimId ? [{ id: claimId, name: pending.claim.label ?? "Claim", entityTypeKey: "claim" }] : [],
          pending: EMPTY_PENDING,
        };
      } catch (e) {
        const answer = `I couldn't mark the supplement as ready: ${e instanceof Error ? e.message : "unknown error"}`;
        return {
          answer,
          spoken: "I couldn't mark the supplement as ready.",
          suggestedActions: [],
          authorityAnswers: [],
          evidence: [],
          toolPlan: null,
          entityRefs: [],
          pending: EMPTY_PENDING,
        };
      }
    }
    const answer = `Understood — the supplement stays a draft for review.`;
    return {
      answer,
      spoken: answer,
      suggestedActions: [],
      authorityAnswers: [],
      evidence: [],
      toolPlan: null,
      entityRefs: [],
      pending: EMPTY_PENDING,
    };
  }

  if (pending.kind === "confirm_workflow" && pending.workflow) {
    if (proceed) {
      return await startWorkflowConfirmed(conv, identity, pending.workflow);
    }
    return {
      answer: `Understood — I won't start the ${pending.workflow.name} workflow.`,
      spoken: `Understood. I won't start that workflow.`,
      suggestedActions: [],
      authorityAnswers: [],
      evidence: [],
      toolPlan: null,
      entityRefs: [],
      pending: EMPTY_PENDING,
    };
  }

  if (pending.kind === "approval") {
    const answer =
      "That action is already submitted for manager approval — I can't override the approval process. You'll be notified when it's decided.";
    return {
      answer,
      spoken: answer,
      suggestedActions: [],
      authorityAnswers: [],
      evidence: [],
      toolPlan: null,
      entityRefs: [],
      pending: EMPTY_PENDING,
    };
  }

  if (pending.kind.startsWith("clarify")) {
    const answer = proceed
      ? "No problem — I'll wait for your answer."
      : "Understood — I'll drop that for now.";
    return {
      answer,
      spoken: answer,
      suggestedActions: [],
      authorityAnswers: [],
      evidence: [],
      toolPlan: null,
      entityRefs: [],
      pending: EMPTY_PENDING,
    };
  }

  const answer = "I don't have anything pending that needs confirmation.";
  return {
    answer,
    spoken: answer,
    suggestedActions: [],
    authorityAnswers: [],
    evidence: [],
    toolPlan: null,
    entityRefs: [],
    pending: EMPTY_PENDING,
  };
}

function actionResultResponse(
  res: { outcome: string; reason?: string; explanation?: string; result?: unknown; status?: string; verificationStatus?: string },
  verb: string,
): RouteResult {
  const outcome = res.outcome;
  if (outcome === "completed") {
    const verification = res.verificationStatus
      ? ` Verification: ${String(res.verificationStatus).replace(/_/g, " ")}.`
      : "";
    const answer = `${verb === "confirmed" ? "Confirmed and" : "Action"} completed successfully.${res.explanation ? ` ${res.explanation}` : ""}${verification}`;
    return {
      answer,
      spoken: "Done. The action completed successfully.",
      suggestedActions: [],
      authorityAnswers: [],
      evidence: [],
      toolPlan: null,
      entityRefs: [],
      pending: EMPTY_PENDING,
    };
  }
  if (outcome === "awaiting_confirmation") {
    return {
      answer: "The action was prepared but still requires confirmation before it can run.",
      spoken: "The action is ready, but needs confirmation before it runs.",
      suggestedActions: [],
      authorityAnswers: [],
      evidence: [],
      toolPlan: null,
      entityRefs: [],
      pending: EMPTY_PENDING,
    };
  }
  const reason = res.reason ?? res.explanation ?? "The action could not be completed.";
  const safeReason = String(reason).slice(0, 300);
  const answer = `${verb === "cancelled" ? "Action cancelled." : "The action could not be completed."} ${safeReason}`;
  return {
    answer,
    spoken: verb === "cancelled" ? "Action cancelled." : "The action could not be completed.",
    suggestedActions: [],
    authorityAnswers: [],
    evidence: [],
    toolPlan: null,
    entityRefs: [],
    pending: EMPTY_PENDING,
  };
}

async function handleSelection(
  conv: Conv,
  q: string,
  pending: PendingState,
  entityContext: EntityRef | null,
): Promise<RouteResult> {
  if (!pending?.options || pending.options.length === 0) {
    const answer = "I'm not sure which one you mean — could you rephrase?";
    return {
      answer,
      spoken: answer,
      suggestedActions: [],
      authorityAnswers: [],
      evidence: [],
      toolPlan: null,
      entityRefs: [],
      pending: EMPTY_PENDING,
    };
  }
  const labels = pending.options.map((o) => o.label);
  const idx = resolveSelection(q, labels);
  if (idx < 0) {
    const optionsText = labels.map((l, i) => `${i + 1}. ${l}`).join(" ");
    const answer = `I couldn't tell which one you meant. Options: ${optionsText}`;
    return {
      answer,
      spoken: "I couldn't tell which one. Say the number or name.",
      suggestedActions: [],
      authorityAnswers: [],
      evidence: [],
      toolPlan: null,
      entityRefs: [],
      pending: { ...pending, message: answer },
    };
  }
  const selected = pending.options[idx];
  if (pending.kind === "clarify_entity" && pending.claim?.resolve === true) {
    // Resolving a claim pick — open the selected claim directly.
    return await handleClaims(conv, `open ${selected.label}`, { claimContext: null });
  }
  if (pending.kind === "clarify_entity") {
    const entity = {
      id: selected.id ?? "",
      name: selected.label,
    } as EntityRef;
    const question = pending.question ?? q;
    const result = await runInvestigationFor(conv, question, entity);
    return { ...result, pending: EMPTY_PENDING };
  }
  if (pending.kind === "clarify_general") {
    const result = await handleAsk(conv, selected.label, entityContext, undefined, false);
    return { ...result, pending: EMPTY_PENDING };
  }
  const answer = `Got it — ${selected.label}.`;
  return {
    answer,
    spoken: answer,
    suggestedActions: [],
    authorityAnswers: [],
    evidence: [],
    toolPlan: null,
    entityRefs: [],
    pending: EMPTY_PENDING,
  };
}

// ---------------------------------------------------------------------------
// Phase 11 — Insurance restoration claims (first vertical)
//
// Discovery → Draft → Human review → Approval → Submission. Voice never
// bypasses risk/confirmation: submitting a supplement always requires
// confirmation, and no connector means no transmission is ever claimed.
// ---------------------------------------------------------------------------

interface ClaimSummaryRow {
  _id: string;
  claimNumber?: string | null;
  customer?: string | null;
  property?: string | null;
  status?: string | null;
  completeness?: {
    complete?: number;
    total?: number;
    summary?: string;
    categories?: Array<{ key: string; label: string; status: string; note: string }>;
  };
  reconciliation?: {
    requested?: number;
    approved?: number;
    denied?: number;
    paid?: number;
    outstanding?: number;
    hasDiscrepancy?: boolean;
    notes?: string[];
  };
  openFindings?: Array<{
    category?: string;
    title?: string;
    confidence?: number;
    estimatedAmount?: number;
    recommendedNextStep?: string;
    limitation?: string;
  }>;
}

async function claimsList(conv: Conv): Promise<ClaimSummaryRow[]> {
  return ((await conv.rq(api.insurance.claims.analyzeAllClaims, {})) ?? []) as ClaimSummaryRow[];
}

function claimLabel(c: ClaimSummaryRow): string {
  return c.customer || c.property || c.claimNumber || "Claim";
}

function matchesClaim(c: ClaimSummaryRow, q: string): boolean {
  const low = q.toLowerCase();
  const hay = [c.customer, c.property, c.claimNumber].filter(Boolean).join(" ").toLowerCase();
  if (!hay) return false;
  const tokens = low
    .replace(/\b(open|show|view|the|claim|for|about|regarding|on|at|tell|me|what|is|of)\b/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  return tokens.length > 0 && tokens.every((t) => hay.includes(t));
}

async function resolveClaim(
  conv: Conv,
  q: string,
  context: ContextShape,
): Promise<{ row: ClaimSummaryRow | null; options?: Array<{ id?: string; label: string }> }> {
  if (context.claimContext?.claimId) {
    const all = await claimsList(conv);
    const found = all.find((c) => String(c._id) === context.claimContext?.claimId);
    if (found) return { row: found };
  }
  const all = await claimsList(conv);
  if (all.length === 0) return { row: null };
  const matches = all.filter((c) => matchesClaim(c, q));
  if (matches.length === 1) return { row: matches[0] };
  if (matches.length > 1) {
    return {
      row: null,
      options: matches.map((c) => ({ id: String(c._id), label: claimLabel(c) })),
    };
  }
  return { row: null };
}

function parseDateOfLoss(q: string): number | undefined {
  const m = q.match(/\b(date of loss|dol)\b[^a-z0-9]{1,3}(.+)/i);
  if (!m) return undefined;
  const raw = m[2].trim().replace(/[.,]$/, "");
  const t = Date.parse(raw);
  if (!Number.isNaN(t)) return t;
  const parts = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (parts) {
    const [, mo, da, yr] = parts;
    const year = yr.length === 2 ? `20${yr}` : yr;
    return new Date(`${year}-${mo.padStart(2, "0")}-${da.padStart(2, "0")}`).getTime();
  }
  return undefined;
}

function moneyMatch(q: string, re: RegExp): number | undefined {
  const m = q.match(re);
  if (!m) return undefined;
  const n = Number(String(m[1]).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

async function handleClaims(
  conv: Conv,
  q: string,
  context: ContextShape,
  identity?: { userId: Id<"users">; tenantId: Id<"tenants">; role: string; tenantIdStr: string },
): Promise<RouteResult> {
  const low = q.toLowerCase();

  // 1) Flagship: “What am I leaving on the table?”
  if (/leaving on the table|revenue recovery|what am i leaving|money (left )?on the table/.test(low)) {
    const all = await claimsList(conv);
    if (all.length === 0) {
      const answer =
        "There are no claims in Atlas yet, so there's nothing to analyze. Say \u201ccreate a claim for the Johnson property\u201d to start one, or upload an estimate and I'll attach it.";
      return { answer, spoken: answer, suggestedActions: ["Open Revenue Recovery"], authorityAnswers: [], evidence: [], toolPlan: null, entityRefs: [], pending: EMPTY_PENDING };
    }
    const potentialTotal = all.reduce(
      (s, c) => s + (c.openFindings ?? []).reduce((a, f) => a + (f.estimatedAmount ?? 0), 0),
      0,
    );
    const outstandingTotal = all.reduce((s, c) => s + (c.reconciliation?.outstanding ?? 0), 0);
    const attention = all.filter(
      (c) => (c.openFindings?.length ?? 0) > 0 || c.reconciliation?.hasDiscrepancy,
    );
    const lines: string[] = [`I analyzed ${all.length} claim${all.length === 1 ? "" : "s"}.`];
    if (potentialTotal > 0) {
      lines.push(`Potential recovery identified across open findings: $${potentialTotal.toLocaleString()} \u2014 potential, not guaranteed.`);
    }
    if (outstandingTotal > 0) {
      lines.push(`Potentially outstanding after payments: $${outstandingTotal.toLocaleString()}.`);
    }
    if (attention.length === 0) lines.push("No open findings or reconciliation gaps right now.");
    for (const c of attention.slice(0, 3)) {
      const findings = (c.openFindings ?? []).slice(0, 2).map((f) => f.title).join("; ");
      const rec = c.reconciliation;
      const recNote =
        rec && rec.outstanding && rec.outstanding > 0
          ? ` $${rec.outstanding.toLocaleString()} potentially outstanding.`
          : rec?.hasDiscrepancy
            ? " Reconciliation needs review."
            : "";
      lines.push(`\u2022 ${claimLabel(c)}: ${findings || "needs attention"}${recNote}`);
    }
    lines.push("Every finding is labeled as potential and carries its own evidence and limitation \u2014 review before acting.");
    const answer = lines.join("\n");
    return {
      answer,
      spoken: spokenFor(answer) || "Here's what may be left on the table.",
      suggestedActions: ["Open Revenue Recovery", "Prepare a supplement"],
      authorityAnswers: [],
      evidence: attention.slice(0, 3).flatMap((c) =>
        (c.openFindings ?? []).map((f) => ({
          kind: "claim_finding",
          title: f.title ?? "Finding",
          snippet: `Confidence ${Math.round((f.confidence ?? 0) * 100)}%. ${f.limitation ?? ""}`,
        })),
      ),
      toolPlan: null,
      entityRefs: attention.slice(0, 5).map((c) => ({
        id: c._id,
        name: claimLabel(c),
        entityTypeKey: "claim",
        status: c.status ?? undefined,
      })),
      pending: EMPTY_PENDING,
    };
  }

  // 2) Create a claim (never fabricates fields; asks for the rest).
  if (/(create|add|new)\s+(a |an |the |new )?claim/i.test(low)) {
    const rest = low.replace(/(create|add|new)\s+(a |an |the |new )?claim/i, "").trim();
    let property: string | undefined;
    let customer: string | undefined;
    const propMatch = rest.match(/(.+?)\s+property/i);
    if (propMatch) property = propMatch[1].trim();
    const custMatch = q.match(/\bcustomer( is | named )?([A-Za-z][A-Za-z .'-]{1,60})/i);
    if (custMatch) customer = custMatch[2].trim();
    if (!property && !customer && rest) customer = rest.replace(/^for\s+/, "").trim();
    if (!property && !customer) {
      const answer =
        "I can create a claim \u2014 tell me the customer or property, e.g. \u201ccreate a claim for the Johnson property\u201d.";
      return {
        answer,
        spoken: answer,
        suggestedActions: [],
        authorityAnswers: [],
        evidence: [],
        toolPlan: null,
        entityRefs: [],
        pending: { kind: "clarify_general", message: answer, question: q },
      };
    }
    const dateOfLoss = parseDateOfLoss(q);
    const causeMatch = q.match(/\bcause of loss[^a-z0-9]{1,3}(.+)/i);
    const causeOfLoss = causeMatch ? causeMatch[1].trim() : undefined;
    const numMatch =
      q.match(/\bclaim (number|#)\s*[:#]?\s*([A-Za-z0-9-]+)/i) ??
      q.match(/\b#\s*([A-Za-z0-9-]{4,})/i);
    const claimNumber = numMatch ? (numMatch[2] ?? numMatch[1]) : undefined;
    if (!identity) {
      return notSignedInClaimResult();
    }
    const res = (await conv.rm(api.insurance.claims.createClaim, {
      customer,
      property,
      claimNumber,
      causeOfLoss,
      dateOfLoss,
      provenance: "Created from conversation request.",
    })) as { claimId: Id<"insuranceClaims">; completeness: { summary: string } };
    const missing: string[] = [];
    if (typeof dateOfLoss !== "number") missing.push("date of loss");
    if (!claimNumber) missing.push("claim number");
    const answer = [
      `Created claim for ${property ?? customer}.`,
      missing.length ? `Still missing: ${missing.join(", ")}.` : "The package has the core information.",
      "You can add details by saying e.g. \u201cdate of loss is March 4th\u201d or \u201cestimate is $12,400\u201d.",
    ].join(" ");
    return {
      answer,
      spoken: `Created the claim. ${missing.length ? `Still missing ${missing.join(" and ")}.` : "Core information is on file."}`,
      suggestedActions: ["Open Revenue Recovery"],
      authorityAnswers: [],
      evidence: [],
      toolPlan: null,
      entityRefs: [
        {
          id: String(res.claimId),
          name: claimLabel({ _id: String(res.claimId), customer, property, claimNumber }),
          entityTypeKey: "claim",
        },
      ],
      pending: EMPTY_PENDING,
      claimContext: { claimId: String(res.claimId) },
    };
  }

  // 3) Record new claim facts (“date of loss is March 4th”, “estimate is $12k”).
  const updateIntent =
    /date of loss|cause of loss|claim number|estimate (is|of|:)|adjuster|carrier (is|:)|payment/.test(low);
  if (updateIntent) {
    const resolved = await resolveClaim(conv, q, context);
    if (!resolved.row) {
      const answer = "Which claim? Say \u201copen the Johnson claim\u201d first, or name the claim in your sentence.";
      return {
        answer,
        spoken: answer,
        suggestedActions: [],
        authorityAnswers: [],
        evidence: [],
        toolPlan: null,
        entityRefs: [],
        pending: resolved.options
          ? { kind: "clarify_entity", options: resolved.options, question: q }
          : { kind: "clarify_general", message: answer },
      };
    }
    const patch: Record<string, unknown> = {};
    const dateOfLoss = parseDateOfLoss(q);
    if (typeof dateOfLoss === "number") patch.dateOfLoss = dateOfLoss;
    const causeMatch = q.match(/\bcause of loss[^a-z0-9]{1,3}(.+)/i);
    if (causeMatch) patch.causeOfLoss = causeMatch[1].trim();
    const numMatch = q.match(/\bclaim (number|#)\s*[:#]?\s*([A-Za-z0-9-]+)/i);
    if (numMatch) patch.claimNumber = numMatch[2] ?? numMatch[1];
    const est = moneyMatch(q, /estimate\s*(?:is|of)?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i);
    if (typeof est === "number") patch.estimateAmount = est;
    const carrier = q.match(/\bcarrier\s*(?:is)?\s*([A-Za-z][A-Za-z .'-]{1,60})/i);
    if (carrier && !/carrier response/.test(low)) patch.carrier = carrier[1].trim();
    const adjuster = q.match(/\badjuster\s*(?:is)?\s*([A-Za-z][A-Za-z .'-]{1,60})/i);
    if (adjuster) patch.adjuster = adjuster[1].trim();
    if (Object.keys(patch).length === 0) {
      const answer =
        "I didn't find a fact to record in that. Try \u201cdate of loss is March 4th\u201d or \u201cestimate is $12,400\u201d.";
      return {
        answer,
        spoken: answer,
        suggestedActions: [],
        authorityAnswers: [],
        evidence: [],
        toolPlan: null,
        entityRefs: [],
        pending: EMPTY_PENDING,
      };
    }
    if (!identity) return notSignedInClaimResult();
    const res = (await conv.rm(api.insurance.claims.updateClaim, {
      claimId: resolved.row._id as Id<"insuranceClaims">,
      patch,
      provenance: "Recorded from conversation request.",
    })) as { completeness: { summary: string } };
    const answer = `Updated ${claimLabel(resolved.row)}. ${res.completeness.summary}`;
    return {
      answer,
      spoken: spokenFor(answer) || "Claim updated.",
      suggestedActions: ["Run analysis", "Open Revenue Recovery"],
      authorityAnswers: [],
      evidence: [],
      toolPlan: null,
      entityRefs: [
        {
          id: String(resolved.row._id),
          name: claimLabel(resolved.row),
          entityTypeKey: "claim",
          status: resolved.row.status ?? undefined,
        },
      ],
      pending: EMPTY_PENDING,
      claimContext: { claimId: String(resolved.row._id) },
    };
  }

  // 4) Prepare a supplement DRAFT (discovery → draft → human review).
  if (/(prepare|draft|write|create)\s+(a |the |an )?supplement/.test(low)) {
    const resolved = await resolveClaim(conv, q, context);
    if (!resolved.row) {
      const answer = "Which claim should the supplement be for? Say \u201copen the Johnson claim\u201d or name the claim.";
      return {
        answer,
        spoken: answer,
        suggestedActions: [],
        authorityAnswers: [],
        evidence: [],
        toolPlan: null,
        entityRefs: [],
        pending: resolved.options
          ? { kind: "clarify_entity", options: resolved.options, question: q, claim: { resolve: true } }
          : EMPTY_PENDING,
      };
    }
    const claimId = String(resolved.row._id);
    if (!identity) return notSignedInClaimResult();
    await conv.rm(api.insurance.claims.runClaimAnalysis, { claimId: claimId as Id<"insuranceClaims"> });
    const pkg = (await conv.rq(api.insurance.claims.getClaimPackage, {
      claimId: claimId as Id<"insuranceClaims">,
    })) as {
      claim: { customer?: string; property?: string; claimNumber?: string };
      findings: Array<{
        category: string;
        title: string;
        evidence?: string[];
        estimatedAmount?: number;
        recommendedNextStep: string;
        limitation: string;
      }>;
    };
    const usable = (pkg.findings ?? [])
      .filter((f) => f.category !== "documentation_gap" && f.category !== "workflow_delay")
      .slice(0, 5);
    if (usable.length === 0) {
      const answer = `I ran the analysis on ${claimLabel(resolved.row)} and found no clear supplement items right now. Review the claim package to confirm.`;
      return {
        answer,
        spoken: answer,
        suggestedActions: ["Open Revenue Recovery"],
        authorityAnswers: [],
        evidence: [],
        toolPlan: null,
        entityRefs: [{ id: claimId, name: claimLabel(resolved.row), entityTypeKey: "claim" }],
        pending: EMPTY_PENDING,
        claimContext: { claimId },
      };
    }
    const amount = usable.reduce((s, f) => s + (f.estimatedAmount ?? 0), 0) || undefined;
    const requestedItems = usable.map((f) => f.title);
    const evidence = usable.flatMap((f) => f.evidence ?? []);
    const res = (await conv.rm(api.insurance.claims.createSupplement, {
      claimId: claimId as Id<"insuranceClaims">,
      reason: "Recovering documented scope not fully represented in the current estimate.",
      amount,
      requestedItems,
      affectedLineItems: requestedItems,
      evidence,
      justification: "Draft assembled from verified evidence by Atlas \u2014 requires human review.",
    })) as { supplementId: Id<"claimSupplements"> };
    const answer = [
      `Drafted a supplement for ${claimLabel(resolved.row)} with ${usable.length} item${usable.length === 1 ? "" : "s"}${amount ? ` and a potential amount of $${amount.toLocaleString()}` : ""}.`,
      "It is a DRAFT \u2014 it requires human review and approval before any submission.",
      usable.slice(0, 3).map((f, i) => `${i + 1}. ${f.title} \u2014 ${f.recommendedNextStep}`).join(" "),
    ].join("\n");
    return {
      answer,
      spoken: spokenFor(`Drafted a supplement with ${usable.length} items for human review.`),
      suggestedActions: ["Submit supplement", "Open Revenue Recovery"],
      authorityAnswers: [],
      evidence: evidence.slice(0, 4).map((e) => ({
        kind: "supplement_evidence",
        title: "Supporting evidence",
        snippet: e,
      })),
      toolPlan: null,
      entityRefs: [{ id: claimId, name: claimLabel(resolved.row), entityTypeKey: "claim" }],
      pending: EMPTY_PENDING,
      claimContext: { claimId, supplementId: String(res.supplementId) },
    };
  }

  // 5) Submit — always through confirmation, never silently.
  if (/(submit|send|file)\s+(it|the|this|a)?\s*(supplement|draft)?|send it|do it now/.test(low)) {
    const resolved = await resolveClaim(conv, q, context);
    const supplementId = context.claimContext?.supplementId;
    if (!resolved.row || !supplementId) {
      const answer =
        "There's no draft supplement in this conversation to submit. Say \u201cprepare the supplement\u201d for the claim first.";
      return {
        answer,
        spoken: answer,
        suggestedActions: [],
        authorityAnswers: [],
        evidence: [],
        toolPlan: null,
        entityRefs: [],
        pending: EMPTY_PENDING,
      };
    }
    const pkg = (await conv.rq(api.insurance.claims.getClaimPackage, {
      claimId: String(resolved.row._id) as Id<"insuranceClaims">,
    })) as {
      supplements: Array<{ _id: string; reason?: string; amount?: number; status?: string }>;
    };
    const draft = pkg.supplements.find((s) => String(s._id) === supplementId);
    const amount = draft?.amount;
    const message = `This will mark the supplement for ${claimLabel(resolved.row)} as ready for submission${amount ? ` with a potential requested amount of $${amount.toLocaleString()}` : ""}. No carrier or email connector is connected yet, so Atlas will NOT transmit anything to the carrier \u2014 it records the submission as ready and raises it in Revenue Recovery for follow-up. Proceed?`;
    return {
      answer: message,
      spoken: spokenFor(message) || "This supplement requires confirmation before it can be marked ready for submission.",
      suggestedActions: [],
      authorityAnswers: [],
      evidence: [],
      toolPlan: null,
      entityRefs: [
        {
          id: String(resolved.row._id),
          name: claimLabel(resolved.row),
          entityTypeKey: "claim",
        },
      ],
      pending: {
        kind: "confirm_action",
        actionType: "claim_submit_supplement",
        claim: {
          claimId: String(resolved.row._id),
          supplementId,
          label: claimLabel(resolved.row),
        },
        title: "Submit supplement",
        message,
      },
      claimContext: { claimId: String(resolved.row._id), supplementId },
    };
  }

  // 6) Open / show a specific claim.
  if (/(open|show|view|tell me about|what about|go to)\b/.test(low) && /\bclaim\b/.test(low)) {
    const resolved = await resolveClaim(conv, q, context);
    if (resolved.options && resolved.options.length > 0) {
      const answer = `I found ${resolved.options.length} claims. Which one do you mean? ${resolved.options
        .map((o, i) => `${i + 1}. ${o.label}`)
        .join(" ")}`;
      return {
        answer,
        spoken: "Which claim? Say the number or name.",
        suggestedActions: [],
        authorityAnswers: [],
        evidence: [],
        toolPlan: null,
        entityRefs: [],
        pending: { kind: "clarify_entity", options: resolved.options, question: q, claim: { resolve: true } },
        claimContext: undefined,
      };
    }
    if (!resolved.row) {
      const all = await claimsList(conv);
      const answer =
        all.length === 0
          ? "There are no claims yet. Say \u201ccreate a claim for the Johnson property\u201d to start."
          : `I don't have that claim. Current claims: ${all.map(claimLabel).join(", ")}.`;
      return {
        answer,
        spoken: spokenFor(answer),
        suggestedActions: ["Open Revenue Recovery"],
        authorityAnswers: [],
        evidence: [],
        toolPlan: null,
        entityRefs: [],
        pending: EMPTY_PENDING,
      };
    }
    const pkg = (await conv.rq(api.insurance.claims.getClaimPackage, {
      claimId: String(resolved.row._id) as Id<"insuranceClaims">,
    })) as {
      claim: { status?: string; estimateAmount?: number; paymentAmount?: number };
      completeness: { summary: string; categories: Array<{ label: string; status: string }> };
      findings: Array<{ status?: string }>;
      supplements: unknown[];
      reconciliation: { outstanding?: number; hasDiscrepancy?: boolean; notes?: string[] };
    };
    const open = Array.isArray(pkg.findings)
      ? pkg.findings.filter((f) => f.status === "open").length
      : 0;
    const answer = [
      `${claimLabel(resolved.row)} \u2014 status ${STATUS_LABELS[pkg.claim.status ?? ""] ?? pkg.claim.status ?? "opened"}.`,
      pkg.completeness.summary,
      open > 0 ? `${open} open finding${open === 1 ? "" : "s"} (potential opportunities).` : "No open findings.",
      pkg.reconciliation?.outstanding && pkg.reconciliation.outstanding > 0
        ? `$${pkg.reconciliation.outstanding.toLocaleString()} potentially outstanding after payments.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    return {
      answer,
      spoken: spokenFor(answer) || `${claimLabel(resolved.row)} opened.`,
      suggestedActions: ["Prepare supplement", "Run analysis", "Open Revenue Recovery"],
      authorityAnswers: [],
      evidence: [],
      toolPlan: null,
      entityRefs: [
        {
          id: String(resolved.row._id),
          name: claimLabel(resolved.row),
          entityTypeKey: "claim",
          status: resolved.row.status ?? undefined,
        },
      ],
      pending: EMPTY_PENDING,
      claimContext: { claimId: String(resolved.row._id) },
    };
  }

  // 7) Default — claims needing attention / current claims.
  const all = await claimsList(conv);
  if (all.length === 0) {
    const answer =
      "There are no claims in Atlas yet. Say \u201ccreate a claim for the Johnson property\u201d to start one.";
    return {
      answer,
      spoken: answer,
      suggestedActions: ["Open Revenue Recovery"],
      authorityAnswers: [],
      evidence: [],
      toolPlan: null,
      entityRefs: [],
      pending: EMPTY_PENDING,
    };
  }
  const needs = all.filter(
    (c) =>
      (c.openFindings?.length ?? 0) > 0 ||
      c.reconciliation?.hasDiscrepancy ||
      (c.completeness?.complete ?? 0) < (c.completeness?.total ?? 9),
  );
  const shown = needs.length > 0 ? needs : all;
  const lines = shown.slice(0, 5).map((c) => {
    const bits: string[] = [claimLabel(c)];
    if ((c.openFindings?.length ?? 0) > 0) {
      bits.push(`${c.openFindings!.length} potential finding${c.openFindings!.length === 1 ? "" : "s"}`);
    }
    if (c.reconciliation?.outstanding && c.reconciliation.outstanding > 0) {
      bits.push(`$${c.reconciliation.outstanding.toLocaleString()} outstanding`);
    }
    if (c.completeness && c.completeness.total && (c.completeness.complete ?? 0) < c.completeness.total) {
      bits.push(`${c.completeness.complete}/${c.completeness.total} info complete`);
    }
    return `\u2022 ${bits.join(" \u00b7 ")}`;
  });
  const answer = [
    needs.length > 0
      ? `I found ${needs.length} claim${needs.length === 1 ? "" : "s"} needing attention:`
      : `Here are your ${all.length} claim${all.length === 1 ? "" : "s"}:`,
    ...lines,
  ].join("\n");
  return {
    answer,
    spoken: spokenFor(answer),
    suggestedActions: ["What am I leaving on the table?", "Open Revenue Recovery"],
    authorityAnswers: [],
    evidence: [],
    toolPlan: null,
    entityRefs: shown.slice(0, 5).map((c) => ({
      id: c._id,
      name: claimLabel(c),
      entityTypeKey: "claim",
      status: c.status ?? undefined,
    })),
    pending: EMPTY_PENDING,
  };
}

function notSignedInClaimResult(): RouteResult {
  const answer = "You need workspace access to create or update claims.";
  return {
    answer,
    spoken: answer,
    suggestedActions: [],
    authorityAnswers: [],
    evidence: [],
    toolPlan: null,
    entityRefs: [],
    pending: EMPTY_PENDING,
  };
}

async function handleOrganizational(conv: Conv, temporal?: TemporalInfo): Promise<RouteResult> {
  const state = (await conv.rq(api.everest.api.getOrganizationalState, {})) as {
    summary?: string;
    counts?: Record<string, number>;
  };
  const windowLabel = temporal?.label ? ` for ${temporal.label}` : "";
  const summary = state.summary ?? "Here's the current state of the business.";
  const answer = `${summary}${windowLabel}`;
  const spoken = spokenFor(summary) || "Here's the current state of the business.";
  const counts = state.counts ?? {};
  const evidence = Object.entries(counts)
    .filter(([, v]) => typeof v === "number" && v > 0)
    .map(([k, v]) => ({
      kind: "intelligence",
      title: k.replace(/([A-Z])/g, " $1").trim(),
      snippet: `${v}`,
      relevance: 0.8,
    }));
  return {
    answer,
    spoken,
    suggestedActions: [],
    authorityAnswers: [],
    evidence,
    toolPlan: null,
    entityRefs: [],
    pending: EMPTY_PENDING,
  };
}

async function runInvestigationFor(
  conv: Conv,
  question: string,
  entity: EntityRef | null,
): Promise<RouteResult> {
  const inv = (await conv.ra(api.everest.api.runInvestigation, {
    question,
  })) as {
    answer?: string;
    summary?: string;
    explanation?: string;
    evidence?: Array<Record<string, unknown>>;
    blockers?: Array<{ text?: string; severity?: string }>;
    availableActions?: string[];
    requiredApprovals?: unknown[];
    recommendedNextStep?: string;
  };
  const explanation = inv.explanation ?? inv.summary ?? inv.answer ?? "";
  const blockers =
    (inv.blockers ?? [])
      .filter((b) => b.text)
      .slice(0, 3)
      .map((b) => `• ${b.text}`);
  const nextStep = inv.recommendedNextStep ? ` Next step: ${inv.recommendedNextStep}.` : "";
  const approvals = (inv.requiredApprovals ?? []).length > 0;
  const answer = [
    entity ? `Regarding ${entity.name}:` : "",
    explanation,
    blockers.length ? `\nBlockers found:\n${blockers.join("\n")}` : "",
    nextStep,
    approvals ? " This may require manager approval before acting." : "",
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  return {
    answer,
    spoken: spokenFor(explanation) || "Here's what I found in the investigation.",
    suggestedActions: (inv.availableActions ?? []).slice(0, 4),
    authorityAnswers: [],
    evidence: inv.evidence ?? [],
    toolPlan: null,
    entityRefs: entity ? [entity] : [],
    pending: EMPTY_PENDING,
    intentKind: "investigative" as const,
  };
}

async function handleInvestigation(
  conv: Conv,
  q: string,
  entityContext: EntityRef | null,
): Promise<RouteResult> {
  if (entityContext) {
    return runInvestigationFor(conv, q, entityContext);
  }
  const matches = (await conv.rq(api.everest.api.resolveEntityMatch, {
    query: q,
    limit: 5,
  })) as Array<{ id: string; name: string; entityTypeKey?: string; status?: string; score?: number }>;
  const real = matches.filter((m) => m.name && m.name.length > 1).slice(0, 5);
  if (real.length === 1) {
    const entity: EntityRef = {
      id: real[0].id,
      name: real[0].name,
      entityTypeKey: real[0].entityTypeKey,
      status: real[0].status,
    };
    return runInvestigationFor(conv, q, entity);
  }
  if (real.length > 1) {
    const answer = `I found ${real.length} possible matches: ${real.map((m) => m.name).join(", ")}. Which one do you mean?`;
    return {
      answer,
      spoken: `I found ${real.length} possible matches. Which one do you mean?`,
      suggestedActions: [],
      authorityAnswers: [],
      evidence: [],
      toolPlan: null,
      entityRefs: real.slice(0, 3).map((m) => ({
        id: m.id,
        name: m.name,
        entityTypeKey: m.entityTypeKey,
        status: m.status,
      })),
      pending: {
        kind: "clarify_entity",
        question: q,
        options: real.map((m) => ({ id: m.id, label: m.name })),
      },
      intentKind: "investigative" as const,
    };
  }
  return runInvestigationFor(conv, q, null);
}

async function handleWorkflow(
  conv: Conv,
  q: string,
  entityContext: EntityRef | null,
): Promise<RouteResult> {
  const defs = (await conv.rq(api.workflows.api.listWorkflowDefinitions, {})) as Array<{
    definition: {
      id: string;
      name: string;
      description?: string;
      steps?: Array<{ id: string; title?: string; type?: string }>;
    };
    settings: { enabled: boolean } | null;
    active: number;
    completed: number;
  }>;
  const tokens = q.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
  let best: (typeof defs)[number] | null = null;
  let bestScore = 0;
  for (const d of defs) {
    const hay = `${d.definition.name} ${d.definition.description ?? ""} ${d.definition.id}`.toLowerCase();
    const score = tokens.filter((t) => hay.includes(t)).length;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }

  // Pull a matching entity name for the workflow subject.
  let entityName = entityContext?.name;
  if (!entityName) {
    const matches = (await conv.rq(api.everest.api.resolveEntityMatch, {
      query: q,
      limit: 3,
    })) as Array<{ id: string; name: string }>;
    entityName = matches.find((m) => q.toLowerCase().includes(m.name.toLowerCase()))?.name;
  }

  if (!best) {
    // No registered workflow matched — route to Ask rather than guessing.
    return handleAsk(conv, q, entityContext, undefined, false);
  }

  const enabled = best.settings?.enabled ?? false;
  if (!enabled) {
    const answer = `The ${best.definition.name} workflow exists in your workspace but isn't activated yet. Enable it from the Workflows page, then I can start it for you.`;
    return {
      answer,
      spoken: `The ${best.definition.name} workflow isn't activated yet. Enable it in Workflows, then I can start it.`,
      suggestedActions: [],
      authorityAnswers: [],
      evidence: [],
      toolPlan: null,
      entityRefs: [],
      pending: EMPTY_PENDING,
    };
  }

  const stepSummary = (best.definition.steps ?? [])
    .map((s) => s.title ?? s.type ?? s.id)
    .filter(Boolean)
    .slice(0, 4)
    .join(" → ");
  const subject = entityName ? ` for ${entityName}` : "";
  const message = `I can start the ${best.definition.name} workflow${subject}. It will run: ${stepSummary}. Should I proceed?`;
  return {
    answer: message,
    spoken: `I can start the ${best.definition.name} workflow${subject}. Should I proceed?`,
    suggestedActions: [],
    authorityAnswers: [],
    evidence: [],
    toolPlan: null,
    entityRefs: entityContext ? [entityContext] : [],
    pending: {
      kind: "confirm_workflow",
      message,
      workflow: {
        definitionId: best.definition.id,
        name: best.definition.name,
        entityName,
      },
    },
    intentKind: "workflow" as const,
  };
}

async function startWorkflowConfirmed(
  conv: Conv,
  identity: { userId: Id<"users">; tenantId: Id<"tenants">; role: string; tenantIdStr: string },
  workflow: { definitionId: string; name: string; entityName?: string },
): Promise<RouteResult> {
  const defs = (await conv.rq(api.workflows.api.listWorkflowDefinitions, {})) as Array<{
    definition: {
      id: string;
      name: string;
      version: string;
      steps?: Array<{ id: string; title?: string; type?: string }>;
    };
    settings: { enabled: boolean } | null;
  }>;
  const def = defs.find((d) => d.definition.id === workflow.definitionId)?.definition;
  if (!def) {
    const answer = `The ${workflow.name} workflow definition is no longer available.`;
    return {
      answer,
      spoken: answer,
      suggestedActions: [],
      authorityAnswers: [],
      evidence: [],
      toolPlan: null,
      entityRefs: [],
      pending: EMPTY_PENDING,
    };
  }
  const now = Date.now();
  const dedupeKey = `voice:${def.id}:${String(identity.userId)}:${now}`;
  const context = {
    trigger: { kind: "conversation", userId: String(identity.userId), requestedAt: now },
    entityName: workflow.entityName ?? null,
    approvalGranted: null,
  };
  const instanceId = await conv.rm(internal.internal.insertWorkflowInstance, {
    tenantId: identity.tenantId,
    definitionId: def.id,
    workflowVersion: def.version,
    status: "pending",
    currentStepId: def.steps?.[0]?.id ?? "",
    context,
    evidenceReferences: [
      { kind: "conversation", title: "Started by voice request", userId: String(identity.userId) },
    ],
    completedStepIds: [],
    retryCounts: {},
    actionCount: 0,
    dedupeKey,
    startedAt: now,
    updatedAt: now,
  });
  await conv.rm(internal.internal.logAudit, {
    tenantId: identity.tenantId,
    actorType: "user",
    actorId: identity.userId,
    actionType: "workflow_started_by_voice",
    targetType: "workflow_instance",
    targetId: String(instanceId),
    metadata: { workflowId: def.id, instanceId: String(instanceId), entityName: workflow.entityName },
  });
  conv.schedule(internal.workflows.engine.advanceWorkflow, { instanceId });
  const answer = `The ${def.name} workflow started successfully and is now running. I'll keep you posted as it progresses.`;
  return {
    answer,
    spoken: `The ${def.name} workflow started successfully.`,
    suggestedActions: [],
    authorityAnswers: [],
    evidence: [
      {
        kind: "workflow",
        title: def.name,
        snippet: "Instance started · status: pending → running",
        relevance: 1,
      },
    ],
    toolPlan: null,
    entityRefs: [],
    pending: EMPTY_PENDING,
    intentKind: "workflow" as const,
  };
}

async function handleAction(
  conv: Conv,
  q: string,
  entityContext: EntityRef | null,
): Promise<RouteResult> {
  // Reuse the existing Ask → Actions handoff: askAtlas produces a tool plan
  // through the Phase 4 planner. Never auto-execute.
  const res = await runAsk(conv, q);
  const rawPlan = res.toolPlan as Record<string, unknown> | null | undefined;
  const plan: PendingState["plan"] =
    rawPlan && typeof rawPlan.toolId === "string"
      ? {
          toolId: rawPlan.toolId,
          toolName: typeof rawPlan.toolName === "string" ? rawPlan.toolName : undefined,
          arguments:
            rawPlan.arguments && typeof rawPlan.arguments === "object"
              ? (rawPlan.arguments as Record<string, unknown>)
              : undefined,
          expectedOutcome:
            typeof rawPlan.expectedOutcome === "string" ? rawPlan.expectedOutcome : undefined,
          verificationPlan:
            typeof rawPlan.verificationPlan === "string" ? rawPlan.verificationPlan : undefined,
          confidence: typeof rawPlan.confidence === "number" ? rawPlan.confidence : undefined,
        }
      : null;
  if (plan?.toolId) {
    const answer = `I can ${plan.expectedOutcome ?? `run ${plan.toolName ?? plan.toolId}`}. This requires your confirmation before anything runs. Should I proceed?`;
    return {
      answer,
      spoken: "I can do that, but I need your confirmation first. Should I proceed?",
      suggestedActions: [],
      authorityAnswers: res.authorityAnswers ?? [],
      evidence: res.evidence ?? [],
      toolPlan: plan,
      entityRefs: entityContext ? [entityContext] : [],
      pending: {
        kind: "confirm_action",
        message: answer,
        title: plan.toolName ?? plan.toolId,
        plan,
      },
      intentKind: "action" as const,
    };
  }
  // No tool matched — answer informatively.
  return {
    answer: res.answer,
    spoken: spokenFor(res.answer),
    suggestedActions: res.suggestedActions ?? [],
    authorityAnswers: res.authorityAnswers ?? [],
    evidence: res.evidence ?? [],
    toolPlan: null,
    entityRefs: entityContext ? [entityContext] : [],
    pending: EMPTY_PENDING,
    intentKind: "action" as const,
  };
}

async function handleAsk(
  conv: Conv,
  q: string,
  entityContext: EntityRef | null,
  temporal: TemporalInfo | undefined,
  regulatory: boolean,
): Promise<RouteResult> {
  const res = await runAsk(conv, q);
  const authority = (res.authorityAnswers ?? []) as Array<Record<string, unknown>>;
  let answer = res.answer;
  if (temporal?.label) {
    answer = `Here's what I found ${temporal.label === "today" ? "today" : `for ${temporal.label}`}: ${answer}`;
  }
  if (regulatory && authority.length > 0 && !answer.includes("This is not legal advice.")) {
    answer = `${answer}\n\nThis is not legal advice.`;
  }
  return {
    answer,
    spoken: spokenFor(answer),
    classification: res.classification,
    mode: res.mode,
    limitations: res.limitations,
    suggestedActions: res.suggestedActions ?? [],
    questionType: res.questionType,
    questionTypeLabel: res.questionTypeLabel,
    authorityAnswers: authority,
    evidence: res.evidence ?? [],
    toolPlan: null,
    entityRefs: entityContext ? [entityContext] : [],
    pending: EMPTY_PENDING,
    intentKind: "informational" as const,
  };
}

async function runAsk(conv: Conv, question: string) {
  try {
    const res = await conv.ra(api.ask.askAtlas, { question });
    return res as {
      answer: string;
      classification?: "FACT" | "RULE" | "OBSERVATION" | "INFERENCE" | "RECOMMENDATION";
      mode?: "ai" | "local";
      limitations?: string;
      suggestedActions?: string[];
      questionType?: string;
      questionTypeLabel?: string;
      authorityAnswers?: Array<Record<string, unknown>>;
      evidence?: Array<Record<string, unknown>>;
      toolPlan?: Record<string, unknown> | null;
    };
  } catch {
    return {
      answer: "I couldn't complete that request right now. Please try again in a moment.",
      suggestedActions: [],
      authorityAnswers: [],
      evidence: [],
      toolPlan: null,
      limitations: "Atlas reasoning temporarily unavailable.",
    };
  }
}

async function memoryNoteFor(conv: Conv, tenantId: Id<"tenants">) {
  try {
    const memories = (await conv.rq(internal.internal.listMemoriesByTenant, {
      tenantId,
      status: "active",
    })) as Array<{ status?: string; origin?: string; memoryType?: string }>;
    return memoryConflictNote(memories);
  } catch {
    return undefined;
  }
}
