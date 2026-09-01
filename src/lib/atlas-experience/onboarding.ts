// ---------------------------------------------------------------------------
// Atlas Onboarding State
//
// Derives onboarding/activation state from real system data.
// NO fake progress bars. NO step counters. Atlas speaks honestly about
// what it knows and what it needs.
// ---------------------------------------------------------------------------

import type { WorkspaceHealth } from "./context";

// ---------------------------------------------------------------------------
// Onboarding States — derived, never stored
// ---------------------------------------------------------------------------

export type AtlasReadinessState =
  /** Organization exists but has no meaningful data yet */
  | "empty"
  /** Data is connected, Atlas is processing */
  | "processing"
  /** Data available but no recovery opportunities identified */
  | "ready_no_opportunities"
  /** Atlas has detected at least one recovery opportunity */
  | "opportunity_detected"
  /** User has investigated at least one claim/opportunity */
  | "investigating"
  /** User has completed at least one action cycle */
  | "activated";

export interface OnboardingSnapshot {
  /** Current readiness state */
  state: AtlasReadinessState;
  /** Whether the organization has any documents */
  hasDocuments: boolean;
  /** Whether the organization has any entities */
  hasEntities: boolean;
  /** Whether the organization has any claims */
  hasClaims: boolean;
  /** Whether the organization has any open findings/opportunities */
  hasOpportunities: boolean;
  /** Whether the organization has any recommendations */
  hasRecommendations: boolean;
  /** Whether the organization has any activity history */
  hasActivity: boolean;
  /** Whether any connections are live */
  hasConnections: boolean;
  /** Whether the pipeline is actively processing */
  isProcessing: boolean;
  /** Number of documents */
  documentCount: number;
  /** Number of entities */
  entityCount: number;
  /** Number of open claims */
  claimCount: number;
  /** Number of open findings */
  findingCount: number;
  /** Whether the workspace profile is complete */
  profileComplete: boolean;
  /** Primary CTA Atlas recommends */
  primaryCta: OnboardingCta;
  /** Atlas's honest assessment message */
  assessment: string;
  /** Atlas's suggested next step */
  nextStep: string;
  /** Where the CTA should navigate */
  ctaTarget: string;
  /** Secondary actions */
  secondaryActions: OnboardingCta[];
  /** The single best claim to investigate first (if any) */
  recommendedClaim?: {
    id: string;
    name: string;
    reason: string;
  };
}

export interface OnboardingCta {
  label: string;
  description: string;
  target: string;
  icon: string;
}

// ---------------------------------------------------------------------------
// Derive onboarding state from real data
// ---------------------------------------------------------------------------

export function deriveOnboardingState(params: {
  health: WorkspaceHealth;
  documentCount: number;
  entityCount: number;
  claimCount: number;
  findingCount: number;
  recommendationCount: number;
  hasActivity: boolean;
  hasConnections: boolean;
  isProcessing: boolean;
  profileComplete: boolean;
  /** Top claim by findings/outstanding — the one Atlas recommends investigating first */
  bestClaim?: { id: string; name: string; reason: string };
}): OnboardingSnapshot {
  const {
    health,
    documentCount,
    entityCount,
    claimCount,
    findingCount,
    recommendationCount,
    hasActivity,
    hasConnections,
    isProcessing,
    profileComplete,
  } = params;

  const hasDocuments = documentCount > 0;
  const hasEntities = entityCount > 0;
  const hasClaims = claimCount > 0;
  const hasOpportunities = findingCount > 0;
  const hasRecommendations = recommendationCount > 0;

  // Derive state from real data
  let state: AtlasReadinessState;

  if (!hasDocuments && !hasEntities && !hasClaims) {
    state = "empty";
  } else if (isProcessing) {
    state = "processing";
  } else if (hasOpportunities || hasRecommendations) {
    state = "opportunity_detected";
  } else if (hasDocuments || hasClaims) {
    state = "ready_no_opportunities";
  } else {
    state = "empty";
  }

  // If there's activity, the user has been investigating
  if (hasActivity && (hasClaims || hasDocuments)) {
    state = "investigating";
  }

  // Determine assessment and next step
  let assessment: string;
  let nextStep: string;
  let primaryCta: OnboardingCta;
  let ctaTarget: string;
  const secondaryActions: OnboardingCta[] = [];

  switch (state) {
    case "empty":
      assessment = "I'm ready. I don't have enough information yet to identify recovery opportunities.";
      nextStep = hasConnections
        ? "Upload claim documents so I can start analyzing."
        : "Connect a system or upload documents to get started.";
      primaryCta = hasConnections
        ? {
            label: "Upload documents",
            description: "Give me something to work with",
            target: "/dashboard/knowledge",
            icon: "FileUp",
          }
        : {
            label: "Connect your systems",
            description: "Link the tools your company already uses",
            target: "/dashboard/connections",
            icon: "Cable",
          };
      ctaTarget = primaryCta.target;
      secondaryActions.push({
        label: "Load demo data",
        description: "Explore Atlas with sample restoration claims",
        target: "/dashboard",
        icon: "FlaskConical",
      });
      secondaryActions.push({
        label: "Ask Atlas",
        description: "Tell me about your company",
        target: "/dashboard/ask",
        icon: "MessageSquareText",
      });
      break;

    case "processing":
      assessment = `I have access to ${documentCount} document${documentCount === 1 ? "" : "s"}. I'm reviewing them now.`;
      nextStep = "I'll surface opportunities as I find them.";
      primaryCta = {
        label: "View knowledge base",
        description: "See what I'm working on",
        target: "/dashboard/knowledge",
        icon: "Database",
      };
      ctaTarget = "/dashboard/knowledge";
      secondaryActions.push({
        label: "Upload more",
        description: "The more I have, the more I can find",
        target: "/dashboard/knowledge",
        icon: "FileUp",
      });
      break;

    case "ready_no_opportunities":
      assessment = `I've reviewed ${documentCount} document${documentCount === 1 ? "" : "s"} and ${entityCount} extracted ${entityCount === 1 ? "entity" : "entities"}. I haven't identified a material recovery opportunity yet.`;
      nextStep = "Upload more claim-related documents or add claims directly.";
      primaryCta = {
        label: "Ask Atlas",
        description: "Ask me what I know so far",
        target: "/dashboard/ask",
        icon: "MessageSquareText",
      };
      ctaTarget = "/dashboard/ask";
      if (!hasClaims) {
        secondaryActions.push({
          label: "Add a claim",
          description: "Start tracking a specific insurance claim",
          target: "/dashboard/revenue-recovery",
          icon: "ClipboardList",
        });
      }
      secondaryActions.push({
        label: "Upload more evidence",
        description: "Supplement what I already know",
        target: "/dashboard/knowledge",
        icon: "FileUp",
      });
      break;

    case "opportunity_detected":
      assessment = `I've found ${findingCount} potential recovery ${findingCount === 1 ? "opportunity" : "opportunities"} across ${claimCount} ${claimCount === 1 ? "claim" : "claims"}.`;
      nextStep = "Let me walk you through the most important one.";
      primaryCta = {
        label: "Review opportunities",
        description: "See what I found and why it matters",
        target: "/dashboard/revenue-recovery",
        icon: "TrendingUp",
      };
      ctaTarget = "/dashboard/revenue-recovery";
      secondaryActions.push({
        label: "Ask Atlas why",
        description: "Understand the reasoning behind each opportunity",
        target: "/dashboard/ask",
        icon: "MessageSquareText",
      });
      break;

    case "investigating":
      assessment = `You've been working on ${claimCount} ${claimCount === 1 ? "claim" : "claims"} with ${findingCount} open ${findingCount === 1 ? "finding" : "findings"}.`;
      nextStep = hasRecommendations
        ? `${recommendationCount} ${recommendationCount === 1 ? "recommendation needs" : "recommendations need"} your review.`
        : "Keep going — I'll keep watching.";
      primaryCta = {
        label: "Continue investigating",
        description: "Pick up where you left off",
        target: "/dashboard/revenue-recovery",
        icon: "Radar",
      };
      ctaTarget = "/dashboard/revenue-recovery";
      secondaryActions.push({
        label: "What matters now?",
        description: "See what needs attention",
        target: "/dashboard",
        icon: "Target",
      });
      break;

    default:
      assessment = "Atlas is monitoring your workspace.";
      nextStep = "Ask me anything.";
      primaryCta = {
        label: "Ask Atlas",
        description: "What do you want to know?",
        target: "/dashboard/ask",
        icon: "MessageSquareText",
      };
      ctaTarget = "/dashboard/ask";
  }

  return {
    state,
    hasDocuments,
    hasEntities,
    hasClaims,
    hasOpportunities,
    hasRecommendations,
    hasActivity,
    hasConnections,
    isProcessing,
    documentCount,
    entityCount,
    claimCount,
    findingCount,
    profileComplete,
    primaryCta,
    assessment,
    nextStep,
    ctaTarget,
    secondaryActions,
    recommendedClaim: params.bestClaim,
  };
}

// ---------------------------------------------------------------------------
// Atlas voice guidance for onboarding states
// ---------------------------------------------------------------------------

export function getOnboardingVoiceGuidance(state: AtlasReadinessState): {
  greeting: string;
  helpPrompt: string;
  emptyResponse: string;
} {
  switch (state) {
    case "empty":
      return {
        greeting: "I'm Atlas. I'm ready to help, but I need some information first.",
        helpPrompt: "What do you need from me?",
        emptyResponse: "I don't have enough claim information yet. Upload documents or connect your systems so I can start finding recovery opportunities.",
      };
    case "processing":
      return {
        greeting: "I'm working on understanding your documents right now.",
        helpPrompt: "What would you like to know?",
        emptyResponse: "I'm still reviewing your documents. I'll have insights soon.",
      };
    case "ready_no_opportunities":
      return {
        greeting: "I've reviewed what you have. I don't see a material recovery opportunity yet.",
        helpPrompt: "What should I look at next?",
        emptyResponse: "I haven't found recovery opportunities in the current data. More documents or claims would help.",
      };
    case "opportunity_detected":
      return {
        greeting: "I found something that matters. Let me show you.",
        helpPrompt: "What opportunity should we look at first?",
        emptyResponse: "I've identified potential recovery opportunities. Want me to walk you through them?",
      };
    case "investigating":
      return {
        greeting: "You're mid-investigation. Here's where things stand.",
        helpPrompt: "What do you want to do next?",
        emptyResponse: "Let's keep working on this. What part do you want to focus on?",
      };
    case "activated":
      return {
        greeting: "Atlas is fully operational. What do you need?",
        helpPrompt: "What should I focus on?",
        emptyResponse: "Everything looks good. I'm continuously monitoring for changes.",
      };
  }
}

// ---------------------------------------------------------------------------
// Empty state messages — Atlas voice, not generic SaaS
// ---------------------------------------------------------------------------

export const ATLAS_EMPTY_STATES = {
  claims: {
    title: "No claims yet",
    assessment: "I don't have any claims to review yet.",
    guidance: "Create your first claim or upload claim-related documents and I'll reconstruct them from the evidence.",
    cta: "Add a claim",
  },
  evidence: {
    title: "No supporting evidence",
    assessment: "I don't have supporting evidence for this finding yet.",
    guidance: "Upload the relevant documents — estimates, photos, invoices — and I'll connect them.",
    cta: "Upload evidence",
  },
  opportunities: {
    title: "No opportunities yet",
    assessment: "I haven't identified a material recovery opportunity yet.",
    guidance: "I need more claim data to find gaps. Upload documents or add claims to get started.",
    cta: "Add claims or documents",
  },
  activity: {
    title: "Nothing has happened yet",
    assessment: "No activity recorded.",
    guidance: "Atlas will track everything that happens from here.",
  },
  recommendations: {
    title: "No pending recommendations",
    assessment: "I don't have any recommendations right now.",
    guidance: "Once I find opportunities, I'll present them here with evidence and reasoning.",
  },
  connections: {
    title: "No systems connected",
    assessment: "I'm not connected to any external systems yet.",
    guidance: "Connect the tools your company already uses, or upload files directly.",
  },
  documents: {
    title: "No documents yet",
    assessment: "I don't have anything to read yet.",
    guidance: "Upload your first documents — SOPs, estimates, invoices, photos — and I'll extract the knowledge.",
  },
  knowledgeGraph: {
    title: "No knowledge yet",
    assessment: "I haven't built a knowledge graph yet.",
    guidance: "Upload documents and I'll extract entities, relationships and facts automatically.",
  },
  intelligence: {
    title: "No intelligence yet",
    assessment: "I don't have enough data to generate intelligence.",
    guidance: "Documents, claims, and connections feed the intelligence engine.",
  },
} as const;
