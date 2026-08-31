// ---------------------------------------------------------------------------
// Tests for Atlas Onboarding State
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  deriveOnboardingState,
  getOnboardingVoiceGuidance,
  ATLAS_EMPTY_STATES,
  type AtlasReadinessState,
} from "./onboarding";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyParams() {
  return {
    health: {
      documents: 0,
      entities: 0,
      openSignals: 0,
      activeWorkflows: 0,
      openClaims: 0,
      pipelineActive: false,
    },
    documentCount: 0,
    entityCount: 0,
    claimCount: 0,
    findingCount: 0,
    recommendationCount: 0,
    hasActivity: false,
    hasConnections: false,
    isProcessing: false,
    profileComplete: false,
  };
}

// ---------------------------------------------------------------------------
// State derivation tests
// ---------------------------------------------------------------------------

describe("deriveOnboardingState", () => {
  it("derives empty state when no data exists", () => {
    const snapshot = deriveOnboardingState(emptyParams());
    expect(snapshot.state).toBe("empty");
    expect(snapshot.hasDocuments).toBe(false);
    expect(snapshot.hasClaims).toBe(false);
    expect(snapshot.hasOpportunities).toBe(false);
    expect(snapshot.ctaTarget).toBe("/dashboard/connections");
  });

  it("derives processing state when pipeline is active", () => {
    const snapshot = deriveOnboardingState({
      ...emptyParams(),
      documentCount: 5,
      isProcessing: true,
    });
    expect(snapshot.state).toBe("processing");
    expect(snapshot.hasDocuments).toBe(true);
    expect(snapshot.documentCount).toBe(5);
  });

  it("derives ready_no_opportunities when documents exist but no findings", () => {
    const snapshot = deriveOnboardingState({
      ...emptyParams(),
      documentCount: 10,
      entityCount: 5,
    });
    expect(snapshot.state).toBe("ready_no_opportunities");
    expect(snapshot.hasDocuments).toBe(true);
    expect(snapshot.hasEntities).toBe(true);
    expect(snapshot.hasOpportunities).toBe(false);
  });

  it("derives opportunity_detected when findings exist", () => {
    const snapshot = deriveOnboardingState({
      ...emptyParams(),
      documentCount: 10,
      entityCount: 5,
      claimCount: 3,
      findingCount: 2,
    });
    expect(snapshot.state).toBe("opportunity_detected");
    expect(snapshot.hasOpportunities).toBe(true);
    expect(snapshot.findingCount).toBe(2);
  });

  it("derives investigating when activity exists with claims", () => {
    const snapshot = deriveOnboardingState({
      ...emptyParams(),
      documentCount: 10,
      claimCount: 3,
      findingCount: 1,
      hasActivity: true,
    });
    expect(snapshot.state).toBe("investigating");
    expect(snapshot.hasActivity).toBe(true);
  });

  it("includes primary CTA and secondary actions", () => {
    const snapshot = deriveOnboardingState(emptyParams());
    expect(snapshot.primaryCta).toBeDefined();
    expect(snapshot.primaryCta.label).toBeTruthy();
    expect(snapshot.primaryCta.target).toBeTruthy();
    expect(snapshot.secondaryActions.length).toBeGreaterThan(0);
  });

  it("provides honest assessment messages", () => {
    const empty = deriveOnboardingState(emptyParams());
    expect(empty.assessment).toContain("ready");
    expect(empty.assessment).toContain("enough information");

    const processing = deriveOnboardingState({
      ...emptyParams(),
      documentCount: 3,
      isProcessing: true,
    });
    expect(processing.assessment).toContain("3");
    expect(processing.assessment).toContain("reviewing");

    const withOpps = deriveOnboardingState({
      ...emptyParams(),
      documentCount: 5,
      claimCount: 3,
      findingCount: 4,
    });
    expect(withOpps.assessment).toContain("4");
    expect(withOpps.assessment).toContain("recovery");
  });

  it("connects to connections page when no connections and empty", () => {
    const snapshot = deriveOnboardingState({
      ...emptyParams(),
      hasConnections: false,
    });
    expect(snapshot.ctaTarget).toBe("/dashboard/connections");
    expect(snapshot.primaryCta.label).toContain("Connect");
  });

  it("connects to knowledge page when connections exist but empty", () => {
    const snapshot = deriveOnboardingState({
      ...emptyParams(),
      hasConnections: true,
    });
    expect(snapshot.ctaTarget).toBe("/dashboard/knowledge");
    expect(snapshot.primaryCta.label).toContain("Upload");
  });

  it("derives investigating state even without opportunities if there is activity", () => {
    const snapshot = deriveOnboardingState({
      ...emptyParams(),
      documentCount: 5,
      claimCount: 1,
      hasActivity: true,
    });
    expect(snapshot.state).toBe("investigating");
  });
});

// ---------------------------------------------------------------------------
// Voice guidance tests
// ---------------------------------------------------------------------------

describe("getOnboardingVoiceGuidance", () => {
  const STATES: AtlasReadinessState[] = [
    "empty",
    "processing",
    "ready_no_opportunities",
    "opportunity_detected",
    "investigating",
    "activated",
  ];

  it("returns guidance for every state", () => {
    for (const state of STATES) {
      const guidance = getOnboardingVoiceGuidance(state);
      expect(guidance.greeting).toBeTruthy();
      expect(guidance.helpPrompt).toBeTruthy();
      expect(guidance.emptyResponse).toBeTruthy();
    }
  });

  it("empty state mentions need for information", () => {
    const g = getOnboardingVoiceGuidance("empty");
    expect(g.greeting).toMatch(/ready|information/i);
    expect(g.emptyResponse).toMatch(/documents|systems|information/i);
  });

  it("opportunity_detected state mentions opportunities", () => {
    const g = getOnboardingVoiceGuidance("opportunity_detected");
    expect(g.greeting).toMatch(/found|something|opportunity/i);
    expect(g.emptyResponse).toMatch(/opportunity|opportunities/i);
  });

  it("processing state mentions working/reviewing", () => {
    const g = getOnboardingVoiceGuidance("processing");
    expect(g.greeting).toMatch(/working|reviewing|processing/i);
  });
});

// ---------------------------------------------------------------------------
// Empty state constants
// ---------------------------------------------------------------------------

describe("ATLAS_EMPTY_STATES", () => {
  it("has entries for all common surfaces", () => {
    expect(ATLAS_EMPTY_STATES.claims).toBeDefined();
    expect(ATLAS_EMPTY_STATES.evidence).toBeDefined();
    expect(ATLAS_EMPTY_STATES.opportunities).toBeDefined();
    expect(ATLAS_EMPTY_STATES.activity).toBeDefined();
    expect(ATLAS_EMPTY_STATES.recommendations).toBeDefined();
    expect(ATLAS_EMPTY_STATES.connections).toBeDefined();
    expect(ATLAS_EMPTY_STATES.documents).toBeDefined();
    expect(ATLAS_EMPTY_STATES.knowledgeGraph).toBeDefined();
    expect(ATLAS_EMPTY_STATES.intelligence).toBeDefined();
  });

  it("every entry has assessment and guidance", () => {
    for (const [key, entry] of Object.entries(ATLAS_EMPTY_STATES)) {
      expect(entry.title, `${key} title`).toBeTruthy();
      expect(entry.assessment, `${key} assessment`).toBeTruthy();
      expect(entry.guidance, `${key} guidance`).toBeTruthy();
    }
  });

  it("claims, opportunities, and documents entries include useful text", () => {
    expect(ATLAS_EMPTY_STATES.claims.cta).toBeTruthy();
    expect(ATLAS_EMPTY_STATES.opportunities.cta).toBeTruthy();
    // documents entry doesn't have a cta field — it relies on the page's own upload CTA
    expect(ATLAS_EMPTY_STATES.documents.guidance).toContain("Upload");
  });
});
