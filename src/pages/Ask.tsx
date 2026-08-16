import { api } from "@/lib/api";
import type { Id } from "@/lib/data-model";
import {
  ConfidenceBar,
  EmptyPanel,
  KnowledgeBadge,
  PageHeader,
  formatDate,
} from "@/components/atlas-ui";
import { Button } from "@/components/ui/button";
import { useVoice } from "@/hooks/use-voice";
import { useAction, useQuery } from "@/hooks/use-supabase";
import {
  ArrowRight,
  BookOpen,
  Bot,
  Database,
  ExternalLink,
  FileText,
  History,
  Landmark,
  Lightbulb,
  Loader2,
  MessageSquareText,
  Mic,
  MicOff,
  Zap,
  Network,
  Radar,
  Send,
  User,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

interface Evidence {
  kind: string;
  title?: string;
  snippet?: string;
  relevance?: number;
  documentTitle?: string;
  evidenceType?: string;
}

interface AuthorityAnswer {
  source: string;
  organization: string;
  authorityTier: string;
  tierLabel: string;
  sourceType: string;
  jurisdiction?: string;
  publicationDate?: number;
  effectiveDate?: number;
  version?: string;
  sourceFact: string;
  atlasInterpretation?: string;
  confidence: number;
  freshness: string;
  sourceUrl?: string;
}

interface PendingState {
  kind: string;
  message?: string;
  title?: string;
  options?: Array<{ id?: string; label: string }>;
}

interface AiStatusInfo {
  configured?: boolean;
  provider?: string;
  model?: string | null;
  status?: string;
  lastErrorCode?: string;
  latencyMs?: number;
}

interface Turn {
  id: string;
  role: "user" | "assistant";
  text: string;
  classification?: string;
  confidence?: number;
  mode?: "ai" | "local";
  limitations?: string;
  suggestedActions?: string[];
  evidence?: Evidence[];
  toolPlan?: ToolPlan | null;
  questionType?: string;
  authorityAnswers?: AuthorityAnswer[];
  intent?: string;
  pending?: PendingState | null;
  findings?: ReasoningFinding[];
  missingInformation?: string[];
  contradictions?: EvidenceContradiction[];
  recommendations?: string[];
  timestamp: number;
}

interface ToolPlan {
  status: string;
  toolId?: string;
  toolName?: string;
  arguments?: Record<string, unknown>;
  confidence?: number;
  expectedOutcome?: string;
  verificationPlan?: string;
  reason?: string;
}

/** Reasoning categories (§23) — conclusions are labeled, never dressed up. */
interface ReasoningFinding {
  category: string;
  statement: string;
  evidenceIds?: string[];
}

interface EvidenceContradiction {
  key?: string;
  field?: string;
  severity?: string;
  detail?: string;
  values?: Array<{ value?: string; documentTitle?: string; documentId?: string }>;
}

const FINDING_STYLES: Record<string, string> = {
  FACT: "border-emerald-400/30 bg-emerald-400/10 text-emerald-700 dark:text-emerald-300",
  INFERENCE: "border-sky-400/30 bg-sky-400/10 text-sky-700 dark:text-sky-300",
  UNKNOWN: "border-slate-400/30 bg-slate-400/10 text-slate-600 dark:text-slate-300",
  MISSING: "border-amber-400/30 bg-amber-400/10 text-amber-700 dark:text-amber-300",
  CONFLICT: "border-rose-400/30 bg-rose-400/10 text-rose-700 dark:text-rose-300",
  RECOMMENDATION: "border-violet-400/30 bg-violet-400/10 text-violet-700 dark:text-violet-300",
};

const EVIDENCE_ICONS: Record<string, typeof FileText> = {
  chunk: FileText,
  entity: Network,
  intelligence: BookOpen,
  document: FileText,
};

const SUGGESTIONS = [
  "Who are our largest customers?",
  "Which customers have active projects and unpaid invoices?",
  "What does our SOP require before we invoice?",
  "Summarize everything we know about Harborview Property Group.",
  "Which information is uncertain or missing?",
];

export default function Ask() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Phase 10 — text and voice route through the SAME conversational brain
  // (api.conversation.converse), which delegates to Ask Atlas internally and
  // keeps multi-turn context in a tenant-scoped session.
  const converse = useAction(api.conversation.converse);
  const history = useQuery(api.history.listAskSessions);

  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatusInfo | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const voice = useVoice({
    onTranscript: (text) => setInput((prev) => (prev ? `${prev} ${text}` : text)),
  });

  // Prefill from home quick-ask.
  useEffect(() => {
    const q = searchParams.get("q");
    if (q) setInput(q);
  }, [searchParams]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  const historyItems = useMemo(() => (history ?? []).slice(0, 20), [history]);

  const submit = async (text?: string) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput("");
    const userTurn: Turn = {
      id: `u-${Date.now()}`,
      role: "user",
      text: q,
      timestamp: Date.now(),
    };
    setTurns((t) => [...t, userTurn]);
    setBusy(true);
    try {
      const res = await converse({
        sessionId: (sessionId ?? undefined) as Id<"conversationSessions"> | undefined,
        transcript: q,
        pageContext: "Ask Atlas",
      });
      setSessionId(res.sessionId);
      if (res.ai) setAiStatus(res.ai as AiStatusInfo);
      setTurns((t) => [
        ...t,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: res.answer,
          classification: res.classification,
          confidence: res.confidence,
          mode: res.mode,
          limitations: res.limitations,
          suggestedActions: res.suggestedActions,
          evidence: res.evidence as unknown as Evidence[],
          toolPlan: (res.toolPlan as ToolPlan | null) ?? null,
          questionType: res.questionType,
          authorityAnswers: res.authorityAnswers as unknown as AuthorityAnswer[] | undefined,
          intent: res.intent,
          pending: res.pending,
          findings: (res.findings as ReasoningFinding[] | undefined) ?? undefined,
          missingInformation: (res.missingInformation as string[] | undefined) ?? undefined,
          contradictions: (res.contradictions as EvidenceContradiction[] | undefined) ?? undefined,
          recommendations: (res.recommendations as string[] | undefined) ?? undefined,
          timestamp: Date.now(),
        },
      ]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ask Atlas failed");
      setTurns((t) => [
        ...t,
        {
          id: `e-${Date.now()}`,
          role: "assistant",
          text: "I couldn't complete that query — please try again.",
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const loadSession = (s: (typeof historyItems)[number]) => {
    setTurns([
      { id: `hq-${s._id}`, role: "user", text: s.question, timestamp: s._creationTime },
      {
        id: `ha-${s._id}`,
        role: "assistant",
        text: s.answer,
        classification: s.classification,
        confidence: s.confidence,
        mode: s.mode,
        limitations: s.limitations ?? undefined,
        suggestedActions: s.suggestedActions ?? undefined,
        evidence: s.evidence as Evidence[],
        toolPlan: s.toolPlan ?? null,
        questionType: s.questionType,
        findings: s.findings as ReasoningFinding[] | undefined,
        missingInformation: s.missingInformation as string[] | undefined,
        contradictions: s.contradictions as EvidenceContradiction[] | undefined,
        recommendations: s.recommendations as string[] | undefined,
        timestamp: s._creationTime,
      },
    ]);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Ask Atlas"
        title="Ask your company anything"
        description="Questions are answered from your knowledge graph with cited evidence — never from memory alone."
      />

      <div className="grid gap-6 lg:grid-cols-4">
        {/* Thread */}
        <div className="flex flex-col gap-4 lg:col-span-3">
          <div
            ref={scrollRef}
            className="atlas-scroll flex max-h-[62vh] min-h-[380px] flex-col gap-5 overflow-y-auto rounded-xl border border-border/70 bg-card/50 p-5"
          >
            {turns.length === 0 && (
              <div className="m-auto flex max-w-md flex-col items-center py-10 text-center">
                <div className="flex size-12 items-center justify-center rounded-xl border border-teal-400/25 bg-teal-400/10 text-teal-600 dark:text-teal-300">
                  <Radar className="size-6" />
                </div>
                <h3 className="mt-4 text-sm font-semibold">Atlas is listening</h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                  Ask about customers, projects, invoices, policies or SOPs — Atlas searches every
                  connected source and cites what it finds. Or start with one of these:
                </p>
                <div className="mt-4 flex w-full flex-col gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => submit(s)}
                      className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-teal-400/40 hover:text-teal-700 dark:hover:text-teal-200"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((t) =>
              t.role === "user" ? (
                <div key={t.id} className="flex justify-end gap-3">
                  <div className="max-w-[85%] rounded-2xl rounded-tr-sm border border-teal-400/25 bg-teal-400/10 px-4 py-2.5 text-sm leading-6 text-teal-800 dark:text-teal-50">
                    {t.text}
                  </div>
                  <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <User className="size-3.5" />
                  </div>
                </div>
              ) : (
                <div key={t.id} className="flex gap-3">
                  <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-teal-400/15 text-teal-600 dark:text-teal-300 ring-1 ring-teal-400/25">
                    <Bot className="size-3.5" />
                  </div>
                  <div className="min-w-0 max-w-[88%] flex-1">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      {t.questionType && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-cyan-700 dark:text-cyan-200">
                          <Radar className="size-3" />
                          {t.questionType.replace(/_/g, " ")} question
                        </span>
                      )}
                      {t.classification && <KnowledgeBadge classification={t.classification} />}
                      {t.mode && (
                        <span
                          className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
                            t.mode === "ai"
                              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-700 dark:text-emerald-300"
                              : "border-border/70 text-muted-foreground"
                          }`}
                        >
                          {t.mode === "ai" ? "Gemini reasoning" : "assembled locally"}
                        </span>
                      )}
                      {typeof t.confidence === "number" && <ConfidenceBar value={t.confidence} />}
                    </div>
                    <div className="rounded-2xl rounded-tl-sm border border-border/70 bg-card px-4 py-3 text-sm leading-6 text-foreground">
                      <p className="whitespace-pre-wrap">{t.text}</p>
                      {(t.pending?.kind === "confirm_action" ||
                        t.pending?.kind === "confirm_workflow") && (
                        <div className="mt-3 rounded-lg border border-amber-400/25 bg-amber-400/5 p-3">
                          <p className="text-[11px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-300">
                            Awaiting your confirmation
                          </p>
                          {t.pending.message && (
                            <p className="mt-1 text-xs leading-5 text-foreground">
                              {t.pending.message}
                            </p>
                          )}
                          <div className="mt-2 flex gap-2">
                            <Button
                              size="sm"
                              className="h-7 gap-1 text-[11px]"
                              onClick={() => void submit("yes, proceed")}
                            >
                              Proceed
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 text-[11px]"
                              onClick={() => void submit("no, cancel")}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                      {(t.pending?.kind === "clarify_entity" ||
                        t.pending?.kind === "clarify_general") && (
                        <div className="mt-3 rounded-lg border border-violet-400/25 bg-violet-400/5 p-3">
                          <p className="text-[11px] font-medium uppercase tracking-wide text-violet-600 dark:text-violet-300">
                            Which one do you mean?
                          </p>
                          {(t.pending?.options ?? []).length > 0 ? (
                            <div className="mt-2 flex flex-col gap-1.5">
                              {(t.pending?.options ?? []).map((o, i) => (
                                <button
                                  key={o.id ?? o.label}
                                  type="button"
                                  onClick={() =>
                                    void submit(
                                      `the ${i + 1 === 1 ? "first" : i + 1 === 2 ? "second" : i + 1 === 3 ? "third" : `${i + 1}th`} one`,
                                    )
                                  }
                                  className="rounded-lg border border-border/70 bg-muted/30 px-2.5 py-1.5 text-left text-xs text-foreground transition-colors hover:border-violet-400/40"
                                >
                                  <span className="mr-1.5 font-mono text-[10px] text-muted-foreground">
                                    {i + 1}.
                                  </span>
                                  {o.label}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                              {t.pending?.message ?? "Could you rephrase that?"}
                            </p>
                          )}
                        </div>
                      )}
                      {t.toolPlan?.status === "ready" && t.toolPlan.toolId && (
                        <div className="mt-3 rounded-lg border border-violet-400/25 bg-violet-400/5 p-3">
                          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-violet-600 dark:text-violet-300">
                            <Zap className="size-3" />
                            Atlas can do this
                          </p>
                          <p className="mt-1.5 text-xs font-semibold text-foreground">
                            {t.toolPlan.toolName ?? t.toolPlan.toolId}
                          </p>
                          {t.toolPlan.expectedOutcome && (
                            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                              {t.toolPlan.expectedOutcome}
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {typeof t.toolPlan.confidence === "number" && (
                              <ConfidenceBar value={t.toolPlan.confidence} />
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="ml-auto h-7 gap-1.5 border-violet-400/30 text-[11px] text-violet-700 hover:bg-violet-400/10 dark:text-violet-200"
                              onClick={() =>
                                navigate(
                                  `/dashboard/actions?tool=${encodeURIComponent(
                                    t.toolPlan!.toolId!,
                                  )}&args=${encodeURIComponent(
                                    JSON.stringify(t.toolPlan!.arguments ?? {}),
                                  )}`,
                                )
                              }
                            >
                              <Zap className="size-3" />
                              Open in Actions
                            </Button>
                          </div>
                          {t.toolPlan.verificationPlan && (
                            <p className="mt-2 border-t border-violet-400/15 pt-2 text-[10px] italic leading-4 text-muted-foreground">
                              Verify: {t.toolPlan.verificationPlan}
                            </p>
                          )}
                        </div>
                      )}
                      {t.suggestedActions && t.suggestedActions.length > 0 && (
                        <div className="mt-3 border-t border-border/50 pt-2.5">
                          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            <Lightbulb className="size-3 text-amber-600 dark:text-amber-300" />
                            Suggested actions
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {t.suggestedActions.map((a) => (
                              <span
                                key={a}
                                className="rounded-md border border-amber-400/25 bg-amber-400/5 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-200"
                              >
                                {a}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Structured intelligence (§37): categorized findings,
                          gaps and contradictions — each grounded in evidence. */}
                      {t.findings && t.findings.length > 0 && (
                        <div className="mt-3 border-t border-border/50 pt-2.5">
                          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            <Radar className="size-3 text-teal-600 dark:text-teal-300" />
                            Atlas analysis
                          </p>
                          <div className="mt-2 space-y-1.5">
                            {t.findings.map((f, i) => (
                              <div
                                key={`${t.id}-f${i}`}
                                className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2"
                              >
                                <span
                                  className={`mt-px shrink-0 rounded-full border px-1.5 py-px font-mono text-[9px] font-semibold uppercase tracking-wide ${
                                    FINDING_STYLES[f.category] ?? FINDING_STYLES.UNKNOWN
                                  }`}
                                >
                                  {f.category}
                                </span>
                                <p className="min-w-0 flex-1 text-[11px] leading-5 text-foreground">
                                  {f.statement}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {t.missingInformation && t.missingInformation.length > 0 && (
                        <div className="mt-3 border-t border-border/50 pt-2.5">
                          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">
                            <Radar className="size-3" />
                            Missing information
                          </p>
                          <ul className="mt-1.5 space-y-1">
                            {t.missingInformation.map((m) => (
                              <li
                                key={m}
                                className="flex items-start gap-1.5 text-[11px] leading-5 text-muted-foreground"
                              >
                                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-amber-500/70" />
                                {m}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {t.contradictions && t.contradictions.length > 0 && (
                        <div className="mt-3 border-t border-border/50 pt-2.5">
                          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-rose-700 dark:text-rose-300">
                            <Radar className="size-3" />
                            Contradictions ({t.contradictions.length})
                          </p>
                          <div className="mt-1.5 space-y-1.5">
                            {t.contradictions.map((c, i) => (
                              <div
                                key={`${t.id}-c${i}`}
                                className="rounded-lg border border-rose-400/20 bg-rose-400/5 px-2.5 py-2"
                              >
                                <p className="text-[11px] font-medium text-foreground">
                                  {c.detail ?? `${c.field ?? "value"} conflict`}
                                </p>
                                {c.values && c.values.length > 0 && (
                                  <div className="mt-1 flex flex-wrap gap-1.5">
                                    {c.values.map((v, j) => (
                                      <span
                                        key={j}
                                        className="rounded border border-border/60 bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                                      >
                                        {v.value}
                                        {v.documentTitle ? ` — ${v.documentTitle}` : ""}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {t.recommendations &&
                        t.recommendations.length > 0 &&
                        (!t.suggestedActions || t.suggestedActions.length === 0) && (
                          <div className="mt-3 border-t border-border/50 pt-2.5">
                            <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-violet-700 dark:text-violet-300">
                              <Lightbulb className="size-3" />
                              Recommended actions
                            </p>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {t.recommendations.map((a) => (
                                <span
                                  key={a}
                                  className="rounded-md border border-violet-400/25 bg-violet-400/5 px-2 py-0.5 text-[11px] text-violet-700 dark:text-violet-200"
                                >
                                  {a}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      {t.limitations && (
                        <p className="mt-3 text-[11px] italic leading-5 text-muted-foreground">
                          ⚠ {t.limitations}
                        </p>
                      )}
                      {t.authorityAnswers && t.authorityAnswers.length > 0 && (
                        <div className="mt-3 border-t border-cyan-400/20 pt-2.5">
                          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-cyan-700 dark:text-cyan-300">
                            <Landmark className="size-3" />
                            Authoritative sources
                          </p>
                          <div className="mt-2 space-y-2">
                            {t.authorityAnswers.map((a, i) => (
                              <div
                                key={i}
                                className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-3"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-xs font-semibold text-foreground">
                                    {a.source}
                                  </span>
                                  <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-medium text-cyan-700 dark:text-cyan-200">
                                    {a.tierLabel}
                                  </span>
                                  {a.version && (
                                    <span className="font-mono text-[10px] text-muted-foreground">
                                      v{a.version}
                                    </span>
                                  )}
                                </div>
                                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                                  {a.jurisdiction && <span>Jurisdiction: {a.jurisdiction}</span>}
                                  {a.publicationDate && (
                                    <span>
                                      Published: {formatDate(a.publicationDate)}
                                    </span>
                                  )}
                                  {a.effectiveDate && (
                                    <span>
                                      Effective: {formatDate(a.effectiveDate)}
                                    </span>
                                  )}
                                  <span>Freshness: {a.freshness.replace(/_/g, " ")}</span>
                                  <span>Confidence: {Math.round(a.confidence * 100)}%</span>
                                </div>
                                <p className="mt-2 text-[11px] leading-5 text-foreground">
                                  {a.sourceFact}
                                </p>
                                {a.atlasInterpretation && (
                                  <p className="mt-1.5 border-l-2 border-cyan-400/30 pl-2 text-[11px] italic leading-5 text-muted-foreground">
                                    Atlas interpretation: {a.atlasInterpretation}
                                  </p>
                                )}
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  {a.sourceUrl && (
                                    <a
                                      href={a.sourceUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-1 text-[10px] font-medium text-cyan-700 underline-offset-2 hover:underline dark:text-cyan-300"
                                    >
                                      <ExternalLink className="size-3" />
                                      Source reference
                                    </a>
                                  )}
                                  <span className="text-[10px] italic text-muted-foreground">
                                    This is not legal advice.
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    {t.evidence && t.evidence.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {t.evidence.slice(0, 5).map((e, i) => {
                          const Icon = EVIDENCE_ICONS[e.kind] ?? FileText;
                          return (
                            <details
                              key={`${t.id}-e${i}`}
                              className="group rounded-lg border border-border/60 bg-muted/20"
                            >
                              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs">
                                <Icon className="size-3.5 shrink-0 text-teal-600 dark:text-teal-300" />
                                <span className="truncate font-medium">
                                  {e.documentTitle ?? e.title ?? e.kind}
                                </span>
                                {e.evidenceType && (
                                  <KnowledgeBadge classification={e.evidenceType} />
                                )}
                                <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/70">
                                  [{i + 1}]
                                </span>
                              </summary>
                              {e.snippet && (
                                <p className="px-3 pb-2.5 text-[11px] leading-5 text-muted-foreground">
                                  {e.snippet}
                                </p>
                              )}
                            </details>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ),
            )}

            {busy && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <div className="flex size-7 items-center justify-center rounded-full bg-teal-400/15 text-teal-600 dark:text-teal-300 ring-1 ring-teal-400/25">
                  <Bot className="size-3.5" />
                </div>
                <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-border/70 bg-card px-4 py-3">
                  <Loader2 className="size-4 animate-spin text-teal-600 dark:text-teal-300" />
                  Retrieving evidence and reasoning…
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="relative">
            {voice.interim && voice.status === "listening" && (
              <p className="mb-1.5 px-1 text-xs italic text-muted-foreground">
                “{voice.interim}”
              </p>
            )}
            {voice.error && (
              <p className="mb-1.5 rounded-lg border border-rose-400/25 bg-rose-400/5 px-2.5 py-1.5 text-[11px] text-rose-700 dark:text-rose-200">
                {voice.error}
              </p>
            )}
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              rows={2}
              placeholder="Ask about documents, claims, invoices, policies… (Enter to send)"
              className="w-full resize-none rounded-xl border border-border/70 bg-card/70 p-3.5 pr-24 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-teal-400/50 focus:ring-2 focus:ring-teal-400/20"
            />
            <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => voice.toggle()}
                title={voice.status === "listening" ? "Stop listening" : "Press to talk"}
                className={`flex size-9 items-center justify-center rounded-lg border transition-colors ${
                  voice.status === "listening"
                    ? "animate-pulse border-rose-400/40 bg-rose-500 text-white"
                    : voice.supported
                      ? "border-border/70 bg-muted/40 text-muted-foreground hover:border-teal-400/40 hover:text-teal-600 dark:hover:text-teal-300"
                      : "border-border/50 bg-muted/20 text-muted-foreground/50"
                }`}
              >
                {voice.status === "listening" ? <MicOff className="size-4" /> : <Mic className="size-4" />}
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy || !input.trim()}
                className="flex size-9 items-center justify-center rounded-lg bg-teal-400 text-teal-950 transition-colors hover:bg-teal-300 disabled:opacity-40"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* AI + History */}
        <div className="flex flex-col gap-4">
          {/* AI configuration status — reflects the real deployed backend,
              never a guessed state. Until a question is answered the status
              is unknown; afterwards it shows what the conversation engine
              actually used. */}
          <div className="rounded-xl border border-border/70 bg-card/50 p-3.5">
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg border border-teal-400/25 bg-teal-400/10 text-teal-600 dark:text-teal-300">
                <Bot className="size-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-xs font-semibold">
                  AI
                  {aiStatus?.configured ? (
                    <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-px font-mono text-[9px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                      {aiStatus.status === "connected"
                        ? "connected"
                        : aiStatus.status === "fallback"
                          ? "fallback"
                          : aiStatus.status === "skipped"
                            ? "no evidence"
                            : aiStatus.status}
                    </span>
                  ) : aiStatus ? (
                    <span className="rounded-full border border-border/70 px-1.5 py-px font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                      not configured
                    </span>
                  ) : (
                    <span className="rounded-full border border-border/70 px-1.5 py-px font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                      checking…
                    </span>
                  )}
                </p>
                {aiStatus?.configured ? (
                  <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                    {aiStatus.provider === "gemini" ? "Gemini" : aiStatus.provider ?? "AI"}
                    {aiStatus.model ? ` · ${aiStatus.model}` : ""} — evidence-grounded
                    reasoning
                  </p>
                ) : (
                  <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                    {aiStatus
                      ? "Atlas is using evidence retrieval until an AI model is configured."
                      : "Ask a question to check the reasoning engine."}
                  </p>
                )}
              </div>
            </div>
            {(aiStatus?.configured || aiStatus?.status === "fallback") && aiStatus?.lastErrorCode && (
              <p className="mt-2 border-t border-border/50 pt-2 font-mono text-[10px] text-muted-foreground/70">
                {aiStatus.status === "fallback"
                  ? `last answer fell back to retrieval (${aiStatus.lastErrorCode})`
                  : aiStatus.status === "skipped"
                    ? "no evidence was retrieved for the last question"
                    : `status: ${aiStatus.status}`}
              </p>
            )}
          </div>

          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <History className="size-4 text-cyan-600 dark:text-cyan-300" />
              Session history
            </h2>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => {
                setTurns([]);
                setSessionId(null);
              }}
              disabled={turns.length === 0}
            >
              Clear
            </Button>
          </div>
          <div className="atlas-scroll max-h-[62vh] space-y-2 overflow-y-auto pr-1">
            {historyItems.length === 0 ? (
              <EmptyPanel
                icon={MessageSquareText}
                title="No questions yet"
                description="Every Ask Atlas session is saved here with its evidence."
              />
            ) : (
              historyItems.map((s) => (
                <button
                  key={s._id}
                  type="button"
                  onClick={() => loadSession(s)}
                  className="block w-full rounded-lg border border-border/60 bg-card/50 p-3 text-left transition-colors hover:border-teal-400/30 hover:bg-card"
                >
                  <p className="line-clamp-2 text-xs font-medium leading-5">{s.question}</p>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="font-mono text-[10px] text-muted-foreground/60">
                      {formatDate(s._creationTime)}
                    </span>
                    {s.classification && <KnowledgeBadge classification={s.classification} />}
                  </div>
                </button>
              ))
            )}
          </div>
          <button
            type="button"
            onClick={() => navigate("/dashboard/knowledge")}
            className="flex items-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2.5 text-xs text-muted-foreground transition-colors hover:border-teal-400/30 hover:text-teal-700 dark:hover:text-teal-200"
          >
            <Database className="size-3.5 text-teal-600 dark:text-teal-300" />
            Answers depend on your knowledge base
            <ArrowRight className="ml-auto size-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
