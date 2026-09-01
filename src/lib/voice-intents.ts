/**
 * Voice Intent Router
 *
 * Maps voice commands to application actions.
 * The router recognizes intents from the conversation engine and routes them to:
 * - Navigation (e.g., "show claims")
 * - Entity context (e.g., "open this claim")
 * - Business actions (handled by action executor, see voice-actions.ts)
 *
 * IMPORTANT: This router ONLY handles navigation and context.
 * Business logic (create supplement, update status, etc.) routes through
 * the existing action executor to preserve authorization and realtime behavior.
 */

import { useNavigate } from "react-router";
import type { AtlasEntity, AtlasEntityType } from "@/lib/atlas-experience/context";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VoiceIntentContext {
  /** Current entity being viewed (if any) */
  currentEntity: AtlasEntity | null;
  /** Current route path */
  pathname: string;
  /** Navigation function */
  navigate: (path: string) => void;
}

export interface VoiceIntentResult {
  /** Whether the intent was handled */
  handled: boolean;
  /** If navigation occurred, the target path */
  redirectPath?: string;
  /** Human-readable message about the action */
  message?: string;
  /** Whether Atlas should speak a confirmation */
  shouldSpeak?: boolean;
}

// ---------------------------------------------------------------------------
// Navigation Patterns
// ---------------------------------------------------------------------------

const CLAIMS_PATTERN = /claims|revenue\s+recovery|supplements?/i;
const WORKFLOWS_PATTERN = /workflows?|work|tasks?|pending|assignments?/i;
const KNOWLEDGE_PATTERN = /knowledge|documents?|evidence|entities?|facts?/i;
const INTELLIGENCE_PATTERN = /intelligence|insights?|signals?|recommendations?/i;
const SETTINGS_PATTERN = /settings?|config|preferences/i;
const TEAM_PATTERN = /team|members?|users?|people/i;

// ---------------------------------------------------------------------------
// Navigation Intent Handlers
// ---------------------------------------------------------------------------

function handleNavigationIntent(
  transcript: string,
  context: VoiceIntentContext
): VoiceIntentResult | null {
  const lower = transcript.toLowerCase();

  // Navigation: Claims / Revenue Recovery
  if (CLAIMS_PATTERN.test(lower)) {
    if (context.pathname !== "/dashboard/revenue-recovery") {
      context.navigate("/dashboard/revenue-recovery");
      return {
        handled: true,
        redirectPath: "/dashboard/revenue-recovery",
        message: "Opening claims",
        shouldSpeak: false, // Conversational engine will speak
      };
    }
    return { handled: true, message: "Already viewing claims", shouldSpeak: false };
  }

  // Navigation: Workflows
  if (WORKFLOWS_PATTERN.test(lower)) {
    if (context.pathname !== "/dashboard/workflows") {
      context.navigate("/dashboard/workflows");
      return {
        handled: true,
        redirectPath: "/dashboard/workflows",
        message: "Opening workflows",
        shouldSpeak: false,
      };
    }
    return { handled: true, message: "Already viewing workflows", shouldSpeak: false };
  }

  // Navigation: Knowledge / Documents
  if (KNOWLEDGE_PATTERN.test(lower)) {
    if (context.pathname !== "/dashboard/knowledge") {
      context.navigate("/dashboard/knowledge");
      return {
        handled: true,
        redirectPath: "/dashboard/knowledge",
        message: "Opening knowledge base",
        shouldSpeak: false,
      };
    }
    return { handled: true, message: "Already viewing knowledge base", shouldSpeak: false };
  }

  // Navigation: Intelligence / Recommendations
  if (INTELLIGENCE_PATTERN.test(lower)) {
    if (context.pathname !== "/dashboard/intelligence") {
      context.navigate("/dashboard/intelligence");
      return {
        handled: true,
        redirectPath: "/dashboard/intelligence",
        message: "Opening intelligence",
        shouldSpeak: false,
      };
    }
    return { handled: true, message: "Already viewing intelligence", shouldSpeak: false };
  }

  // Navigation: Settings
  if (SETTINGS_PATTERN.test(lower)) {
    if (context.pathname !== "/dashboard/settings") {
      context.navigate("/dashboard/settings");
      return {
        handled: true,
        redirectPath: "/dashboard/settings",
        message: "Opening settings",
        shouldSpeak: false,
      };
    }
    return { handled: true, message: "Already viewing settings", shouldSpeak: false };
  }

  // Navigation: Team
  if (TEAM_PATTERN.test(lower)) {
    if (context.pathname !== "/dashboard/team") {
      context.navigate("/dashboard/team");
      return {
        handled: true,
        redirectPath: "/dashboard/team",
        message: "Opening team",
        shouldSpeak: false,
      };
    }
    return { handled: true, message: "Already viewing team", shouldSpeak: false };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Entity Context Handlers
// ---------------------------------------------------------------------------

function handleEntityIntent(
  transcript: string,
  context: VoiceIntentContext
): VoiceIntentResult | null {
  const lower = transcript.toLowerCase();

  // "Open this claim" / "Show this claim" when viewing a claim
  if (/open|show|view/.test(lower) && /this|the current/.test(lower)) {
    if (!context.currentEntity || context.currentEntity.type === "workspace") {
      return {
        handled: true,
        message: "No entity is currently in focus",
        shouldSpeak: true,
      };
    }

    const detailPath = buildEntityPath(context.currentEntity);
    if (detailPath && detailPath !== context.pathname) {
      context.navigate(detailPath);
      return {
        handled: true,
        redirectPath: detailPath,
        message: `Opening ${context.currentEntity.type}`,
        shouldSpeak: false,
      };
    }
    return { handled: true, message: "Already viewing this entity", shouldSpeak: false };
  }

  // "What is blocking this claim?" — query current entity
  if (/blocking|blocking|waiting|pending|stalled/i.test(lower)) {
    if (!context.currentEntity) {
      return { handled: false };
    }
    // The backend will use entity context to scope the answer
    return { handled: false }; // Let conversational engine handle this
  }

  return null;
}

// ---------------------------------------------------------------------------
// Entity Path Builder
// ---------------------------------------------------------------------------

function buildEntityPath(entity: AtlasEntity): string | null {
  switch (entity.type) {
    case "claim":
      return `/dashboard/revenue-recovery/${entity.id}`;
    case "workflow":
      return `/dashboard/workflows/${entity.id}`;
    case "knowledge":
      return `/dashboard/knowledge/${entity.id}`;
    case "document":
      return `/dashboard/knowledge/${entity.id}`;
    case "archive":
      return `/dashboard/knowledge/archives/${entity.id}`;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Main Intent Handler
// ---------------------------------------------------------------------------

/**
 * Route a voice command transcript to the appropriate handler.
 *
 * @param transcript The user's spoken input
 * @param intent The intent classification from the conversation engine (optional)
 * @param context Current application context
 * @returns Result indicating whether the intent was handled and what action was taken
 */
export async function handleVoiceIntent(
  transcript: string,
  intent: string | undefined,
  context: VoiceIntentContext
): Promise<VoiceIntentResult> {
  // Try navigation intents first
  const navResult = handleNavigationIntent(transcript, context);
  if (navResult?.handled) {
    return navResult;
  }

  // Try entity-specific intents
  const entityResult = handleEntityIntent(transcript, context);
  if (entityResult?.handled) {
    return entityResult;
  }

  // If no navigation intent matched, let the conversational engine handle it
  // (queries, summaries, entity-specific questions, etc.)
  return { handled: false };
}

// ---------------------------------------------------------------------------
// Export for use in components
// ---------------------------------------------------------------------------

export type { VoiceIntentContext, VoiceIntentResult };
