// ---------------------------------------------------------------------------
// Tests for the Claim Discovery + Evidence Reconstruction Engine
// (src/lib/insurance/discovery.ts — canonical, pure).
//
// The FINAL VALIDATION PASS: prove Atlas can take a messy collection of
// ingested company information and independently discover, reconstruct,
// create, and continuously maintain the actual business claim represented by
// that evidence — even when there is no clean pre-existing claim record and
// even when a claim number is missing or unreliable.
//
// Behaviors pinned here:
//   • claim-number independence (policy, then property+carrier+loss date)
//   • create (HIGH) / propose (MEDIUM) / keep_evidence (LOW) decisions
//   • existing-claim enrichment without duplication
//   • conflicting identifiers on one property → separate review clusters
//   • loss dates partition same-property clusters
//   • candidate-only clusters are never dropped to keep_evidence
//   • deterministic, order-independent output with transparent reasons
//   • row → engine mappers never throw on null/missing fields
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  clusterEvidence,
  decideClusters,
  discoverClaims,
  extractClaimSignals,
  matchExistingClaim,
  scoreCluster,
  toDiscoveryCandidate,
  toDiscoveryClaim,
  toEpochMs,
  toMoney,
  type DiscoveryClaim,
  type DiscoveryDoc,
} from "./discovery";
import { extractClaimNumber } from "./reconstruct";

function doc(partial: Partial<DiscoveryDoc> & { _id: string }): DiscoveryDoc {
  return { title: null, classification: null, summary: null, text: null, ...partial };
}

// ---------------------------------------------------------------------------
// extractClaimSignals — deterministic signal extraction
// ---------------------------------------------------------------------------

describe("extractClaimSignals — deterministic signal extraction", () => {
  it("extracts a claim number from the title (stronger than text)", () => {
    const s = extractClaimSignals(
      doc({
        _id: "d1",
        title: "GAP-26-51847_FNOL.pdf",
        text: "A completely different number in the body 12345",
      }),
    );
    expect(s.claimNumber).toBe("GAP-26-51847");
  });

  it("never treats a bare long number as a claim number — ZIP codes, policy tails and years stay out", () => {
    expect(extractClaimSignals(doc({ _id: "d1", text: "Lakeland FL 33813" })).claimNumber).toBeNull();
    expect(extractClaimSignals(doc({ _id: "d2", text: "Policy number POL-884213" })).claimNumber).toBeNull();
    expect(extractClaimSignals(doc({ _id: "d3", text: "Policy GAP-HO-884217" })).claimNumber).toBeNull();
    expect(extractClaimSignals(doc({ _id: "d4", text: "Fiscal year 2026 budget" })).claimNumber).toBeNull();
    // A number that directly follows a claim indicator IS one.
    expect(extractClaimSignals(doc({ _id: "d5", text: "Claim No. 51847" })).claimNumber).toBe("51847");
  });

  it("falls back to the full text when the title carries no claim number", () => {
    const s = extractClaimSignals(
      doc({ _id: "d1", title: "First notice of loss.pdf", text: "Claim number: CL-2019-48211" }),
    );
    expect(s.claimNumber).toBe("CL-2019-48211");
  });

  it("extracts policy, property, carrier, loss date and cause together", () => {
    const s = extractClaimSignals(
      doc({
        _id: "d1",
        title: "Claim GAP-26-51847 estimate.pdf",
        classification: "Estimate",
        text: [
          "Policy number: POL-884213",
          "Property: 1427 Cypress Ridge Drive, Lakeland FL 33813",
          "State Farm",
          "Date of loss: 2026-07-14",
          "Cause of loss: wind and hail",
        ].join(". "),
      }),
    );
    expect(s.claimNumber).toBe("GAP-26-51847");
    expect(s.policy).toBe("POL-884213");
    expect(s.property).toContain("1427 Cypress Ridge Drive");
    expect(s.carrier).toMatch(/state farm/i);
    expect(s.dateOfLoss).toBe("2026-07-14");
    expect(s.causeOfLoss).toBe("wind and hail");
    expect(s.docType).toBe("estimate");
  });

  it("never reads a bare date as a loss date without loss context", () => {
    const s = extractClaimSignals(
      doc({ _id: "d1", classification: "Invoice", text: "Invoice date July 14, 2026. Invoice total: $28,400.00." }),
    );
    expect(s.dateOfLoss).toBeNull();
    expect(s.invoicedAmount).toBe(28400);
  });

  it("extracts the financial amounts", () => {
    const s = extractClaimSignals(
      doc({
        _id: "d1",
        classification: "Estimate",
        text: "Total estimate: $24,500. Deductible: $2,500.",
      }),
    );
    expect(s.estimateAmount).toBe(24500);
    expect(s.deductible).toBe(2500);
  });
});

// ---------------------------------------------------------------------------
// clusterEvidence — claim-number independence
// ---------------------------------------------------------------------------

describe("clusterEvidence — claim-number independence", () => {
  it("clusters documents by claim number when one exists", () => {
    const { clusters, unclustered } = clusterEvidence([
      doc({ _id: "d1", title: "GAP-26-51847_FNOL.pdf" }),
      doc({ _id: "d2", title: "GAP-26-51847_Estimate.pdf" }),
      doc({ _id: "d3", title: "unrelated receipt.pdf" }),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.docs.map((d) => d._id)).toEqual(["d1", "d2"]);
    expect(unclustered).toBe(1);
  });

  it("clusters by policy when no document contains a claim number", () => {
    const { clusters } = clusterEvidence([
      doc({ _id: "d1", classification: "Estimate", text: "Policy number POL-884213. Estimate total $24,500." }),
      doc({ _id: "d2", classification: "Invoice", text: "Invoice total $28,400. Policy POL-884213." }),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.key).toMatch(/^POL:/);
    expect(clusters[0]?.docs.map((d) => d._id).sort()).toEqual(["d1", "d2"]);
  });

  it("clusters by property + carrier + loss date when no claim number or policy exists", () => {
    const { clusters } = clusterEvidence([
      doc({
        _id: "d1",
        classification: "Inspection",
        text: "Inspection of 1427 Cypress Ridge Drive, Lakeland FL 33813. State Farm. Date of loss: 2026-07-14.",
      }),
      doc({
        _id: "d2",
        classification: "Estimate",
        text: "Estimate total $24,500. 1427 Cypress Ridge Drive, Lakeland FL 33813. State Farm. Date of loss: 2026-07-14.",
      }),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.key).toMatch(/^ADDR:/);
  });

  it("keeps two claims for the same property separate when the loss dates differ", () => {
    const { clusters } = clusterEvidence([
      doc({
        _id: "d1",
        classification: "Inspection",
        text: "1427 Cypress Ridge Drive, Lakeland FL 33813. State Farm. Date of loss: 2026-07-14.",
      }),
      doc({
        _id: "d2",
        classification: "Inspection",
        text: "1427 Cypress Ridge Drive, Lakeland FL 33813. State Farm. Date of loss: 2025-08-03.",
      }),
    ]);
    expect(clusters).toHaveLength(2);
  });

  it("leaves documents with no claim signals unclustered (evidence kept, nothing manufactured)", () => {
    const { clusters, unclustered } = clusterEvidence([
      doc({ _id: "d1", classification: "Other", text: "Team meeting notes" }),
      doc({ _id: "d2", classification: "Other", text: "Vendor invoice without identifiers" }),
    ]);
    expect(clusters).toHaveLength(0);
    expect(unclustered).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// discoverClaims — create / propose / keep_evidence decisions
// ---------------------------------------------------------------------------

describe("discoverClaims — HIGH evidence creates a real claim", () => {
  const fullEvidence = () => [
    doc({
      _id: "d1",
      title: "FNOL_GAP-26-51847.pdf",
      classification: "Fnol",
      text: "First notice of loss. Claim GAP-26-51847. Policy number POL-884213. 1427 Cypress Ridge Drive, Lakeland FL 33813. State Farm. Date of loss: 2026-07-14. Cause of loss: wind and hail.",
    }),
    doc({
      _id: "d2",
      title: "StateFarm_Policy_GAP-26-51847.pdf",
      classification: "Policy",
      text: "Policy POL-884213. State Farm. Claim GAP-26-51847.",
    }),
    doc({
      _id: "d3",
      title: "Inspection_Report_GAP-26-51847.pdf",
      classification: "Inspection",
      text: "Inspection of 1427 Cypress Ridge Drive, Lakeland FL 33813. Claim GAP-26-51847. Date of loss: 2026-07-14.",
    }),
    doc({
      _id: "d4",
      title: "Roof_Estimate_GAP-26-51847.pdf",
      classification: "Estimate",
      text: "Total estimate: $24,500. Claim GAP-26-51847. 1427 Cypress Ridge Drive, Lakeland FL 33813.",
    }),
  ];

  it("reconstructs a claim at HIGH confidence with every field sourced (provenance)", () => {
    const { decisions } = discoverClaims(fullEvidence(), [], []);
    expect(decisions).toHaveLength(1);
    const d = decisions[0]!;
    expect(d.decision).toBe("create");
    expect(d.tier).toBe("HIGH");
    expect(d.confidence).toBeGreaterThanOrEqual(0.6);
    expect(d.claimNumber?.value).toBe("GAP-26-51847");
    expect(d.claimNumber?.sourceDocumentId).toBeTruthy();
    expect(d.policy?.value).toBe("POL-884213");
    expect(d.property?.value).toContain("1427 Cypress Ridge Drive");
    expect(d.carrier?.value).toMatch(/state farm/i);
    expect(d.dateOfLoss?.value).toBe("2026-07-14");
    expect(d.causeOfLoss?.value).toBe("wind and hail");
    expect(d.estimateAmount?.value).toBe("$24,500");
    expect(d.evidenceIds).toHaveLength(4);
    expect(d.evidenceTitles).toHaveLength(4);
    expect(d.docTypes).toEqual(expect.arrayContaining(["fnol", "policy", "inspection", "estimate"]));
    expect(d.reasons.length).toBeGreaterThan(3);
    expect(d.summary).toContain("GAP-26-51847");
    // Collections are always arrays — never undefined.
    expect(Array.isArray(d.conflicts)).toBe(true);
    expect(Array.isArray(d.reasons)).toBe(true);
    expect(Array.isArray(d.docTypes)).toBe(true);
  });

  it("carries customer/property resolved from a persisted reconstruction candidate", () => {
    const { decisions } = discoverClaims(fullEvidence(), [
      {
        claimKey: "GAP-26-51847",
        claimNumber: "GAP-26-51847",
        customer: "Robert J. Mitchell",
        property: "1427 Cypress Ridge Drive, Lakeland FL 33813",
        confidence: 0.84,
      },
    ], []);
    expect(decisions).toHaveLength(1);
    const d = decisions[0]!;
    expect(d.decision).toBe("create");
    expect(d.customer?.value).toBe("Robert J. Mitchell");
    expect(d.customer?.sourceTitle).toContain("candidate");
  });

  it("is deterministic and order-independent for the same evidence", () => {
    const sorted = discoverClaims(fullEvidence(), [], []).decisions;
    const shuffled = discoverClaims([...fullEvidence()].reverse(), [], []).decisions;
    expect(shuffled.map((d) => d.clusterKey)).toEqual(sorted.map((d) => d.clusterKey));
    expect(shuffled.map((d) => d.confidence)).toEqual(sorted.map((d) => d.confidence));
    expect(shuffled.map((d) => d.evidenceIds)).toEqual(sorted.map((d) => d.evidenceIds));
  });
});

describe("discoverClaims — claim discovery WITHOUT a claim number", () => {
  it("creates a HIGH-confidence claim from policy + property + carrier + loss date", () => {
    const docs = [
      doc({
        _id: "d1",
        classification: "Fnol",
        text: "First notice of loss. Policy number POL-884213. 1427 Cypress Ridge Drive, Lakeland FL 33813. State Farm. Date of loss: 2026-07-14. Cause of loss: wind and hail.",
      }),
      doc({
        _id: "d2",
        classification: "Inspection",
        text: "Inspection report. Policy POL-884213. 1427 Cypress Ridge Drive, Lakeland FL 33813. State Farm. Date of loss: 2026-07-14.",
      }),
      doc({
        _id: "d3",
        classification: "Estimate",
        text: "Estimate total $24,500. Policy POL-884213. 1427 Cypress Ridge Drive, Lakeland FL 33813.",
      }),
    ];
    const { decisions, unclustered } = discoverClaims(docs, [], []);
    expect(unclustered).toBe(0);
    expect(decisions).toHaveLength(1);
    const d = decisions[0]!;
    expect(d.claimNumber).toBeUndefined(); // no claim number anywhere
    expect(d.decision).toBe("create");
    expect(d.tier).toBe("HIGH");
    expect(d.confidence).toBeGreaterThanOrEqual(0.6);
    expect(d.policy?.value).toBe("POL-884213");
    expect(d.property?.value).toContain("1427 Cypress Ridge Drive");
  });

  it("proposes a MEDIUM reviewable candidate when the evidence is real but thinner", () => {
    const docs = [
      doc({
        _id: "d1",
        classification: "Inspection",
        text: "Inspection of 1427 Cypress Ridge Drive, Lakeland FL 33813. State Farm. Date of loss: 2026-07-14.",
      }),
    ];
    const { decisions } = discoverClaims(docs, [], []);
    expect(decisions).toHaveLength(1);
    const d = decisions[0]!;
    expect(d.decision).toBe("propose");
    expect(d.tier).toBe("MEDIUM");
    expect(d.confidence).toBeGreaterThanOrEqual(0.35);
    expect(d.confidence).toBeLessThan(0.6);
    expect(d.summary).toMatch(/candidate/i);
  });

  it("keeps LOW-confidence evidence without manufacturing anything", () => {
    const docs = [
      doc({
        _id: "d1",
        classification: "Invoice",
        text: "Invoice total: $28,400.00. Policy number POL-884213.",
      }),
    ];
    const { decisions } = discoverClaims(docs, [], []);
    expect(decisions).toHaveLength(1);
    const d = decisions[0]!;
    expect(d.decision).toBe("keep_evidence");
    expect(d.tier).toBe("LOW");
    expect(d.confidence).toBeLessThan(0.35);
    expect(d.summary).toMatch(/evidence stays available/i);
  });

  it("produces no decisions when no document carries any claim signal", () => {
    const { decisions, unclustered } = discoverClaims(
      [
        doc({ _id: "d1", classification: "Other", text: "Lunch menu" }),
        doc({ _id: "d2", classification: "Other", text: "Company picnic photos" }),
      ],
      [],
      [],
    );
    expect(decisions).toHaveLength(0);
    expect(unclustered).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// discoverClaims — existing claim enrichment (never a duplicate)
// ---------------------------------------------------------------------------

describe("discoverClaims — enrichment of an existing claim", () => {
  const newEvidence = () => [
    doc({
      _id: "e1",
      title: "Carrier_Email_GAP-26-51847.pdf",
      classification: "Correspondence",
      text: "Claim GAP-26-51847. Policy POL-884213. State Farm.",
    }),
    doc({
      _id: "e2",
      title: "Invoice_GAP-26-51847.pdf",
      classification: "Invoice",
      text: "Invoice total $28,400. Claim GAP-26-51847.",
    }),
  ];

  it("enriches a claim matched by claim number — no duplicate is created", () => {
    const existing: DiscoveryClaim[] = [
      { _id: "claim-1", claimNumber: "GAP-26-51847", customer: "Robert J. Mitchell", status: "opened" },
    ];
    const { decisions } = discoverClaims(newEvidence(), [], existing);
    expect(decisions).toHaveLength(1);
    const d = decisions[0]!;
    expect(d.decision).toBe("enrich");
    expect(d.targetClaimId).toBe("claim-1");
    expect(d.targetClaimNumber).toBe("GAP-26-51847");
    expect(d.summary).toMatch(/enrich/i);
  });

  it("enriches by policy when the claim record has no claim number", () => {
    const existing: DiscoveryClaim[] = [{ _id: "claim-2", policy: "POL-884213", status: "opened" }];
    const { decisions } = discoverClaims(newEvidence(), [], existing);
    expect(decisions[0]?.decision).toBe("enrich");
    expect(decisions[0]?.targetClaimId).toBe("claim-2");
  });

  it("enriches by property + carrier + loss date when identifiers are absent", () => {
    const existing: DiscoveryClaim[] = [
      {
        _id: "claim-3",
        property: "1427 Cypress Ridge Drive, Lakeland FL 33813",
        carrier: "State Farm",
        dateOfLoss: Date.UTC(2026, 6, 14),
        status: "opened",
      },
    ];
    const docs = [
      doc({
        _id: "e1",
        classification: "Inspection",
        text: "Inspection of 1427 Cypress Ridge Drive, Lakeland FL 33813. State Farm. Date of loss: 2026-07-14.",
      }),
    ];
    const { decisions } = discoverClaims(docs, [], existing);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.decision).toBe("enrich");
    expect(decisions[0]?.targetClaimId).toBe("claim-3");
  });
});

// ---------------------------------------------------------------------------
// discoverClaims — conflicts are preserved, never silently resolved
// ---------------------------------------------------------------------------

describe("discoverClaims — conflicting identifiers and loss-date partitions", () => {
  it("keeps two claim numbers for the same property as separate review clusters with an identifier conflict", () => {
    const docs = [
      doc({
        _id: "d1",
        classification: "Estimate",
        text: "1427 Cypress Ridge Drive, Lakeland FL 33813. Claim number GAP-26-1001. Total estimate: $24,500.",
      }),
      doc({
        _id: "d2",
        classification: "Inspection",
        text: "1427 Cypress Ridge Drive, Lakeland FL 33813. Claim number GAP-26-2001.",
      }),
    ];
    const { decisions } = discoverClaims(docs, [], []);
    expect(decisions).toHaveLength(2);
    for (const d of decisions) {
      expect(d.identifierConflict).toBeTruthy();
      expect(d.identifierConflict).toContain("GAP-26-1001");
      expect(d.identifierConflict).toContain("GAP-26-2001");
      // Both identifiers preserved as conflict values — nothing picked as winner.
      const numValues = d.conflicts.find((c) => c.field === "Claim identifier")?.values.map((v) => v.value) ?? [];
      expect(numValues).toEqual(expect.arrayContaining(["GAP-26-1001", "GAP-26-2001"]));
    }
  });

  it("keeps conflicting amounts with both sources cited", () => {
    const docs = [
      doc({ _id: "d1", classification: "Estimate", text: "Claim GAP-26-1001. Total estimate: $24,500." }),
      doc({ _id: "d2", classification: "Estimate", text: "Claim GAP-26-1001. Total estimate: $26,000." }),
    ];
    const { decisions } = discoverClaims(docs, [], []);
    const amountConflict = decisions[0]?.conflicts.find((c) => c.field === "Estimate total");
    expect(amountConflict).toBeDefined();
    expect(amountConflict?.values.map((v) => v.value)).toEqual(expect.arrayContaining(["$24,500", "$26,000"]));
    expect(amountConflict?.note).toMatch(/reconcile/i);
  });
});

// ---------------------------------------------------------------------------
// discoverClaims — candidate-only clusters
// ---------------------------------------------------------------------------

describe("discoverClaims — persisted candidates are never dropped", () => {
  it("keeps a candidate whose evidence was not re-scanned as a MEDIUM reconstruction (propose), not keep_evidence", () => {
    const { decisions } = discoverClaims([], [
      {
        claimKey: "GAP-26-99999",
        claimNumber: "GAP-26-99999",
        customer: "Acme Roofing",
        property: "123 Main Street, Tampa FL 33601",
        confidence: 0.8,
        status: "pending",
      },
    ], []);
    expect(decisions).toHaveLength(1);
    const d = decisions[0]!;
    expect(d.decision).toBe("propose");
    expect(d.tier).toBe("MEDIUM");
    expect(d.claimNumber?.value).toBe("GAP-26-99999");
    expect(d.claimNumber?.sourceTitle).toContain("candidate");
    expect(d.customer?.value).toBe("Acme Roofing");
    expect(d.summary).toMatch(/candidate/i);
  });
});

// ---------------------------------------------------------------------------
// scoreCluster + matchExistingClaim — direct contract
// ---------------------------------------------------------------------------

describe("scoreCluster + matchExistingClaim — direct contract", () => {
  it("scores a single-policy cluster LOW (honest threshold line)", () => {
    const { clusters } = clusterEvidence([
      doc({ _id: "d1", classification: "Invoice", text: "Invoice total $28,400. Policy number POL-884213." }),
    ]);
    const scored = scoreCluster(clusters[0]!, new Map([["d1", clusters[0]!.docs[0]!]]));
    expect(scored.confidence).toBeLessThan(0.35);
    expect(scored.reasons.length).toBeGreaterThan(0);
  });

  it("matchExistingClaim matches on claim number first, then policy, then property+carrier+loss date", () => {
    const claim: DiscoveryClaim = { _id: "c1", claimNumber: "GAP-26-51847", policy: "POL-884213", status: "opened" };
    const { clusters } = clusterEvidence([
      doc({ _id: "d1", classification: "Estimate", text: "Claim GAP-26-51847. Policy POL-884213. Total estimate: $24,500." }),
    ]);
    const scored = scoreCluster(clusters[0]!, new Map([["d1", clusters[0]!.docs[0]!]]));
    expect(matchExistingClaim(scored, [claim])?._id).toBe("c1");
  });
});

// ---------------------------------------------------------------------------
// Row → engine mappers — the persistence boundary never throws
// ---------------------------------------------------------------------------

describe("row → engine mappers — null-safe persistence boundary", () => {
  it("toDiscoveryClaim maps real rows and nulls out missing fields", () => {
    const claim = toDiscoveryClaim({
      _id: "claim-1",
      claimNumber: "GAP-26-51847",
      customer: "Robert J. Mitchell",
      dateOfLoss: Date.UTC(2026, 6, 14),
      estimateAmount: 24500,
      evidenceDocumentIds: ["d1", "d2"],
      evidenceSummary: ["estimate", "photos"],
    });
    expect(claim._id).toBe("claim-1");
    expect(claim.claimNumber).toBe("GAP-26-51847");
    expect(claim.estimateAmount).toBe(24500);
    expect(claim.evidenceDocumentIds).toEqual(["d1", "d2"]);

    const sparse = toDiscoveryClaim({ _id: "claim-2" });
    expect(sparse.claimNumber).toBeNull();
    expect(sparse.carrier).toBeNull();
    expect(sparse.dateOfLoss).toBeNull();
    expect(sparse.evidenceSummary).toBeNull();
  });

  it("toDiscoveryCandidate maps real rows and handles missing collections", () => {
    const cand = toDiscoveryCandidate({
      _id: "cand-1",
      claimKey: "GAP-26-51847",
      claimNumber: "GAP-26-51847",
      customer: "Acme",
      confidence: 0.84,
    });
    expect(cand.claimKey).toBe("GAP-26-51847");
    expect(cand.documentIds).toBeNull();
    expect(cand.documentTitles).toBeNull();
  });

  it("toEpochMs and toMoney convert the persisted formats honestly", () => {
    expect(toEpochMs("2026-07-14")).toBe(Date.UTC(2026, 6, 14));
    expect(toEpochMs("not-a-date")).toBeNull();
    expect(toMoney("$24,500")).toBe(24500);
    expect(toMoney("garbage")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Robustness — the engine never yields undefined collections
// ---------------------------------------------------------------------------

describe("discovery engine robustness", () => {
  it("returns an empty report for empty input", () => {
    const report = discoverClaims([], [], []);
    expect(report.decisions).toEqual([]);
    expect(report.unclustered).toBe(0);
  });

  it("every decision carries array collections — never undefined", () => {
    const { decisions } = discoverClaims([
      doc({ _id: "d1", classification: "Estimate", text: "Claim GAP-26-51847. Total estimate: $24,500." }),
    ], [], []);
    for (const d of decisions) {
      expect(Array.isArray(d.evidenceIds)).toBe(true);
      expect(Array.isArray(d.evidenceTitles)).toBe(true);
      expect(Array.isArray(d.docTypes)).toBe(true);
      expect(Array.isArray(d.conflicts)).toBe(true);
      expect(Array.isArray(d.reasons)).toBe(true);
    }
  });

  it("survives documents with null titles/summaries/text", () => {
    const { decisions } = discoverClaims([
      doc({ _id: "d1", classification: "Estimate" }),
      doc({ _id: "d2", classification: null, title: null, summary: null, text: null }),
    ], [], []);
    expect(Array.isArray(decisions)).toBe(true);
  });

  it("extractClaimNumber matches the claim-identifier patterns used across Atlas", () => {
    expect(extractClaimNumber("GAP-26-51847_estimate.pdf")).toBe("GAP-26-51847");
    expect(extractClaimNumber("CL-2019-48211")).toBe("CL-2019-48211");
    expect(extractClaimNumber("Claim-12345")).toBe("12345");
    expect(extractClaimNumber("Claim number 51847")).toBe("51847");
    // Regression: bare long numbers without a claim indicator are NOT claims.
    expect(extractClaimNumber("no identifiers here")).toBeNull();
    expect(extractClaimNumber("Policy number POL-884213")).toBeNull();
    expect(extractClaimNumber("GAP-HO-884217")).toBeNull();
    expect(extractClaimNumber("Lakeland FL 33813")).toBeNull();
  });
});
