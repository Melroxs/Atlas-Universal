// ---------------------------------------------------------------------------
// Atlas — Proactive Intelligence Sweep (DB surface)
//
// The continuous monitoring loop: read REAL tenant state (events, workflows,
// approvals, actions, authority, connections) and turn meaningful signals into
// structured decisions + deduped notifications. Everything is derived from
// actual records — no fabricated findings. Non-node module (internal
// queries/mutations only); the public API and cron wrap these.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { decide, stableToken } from "./decision";
import {
  connectorRisk,
  deadlineWithoutProgress,
  repeatedFailures,
  unusuallyLong,
} from "./risk";
import { deadlineStatus } from "../everest/temporalOps";
import { evaluateApplicability } from "../everest/jurisdiction";
import { EVENT_REGISTRY } from "../events/registry";

const AUTHORITY_EVENT_TYPES = new Set(
  EVENT_REGISTRY.filter((e) => e.provider === "atlas_authority").map((e) => e.type),
);

/** Resolve a tenant's business-day context for temporal interpretation. */
async function calendarForTenant(ctx: MutationCtx, tenantId: string) {
  const context = await ctx.db
    .query("organizationContexts")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId as never))
    .first();
  return {
    timezone: context?.primaryTimezone ?? "UTC",
    businessDays: context?.businessDays ?? [1, 2, 3, 4, 5],
    businessHours: context?.businessHours ?? { start: "09:00", end: "17:00" },
    holidays: (context?.holidays as string[] | undefined) ?? [],
    country: context?.country ?? null,
    regions: (context?.regions as string[] | undefined) ?? [],
    cities: (context?.cities as string[] | undefined) ?? [],
    industry: context?.industry ?? null,
  };
}

function fmtTimestamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Run the full proactive sweep for one tenant. Idempotent — decisions and
 *  notifications are deduped, so re-running never double-applies. */
export const sweepTenant = internalMutation({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, { tenantId }) => {
    const now = Date.now();
    const cal = await calendarForTenant(ctx, tenantId);
    const calendarCfg = {
      timezone: cal.timezone,
      businessDays: cal.businessDays,
      businessHours: cal.businessHours,
      holidays: cal.holidays,
    };
    let created = 0;
    let notified = 0;

    const insertDecision = async (input: Parameters<typeof decide>[0]) => {
      const d = decide(input, now);
      const existing = await ctx.db
        .query("decisions")
        .withIndex("by_dedupe", (q) => q.eq("dedupeKey", d.dedupeKey))
        .first();
      if (existing) return false;
      await ctx.db.insert("decisions", {
        ...d,
        tenantId,
        decisionId: d.decisionId,
        dedupeKey: d.dedupeKey,
        recommendation: d.recommendation ?? undefined,
        impact: d.impact ?? undefined,
        riskReason: d.riskReason ?? undefined,
        status: "open",
      });
      created++;
      return true;
    };

    const notify = async (input: {
      severity: "info" | "low" | "medium" | "high" | "critical";
      title: string;
      description?: string;
      dedupeTitle: string;
      actionId?: string;
    }) => {
      // Dedupe within a day — prevents notification spam.
      const recent = await ctx.db
        .query("notifications")
        .withIndex("by_tenant_created", (q) =>
          q.eq("tenantId", tenantId).gte("createdAt", now - 24 * 3600_000),
        )
        .filter((q) => q.eq(q.field("title"), input.dedupeTitle))
        .first();
      if (recent) return;
      await ctx.db.insert("notifications", {
        tenantId,
        recipientId: undefined,
        severity: input.severity,
        title: input.dedupeTitle,
        description: input.description,
        sourceEventId: undefined,
        actionId: input.actionId as never,
        read: false,
        createdAt: now,
      });
      notified++;
    };

    // --- 1. Pending approvals (real records, real deadlines) -------------------
    const pendingApprovals = await ctx.db
      .query("workflowApprovals")
      .withIndex("by_tenant_status", (q) =>
        q.eq("tenantId", tenantId).eq("status", "pending"),
      )
      .collect();

    for (const a of pendingApprovals) {
      const dl = a.expiresAt
        ? deadlineStatus(a.expiresAt, now, calendarCfg, 2)
        : null;
      const overdue = dl?.status === "overdue";
      const dueSoon = dl?.status === "due_soon" || dl?.status === "due_today";
      if (overdue || dueSoon) {
        const subject = `approval:${a.title}`;
        const d = await insertDecision({
          tenantId: String(tenantId),
          type: overdue ? "escalate" : "monitor",
          subject,
          title: overdue ? `Approval overdue: ${a.title}` : `Approval due soon: ${a.title}`,
          summary: `An approval request ${overdue ? "has passed" : "is approaching"} its deadline and is waiting for a decision.`,
          evidence: [
            {
              kind: "approval",
              sourceId: String(a._id),
              title: a.title,
              snippet: `Created ${fmtTimestamp(a.createdAt)}${a.expiresAt ? ` · deadline ${fmtTimestamp(a.expiresAt)}` : ""}`,
              timestamp: a.createdAt,
              evidenceState: "verified",
            },
          ],
          temporalContext: { deadlineAt: a.expiresAt ?? null, now },
          options: [
            { label: "Approve now", description: "Approve the pending request immediately.", risk: "medium" },
            { label: "Request more information", description: "Ask the requester for missing detail.", risk: "low" },
            { label: "Reject", description: "Reject with a documented reason.", risk: "high" },
          ],
        });
        if (d) {
          await notify({
            severity: overdue ? "high" : "medium",
            title: `Approval ${overdue ? "overdue" : "due soon"}: ${a.title}`,
            description: `${dl?.label ?? ""} — review needed.`,
            dedupeTitle: `Approval ${overdue ? "overdue" : "due soon"}: ${a.title}`,
          });
        }
      }
    }

    // --- 2. Failed workflows (real failures) -----------------------------------
    const failedWorkflows = await ctx.db
      .query("workflowInstances")
      .withIndex("by_tenant_status", (q) =>
        q.eq("tenantId", tenantId).eq("status", "failed"),
      )
      .take(50);
    for (const w of failedWorkflows) {
      const subject = `workflow-failure:${w.definitionId}`;
      const d = await insertDecision({
        tenantId: String(tenantId),
        type: "investigate",
        subject,
        title: `Workflow failed: ${w.definitionId}`,
        summary: w.failureReason ?? "A workflow failed during execution.",
        evidence: [
          {
            kind: "workflow",
            sourceId: String(w._id),
            title: w.definitionId,
            snippet: w.failureReason ?? "No failure reason recorded.",
            timestamp: w.updatedAt,
            evidenceState: "verified",
          },
        ],
        context: { instanceId: String(w._id) },
        options: [
          { label: "Retry workflow", description: "Re-run the failed workflow with the same inputs.", risk: "medium" },
          { label: "Inspect logs", description: "Review the failure trail before retrying.", risk: "low" },
        ],
      });
      if (d) {
        await notify({
          severity: "high",
          title: `Workflow failed: ${w.definitionId}`,
          description: w.failureReason ?? "Review and retry.",
          dedupeTitle: `Workflow failed: ${w.definitionId}`,
        });
      }
    }

    // --- 3. Stalled / unusually long workflows ---------------------------------
    const running = await ctx.db
      .query("workflowInstances")
      .withIndex("by_tenant_status", (q) =>
        q.eq("tenantId", tenantId).eq("status", "running"),
      )
      .take(100);
    for (const w of running) {
      const durationH = (now - w.startedAt) / 3600_000;
      const anomaly = unusuallyLong({
        entity: w.definitionId,
        durationHours: durationH,
        expectedHours: 48,
        kind: "workflow",
      });
      if (anomaly) {
        await insertDecision({
          tenantId: String(tenantId),
          type: "monitor",
          subject: `stalled-workflow:${w.definitionId}`,
          title: `Workflow running unusually long: ${w.definitionId}`,
          summary: `${anomaly.baseline} ${anomaly.observed}`,
          evidence: [
            {
              kind: "workflow",
              sourceId: String(w._id),
              title: w.definitionId,
              snippet: `Started ${fmtTimestamp(w.startedAt)} · running ${Math.round(durationH)}h`,
              timestamp: w.startedAt,
              evidenceState: "verified",
            },
          ],
          options: [
            { label: "Keep monitoring", description: "Allow more time before intervention.", risk: "low" },
            { label: "Investigate", description: "Trace the workflow steps for a blocker.", risk: "medium" },
          ],
        });
      }
    }

    // --- 4. Repeated action failures (closed-loop) ------------------------------
    const failedActions = await ctx.db
      .query("toolActions")
      .withIndex("by_tenant_status", (q) =>
        q.eq("tenantId", tenantId).eq("status", "failed"),
      )
      .take(50);
    const failuresByTool = new Map<string, number>();
    for (const act of failedActions) {
      failuresByTool.set(act.toolId, (failuresByTool.get(act.toolId) ?? 0) + 1);
    }
    for (const [toolId, count] of failuresByTool) {
      const anomaly = repeatedFailures({ entity: toolId, count, kind: "action" });
      if (anomaly) {
        await insertDecision({
          tenantId: String(tenantId),
          type: "investigate",
          subject: `action-failures:${toolId}`,
          title: `Repeated action failures: ${toolId}`,
          summary: `${anomaly.baseline} ${anomaly.observed}`,
          evidence: failedActions
            .filter((a) => a.toolId === toolId)
            .slice(0, 3)
            .map((a) => ({
              kind: "action" as const,
              sourceId: String(a._id),
              title: a.toolId,
              snippet: a.error ?? "Action failed.",
              timestamp: a.completedAt ?? a.startedAt ?? now,
              evidenceState: "verified" as const,
            })),
          options: [
            { label: "Retry", description: "Attempt the action again with bounded retries.", risk: "medium" },
            { label: "Inspect", description: "Review the failure trail before retrying.", risk: "low" },
          ],
        });
      }
    }

    // --- 5. Actions awaiting verification (closed-loop) --------------------------
    const pendingVerification = await ctx.db
      .query("toolActions")
      .withIndex("by_tenant_status", (q) =>
        q.eq("tenantId", tenantId).eq("status", "verification_failed"),
      )
      .take(20);
    for (const act of pendingVerification) {
      await insertDecision({
        tenantId: String(tenantId),
        type: "monitor",
        subject: `verification:${act.toolId}:${String(act._id).slice(0, 8)}`,
        title: `Action outcome not verified: ${act.toolId}`,
        summary:
          "Execution finished but the expected state change could not be independently verified.",
        evidence: [
          {
            kind: "action",
            sourceId: String(act._id),
            title: act.toolId,
            snippet: "Verification failed or pending — execution succeeded, outcome not independently verified.",
            timestamp: act.completedAt ?? now,
            evidenceState: "inferred",
          },
        ],
        options: [
          { label: "Re-verify", description: "Re-check the resulting state against expectations.", risk: "low" },
          { label: "Accept outcome", description: "Mark the outcome as accepted by the operator.", risk: "medium" },
        ],
      });
    }

    // --- 6. Authority changes pending review -------------------------------------
    const pendingAssessments = await ctx.db
      .query("impactAssessments")
      .withIndex("by_status", (q) => q.eq("status", "pending_review"))
      .take(50);
    for (const asmt of pendingAssessments) {
      const affected = (asmt.affectedTenantIds ?? []) as string[];
      if (affected.length > 0 && !affected.includes(String(tenantId))) continue;
      await insertDecision({
        tenantId: String(tenantId),
        type: "recommend",
        subject: `authority-review:${asmt.knowledgeId}`,
        title: `Authority change review: ${asmt.knowledgeTitle}`,
        summary: asmt.recommendedAction,
        evidence: [
          {
            kind: "authority",
            sourceId: asmt.sourceId,
            title: asmt.knowledgeTitle,
            snippet: `${asmt.changeType.replace(/_/g, " ")} — ${asmt.recommendedAction}`,
            authorityTier: asmt.authorityTier,
            evidenceState: "verified",
          },
        ],
        authorityContext: {
          sourceId: asmt.sourceId,
          changeType: asmt.changeType,
          severity: asmt.severity,
        },
        options: [
          { label: "Approve review", description: "Accept the impact assessment after review.", risk: "medium" },
          { label: "Request more info", description: "Gather more context before deciding.", risk: "low" },
        ],
      });
      await notify({
        severity: asmt.severity === "high" ? "high" : "medium",
        title: `Authority change needs review: ${asmt.knowledgeTitle}`,
        description: asmt.recommendedAction,
        dedupeTitle: `Authority change needs review: ${asmt.knowledgeTitle}`,
      });
    }

    // --- 7. Connector health (real connection states) -----------------------------
    const connections = await ctx.db
      .query("connections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    for (const conn of connections) {
      const unhealthy = conn.healthStatus === "error" || conn.status !== "connected";
      if (unhealthy) {
        const finding = connectorRisk({
          provider: conn.provider,
          status: conn.status,
          consecutiveFailures: conn.healthStatus === "error" ? 1 : 0,
        });
        await insertDecision({
          tenantId: String(tenantId),
          type: "monitor",
          subject: `connector:${conn.provider}`,
          title: `Connector health: ${conn.provider}`,
          summary: `${finding.observed} ${finding.inferredRisk}`,
          evidence: [
            {
              kind: "connector",
              sourceId: String(conn._id),
              title: conn.provider,
              snippet: conn.healthStatus ?? conn.status,
              timestamp: conn.lastSyncAt ?? now,
              evidenceState: "verified",
            },
          ],
          options: [
            { label: "Re-test connection", description: "Run a live health test.", risk: "low" },
            { label: "Reconnect", description: "Re-authorize the connection.", risk: "medium" },
          ],
        });
        if (conn.healthStatus === "error") {
          await notify({
            severity: "medium",
            title: `Connector needs attention: ${conn.provider}`,
            description: conn.lastError ?? "Connection reported an error.",
            dedupeTitle: `Connector needs attention: ${conn.provider}`,
          });
        }
      }
    }

    // --- 8. Deadline-without-progress (real due items) -----------------------------
    for (const a of pendingApprovals) {
      if (!a.expiresAt) continue;
      const anomaly = deadlineWithoutProgress({
        entity: a.title,
        deadlineAt: a.expiresAt,
        now,
        lastProgressAt: a.decidedAt ?? null,
      });
      if (anomaly) {
        await insertDecision({
          tenantId: String(tenantId),
          type: "escalate",
          subject: `deadline-no-progress:${a.title}`,
          title: `Deadline without progress: ${a.title}`,
          summary: `${anomaly.baseline} ${anomaly.observed}`,
          evidence: [
            {
              kind: "deadline",
              sourceId: String(a._id),
              title: a.title,
              snippet: anomaly.observed,
              timestamp: a.expiresAt,
              evidenceState: "verified",
            },
          ],
          temporalContext: { deadlineAt: a.expiresAt, now },
          options: [
            { label: "Escalate", description: "Notify a manager of the stalled approval.", risk: "medium" },
            { label: "Chase requester", description: "Contact the requester for an update.", risk: "low" },
          ],
        });
      }
    }

    // --- 9. Applicability-aware requirement effective dates -------------------------
    const versions = await ctx.db.query("knowledgeVersions").take(500);
    for (const k of versions) {
      if (k.status !== "active" || !k.effectiveAt) continue;
      if (k.effectiveAt <= now || k.effectiveAt - now > 14 * 86_400_000) continue;
      const applies = evaluateApplicability(
        { jurisdiction: k.jurisdiction, industry: k.industry, effectiveDate: k.effectiveAt },
        {
          country: cal.country ?? undefined,
          state: cal.regions[0] ?? undefined,
          municipality: cal.cities[0] ?? undefined,
          industry: cal.industry ?? undefined,
          asOf: now,
        },
      );
      if (!applies.applicable) continue;
      const subject = `effective:${k.knowledgeId}`;
      const d = await insertDecision({
        tenantId: String(tenantId),
        type: "monitor",
        subject,
        title: `Requirement becomes effective soon: ${k.normalizedFact.slice(0, 60)}`,
        summary: `Becomes effective ${fmtTimestamp(k.effectiveAt)}. Review operational readiness before the effective date.`,
        evidence: [
          {
            kind: "authority",
            sourceId: k.sourceId,
            title: k.normalizedFact.slice(0, 80),
            snippet: `Effective ${fmtTimestamp(k.effectiveAt)} · applies to this workspace's jurisdiction/industry`,
            timestamp: k.effectiveAt,
            evidenceState: "verified",
          },
        ],
        authorityContext: { knowledgeId: k.knowledgeId, effectiveAt: k.effectiveAt },
        temporalContext: { deadlineAt: k.effectiveAt, now },
        options: [
          { label: "Prepare", description: "Plan for the requirement before it takes effect.", risk: "low" },
          { label: "Defer", description: "Review at the next scheduled briefing.", risk: "low" },
        ],
      });
      if (d) {
        await notify({
          severity: "info",
          title: `Requirement effective soon: ${k.normalizedFact.slice(0, 48)}`,
          description: `Becomes effective ${fmtTimestamp(k.effectiveAt)}.`,
          dedupeTitle: `Requirement effective soon: ${k.normalizedFact.slice(0, 48)}`,
        });
      }
    }

    await ctx.db.insert("auditLogs", {
      tenantId,
      actorType: "system",
      actionType: "proactive_sweep",
      targetType: "tenant",
      metadata: { created, notified, at: now },
    });

    return { created, notified };
  },
});

/** Sweep every tenant with an organization context — the cron entry. */
export const sweepAllTenants = internalMutation({
  args: {},
  handler: async (ctx) => {
    const contexts = await ctx.db.query("organizationContexts").collect();
    let totalCreated = 0;
    let totalNotified = 0;
    for (const c of contexts) {
      const res = await ctx.runMutation(internal.ops.sweepDb.sweepTenant, {
        tenantId: c.tenantId,
      });
      totalCreated += res.created;
      totalNotified += res.notified;
    }
    return { tenants: contexts.length, totalCreated, totalNotified };
  },
});
