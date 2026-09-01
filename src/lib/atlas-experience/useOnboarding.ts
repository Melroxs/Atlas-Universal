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
  const claims = useQuery(api.insurance.claims.listClaims, {});
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

    // Find the single best claim to investigate first
    const bestClaim = (() => {
      const list = (claims ?? []) as Array<Record<string, unknown>>;
      if (list.length === 0) return undefined;
      const scored = list.map((c) => {
        const score =
          (c.needsAttention ? 10000 : 0) +
          ((c.openFindings as number) ?? 0) * 100 +
          ((c.outstanding as number) ?? 0);
        return { c, score };
      }).sort((a, b) => b.score - a.score);
      const top = scored[0]?.c;
      if (!top) return undefined;
      const name = (top.customer as string) ?? (top.property as string) ?? (top.claimNumber as string) ?? `Claim ${String(top._id).slice(0, 6)}`;
      const reasons: string[] = [];
      if (top.needsAttention) reasons.push("needs attention");
      const openFindings = (top.openFindings as number) ?? 0;
      if (openFindings > 0) reasons.push(`${openFindings} open finding${openFindings === 1 ? "" : "s"}`);
      const outstanding = (top.outstanding as number) ?? 0;
      if (outstanding > 0) reasons.push(`$${outstanding.toLocaleString()} outstanding`);
      const reason = reasons.length > 0 ? reasons.join(" · ") : "most active claim";
      return { id: String(top._id), name, reason };
    })();

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
      bestClaim,
    });
  }, [
    health,
    docStats,
    entityStats,
    claimCounts,
    claims,
    recCounts,
    workspace,
    audit,
    catalog,
  ]);
}
