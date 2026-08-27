# Atlas U.S. Insurance Restoration Industry Knowledge Corpus

**Release:** 0.1.0-seed  
**Retrieved:** 2026-08-27  
**Layer:** `atlas_industry`

## Purpose

This archive is a machine-readable seed corpus for an AI system operating in U.S. insurance restoration, roofing, construction, mitigation, reconstruction, estimating, documentation, billing, and revenue-recovery workflows. It is designed to preserve provenance and distinguish law, regulation, code, licensing, professional standards, insurance practice, contractor workflow, evidence requirements, industry practice, and Atlas heuristics.

> This corpus is not legal advice, a coverage determination, a payment guarantee, or a substitute for checking the current policy, facts, jurisdiction, official source, and applicable contract.

## Source methodology

The source hierarchy prioritizes federal and state primary authorities, then recognized standards organizations, then reputable industry authorities, and finally carefully labeled secondary sources. The seed release includes official EPA, OSHA, and NAIC source metadata. NAIC model-law content is not treated as enacted law. Copyrighted standards and proprietary Xactimate/carrier pricing content are not reproduced.

## Coverage and limitations

The corpus includes a 31-stage claim lifecycle, role/document/evidence ontologies, supplement and potential revenue-recovery concepts, risk records, federal regulatory seed records, standards metadata, a knowledge graph, provenance, validation-ready JSONL, and profiles for all 50 states plus the District of Columbia. State profiles intentionally identify missing official research rather than inventing requirements. Local permitting, adopted codes, amendments, and licensing must be verified with the relevant locality.

| Metric | Count |
|---|---:|
| sources | 5 |
| knowledgeRecords | 112 |
| regulations | 8 |
| workflows | 31 |
| evidenceRequirements | 36 |
| documentationTypes | 36 |
| stateProfiles | 51 |
| standards | 5 |
| risks | 21 |
| revenueRecoveryConcepts | 16 |
| inferredOrHeuristicRecords | 155 |
| conflicts | 0 |


## Interpretation rules

No supplement item is automatically payable. Potential recovery is subject to policy language, facts, jurisdiction, documentation, contract, carrier determination, and dispute mechanisms. Evidence only supports what it directly documents; it does not independently prove coverage, causation, compliance, or entitlement. Inferences are marked `isInference: true` and use `UNKNOWN`, `ATLAS_HEURISTIC`, or case-specific classifications.

## Recommended refresh schedule

Perform a monthly URL and source-version check for federal sources and a quarterly state-profile refresh. Trigger an immediate review after a statutory, regulatory, code-edition, disaster, or major agency change. A production deployment should require a human compliance review before using a record to recommend action.

## Files

The `atlas_ingestion/` directory contains JSONL files intended for ingestion. `provenance/` contains source and retrieval metadata. Domain directories contain the same records organized for human review. `quality_control_report.json` records automated validation results.
