// ---------------------------------------------------------------------------
// Talk to Atlas — Primary conversational interface
//
// This is NOT a chatbot page. This IS Atlas.
//
// The user speaks or types. Atlas listens, investigates, explains,
// recommends, and can execute approved actions.
//
// No separate page header. Atlas is the interface.
//
// ┌──────────────────────────────────────────────────────────────┐
// │                                                              │
// │  ┌────────────────────────────────────────────────────┐     │
// │  │                                                    │     │
// │  │  Good morning.                                     │     │
// │  │                                                    │     │
// │  │  I've reviewed what's changed.                     │     │
// │  │  There are three things I'd like you to see.       │     │
// │  │                                                    │     │
// │  └────────────────────────────────────────────────────┘     │
// │                                                              │
// └──────────────────────────────────────────────────────────────┘

import { api } from "@/lib/api";
import type { Id } from "@/lib/data-model";
import { useVoice } from "@/hooks/use-voice";
import { useVoiceSession } from "@/components/voice-session";
import { useAction, useQuery } from "@/hooks/use-supabase";
import { useAtlasContext } from "@/lib/atlas-experience/context";
import { useIntelligence } from "@/lib/atlas-experience/useIntelligence";
import { useActivity } from "@/lib/atlas-experience/useActivity";
import { useDecisions } from "@/lib/atlas-experience/useDecisions";
import { useAtlasActionAuth } from "@/hooks/use-atlas-action-auth";
import { buildConversationContext } from "@/lib/atlas-experience/conversational-intelligence";
import { bridgeIntentToAction } from "@/lib/atlas-experience/conversational-execution-bridge";
import { AtlasActionPanel } from "@/components/atlas-experience/AtlasActionPanel";
import { Button } from "@/components/ui/button";
import { ConfidenceBar, KnowledgeBadge, formatDate } from "@/components/atlas-ui";
import {
  Bot,
  Check,
  ChevronRight,
  CircleStop,
  FileText,
  Landmark,
  Lightbulb,
  Loader2,
  Mic,
  MicOff,
  Radar,
  Send,
  Sparkles,
  User,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  sourceFact: string;
  confidence: number;
  freshness: string;
}

interface PendingState {
  kind: string;
  message?: string;
  title?: string;
  options?: Array<{ id?: string; label: string }>;
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
  questionType?: string;
  authorityAnswers?: AuthorityAnswer[];
  intent?: string;
  pending?: PendingState | null;
  actionProposal?: {
    hasAction: boolean;
    action?: import("@/lib/atlas-experience/execution").AtlasExecutableAction;
    requiresConfirmation: boolean;
    authorized: boolean;
    authorizationReason?: string;
  };
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Suggested prompts — context-aware, Atlas phrasing
// ---------------------------------------------------------------------------

function useSuggestedPrompts(): string[] {
  const { items: attentionItems } = useIntelligence();
  const { decisions } = useDecisions();

  return useMemo(() => {
    const prompts: string[] = ["What's happening with our business?"];

    const criticalCount = attentionItems.filter(
      (a) => a.status === "open" && (a.severity === "critical" || a.severity === "high"),
    ).length;
    if (criticalCount > 0) {
      prompts.push(`What are the ${criticalCount} critical issues?`);
    }

    const pendingCount = decisions.filter((d) => d.requiresApproval && d.status === "new").length;
    if (pendingCount > 0) {
      prompts.push("What needs my approval?");
    }

    const stalled = attentionItems.filter(
      (a) => a.status === "open" && a.category === "overdue_task",
    ).length;
    if (stalled > 0) {
      prompts.push("Which claims are stalled?");
    }

    prompts.push("What's the biggest recovery opportunity?");

    return prompts.slice(0, 4);
  }, [attentionItems, decisions]);
}

// ---------------------------------------------------------------------------
// Talk page — Atlas IS the conversation
// ---------------------------------------------------------------------------

export default function Talk() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const converse = useAction(api.conversation.converse);

  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const session = useVoiceSession();
  const voice = useVoice({
    onTranscript: (text) => setInput((prev) => (prev ? `${prev} ${text}` : text)),
  });

  const auth = useAtlasActionAuth();
  const { health, entity, investigation } = useAtlasContext();
  const { items: attentionItems } = useIntelligence();
  const { activities } = useActivity();
  const { decisions } = useDecisions();
  const [conversationEntity, setConversationEntity] = useState<import("@/lib/atlas-experience/entity-reference").AtlasEntityReference | undefined>();

  const suggestedPrompts = useSuggestedPrompts();

  // Build conversation context for action bridge
  const conversationContext = useMemo(
    () =>
      buildConversationContext({
        workspaceId: auth.userId || "",
        workspaceName: undefined,
        userRole: auth.userRole,
        health,
        attentionItems,
        activities,
        decisions,
        signals: [],
        currentEntity: conversationEntity ?? (entity ? { type: entity.type, id: entity.id, label: entity.name ?? entity.id } : undefined),
        investigation: investigation ? {
          entity: investigation.entity,
          originatingInsight: investigation.originatingInsight,
          assessment: investigation.assessment,
          confidence: investigation.confidence,
          recommendation: investigation.recommendation,
          evidenceSummary: investigation.evidenceSummary,
          gaps: investigation.gaps,
        } : undefined,
      }),
    [health, attentionItems, activities, decisions, auth.userId, auth.userRole, conversationEntity, entity, investigation],
  );

  // Sync voice session turns
  const lastSessionTurnCountRef = useRef(0);
  useEffect(() => {
    const sessionTurns = session.turns;
    if (sessionTurns.length > lastSessionTurnCountRef.current) {
      const newTurns = sessionTurns.slice(lastSessionTurnCountRef.current);
      lastSessionTurnCountRef.current = sessionTurns.length;
      setTurns((prev) => [
        ...prev,
        ...newTurns.map((t) => ({
          id: t.id,
          role: t.role,
          text: t.text,
          timestamp: t.ts,
        })),
      ]);
    }
  }, [session.turns]);

  // Prefill from URL params
  useEffect(() => {
    const q = searchParams.get("q");
    if (q) {
      setInput(q);
      setTimeout(() => {
        void submit(q);
      }, 300);
    }
  }, [searchParams]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  // Voice state
  const micActive = voice.status === "listening" || voice.status === "transcribing";

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

    // Run conversational execution bridge
    const actionProposal = bridgeIntentToAction(q, {
      userRole: auth.userRole,
      userId: auth.userId,
      currentEntity: conversationEntity,
      conversationContext,
    });

    if (actionProposal.hasAction && actionProposal.action?.entity) {
      setConversationEntity(actionProposal.action.entity);
    }

    try {
      const res = await converse({
        sessionId: (sessionId ?? undefined) as Id<"conversationSessions"> | undefined,
        transcript: q,
        pageContext: "Talk to Atlas",
      });

      setSessionId(res.sessionId);
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
          questionType: res.questionType,
          authorityAnswers: res.authorityAnswers as unknown as AuthorityAnswer[] | undefined,
          intent: res.intent,
          pending: res.pending,
          timestamp: Date.now(),
          actionProposal: actionProposal.hasAction
            ? {
                hasAction: true,
                action: actionProposal.action,
                requiresConfirmation: actionProposal.requiresConfirmation,
                authorized: actionProposal.authorized,
                authorizationReason: actionProposal.authorizationReason,
              }
            : undefined,
        },
      ]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Atlas could not respond");
      setTurns((t) => [
        ...t,
        {
          id: `e-${Date.now()}`,
          role: "assistant",
          text: "I hit a problem responding to that. Nothing was sent. You can try again.",
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Conversation area — immersive, no page header */}
      <div
        ref={scrollRef}
        className="atlas-scroll flex max-h-[65vh] min-h-[450px] flex-col gap-5 overflow-y-auto rounded-2xl border border-border/50 bg-card/20 p-6"
      >
        {/* Empty state — Atlas is present */}
        {turns.length === 0 && !busy && (
          <div className="m-auto flex max-w-lg flex-col items-center py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-teal-400/10 text-teal-600 dark:text-teal-300">
              <Radar className="size-6" />
            </div>
            <p className="mt-5 max-w-sm text-sm leading-6 text-muted-foreground">
              What would you like to know? Ask about claims, evidence, recommendations, or what matters most right now.
            </p>

            {/* Suggested prompts — Atlas suggests */}
            <div className="mt-6 flex w-full flex-col gap-2">
              {suggestedPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => void submit(prompt)}
                  className="group flex items-center gap-3 rounded-xl border border-border/60 bg-card/40 px-4 py-3 text-left transition-colors hover:border-teal-400/40 hover:bg-card/80"
                >
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-teal-400/10 text-teal-600 dark:text-teal-300">
                    <Zap className="size-3.5" />
                  </div>
                  <span className="text-sm text-muted-foreground group-hover:text-foreground">
                    {prompt}
                  </span>
                  <ChevronRight className="ml-auto size-3.5 text-muted-foreground/40 group-hover:text-teal-600 dark:group-hover:text-teal-300" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Conversation turns */}
        {turns.map((t) =>
          t.role === "user" ? (
            <div key={t.id} className="flex justify-end gap-3">
              <div className="max-w-[80%] rounded-2xl rounded-tr-sm border border-teal-400/25 bg-teal-400/10 px-4 py-3 text-sm leading-6 text-teal-800 dark:text-teal-50">
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
              <div className="min-w-0 max-w-[85%] flex-1">
                {/* Metadata — subtle, not dominant */}
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  {t.questionType && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-cyan-700 dark:text-cyan-200">
                      <Radar className="size-3" />
                      {t.questionType.replace(/_/g, " ")}
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
                      {t.mode === "ai" ? "AI reasoning" : "retrieval"}
                    </span>
                  )}
                  {typeof t.confidence === "number" && <ConfidenceBar value={t.confidence} />}
                </div>

                {/* Answer */}
                <div className="rounded-2xl rounded-tl-sm border border-border/70 bg-card px-4 py-3 text-sm leading-6 text-foreground">
                  <p className="whitespace-pre-wrap">{t.text}</p>

                  {/* Confirmation prompts */}
                  {(t.pending?.kind === "confirm_action" || t.pending?.kind === "confirm_workflow") && (
                    <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-400/5 p-3">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-300">
                        Awaiting your confirmation
                      </p>
                      {t.pending.message && (
                        <p className="mt-1 text-xs leading-5 text-foreground">{t.pending.message}</p>
                      )}
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" className="h-7 gap-1 text-[11px]" onClick={() => void submit("yes, proceed")}>
                          <Check className="size-3" /> Proceed
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={() => void submit("no, cancel")}>
                          <CircleStop className="size-3" /> Cancel
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Suggested actions */}
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

                  {/* Action proposal from bridge */}
                  {t.actionProposal?.hasAction && t.actionProposal.action && (
                    <div className="mt-3 border-t border-teal-400/20 pt-2.5">
                      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-teal-700 dark:text-teal-200">
                        <Zap className="size-3" />
                        Atlas can do this
                      </p>
                      <p className="mt-1.5 text-xs font-semibold text-foreground">
                        {t.actionProposal.action.description}
                      </p>
                      {!t.actionProposal.authorized && t.actionProposal.authorizationReason && (
                        <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-300">
                          {t.actionProposal.authorizationReason}
                        </p>
                      )}
                      <div className="mt-2">
                        <AtlasActionPanel
                          actions={[
                            {
                              type: t.actionProposal.action.type,
                              label: t.actionProposal.action.description,
                              entity: t.actionProposal.action.entity,
                              params: t.actionProposal.action.parameters,
                            },
                          ]}
                          userRole={auth.userRole}
                          userId={auth.userId}
                          layout="compact"
                        />
                      </div>
                    </div>
                  )}

                  {/* Limitations */}
                  {t.limitations && (
                    <p className="mt-3 text-[11px] italic leading-5 text-muted-foreground">
                      ⚠ {t.limitations}
                    </p>
                  )}

                  {/* Authority answers */}
                  {t.authorityAnswers && t.authorityAnswers.length > 0 && (
                    <div className="mt-3 border-t border-cyan-400/20 pt-2.5">
                      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-cyan-700 dark:text-cyan-300">
                        <Landmark className="size-3" />
                        Authoritative sources
                      </p>
                      <div className="mt-2 space-y-2">
                        {t.authorityAnswers.slice(0, 2).map((a, i) => (
                          <div key={i} className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-3">
                            <p className="text-xs font-semibold text-foreground">{a.source}</p>
                            <p className="mt-1 text-[11px] leading-5 text-foreground">{a.sourceFact}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Evidence */}
                {t.evidence && t.evidence.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {t.evidence.slice(0, 4).map((e, i) => (
                      <details
                        key={`${t.id}-e${i}`}
                        className="group rounded-lg border border-border/60 bg-muted/20"
                      >
                        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs">
                          <FileText className="size-3.5 shrink-0 text-teal-600 dark:text-teal-300" />
                          <span className="truncate font-medium">
                            {e.documentTitle ?? e.title ?? e.kind}
                          </span>
                          {e.evidenceType && <KnowledgeBadge classification={e.evidenceType} />}
                        </summary>
                        {e.snippet && (
                          <p className="px-3 pb-2.5 text-[11px] leading-5 text-muted-foreground">
                            {e.snippet}
                          </p>
                        )}
                      </details>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ),
        )}

        {/* Thinking indicator — Atlas is working */}
        {busy && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <div className="flex size-7 items-center justify-center rounded-full bg-teal-400/15 text-teal-600 dark:text-teal-300 ring-1 ring-teal-400/25">
              <Bot className="size-3.5" />
            </div>
            <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-border/70 bg-card px-4 py-3">
              <Loader2 className="size-4 animate-spin text-teal-600 dark:text-teal-300" />
              <span className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="size-1.5 animate-bounce rounded-full bg-teal-500/70"
                    style={{ animationDelay: `${i * 140}ms` }}
                  />
                ))}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
