// ---------------------------------------------------------------------------
// Atlas Contradiction Engine — Edge Function Re-export
//
// The canonical implementation lives in src/lib/evidence/contradictions.ts
// (shared pure module). This file re-exports it so the Edge Function package
// continues to work with its existing import graph.
// ---------------------------------------------------------------------------

export {
  scanDocumentsForContradictions,
  compareClaimAgainstDocuments,
  type ContradictionDoc,
  type ContradictionValue,
  type EvidenceContradiction,
  type ClaimFactsLike,
  type GapSeverity,
} from "../../../../src/lib/evidence/contradictions.ts";
