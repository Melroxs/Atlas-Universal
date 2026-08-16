// ---------------------------------------------------------------------------
// Claim discovery + evidence reconstruction — executable layer.
//
// Runs the pure engine (src/lib/insurance/discovery.ts) against the tenant's
// REAL persisted state and executes the decisions through the deployed RPCs:
//
//   HIGH + no matching claim   → persist a claim (approve the pending
//                                candidate when one exists, else
//                                insurance_create_claim) + attach evidence
//   Evidence matches a claim   → enrich (attach evidence, fill ONLY missing
//                                fields — a value the claim already carries
//                                is never overwritten)
//   MEDIUM                     → persist a reviewable candidate
//   LOW                        → keep the evidence, create nothing
//
// Shared by api.insurance.candidates.reconstructClaims and the automatic
// trigger after archive ingestion. Everything is RLS-scoped and idempotent.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import { rpcCall } from "@/lib/actions/rpc";
import * as discovery from "@/lib/insurance/discovery";

export interface ClaimDiscoveryResult {
  ok: boolean;
  created: number;
  enriched: number;
  proposed: number;
  kept: number;
  scanned: number;
  unclustered: number;
  decisions: Array<Record<string, unknown>>;
}

export async function runClaimDiscovery(
  supabase: SupabaseClient,
): Promise<ClaimDiscoveryResult> {
  // 1. Load the tenant's real state (all RLS-scoped).
  const claims = (
    ((await rpcCall(supabase, "insurance_list_claims")) ?? []) as Array<{
      claim?: Record<string, unknown> | null;
    }>
  )
    .map((r) => r?.claim)
    .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === "object"))
    .map((c) => discovery.toDiscoveryClaim(c));
  const candidates = (
    ((await rpcCall(supabase, "insurance_list_claim_candidates")) ?? []) as Array<Record<string, unknown>>
  ).map((c) => discovery.toDiscoveryCandidate(c));
  const rows = ((await rpcCall(supabase, "documents_list_documents")) ?? []) as Array<{
    _id: string;
    title?: string | null;
    summary?: string | null;
    classification?: string | null;
    status?: string | null;
  }>;
  const ready = (rows ?? []).filter((d) => d && d.status === "ready");

  // 2. Load bounded chunk text for claim-relevant documents.
  const scanned: discovery.DiscoveryDoc[] = [];
  for (const d of ready.slice(0, 60)) {
    const doc: discovery.DiscoveryDoc = {
      _id: d._id,
      title: d.title ?? null,
      summary: d.summary ?? null,
      classification: d.classification ?? null,
    };
    if (discovery.isDiscoveryCandidateDoc(doc)) {
      try {
        const detail = (await rpcCall(supabase, "documents_get_document_detail", {
          documentId: d._id,
        })) as { chunks?: Array<{ content?: string }> } | null;
        doc.text = (detail?.chunks ?? [])
          .map((c) => c.content ?? "")
          .join("\n")
          .slice(0, 24_000);
      } catch {
        // A single unreadable document never fails the discovery run.
      }
    }
    scanned.push(doc);
  }

  const report = discovery.discoverClaims(scanned, candidates, claims);
  if (report.decisions.length === 0) {
    return { ok: true, created: 0, enriched: 0, proposed: 0, kept: 0, scanned: scanned.length, unclustered: report.unclustered, decisions: [] };
  }

  // 3. Execute the decisions against the database.
  let created = 0;
  let enriched = 0;
  let proposed = 0;
  let kept = 0;
  const decisionSummary: Array<Record<string, unknown>> = [];
  const pendingByKey = new Map(
    candidates
      .filter((c) => c.status === "pending" && c.claimKey)
      .map((c) => [String(c.claimKey).replace(/[-\s]/g, "").toUpperCase(), c]),
  );

  for (const d of report.decisions) {
    const claimNumber = d.claimNumber?.value ?? null;
    const customer = d.customer?.value ?? null;
    const property = d.property?.value ?? null;
    const carrier = d.carrier?.value ?? null;
    const policy = d.policy?.value ?? null;
    const adjuster = d.adjuster?.value ?? null;
    const dateOfLoss = d.dateOfLoss ? discovery.toEpochMs(d.dateOfLoss.value) : null;
    const causeOfLoss = d.causeOfLoss?.value ?? null;
    const estimateAmount = d.estimateAmount ? discovery.toMoney(d.estimateAmount.value) : null;
    const invoicedAmount = d.invoicedAmount ? discovery.toMoney(d.invoicedAmount.value) : null;
    const paymentAmount = d.paymentAmount ? discovery.toMoney(d.paymentAmount.value) : null;
    const deductible = d.deductible ? discovery.toMoney(d.deductible.value) : null;
    const provenance = `Atlas reconstructed this claim from ${d.evidenceIds.length} evidence source(s): ${d.evidenceTitles
      .slice(0, 6)
      .join("; ")}${d.conflicts.length ? ` Conflicts preserved: ${d.conflicts.map((c) => c.field).join(", ")}.` : ""} Confidence ${d.confidence} (${d.tier}). ${d.identifierConflict ?? ""}`.trim();

    if (d.decision === "keep_evidence") {
      kept++;
      decisionSummary.push({ clusterKey: d.clusterKey, tier: d.tier, decision: d.decision, confidence: d.confidence, summary: d.summary });
      continue;
    }

    if (d.decision === "enrich" && d.targetClaimId) {
      // Fill ONLY fields the claim does not already have. A value the claim
      // already carries is never overwritten; if the evidence disagrees with
      // it, the conflict is preserved for the contradiction engine instead.
      const claim = claims.find((c) => c._id === d.targetClaimId);
      const patch: Record<string, unknown> = {};
      if (claim) {
        if (!claim.carrier && carrier) patch.carrier = carrier;
        if (!claim.policy && policy) patch.policy = policy;
        if (!claim.adjuster && adjuster) patch.adjuster = adjuster;
        if (!claim.dateOfLoss && dateOfLoss) patch.dateOfLoss = dateOfLoss;
        if (!claim.causeOfLoss && causeOfLoss) patch.causeOfLoss = causeOfLoss;
        if (claim.estimateAmount == null && estimateAmount != null) patch.estimateAmount = estimateAmount;
        if (claim.invoicedAmount == null && invoicedAmount != null) patch.invoicedAmount = invoicedAmount;
        if (claim.paymentAmount == null && paymentAmount != null) patch.paymentAmount = paymentAmount;
        if (claim.deductible == null && deductible != null) patch.deductible = deductible;
        if (!claim.customer && customer) patch.customer = customer;
        if (!claim.property && property) patch.property = property;
        patch.provenance = [claim.provenance, provenance].filter(Boolean).join(" ");
      }
      try {
        if (Object.keys(patch).length > 0) {
          await rpcCall(supabase, "insurance_update_claim", {
            claimId: d.targetClaimId,
            patch,
          });
        }
        let attached = 0;
        for (const docId of d.evidenceIds) {
          try {
            await rpcCall(supabase, "insurance_attach_claim_evidence", {
              claimId: d.targetClaimId,
              documentId: docId,
            });
            attached++;
          } catch {
            // A single unreadable link never fails the enrichment.
          }
        }
        enriched++;
        decisionSummary.push({ clusterKey: d.clusterKey, claimId: d.targetClaimId, tier: d.tier, decision: d.decision, confidence: d.confidence, evidenceAttached: attached, summary: d.summary });
      } catch (e) {
        decisionSummary.push({ clusterKey: d.clusterKey, tier: d.tier, decision: d.decision, error: e instanceof Error ? e.message : String(e) });
      }
      continue;
    }

    if (d.decision === "propose") {
      // Reviewable candidate — never a definitive claim.
      try {
        await rpcCall(supabase, "insurance_upsert_candidates", {
          candidates: [
            {
              archiveId: null,
              claimKey: d.clusterKey,
              claimNumber,
              customer,
              property,
              fileCount: Math.max(1, d.evidenceIds.length),
              totalSize: null,
              confidence: d.confidence,
              filePaths: [],
              evidence: d.evidenceTitles,
            },
          ],
        });
        proposed++;
        decisionSummary.push({ clusterKey: d.clusterKey, tier: d.tier, decision: d.decision, confidence: d.confidence, summary: d.summary });
      } catch (e) {
        decisionSummary.push({ clusterKey: d.clusterKey, tier: d.tier, decision: d.decision, error: e instanceof Error ? e.message : String(e) });
      }
      continue;
    }

    // decision === "create" (HIGH confidence, no existing claim).
    try {
      let claimId: string | null = null;
      const pending = d.claimNumber
        ? pendingByKey.get(String(d.claimNumber.value).replace(/[-\s]/g, "").toUpperCase())
        : undefined;
      if (pending?._id) {
        // The pending candidate is the canonical creation path: it creates
        // the claim AND marks the candidate approved, so the same evidence
        // never produces both a candidate and a claim.
        const approved = (await rpcCall(supabase, "insurance_approve_claim_candidate", {
          candidateId: pending._id,
        })) as { claimId?: string } | null;
        claimId = approved?.claimId ?? null;
      }
      if (!claimId) {
        // No pending candidate → route creation through the SAME deduped
        // candidate path instead of a raw insurance_create_claim: the live
        // database dedupes insurance_upsert_candidates on tenantId + claimKey
        // and insurance_approve_claim_candidate rejects a second approval,
        // while two identical insurance_create_claim calls persist TWO rows.
        // Upsert→approve therefore converges concurrent discovery runs
        // (double "Scan & reconstruct", ingestion trigger racing a manual
        // scan) on ONE claim per evidence cluster.
        await rpcCall(supabase, "insurance_upsert_candidates", {
          candidates: [
            {
              archiveId: null,
              claimKey: d.clusterKey,
              claimNumber,
              customer,
              property,
              fileCount: Math.max(1, d.evidenceIds.length),
              totalSize: null,
              confidence: d.confidence,
              filePaths: [],
              evidence: d.evidenceTitles,
            },
          ],
        });
        const candRows = ((await rpcCall(supabase, "insurance_list_claim_candidates")) ??
          []) as Array<{ _id: string; claimKey?: string | null; status?: string }>;
        const normKey = (s: string) => String(s ?? "").replace(/[-\s]/g, "").toUpperCase();
        const canonical = candRows.find(
          (c) => c && normKey(c.claimKey ?? "") === normKey(d.clusterKey),
        );
        if (canonical?._id) {
          try {
            const approved = (await rpcCall(supabase, "insurance_approve_claim_candidate", {
              candidateId: canonical._id,
            })) as { claimId?: string } | null;
            claimId = approved?.claimId ?? null;
          } catch (approveError) {
            // The RPC rejects a second approval: a concurrent run already
            // created the claim for this cluster. Adopt that claim (and
            // attach this run's evidence to it) instead of creating a
            // duplicate — both runs carry the same cluster's evidence.
            const claimsNow = ((await rpcCall(supabase, "insurance_list_claims")) ??
              []) as Array<{ claim?: Record<string, unknown> | null }>;
            const concurrent = claimsNow
              .map((r) => r?.claim)
              .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === "object"))
              .find((c) => {
                if (
                  d.claimNumber &&
                  typeof c.claimNumber === "string" &&
                  normKey(c.claimNumber) === normKey(d.claimNumber.value)
                ) {
                  return true;
                }
                // Claim-number-less clusters: same place + carrier + loss date
                // (the same conservative match the discovery engine uses).
                const n = (s: string) => (s ?? "").replace(/[-\s]/g, "").toUpperCase();
                const samePlace =
                  property &&
                  typeof c.property === "string" &&
                  (n(c.property) === n(property) ||
                    n(c.property).includes(n(property)) ||
                    n(property).includes(n(c.property)));
                const sameCarrier =
                  carrier && typeof c.carrier === "string" && n(c.carrier) === n(carrier);
                const sameDol =
                  dateOfLoss && typeof c.dateOfLoss === "number" && c.dateOfLoss === dateOfLoss;
                return Boolean(samePlace && sameCarrier && sameDol);
              });
            if (concurrent?._id) {
              claimId = String(concurrent._id);
            } else {
              // Not a concurrency collision — surface the real error.
              throw approveError;
            }
          }
        }
      }
      if (!claimId) {
        // Last resort ONLY: no candidate row resolved AND no concurrent claim
        // appeared (e.g. the upsert path itself failed). With upsert→approve
        // as the primary path this is no longer reachable in the normal flow.
        const createdRes = (await rpcCall(supabase, "insurance_create_claim", {
          claimNumber,
          customer,
          property,
          carrier,
          policy,
          adjuster,
          dateOfLoss,
          causeOfLoss,
          status: "opened",
          estimateAmount,
          invoicedAmount,
          paymentAmount,
          deductible,
          provenance,
        })) as { claimId?: string } | null;
        claimId = createdRes?.claimId ?? null;
      }
      if (claimId) {
        // Record the real reconstruction confidence (the RPCs write a fixed
        // default) and link every evidence document.
        try {
          await rpcCall(supabase, "insurance_update_claim", {
            claimId,
            patch: { confidence: d.confidence, provenance },
          });
        } catch {
          // Confidence is best-effort; the claim itself is persisted.
        }
        let attached = 0;
        for (const docId of d.evidenceIds) {
          try {
            await rpcCall(supabase, "insurance_attach_claim_evidence", {
              claimId,
              documentId: docId,
            });
            attached++;
          } catch {
            // A single unreadable link never fails the creation.
          }
        }
        created++;
        decisionSummary.push({ clusterKey: d.clusterKey, claimId, tier: d.tier, decision: d.decision, confidence: d.confidence, evidenceAttached: attached, summary: d.summary });
      } else {
        decisionSummary.push({ clusterKey: d.clusterKey, tier: d.tier, decision: d.decision, error: "claim creation returned no claimId" });
      }
    } catch (e) {
      decisionSummary.push({ clusterKey: d.clusterKey, tier: d.tier, decision: d.decision, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return {
    ok: true,
    created,
    enriched,
    proposed,
    kept,
    scanned: scanned.length,
    unclustered: report.unclustered,
    decisions: decisionSummary,
  };
}
