// ---------------------------------------------------------------------------
// useOnboarding — derives Atlas onboarding/activation state from real data
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { useQuery } from "@/hooks/use-supabase";
import { api } from "@/lib/api";
import { useAtlasContext } from "@/lib/atlas-experience/context";
import {
  deriveOnboardingState,
  type OnboardingSnapshot,
} from "@/lib/atlas-experience/onboarding";

/**
 * Derives the current onboarding/activation state from real system data.
 * Returns a snapshot that components can use to show honest, contextual
 * empty states and guidance — never fake progress.
 */
export function useOnboarding(): OnboardingSnapshot {
  const { health } = useAtlasContext();

  const docStats = useQuery(api.documents.documentStats);
  const entityStats = useQuery(api.knowledge.entityStats);
  const claimCounts = useQuery(api.insurance.claims.claimCounts);
  const recCounts = useQuery(api.recommendations.recommendationCounts);
  const workspace = useQuery(api.tenants.getMyWorkspace);
  const audit = useQuery(api.audit.listAuditLogs, { limit: 20 });
  const catalog = useQuery(api.connections.listConnectorCatalog);

  return useMemo(() => {
    const documentCount = docStats?.total ?? 0;
    const entityCount = entityStats?.entities ?? 0;
    const claimCount = claimCounts?.openClaims ?? 0;
    const findingCount = claimCounts?.openFindings ?? 0;
    const recommendationCount = recCounts?.open ?? 0;

    const hasActivity = (audit ?? []).length > 0;

    const connectedCount = (catalog ?? []).filter((e) =>
      ["connected", "healthy", "degraded", "syncing"].includes(
        e.displayStatus,
      ),
    ).length;
    const hasConnections = connectedCount > 0;

    const isProcessing = (docStats?.processing ?? 0) > 0;
    const profileComplete =
      workspace?.profile?.onboardingComplete ?? false;

    return deriveOnboardingState({
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
    });
  }, [
    health,
    docStats,
    entityStats,
    claimCounts,
    recCounts,
    workspace,
    audit,
    catalog,
  ]);
}
