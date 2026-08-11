/**
 * Phase 14 — claim reconstruction: potential claims from company data.
 *
 * Atlas discovers POTENTIAL claims from deterministic identifiers in imported
 * documents and archive files. Candidates are never converted into
 * authoritative claims automatically: an authorized user approves, and
 * approval links the supporting evidence, appends timeline events and audits
 * the decision. Every candidate is tenant-scoped.
 */
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "../_generated/api";
import { action, internalMutation, mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { isEditor, requireTenant, requireUser } from "../helpers";
import {
  buildCandidateFromArchive,
  candidateKey,
  clusterDocumentsByClaimNumber,
  extractClaimNumber,
} from "./reconstruct";

const DOC_SCAN_LIMIT = 400;
const CLAIM_ISH =
  /estimate|invoice|claim|insurance|report|correspondence|supplement|policy|contract|payment|scope/i;

// ---------------------------------------------------------------------------
// Internal upsert (idempotent — shared by the document scan and the archive)
// ---------------------------------------------------------------------------

const CANDIDATE_INPUT = {
  tenantId: v.id("tenants"),
  claimKey: v.string(),
  claimNumber: v.optional(v.string()),
  customer: v.optional(v.string()),
  property: v.optional(v.string()),
  carrier: v.optional(v.string()),
  adjuster: v.optional(v.string()),
  dateOfLoss: v.optional(v.number()),
  causeOfLoss: v.optional(v.string()),
  evidence: v.array(v.string()),
  documentIds: v.array(v.id("documents")),
  archivePaths: v.optional(v.array(v.string())),
  archiveId: v.optional(v.id("archiveIngestions")),
  estimatedValue: v.optional(v.number()),
  billedValue: v.optional(v.number()),
  paidValue: v.optional(v.number()),
  potentialOutstanding: v.optional(v.number()),
  confidence: v.number(),
  basis: v.string(),
  provenance: v.string(),
  createdBy: v.optional(v.id("users")),
};

export const upsertCandidateInternal = internalMutation({
  args: CANDIDATE_INPUT,
  handler: async (ctx, args) => {
    const key = candidateKey(String(args.tenantId), args.claimKey);
    const existing = await ctx.db
      .query("claimCandidates")
      .withIndex("by_claim_key", (q) => q.eq("claimKey", key))
      .first();
    const now = Date.now();
    if (!existing) {
      return await ctx.db.insert("claimCandidates", {
        ...args,
        claimKey: key,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
    }
    // Approved/rejected candidates are final — a later scan never resurrects them.
    if (existing.status !== "pending") return existing._id;
    const merged = {
      claimNumber: existing.claimNumber ?? args.claimNumber,
      customer: existing.customer ?? args.customer,
      property: existing.property ?? args.property,
      carrier: existing.carrier ?? args.carrier,
      adjuster: existing.adjuster ?? args.adjuster,
      dateOfLoss: existing.dateOfLoss ?? args.dateOfLoss,
      causeOfLoss: existing.causeOfLoss ?? args.causeOfLoss,
      evidence: [...new Set([...(existing.evidence ?? []), ...args.evidence])],
      documentIds: [
        ...new Set([...(existing.documentIds ?? []), ...args.documentIds]),
      ],
      archivePaths: [
        ...new Set([
          ...(existing.archivePaths ?? []),
          ...(args.archivePaths ?? []),
        ]),
      ],
      archiveId: existing.archiveId ?? args.archiveId,
      estimatedValue: existing.estimatedValue ?? args.estimatedValue,
      billedValue: existing.billedValue ?? args.billedValue,
      paidValue: existing.paidValue ?? args.paidValue,
      potentialOutstanding:
        existing.potentialOutstanding ?? args.potentialOutstanding,
      confidence: Math.max(existing.confidence ?? 0, args.confidence),
      basis: args.basis ?? existing.basis,
      provenance: args.provenance ?? existing.provenance,
      updatedAt: now,
    };
    await ctx.db.patch(existing._id, merged);
    return existing._id;
  },
});

/**
 * Create candidates from an archive's derived claim hints (called by the
 * archive completion job). Also links the actual ingested documents whose
 * archive paths match the hint's sample paths, so approval carries evidence.
 */
export const createCandidatesFromArchive = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    archiveId: v.id("archiveIngestions"),
    filename: v.string(),
    potentialClaims: v.array(
      v.object({
        claimNumber: v.string(),
        fileCount: v.number(),
        confidence: v.number(),
        samplePaths: v.array(v.string()),
      }),
    ),
    ingestedByPath: v.optional(v.array(v.object({ path: v.string(), documentId: v.id("documents") }))),
    createdBy: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const byPath = new Map(
      (args.ingestedByPath ?? []).map((p) => [p.path, p.documentId]),
    );
    let created = 0;
    for (const hint of args.potentialClaims) {
      const candidate = buildCandidateFromArchive(hint);
      const documentIds = candidate.archivePaths
        .map((p) => byPath.get(p))
        .filter((d): d is Id<"documents"> => Boolean(d));
      await ctx.runMutation(internal.insurance.candidates.upsertCandidateInternal, {
        tenantId: args.tenantId,
        claimKey: candidate.claimKey,
        claimNumber: candidate.claimNumber,
        customer: candidate.customer,
        evidence: candidate.evidence,
        documentIds,
        archivePaths: candidate.archivePaths,
        archiveId: args.archiveId,
        confidence: candidate.confidence,
        basis: candidate.basis,
        provenance: `Imported from archive “${args.filename}” (checksum-derived claim hints). Requires human approval before Atlas treats this as a claim.`,
        createdBy: args.createdBy,
      });
      created++;
    }
    return { candidates: created };
  },
});

// ---------------------------------------------------------------------------
// Document scan (the general reconstruction entry point)
// ---------------------------------------------------------------------------

export const reconstructClaims = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("You must be signed in.");
    const membership = await ctx.runQuery(internal.internal.getMembershipByUser, {
      userId,
    });
    if (!membership) throw new Error("You don't belong to a workspace yet.");
    const tenantId = membership.tenantId as Id<"tenants">;

    const docs = (await ctx.runQuery(internal.internal.listDocsByTenant, {
      tenantId,
    })) as Array<{
      _id: Id<"documents">;
      title: string;
      classification?: string;
    }>;

    const scanned: Array<{
      _id: Id<"documents">;
      title: string;
      content?: string;
    }> = [];
    for (const doc of docs.slice(0, DOC_SCAN_LIMIT)) {
      const hasTitleNumber = extractClaimNumber(doc.title) !== null;
      // Only pull content when the title has no number AND the doc plausibly
      // relates to claims — bounds the scan cost.
      let content: string | undefined;
      if (!hasTitleNumber && CLAIM_ISH.test(`${doc.title} ${doc.classification ?? ""}`)) {
        const chunks = (await ctx.runQuery(internal.internal.listChunksByDocument, {
          documentId: doc._id,
        })) as Array<{ content: string }> | null;
        content = chunks?.[0]?.content?.slice(0, 400) ?? undefined;
      }
      scanned.push({ _id: doc._id, title: doc.title, content });
    }

    const clusters = clusterDocumentsByClaimNumber(scanned);
    for (const c of clusters) {
      await ctx.runMutation(internal.insurance.candidates.upsertCandidateInternal, {
        tenantId,
        claimKey: c.claimKey,
        claimNumber: c.claimNumber,
        customer: c.customer,
        evidence: c.evidence,
        documentIds: c.documentIds as Id<"documents">[],
        confidence: c.confidence,
        basis: c.basis,
        provenance: `Discovered by scanning ${scanned.length} knowledge-base document${scanned.length === 1 ? "" : "s"} for claim identifiers. Requires human approval before Atlas treats this as a claim.`,
        createdBy: userId,
      });
    }
    return { scanned: scanned.length, candidates: clusters.length };
  },
});

// ---------------------------------------------------------------------------
// Review queries
// ---------------------------------------------------------------------------

export const listClaimCandidates = query({
  args: { status: v.optional(v.string()) },
  handler: async (ctx, { status }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const candidates = await ctx.db
      .query("claimCandidates")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(100);
    const filtered = status ? candidates.filter((c) => c.status === status) : candidates;
    // Resolve linked documents (bounded) for display.
    return Promise.all(
      filtered.map(async (c) => {
        const docTitles: string[] = [];
        for (const id of (c.documentIds ?? []).slice(0, 5)) {
          const doc = await ctx.db.get(id);
          if (doc && doc.tenantId === tenantId) docTitles.push(doc.title);
        }
        return { ...c, documentTitles: docTitles };
      }),
    );
  },
});

export const claimCandidateCounts = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const candidates = await ctx.db
      .query("claimCandidates")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const pending = candidates.filter((c) => c.status === "pending");
    return {
      pending: pending.length,
      approved: candidates.filter((c) => c.status === "approved").length,
      rejected: candidates.filter((c) => c.status === "rejected").length,
      total: candidates.length,
      potentialValue: pending.reduce((s, c) => s + (c.potentialOutstanding ?? 0), 0),
      evidenceFiles: pending.reduce((s, c) => s + c.evidence.length + c.documentIds.length, 0),
    };
  },
});

// ---------------------------------------------------------------------------
// Approval / rejection — always human, always audited
// ---------------------------------------------------------------------------

function normalizeClaimNumber(n?: string | null): string | null {
  if (!n) return null;
  return n.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export const approveClaimCandidate = mutation({
  args: { candidateId: v.id("claimCandidates") },
  handler: async (ctx, { candidateId }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    if (!(await isEditor(ctx, userId, tenantId))) {
      throw new Error("Only editors and above can approve potential claims.");
    }
    const candidate = await ctx.db.get(candidateId);
    if (!candidate || candidate.tenantId !== tenantId) {
      throw new Error("Candidate not found.");
    }
    if (candidate.status === "approved") {
      return { claimId: candidate.approvedClaimId, created: false };
    }

    const now = Date.now();
    const normalized = normalizeClaimNumber(candidate.claimNumber ?? candidate.claimKey);

    // Validate evidence documents (tenant-scoped) before linking.
    const evidenceDocIds: Id<"documents">[] = [];
    const evidenceCategories: string[] = [];
    for (const id of candidate.documentIds ?? []) {
      const doc = await ctx.db.get(id);
      if (!doc || doc.tenantId !== tenantId) continue;
      evidenceDocIds.push(id);
      const cls = (doc.classification ?? "").toLowerCase();
      if (/estimate|scope/.test(cls)) evidenceCategories.push("estimate");
      else if (/invoice|financial/.test(cls)) evidenceCategories.push("invoice");
      else if (/photo|image/.test(cls)) evidenceCategories.push("photos");
      else if (/report|correspondence|email|policy|contract|supplement/.test(cls))
        evidenceCategories.push("documentation");
    }

    // Dedupe against an existing authoritative claim with the same number.
    const existingClaims = await ctx.db
      .query("insuranceClaims")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const match = normalized
      ? existingClaims.find((c) => normalizeClaimNumber(c.claimNumber) === normalized)
      : undefined;

    let claimId: Id<"insuranceClaims">;
    let created = false;
    if (match) {
      claimId = match._id;
      // Merge evidence into the existing claim (never duplicated).
      const merged = [
        ...new Set([...(match.evidenceDocumentIds ?? []), ...evidenceDocIds]),
      ];
      await ctx.db.patch(claimId, {
        evidenceDocumentIds: merged,
        evidenceSummary: [
          ...new Set([...(match.evidenceSummary ?? []), ...evidenceCategories]),
        ],
        updatedAt: now,
      });
    } else {
      created = true;
      claimId = await ctx.db.insert("insuranceClaims", {
        tenantId,
        claimNumber: candidate.claimNumber ?? candidate.claimKey,
        customer: candidate.customer,
        property: candidate.property,
        carrier: candidate.carrier,
        adjuster: candidate.adjuster,
        dateOfLoss: candidate.dateOfLoss,
        causeOfLoss: candidate.causeOfLoss,
        status: "opened",
        currentStage: "Opened",
        estimateAmount: undefined,
        estimateLineItemCount: undefined,
        invoicedAmount: undefined,
        paymentAmount: undefined,
        approvedAmount: undefined,
        collectedAmount: undefined,
        openBalance: undefined,
        deductible: undefined,
        policyLimits: undefined,
        scopeItems: undefined,
        expectedScope: undefined,
        actualScope: undefined,
        evidenceSummary: [...new Set(evidenceCategories)],
        evidenceDocumentIds: evidenceDocIds,
        timeline: [
          {
            ts: candidate.createdAt,
            kind: "claim_identified",
            label: "Claim identified from company data",
            detail: candidate.basis.slice(0, 300),
            source: "atlas",
          },
          {
            ts: now,
            kind: "claim_approved",
            label: "Potential claim approved",
            detail: `Approved by a workspace member; ${candidate.documentIds.length} document${candidate.documentIds.length === 1 ? "" : "s"} and ${candidate.archivePaths?.length ?? 0} archive file${(candidate.archivePaths?.length ?? 0) === 1 ? "" : "s"} linked as evidence.`,
            source: "atlas",
          },
        ],
        provenance: candidate.basis,
        confidence: Math.min(0.9, candidate.confidence),
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.patch(candidateId, {
      status: "approved",
      approvedClaimId: claimId,
      updatedAt: now,
    });
    await ctx.db.insert("auditLogs", {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: created ? "candidate_approved_claim_created" : "candidate_approved_claim_linked",
      targetType: "claimCandidates",
      targetId: String(candidateId),
      metadata: {
        claimId: String(claimId),
        claimNumber: candidate.claimNumber,
        evidenceDocs: evidenceDocIds.length,
        archivePaths: candidate.archivePaths?.length ?? 0,
        created,
      },
    });
    return { claimId, created };
  },
});

export const rejectClaimCandidate = mutation({
  args: { candidateId: v.id("claimCandidates") },
  handler: async (ctx, { candidateId }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    if (!(await isEditor(ctx, userId, tenantId))) {
      throw new Error("Only editors and above can reject potential claims.");
    }
    const candidate = await ctx.db.get(candidateId);
    if (!candidate || candidate.tenantId !== tenantId) {
      throw new Error("Candidate not found.");
    }
    await ctx.db.patch(candidateId, { status: "rejected", updatedAt: Date.now() });
    await ctx.db.insert("auditLogs", {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: "candidate_rejected",
      targetType: "claimCandidates",
      targetId: String(candidateId),
      metadata: { claimNumber: candidate.claimNumber },
    });
    return { candidateId, status: "rejected" };
  },
});

/** Best-effort helper for the conversation brain (tenant-scoped summary). */
export const candidateSummary = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const candidates = await ctx.db
      .query("claimCandidates")
      .withIndex("by_tenant_status", (q) =>
        q.eq("tenantId", tenantId).eq("status", "pending"),
      )
      .take(50);
    return candidates.map((c) => ({
      claimNumber: c.claimNumber ?? c.claimKey,
      customer: c.customer,
      property: c.property,
      evidenceFiles: c.evidence.length + c.documentIds.length,
      confidence: c.confidence,
      createdAt: c.createdAt,
      basis: c.basis,
    }));
  },
});
