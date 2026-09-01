/**
 * Voice Context Provider
 *
 * Bridges AtlasContext (entity, route) into voice components.
 * This wrapper ensures every page automatically provides context to voice
 * without manual prop drilling.
 *
 * Mount this above your page components to enable voice awareness of
 * what the user is currently viewing.
 */

import { useAtlasContext } from "@/lib/atlas-experience/context";
import { useLocation } from "react-router";
import type { ReactNode } from "react";

/**
 * Infer a serializable page context from the current route and entity.
 * This context is passed to voice components so they know what the user
 * is currently looking at.
 */
export interface VoicePageContext {
  /** Current route path */
  route: string;
  /** Current entity type (if any) */
  entityType?: string;
  /** Current entity ID (if any) */
  entityId?: string;
  /** Current entity name (if any) */
  entityName?: string;
  /** Whether the user is viewing an entity detail */
  isEntityFocused?: boolean;
}

/**
 * Hook to get the current page context for voice.
 *
 * @example
 * const pageContext = useVoicePageContext();
 * // → { route: "/dashboard/revenue-recovery/claim-123", entityType: "claim", ... }
 */
export function useVoicePageContext(): VoicePageContext {
  const location = useLocation();
  const { entity, isEntityFocused } = useAtlasContext();

  return {
    route: location.pathname,
    entityType: entity?.type,
    entityId: entity?.id,
    entityName: entity?.name,
    isEntityFocused,
  };
}

/**
 * Serialize page context for passing to voice components as a string.
 * Used by voice intents and actions to understand the current scope.
 */
export function serializeVoicePageContext(ctx: VoicePageContext): string {
  return JSON.stringify(ctx);
}

/**
 * Deserialize page context from a string.
 */
export function deserializeVoicePageContext(serialized: string): VoicePageContext | null {
  try {
    return JSON.parse(serialized) as VoicePageContext;
  } catch {
    return null;
  }
}

/**
 * Wrapper component that provides voice context awareness to its children.
 * Typically used to wrap page routes.
 */
export function VoiceContextAware({ children }: { children: ReactNode }) {
  // This component is mainly a marker for future enhancements.
  // The actual context propagation happens via useVoicePageContext()
  // in voice-aware components.
  return <>{children}</>;
}

// Export types for use in voice components
export type { VoicePageContext };
