BEGIN;

-- ============================================================
-- ATLAS KNOWLEDGE LAYER — LAYER 1
-- FIXED SINGLE-PASTE SEED
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.atlas_knowledge (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    knowledge_key TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT NOT NULL,
    knowledge_type TEXT NOT NULL DEFAULT 'industry',
    scope TEXT NOT NULL DEFAULT 'global',
    source_type TEXT NOT NULL DEFAULT 'atlas_seed',
    source_name TEXT,
    confidence NUMERIC(5,4) NOT NULL DEFAULT 0.95,
    status TEXT NOT NULL DEFAULT 'active',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SECURITY
-- ============================================================

ALTER TABLE public.atlas_knowledge ENABLE ROW LEVEL SECURITY;

-- Remove potentially conflicting seed policies.
DROP POLICY IF EXISTS "atlas_knowledge_public_read"
    ON public.atlas_knowledge;

DROP POLICY IF EXISTS "atlas_knowledge_authenticated_read"
    ON public.atlas_knowledge;

DROP POLICY IF EXISTS "atlas_knowledge_service_role_all"
    ON public.atlas_knowledge;

-- Normal authenticated users can READ active global knowledge.
CREATE POLICY "atlas_knowledge_authenticated_read"
ON public.atlas_knowledge
FOR SELECT
TO authenticated
USING (
    scope = 'global'
    AND status = 'active'
);

-- Service role can perform backend operations.
CREATE POLICY "atlas_knowledge_service_role_all"
ON public.atlas_knowledge
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_atlas_knowledge_scope
ON public.atlas_knowledge(scope);

CREATE INDEX IF NOT EXISTS idx_atlas_knowledge_category
ON public.atlas_knowledge(category);

CREATE INDEX IF NOT EXISTS idx_atlas_knowledge_status
ON public.atlas_knowledge(status);

CREATE INDEX IF NOT EXISTS idx_atlas_knowledge_type
ON public.atlas_knowledge(knowledge_type);

-- ============================================================
-- LAYER 1 INDUSTRY KNOWLEDGE
-- ============================================================

INSERT INTO public.atlas_knowledge (
    knowledge_key,
    title,
    content,
    category,
    knowledge_type,
    scope,
    source_type,
    source_name,
    confidence,
    status,
    metadata
)
VALUES

-- INSURANCE RESTORATION

(
    'industry.insurance_restoration.overview',
    'Insurance Restoration Industry Overview',
    'Insurance restoration is the process of restoring property after a covered loss such as wind, hail, storm, fire, water, or other insured damage. Restoration contractors typically inspect damage, document conditions, develop an estimate, communicate with the property owner and insurance carrier, perform authorized work, document completed work, and pursue additional compensation when legitimate scope or pricing differences exist.',
    'insurance_restoration',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.98,
    'active',
    '{"layer":1,"domain":"insurance_restoration"}'
),

(
    'industry.insurance_restoration.contractor_role',
    'Restoration Contractor Role in the Claim Lifecycle',
    'A restoration contractor commonly participates in property inspection, damage documentation, estimating, scope development, repair execution, change documentation, supplement preparation, carrier communication, and final documentation. The contractor should distinguish between observed physical damage, required repair scope, pricing, policy coverage decisions, and carrier authorization.',
    'insurance_restoration',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.97,
    'active',
    '{"layer":1}'
),

(
    'industry.insurance_restoration.claim_lifecycle',
    'Typical Property Insurance Claim Lifecycle',
    'A typical restoration claim progresses through loss occurrence, initial inspection, damage documentation, claim reporting, estimate creation, carrier or adjuster review, scope negotiation, authorization, repair execution, change documentation, supplement or revision requests, final documentation, invoicing, and claim closure. Actual workflows vary by carrier, policy, jurisdiction, and project.',
    'claims',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.98,
    'active',
    '{"layer":1}'
),

-- DOCUMENTATION

(
    'industry.documentation.damage_photos',
    'Damage Photo Documentation',
    'Damage photographs are a core form of claim evidence. Useful photo documentation should establish location, affected component, severity, dimensions where relevant, surrounding conditions, and the relationship between the observed condition and the proposed repair. Photos should be organized so a reviewer can understand the evidence without relying solely on verbal explanation.',
    'documentation',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.98,
    'active',
    '{"layer":1,"evidence_type":"photo"}'
),

(
    'industry.documentation.before_during_after',
    'Before, During, and After Documentation',
    'Strong restoration documentation commonly includes before-work evidence, documentation of concealed or discovered conditions during work, and after-work evidence. The exact documentation needed depends on the repair and claim. Before-and-after evidence helps establish what condition existed and what work was completed.',
    'documentation',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.97,
    'active',
    '{"layer":1}'
),

(
    'industry.documentation.measurements',
    'Measurement Documentation',
    'Measurements can support quantities in an estimate and help connect physical conditions to proposed scope. Depending on the project, useful evidence may include roof dimensions, linear measurements, elevations, room dimensions, material quantities, openings, waste factors, and other quantity-driving information.',
    'documentation',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.95,
    'active',
    '{"layer":1,"evidence_type":"measurement"}'
),

(
    'industry.documentation.material_evidence',
    'Material and Component Evidence',
    'Documentation may need to establish the type, age, condition, availability, installation method, or required replacement characteristics of affected materials or components. Product labels, manufacturer information, photographs, receipts, samples, measurements, and field observations can provide supporting evidence depending on the issue.',
    'documentation',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.94,
    'active',
    '{"layer":1}'
),

-- SUPPLEMENTS

(
    'industry.supplements.definition',
    'Insurance Supplement Definition',
    'A supplement is a request to revise or increase the previously established scope or estimate based on additional damage, omitted work, changed conditions, necessary repair procedures, applicable pricing, code-related requirements where applicable, or other supportable differences discovered during the claim or repair process.',
    'supplements',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.98,
    'active',
    '{"layer":1}'
),

(
    'industry.supplements.evidence_first',
    'Evidence-First Supplement Principle',
    'A strong supplement should connect each requested scope or pricing change to supporting evidence. The evidence may include photographs, measurements, documentation of concealed conditions, manufacturer requirements, invoices, receipts, applicable code documentation, estimating logic, or other relevant records. A dollar amount without supporting reasoning is generally weaker than a clearly documented cause-and-effect explanation.',
    'supplements',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.98,
    'active',
    '{"layer":1,"principle":"evidence_first"}'
),

(
    'industry.supplements.omitted_scope',
    'Omitted Scope as a Supplement Trigger',
    'One common reason for a supplement is that necessary work or quantities were not included in the original estimate. Atlas should distinguish omitted scope from new damage, pricing differences, code-related requirements, or other categories rather than treating every supplement as the same type of issue.',
    'supplements',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.97,
    'active',
    '{"layer":1}'
),

(
    'industry.supplements.hidden_damage',
    'Hidden or Concealed Damage',
    'Additional damage may become visible only after demolition, removal, tear-off, opening assemblies, or beginning repairs. Such conditions should be documented as soon as they are discovered and connected to the work necessary to address them.',
    'supplements',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.98,
    'active',
    '{"layer":1}'
),

(
    'industry.supplements.pricing_difference',
    'Estimating and Pricing Differences',
    'Differences between contractor and carrier estimates can result from different assumptions about quantities, labor, materials, operations, access, waste, equipment, minimum charges, or applicable pricing. Atlas should identify the specific estimating difference rather than treating a total-dollar variance as self-explanatory.',
    'supplements',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.96,
    'active',
    '{"layer":1}'
),

-- ESTIMATING

(
    'industry.estimating.xactimate',
    'Xactimate and Insurance Estimating',
    'Xactimate is widely used in the U.S. property insurance ecosystem for estimating repair and replacement costs. Estimates commonly consist of line items representing labor, material, equipment, quantities, operations, and related costs. Atlas should treat estimate line items as structured evidence and reasoning inputs rather than merely dollar values.',
    'estimating',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.97,
    'active',
    '{"layer":1,"software":"Xactimate"}'
),

(
    'industry.estimating.line_item_reasoning',
    'Estimate Line-Item Reasoning',
    'A line item should be evaluated in relation to the physical work it represents. Atlas should reason about whether evidence supports the presence of the work, whether the quantity appears connected to documented measurements, whether the operation is consistent with the repair scenario, and whether differences between estimates require further evidence.',
    'estimating',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.96,
    'active',
    '{"layer":1}'
),

(
    'industry.estimating.scope_vs_price',
    'Scope Versus Pricing',
    'Claim differences should be separated into scope differences and pricing differences. Scope differences concern what work or quantities are included. Pricing differences concern the cost assigned to work that is otherwise within scope. Separating these concepts improves claim review and supplement reasoning.',
    'estimating',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.98,
    'active',
    '{"layer":1}'
),

-- ROOFING

(
    'industry.roofing.wind_hail',
    'Roofing Wind and Hail Damage',
    'Wind and hail claims commonly require documentation of affected roofing components and related exterior components. Useful evidence can include representative damage photographs, field observations, measurements, roof diagrams, collateral damage, affected accessories, and documentation of repair or replacement requirements.',
    'roofing',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.96,
    'active',
    '{"layer":1,"loss_types":["wind","hail"]}'
),

(
    'industry.roofing.components',
    'Roof System Components',
    'A roofing system can include shingles or other roof covering, underlayment, flashing, drip edge, ventilation components, valleys, penetrations, pipe boots, ridge components, decking, gutters, accessories, and related components. Damage assessment should consider the complete system rather than only the visible primary covering.',
    'roofing',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.97,
    'active',
    '{"layer":1}'
),

(
    'industry.roofing.replacement_scope',
    'Roof Replacement Scope',
    'Roof replacement scope may involve tear-off, disposal, preparation, replacement materials, underlayment, flashing, ventilation, accessories, labor, equipment, and other operations depending on the roof system and documented conditions. Atlas should not assume that every roof replacement contains identical scope.',
    'roofing',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.96,
    'active',
    '{"layer":1}'
),

-- CLAIMS / ADJUSTERS

(
    'industry.adjuster.role',
    'Insurance Adjuster Role',
    'An insurance adjuster evaluates a reported loss and may inspect damage, review documentation, determine or recommend claim scope, communicate with the policyholder and other parties, and evaluate estimates. Adjuster responsibilities and authority vary by role, carrier, jurisdiction, and claim.',
    'claims',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.97,
    'active',
    '{"layer":1}'
),

(
    'industry.claim.coverage_vs_scope',
    'Coverage Versus Physical Scope',
    'Coverage determination and physical damage assessment are distinct concepts. A contractor can document observed damage and proposed repair scope, while coverage decisions are made under the applicable insurance policy and carrier process. Atlas should avoid presenting an estimate or physical observation as a definitive coverage determination.',
    'claims',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.99,
    'active',
    '{"layer":1,"critical_reasoning_rule":true}'
),

(
    'industry.claim.communication',
    'Claim Communication Documentation',
    'Claim-related communications can become important evidence of decisions, requests, disagreements, approvals, and outstanding issues. Relevant communications may include emails, messages, notes, inspection reports, estimate comments, and other records. Atlas should preserve provenance when using communication data in claim reasoning.',
    'claims',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.97,
    'active',
    '{"layer":1,"provenance_required":true}'
),

-- EVIDENCE

(
    'industry.evidence.provenance',
    'Evidence Provenance',
    'Claim reasoning should be traceable to source evidence. When Atlas makes a recommendation, the system should be capable of identifying the underlying document, photograph, estimate line, communication, measurement, or other source used to support the conclusion.',
    'evidence',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.99,
    'active',
    '{"layer":1,"principle":"provenance"}'
),

(
    'industry.evidence.contradictions',
    'Contradiction Detection',
    'Claim records can contain conflicting information, such as different dates, quantities, descriptions, damage locations, estimate assumptions, or statements about completed work. Contradictions should be surfaced rather than silently resolved when they could affect claim reasoning.',
    'evidence',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.97,
    'active',
    '{"layer":1,"principle":"surface_conflicts"}'
),

(
    'industry.evidence.missing_evidence',
    'Missing Evidence and Evidence Gaps',
    'An evidence gap exists when a proposed claim action, scope item, or conclusion requires support that is not currently available or sufficiently clear. Atlas should identify the missing evidence and, where possible, explain what evidence would strengthen the conclusion.',
    'evidence',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.99,
    'active',
    '{"layer":1,"principle":"gap_detection"}'
),

(
    'industry.evidence.representative_photos',
    'Representative Evidence',
    'Evidence should be representative of the condition being claimed. A single photograph may not establish the full extent, quantity, or location of damage. Atlas should evaluate whether the available evidence is sufficient for the specific conclusion being made.',
    'evidence',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.95,
    'active',
    '{"layer":1}'
),

-- CODE / COMPLIANCE

(
    'industry.code.local_requirements',
    'Building Code and Local Requirements',
    'Building codes and local requirements can affect repair scope. Code-related requirements vary by jurisdiction, building type, construction date, adopted code edition, and specific circumstances. Atlas should identify code-related questions and supporting documentation needs without assuming a universal requirement.',
    'compliance',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.98,
    'active',
    '{"layer":1,"critical_reasoning_rule":true}'
),

(
    'industry.code.documentation',
    'Code Documentation',
    'When code or regulatory requirements are relevant to a claim, supporting evidence may include applicable code provisions, jurisdictional requirements, permit information, official documentation, manufacturer requirements, or other authoritative sources. Atlas should distinguish authoritative requirements from informal commentary.',
    'compliance',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.96,
    'active',
    '{"layer":1}'
),

-- CLAIM PACKAGES

(
    'industry.claim_package.initial',
    'Initial Claim Package',
    'A strong initial claim package generally organizes the loss description, observed damage, supporting photographs, measurements, estimate, relevant documentation, and other evidence needed for review. The exact package varies by claim and carrier.',
    'claim_packages',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.97,
    'active',
    '{"layer":1}'
),

(
    'industry.claim_package.supplement',
    'Supplement Claim Package',
    'A supplement package should clearly identify what differs from the prior estimate or approved scope, why the change is necessary, what evidence supports it, and the requested revision. Clear mapping between requested changes and evidence improves reviewability.',
    'claim_packages',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.99,
    'active',
    '{"layer":1}'
),

-- AI REASONING

(
    'industry.ai.do_not_invent',
    'AI Must Not Invent Claim Facts',
    'Atlas must not invent damage, measurements, policy provisions, estimate quantities, pricing, approvals, communications, code requirements, or other claim facts that are not supported by available evidence. When information is unavailable, Atlas should explicitly identify the uncertainty or evidence gap.',
    'ai_reasoning',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    1.00,
    'active',
    '{"layer":1,"critical":true}'
),

(
    'industry.ai.distinguish_fact_inference',
    'Distinguish Facts From Inferences',
    'Atlas should distinguish directly observed or documented facts from inferred conclusions. A source document may establish a fact while the system may infer a likely relationship. Inferences should be labeled as such and should remain traceable to their supporting evidence.',
    'ai_reasoning',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    1.00,
    'active',
    '{"layer":1,"critical":true}'
),

(
    'industry.ai.confidence',
    'Confidence and Uncertainty',
    'Atlas should represent uncertainty when evidence is incomplete, conflicting, ambiguous, or insufficient. Confidence should reflect the strength and quality of evidence rather than simply the certainty of the generated language.',
    'ai_reasoning',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.99,
    'active',
    '{"layer":1,"critical":true}'
),

(
    'industry.ai.source_citation',
    'Source Citation Requirement',
    'Material recommendations and conclusions generated by Atlas should be traceable to source material whenever source evidence exists. Citations or provenance references should allow a reviewer to locate the underlying evidence.',
    'ai_reasoning',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    1.00,
    'active',
    '{"layer":1,"critical":true}'
),

-- ATLAS WORKFLOW

(
    'industry.atlas.ingestion',
    'Knowledge and Claim Ingestion',
    'Atlas can ingest documents, estimates, photographs, communications, and other claim-related information as inputs to its reasoning pipeline. Ingestion should preserve source identity and provenance so downstream reasoning can be traced back to original evidence.',
    'atlas_workflow',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.99,
    'active',
    '{"layer":1,"pipeline_stage":"ingestion"}'
),

(
    'industry.atlas.extraction',
    'Evidence Extraction',
    'After ingestion, Atlas should extract relevant entities, dates, quantities, damage descriptions, estimate information, participants, communications, and other structured facts from source material. Extracted facts should retain links to their originating evidence.',
    'atlas_workflow',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.99,
    'active',
    '{"layer":1,"pipeline_stage":"extraction"}'
),

(
    'industry.atlas.entity_resolution',
    'Entity Resolution',
    'Atlas should resolve references to the same claim, property, customer, contractor, adjuster, document, estimate, or other entity when multiple sources refer to them differently. Resolution should be evidence-driven and should avoid merging entities when identity is uncertain.',
    'atlas_workflow',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.97,
    'active',
    '{"layer":1,"pipeline_stage":"entity_resolution"}'
),

(
    'industry.atlas.claim_reconstruction',
    'Claim Reconstruction',
    'Atlas should reconstruct a coherent claim timeline and state from distributed evidence. The reconstructed claim should represent what is known, what is uncertain, what changed, what evidence supports each state, and where contradictions remain.',
    'atlas_workflow',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.99,
    'active',
    '{"layer":1,"pipeline_stage":"claim_reconstruction"}'
),

(
    'industry.atlas.gap_intelligence',
    'Evidence Gap Intelligence',
    'Atlas should identify missing evidence that prevents a claim, estimate item, supplement request, or recommendation from being adequately supported. The system should explain the gap and, where practical, recommend the evidence needed to close it.',
    'atlas_workflow',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.99,
    'active',
    '{"layer":1,"pipeline_stage":"gap_intelligence"}'
),

(
    'industry.atlas.contradiction_engine',
    'Contradiction Intelligence',
    'Atlas should identify material conflicts across documents, estimates, photographs, communications, measurements, and other sources. Contradictions should be surfaced to reviewers and should not be silently overwritten by whichever source was processed last.',
    'atlas_workflow',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    0.99,
    'active',
    '{"layer":1,"pipeline_stage":"contradiction_engine"}'
),

(
    'industry.atlas.ask_atlas',
    'Ask Atlas Evidence-Based Answers',
    'When a user asks Atlas a claim question, Atlas should answer from available customer evidence plus applicable shared industry knowledge. Answers should distinguish customer-specific facts from general industry knowledge and should identify supporting sources whenever possible.',
    'atlas_workflow',
    'industry',
    'global',
    'atlas_seed',
    'Atlas Industry Knowledge',
    1.00,
    'active',
    '{"layer":1,"pipeline_stage":"ask_atlas"}'
)

ON CONFLICT (knowledge_key)
DO UPDATE SET
    title = EXCLUDED.title,
    content = EXCLUDED.content,
    category = EXCLUDED.category,
    knowledge_type = EXCLUDED.knowledge_type,
    scope = EXCLUDED.scope,
    source_type = EXCLUDED.source_type,
    source_name = EXCLUDED.source_name,
    confidence = EXCLUDED.confidence,
    status = EXCLUDED.status,
    metadata = EXCLUDED.metadata,
    updated_at = NOW();

-- ============================================================
-- VERIFICATION
-- ============================================================

DO $$
DECLARE
    seed_count INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO seed_count
    FROM public.atlas_knowledge
    WHERE scope = 'global'
      AND source_type = 'atlas_seed';

    RAISE NOTICE '=============================================';
    RAISE NOTICE 'ATLAS KNOWLEDGE LAYER SEED COMPLETE';
    RAISE NOTICE 'Layer 1 records: %', seed_count;
    RAISE NOTICE 'RLS: ENABLED';
    RAISE NOTICE '=============================================';
END $$;

COMMIT;

-- Final result
SELECT
    COUNT(*) AS layer_1_records,
    COUNT(DISTINCT category) AS categories
FROM public.atlas_knowledge
WHERE scope = 'global'
  AND source_type = 'atlas_seed';
