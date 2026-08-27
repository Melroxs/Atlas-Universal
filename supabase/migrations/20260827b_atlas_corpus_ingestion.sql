-- ---------------------------------------------------------------------------
-- Atlas Knowledge Layer — Full Corpus Internal Seed
--
-- Migration 20260827b: Extends industry_seed_internal() to support
-- the full Atlas Insurance Restoration Industry Knowledge Corpus.
--
-- The original 26-item baseline seed remains in 20260827_atlas_knowledge_seed_internal.sql.
-- This migration adds:
--   1. industry_ingest_corpus() — SECURITY DEFINER function for ingesting
--      the full 168-record corpus via JSONB parameters.
--   2. Enhanced idempotency via ON CONFLICT DO UPDATE on title+knowledgeType.
--   3. Graph relationship support via atlasIndustryRelationships table.
--   4. Corpus versioning via atlasIndustryDocuments.metadata.
--
-- This function is NOT granted to anon/authenticated roles.
-- Only superuser/service-role can call it.
-- ---------------------------------------------------------------------------

-- ================================================================
-- 1. Graph relationships table
-- ================================================================

CREATE TABLE IF NOT EXISTS public.atlasIndustryRelationships (
  _id           uuid DEFAULT extensions.gen_random_uuid() PRIMARY KEY,
  _creationTime bigint DEFAULT public.epoch_ms(),
  sourceId      text NOT NULL,
  targetId      text NOT NULL,
  relationship  text NOT NULL,
  metadata      jsonb DEFAULT '{}'::jsonb,
  corpusVersion text,
  UNIQUE (sourceId, targetId, relationship)
);

CREATE INDEX IF NOT EXISTS idx_industry_rels_source ON public.atlasIndustryRelationships(sourceId);
CREATE INDEX IF NOT EXISTS idx_industry_rels_target ON public.atlasIndustryRelationships(targetId);
CREATE INDEX IF NOT EXISTS idx_industry_rels_type ON public.atlasIndustryRelationships(relationship);

ALTER TABLE public.atlasIndustryRelationships ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "industry_rels_read" ON public.atlasIndustryRelationships;
  CREATE POLICY "industry_rels_read" ON public.atlasIndustryRelationships
    FOR SELECT USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "industry_rels_admin" ON public.atlasIndustryRelationships;
  CREATE POLICY "industry_rels_admin" ON public.atlasIndustryRelationships
    FOR ALL USING (
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles._id = auth.uid()
        AND profiles.platform_role IN ('super_admin', 'atlas_admin')
      )
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ================================================================
-- 2. Corpus ingestion function (SECURITY DEFINER, no auth.uid())
-- ================================================================

CREATE OR REPLACE FUNCTION public.industry_ingest_corpus(
  p_knowledge jsonb DEFAULT '[]'::jsonb,
  p_provenance jsonb DEFAULT '[]'::jsonb,
  p_relationships jsonb DEFAULT '[]'::jsonb,
  p_corpus_version text DEFAULT '1.0.0'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_item jsonb;
  v_prov jsonb;
  v_rel jsonb;
  v_seeded_know int := 0;
  v_updated_know int := 0;
  v_seeded_prov int := 0;
  v_updated_prov int := 0;
  v_seeded_rels int := 0;
  v_updated_rels int := 0;
  v_skipped int := 0;
  v_existing int;
BEGIN
  -- ================================================================
  -- A. Ingest provenance records (idempotent via sourceId UNIQUE)
  -- ================================================================

  FOR v_prov IN SELECT * FROM jsonb_array_elements(coalesce(p_provenance, '[]'::jsonb))
  LOOP
    SELECT count(*) INTO v_existing FROM public.atlasIndustryProvenance
      WHERE sourceId = v_prov->>'sourceId';

    INSERT INTO public.atlasIndustryProvenance (
      sourceId, sourceName, organization, authorityTier, sourceType,
      canonicalUrl, status, jurisdiction, industry, version
    ) VALUES (
      v_prov->>'sourceId', v_prov->>'sourceName', v_prov->>'organization',
      coalesce(v_prov->>'authorityTier', 'tier3_industry'),
      coalesce(v_prov->>'sourceType', 'curated'),
      v_prov->>'canonicalUrl',
      coalesce(v_prov->>'status', 'active'),
      v_prov->>'jurisdiction', v_prov->>'industry',
      coalesce(v_prov->>'version', p_corpus_version)
    )
    ON CONFLICT (sourceId) DO UPDATE SET
      sourceName = EXCLUDED.sourceName,
      organization = EXCLUDED.organization,
      authorityTier = EXCLUDED.authorityTier,
      sourceType = EXCLUDED.sourceType,
      status = EXCLUDED.status,
      canonicalUrl = coalesce(EXCLUDED.canonicalUrl, atlasIndustryProvenance.canonicalUrl);

    IF v_existing = 0 THEN
      v_seeded_prov := v_seeded_prov + 1;
    ELSE
      v_updated_prov := v_updated_prov + 1;
    END IF;
  END LOOP;

  -- ================================================================
  -- B. Ingest knowledge items (idempotent via title+knowledgeType UNIQUE)
  -- ================================================================

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_knowledge, '[]'::jsonb))
  LOOP
    SELECT count(*) INTO v_existing FROM public.atlasIndustryKnowledge
      WHERE title = v_item->>'title' AND knowledgeType = v_item->>'knowledgeType';

    INSERT INTO public.atlasIndustryKnowledge (
      title, statement, interpretation, knowledgeType,
      sourceClassification, industry, jurisdiction, version,
      confidence, status, isInference, tags, publishedAt
    ) VALUES (
      v_item->>'title', v_item->>'statement', v_item->>'interpretation',
      v_item->>'knowledgeType',
      coalesce(v_item->>'sourceClassification', 'ATLAS_CURATED')::source_classification,
      v_item->>'industry', v_item->>'jurisdiction',
      coalesce(v_item->>'version', p_corpus_version),
      coalesce((v_item->>'confidence')::double precision, 0.7),
      coalesce(v_item->>'status', 'active'),
      coalesce((v_item->>'isInference')::boolean, false),
      coalesce(v_item->'tags', '[]'::jsonb),
      public.epoch_ms()
    )
    ON CONFLICT (title, knowledgeType) DO UPDATE SET
      statement = EXCLUDED.statement,
      interpretation = coalesce(EXCLUDED.interpretation, atlasIndustryKnowledge.interpretation),
      sourceClassification = EXCLUDED.sourceClassification,
      industry = coalesce(EXCLUDED.industry, atlasIndustryKnowledge.industry),
      jurisdiction = coalesce(EXCLUDED.jurisdiction, atlasIndustryKnowledge.jurisdiction),
      confidence = EXCLUDED.confidence,
      status = EXCLUDED.status,
      isInference = EXCLUDED.isInference,
      tags = EXCLUDED.tags,
      version = EXCLUDED.version,
      updatedAt = public.epoch_ms();

    IF v_existing = 0 THEN
      v_seeded_know := v_seeded_know + 1;
    ELSE
      v_updated_know := v_updated_know + 1;
    END IF;
  END LOOP;

  -- ================================================================
  -- C. Ingest graph relationships (idempotent via sourceId+targetId+relationship UNIQUE)
  -- ================================================================

  FOR v_rel IN SELECT * FROM jsonb_array_elements(coalesce(p_relationships, '[]'::jsonb))
  LOOP
    SELECT count(*) INTO v_existing FROM public.atlasIndustryRelationships
      WHERE sourceId = v_rel->>'sourceId'
        AND targetId = v_rel->>'targetId'
        AND relationship = v_rel->>'relationship';

    INSERT INTO public.atlasIndustryRelationships (
      sourceId, targetId, relationship, metadata, corpusVersion
    ) VALUES (
      v_rel->>'sourceId', v_rel->>'targetId', v_rel->>'relationship',
      coalesce(v_rel->'metadata', '{}'::jsonb),
      p_corpus_version
    )
    ON CONFLICT (sourceId, targetId, relationship) DO NOTHING;

    IF v_existing = 0 THEN
      v_seeded_rels := v_seeded_rels + 1;
    ELSE
      v_updated_rels := v_updated_rels + 1;
    END IF;
  END LOOP;

  -- ================================================================
  -- D. Return ingestion report
  -- ================================================================

  RETURN jsonb_build_object(
    'corpusVersion', p_corpus_version,
    'seededKnowledge', v_seeded_know,
    'updatedKnowledge', v_updated_know,
    'skippedKnowledge', v_skipped,
    'seededProvenance', v_seeded_prov,
    'updatedProvenance', v_updated_prov,
    'seededRelationships', v_seeded_rels,
    'updatedRelationships', v_updated_rels,
    'totalKnowledge', (SELECT count(*)::int FROM public.atlasIndustryKnowledge),
    'totalProvenance', (SELECT count(*)::int FROM public.atlasIndustryProvenance),
    'totalRelationships', (SELECT count(*)::int FROM public.atlasIndustryRelationships)
  );
END;
$$;

-- Revoke from public roles
REVOKE EXECUTE ON FUNCTION public.industry_ingest_corpus(jsonb, jsonb, jsonb, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.industry_ingest_corpus(jsonb, jsonb, jsonb, text) FROM anon;

-- ================================================================
-- 3. Knowledge graph RPC that includes relationships
-- ================================================================

CREATE OR REPLACE FUNCTION public.industry_knowledge_graph()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_nodes jsonb;
  v_edges jsonb;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('nodes', '[]'::jsonb, 'edges', '[]'::jsonb); END IF;

  -- Build nodes from knowledge items
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', k._id, 'type', k.knowledgeType, 'title', k.title
  )), '[]'::jsonb)
  INTO v_nodes
  FROM public.atlasIndustryKnowledge k
  WHERE k.status = 'active';

  -- Build edges from both document→knowledge AND relationship table
  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
    'source', r.sourceId, 'target', r.targetId, 'relationship', r.relationship
  )), '[]'::jsonb)
  INTO v_edges
  FROM public.atlasIndustryRelationships r
  WHERE r.sourceId IN (SELECT title FROM public.atlasIndustryKnowledge WHERE status = 'active')
     OR r.targetId IN (SELECT title FROM public.atlasIndustryKnowledge WHERE status = 'active');

  -- Also include document→knowledge edges
  v_edges := (
    SELECT COALESCE(v_edges, '[]'::jsonb) || COALESCE(jsonb_agg(jsonb_build_object(
      'source', k.documentId, 'target', k._id, 'relationship', 'contains'
    )), '[]'::jsonb)
    FROM public.atlasIndustryKnowledge k
    WHERE k.status = 'active' AND k.documentId IS NOT NULL
  );

  RETURN jsonb_build_object('nodes', v_nodes, 'edges', v_edges);
END;
$$;
