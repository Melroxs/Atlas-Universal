-- ============================================================================
-- Atlas Knowledge Layer — Industry Knowledge Tables
-- Migration: 20260826_atlas_knowledge_layer.sql
--
-- IMPORTANT:
-- Atlas uses camelCase table/column names through Supabase/PostgREST.
-- PostgreSQL requires DOUBLE QUOTES to preserve camelCase identifiers.
--
-- This migration:
--   1. Creates required enums
--   2. Creates four industry knowledge tables
--   3. Creates indexes
--   4. Enables RLS
--   5. Creates authenticated read policies
--   6. Creates Atlas admin write policies
--   7. Creates knowledge retrieval RPCs
--   8. Creates the admin seed RPC
--
-- Safe to re-run.
-- ============================================================================


-- ============================================================================
-- 0. REQUIRED EXTENSION / FUNCTION CHECKS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Verify the existing Atlas epoch_ms() helper exists.
-- This intentionally does not recreate it because Atlas already provides it.


-- ============================================================================
-- 1. ENUMS
-- ============================================================================

DO $$
BEGIN
  CREATE TYPE public.knowledge_layer AS ENUM (
    'atlas_industry',
    'customer',
    'live_evidence'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;


DO $$
BEGIN
  CREATE TYPE public.source_classification AS ENUM (
    'INDUSTRY_STANDARD',
    'REGULATORY',
    'CARRIER_OR_INSURANCE',
    'MANUFACTURER',
    'PROFESSIONAL_GUIDANCE',
    'ATLAS_CURATED',
    'CUSTOMER_PROVIDED',
    'CUSTOMER_GENERATED',
    'MODEL_INFERENCE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;


DO $$
BEGIN
  CREATE TYPE public.ingestion_status AS ENUM (
    'uploaded',
    'processing',
    'parsed',
    'indexed',
    'needs_review',
    'approved',
    'published',
    'archived',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;


-- ============================================================================
-- 2. INDUSTRY KNOWLEDGE DOCUMENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public."atlasIndustryDocuments" (
  "_id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  "_creationTime" bigint DEFAULT public.epoch_ms(),

  "title" text NOT NULL,
  "description" text,
  "filename" text,
  "mimeType" text,
  "size" bigint DEFAULT 0,

  "storagePath" text,

  "sourceType" text,
  "sourceUrl" text,
  "sourceId" text,

  "classification" public.source_classification
    DEFAULT 'ATLAS_CURATED',

  "status" public.ingestion_status
    DEFAULT 'uploaded',

  "error" text,

  "chunkCount" integer DEFAULT 0,
  "entityCount" integer DEFAULT 0,

  "processedAt" bigint,
  "publishedAt" bigint,

  "industry" text,
  "jurisdiction" text,
  "version" text,

  "contentHash" text,

  "tags" jsonb DEFAULT '[]'::jsonb,
  "metadata" jsonb DEFAULT '{}'::jsonb
);


-- ============================================================================
-- 3. INDUSTRY KNOWLEDGE CHUNKS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public."atlasIndustryChunks" (
  "_id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  "_creationTime" bigint DEFAULT public.epoch_ms(),

  "documentId" uuid NOT NULL
    REFERENCES public."atlasIndustryDocuments"("_id")
    ON DELETE CASCADE,

  "chunkIndex" integer NOT NULL DEFAULT 0,

  "content" text NOT NULL,

  "tokenCount" integer,

  -- Stored as JSONB so Atlas can operate without pgvector.
  "embedding" jsonb,

  "metadata" jsonb DEFAULT '{}'::jsonb,

  UNIQUE ("documentId", "chunkIndex")
);


-- ============================================================================
-- 4. INDUSTRY KNOWLEDGE ITEMS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public."atlasIndustryKnowledge" (
  "_id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  "_creationTime" bigint DEFAULT public.epoch_ms(),

  "documentId" uuid
    REFERENCES public."atlasIndustryDocuments"("_id")
    ON DELETE SET NULL,

  "title" text NOT NULL,
  "statement" text NOT NULL,
  "interpretation" text,

  "knowledgeType" text NOT NULL,

  "sourceClassification" public.source_classification
    DEFAULT 'ATLAS_CURATED',

  "industry" text,
  "jurisdiction" text,
  "version" text,

  "confidence" double precision DEFAULT 0.7,

  "status" text DEFAULT 'active',

  "isInference" boolean DEFAULT false,

  "tags" jsonb DEFAULT '[]'::jsonb,

  "chunkIds" jsonb DEFAULT '[]'::jsonb,

  "publishedAt" bigint,
  "updatedAt" bigint
);


-- ============================================================================
-- 5. INDUSTRY PROVENANCE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public."atlasIndustryProvenance" (
  "_id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  "_creationTime" bigint DEFAULT public.epoch_ms(),

  "sourceId" text NOT NULL UNIQUE,

  "sourceName" text NOT NULL,
  "organization" text NOT NULL,

  "authorityTier" text DEFAULT 'tier3_industry',
  "sourceType" text DEFAULT 'curated',

  "canonicalUrl" text,

  "jurisdiction" text,
  "industry" text,

  "publicationDate" bigint,
  "retrievalDate" bigint,
  "effectiveDate" bigint,

  "version" text,

  "status" text DEFAULT 'active',

  "supersededBy" jsonb DEFAULT '[]'::jsonb,

  "metadata" jsonb DEFAULT '{}'::jsonb
);


-- ============================================================================
-- 6. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_industry_chunks_doc
  ON public."atlasIndustryChunks" ("documentId");

CREATE INDEX IF NOT EXISTS idx_industry_knowledge_doc
  ON public."atlasIndustryKnowledge" ("documentId");

CREATE INDEX IF NOT EXISTS idx_industry_knowledge_type
  ON public."atlasIndustryKnowledge" ("knowledgeType");

CREATE INDEX IF NOT EXISTS idx_industry_knowledge_industry
  ON public."atlasIndustryKnowledge" ("industry");

CREATE INDEX IF NOT EXISTS idx_industry_knowledge_status
  ON public."atlasIndustryKnowledge" ("status");

CREATE INDEX IF NOT EXISTS idx_industry_knowledge_source
  ON public."atlasIndustryKnowledge" ("sourceClassification");

CREATE INDEX IF NOT EXISTS idx_industry_documents_status
  ON public."atlasIndustryDocuments" ("status");


-- ============================================================================
-- 7. ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE public."atlasIndustryDocuments"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."atlasIndustryChunks"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."atlasIndustryKnowledge"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."atlasIndustryProvenance"
  ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- 8. READ POLICIES
--
-- All authenticated Atlas users can read industry knowledge.
-- Anonymous users cannot.
-- ============================================================================

DROP POLICY IF EXISTS "industry_docs_read"
  ON public."atlasIndustryDocuments";

CREATE POLICY "industry_docs_read"
  ON public."atlasIndustryDocuments"
  FOR SELECT
  TO authenticated
  USING (true);


DROP POLICY IF EXISTS "industry_chunks_read"
  ON public."atlasIndustryChunks";

CREATE POLICY "industry_chunks_read"
  ON public."atlasIndustryChunks"
  FOR SELECT
  TO authenticated
  USING (true);


DROP POLICY IF EXISTS "industry_knowledge_read"
  ON public."atlasIndustryKnowledge";

CREATE POLICY "industry_knowledge_read"
  ON public."atlasIndustryKnowledge"
  FOR SELECT
  TO authenticated
  USING (true);


DROP POLICY IF EXISTS "industry_provenance_read"
  ON public."atlasIndustryProvenance";

CREATE POLICY "industry_provenance_read"
  ON public."atlasIndustryProvenance"
  FOR SELECT
  TO authenticated
  USING (true);


-- ============================================================================
-- 9. ADMIN WRITE POLICIES
--
-- Only super_admin / atlas_admin may modify industry knowledge.
-- ============================================================================

DROP POLICY IF EXISTS "industry_docs_admin"
  ON public."atlasIndustryDocuments";

CREATE POLICY "industry_docs_admin"
  ON public."atlasIndustryDocuments"
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p."_id" = auth.uid()
        AND p.platform_role IN ('super_admin', 'atlas_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p."_id" = auth.uid()
        AND p.platform_role IN ('super_admin', 'atlas_admin')
    )
  );


DROP POLICY IF EXISTS "industry_chunks_admin"
  ON public."atlasIndustryChunks";

CREATE POLICY "industry_chunks_admin"
  ON public."atlasIndustryChunks"
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p."_id" = auth.uid()
        AND p.platform_role IN ('super_admin', 'atlas_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p."_id" = auth.uid()
        AND p.platform_role IN ('super_admin', 'atlas_admin')
    )
  );


DROP POLICY IF EXISTS "industry_knowledge_admin"
  ON public."atlasIndustryKnowledge";

CREATE POLICY "industry_knowledge_admin"
  ON public."atlasIndustryKnowledge"
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p."_id" = auth.uid()
        AND p.platform_role IN ('super_admin', 'atlas_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p."_id" = auth.uid()
        AND p.platform_role IN ('super_admin', 'atlas_admin')
    )
  );


DROP POLICY IF EXISTS "industry_provenance_admin"
  ON public."atlasIndustryProvenance";

CREATE POLICY "industry_provenance_admin"
  ON public."atlasIndustryProvenance"
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p."_id" = auth.uid()
        AND p.platform_role IN ('super_admin', 'atlas_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p."_id" = auth.uid()
        AND p.platform_role IN ('super_admin', 'atlas_admin')
    )
  );


-- ============================================================================
-- 10. RPC — LIST INDUSTRY DOCUMENTS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.industry_list_documents()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN

  IF v_user IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          '_id', d."_id",
          'title', d."title",
          'filename', d."filename",
          'status', d."status",
          'classification', d."classification",
          'chunkCount', d."chunkCount",
          'entityCount', d."entityCount",
          'industry', d."industry",
          'jurisdiction', d."jurisdiction",
          'version', d."version",
          'publishedAt', d."publishedAt",
          '_creationTime', d."_creationTime",
          'tags', d."tags"
        )
        ORDER BY d."_creationTime" DESC
      ),
      '[]'::jsonb
    )
    FROM public."atlasIndustryDocuments" d
  );

END;
$$;


-- ============================================================================
-- 11. RPC — GET INDUSTRY DOCUMENT DETAIL
-- ============================================================================

CREATE OR REPLACE FUNCTION public.industry_get_document_detail(
  p_documentId uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_doc jsonb;
  v_chunks jsonb;
  v_knowledge jsonb;
BEGIN

  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;


  SELECT jsonb_build_object(
    '_id', d."_id",
    'title', d."title",
    'filename', d."filename",
    'status', d."status",
    'classification', d."classification",
    'chunkCount', d."chunkCount",
    'entityCount', d."entityCount",
    'industry', d."industry",
    'jurisdiction', d."jurisdiction",
    'version', d."version",
    'publishedAt', d."publishedAt",
    '_creationTime', d."_creationTime",
    'tags', d."tags",
    'description', d."description",
    'sourceId', d."sourceId",
    'contentHash', d."contentHash"
  )
  INTO v_doc
  FROM public."atlasIndustryDocuments" d
  WHERE d."_id" = p_documentId;


  IF v_doc IS NULL THEN
    RETURN NULL;
  END IF;


  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        '_id', c."_id",
        'chunkIndex', c."chunkIndex",
        'content', c."content",
        'tokenCount', c."tokenCount"
      )
      ORDER BY c."chunkIndex"
    ),
    '[]'::jsonb
  )
  INTO v_chunks
  FROM public."atlasIndustryChunks" c
  WHERE c."documentId" = p_documentId;


  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        '_id', k."_id",
        'title', k."title",
        'statement', k."statement",
        'interpretation', k."interpretation",
        'knowledgeType', k."knowledgeType",
        'sourceClassification', k."sourceClassification",
        'confidence', k."confidence",
        'status', k."status",
        'industry', k."industry",
        'jurisdiction', k."jurisdiction"
      )
      ORDER BY k."confidence" DESC
    ),
    '[]'::jsonb
  )
  INTO v_knowledge
  FROM public."atlasIndustryKnowledge" k
  WHERE k."documentId" = p_documentId;


  RETURN jsonb_build_object(
    'doc', v_doc,
    'chunks', v_chunks,
    'knowledge', v_knowledge
  );

END;
$$;


-- ============================================================================
-- 12. RPC — SEARCH INDUSTRY KNOWLEDGE
-- ============================================================================

CREATE OR REPLACE FUNCTION public.industry_search_knowledge(
  p_query text DEFAULT '',
  p_industry text DEFAULT NULL,
  p_jurisdiction text DEFAULT NULL,
  p_sourceClassification text DEFAULT NULL,
  p_knowledgeType text DEFAULT NULL,
  p_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_terms text[];
  v_result jsonb;
BEGIN

  IF v_user IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;


  v_terms := string_to_array(
    lower(
      regexp_replace(
        COALESCE(p_query, ''),
        '[^a-z0-9\s]',
        ' ',
        'g'
      )
    ),
    ' '
  );


  v_terms := array_remove(v_terms, '');
  v_terms := array_remove(v_terms, 'the');
  v_terms := array_remove(v_terms, 'and');
  v_terms := array_remove(v_terms, 'or');
  v_terms := array_remove(v_terms, 'is');
  v_terms := array_remove(v_terms, 'for');
  v_terms := array_remove(v_terms, 'in');
  v_terms := array_remove(v_terms, 'to');
  v_terms := array_remove(v_terms, 'of');
  v_terms := array_remove(v_terms, 'a');
  v_terms := array_remove(v_terms, 'an');


  SELECT COALESCE(
    jsonb_agg(
      row_to_json(r)
      ORDER BY r.relevance DESC
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM (
    SELECT
      k."_id",
      k."title",
      k."statement",
      k."interpretation",
      k."knowledgeType",
      k."sourceClassification",
      k."confidence",
      k."industry",
      k."jurisdiction",
      k."version",
      k."status",
      k."tags",

      (
        CASE
          WHEN array_length(v_terms, 1) > 0
          THEN
            (
              SELECT count(*)
              FROM unnest(v_terms) t
              WHERE lower(COALESCE(k."title", '')) LIKE '%' || t || '%'
                 OR lower(COALESCE(k."statement", '')) LIKE '%' || t || '%'
                 OR lower(COALESCE(k."interpretation", '')) LIKE '%' || t || '%'
            )::double precision
            / array_length(v_terms, 1)
          ELSE 0.5
        END
        * 0.7
        + k."confidence" * 0.3
      ) AS relevance

    FROM public."atlasIndustryKnowledge" k

    WHERE k."status" = 'active'

      AND (
        p_industry IS NULL
        OR k."industry" = p_industry
      )

      AND (
        p_jurisdiction IS NULL
        OR k."jurisdiction" ILIKE '%' || p_jurisdiction || '%'
      )

      AND (
        p_sourceClassification IS NULL
        OR k."sourceClassification"::text = p_sourceClassification
      )

      AND (
        p_knowledgeType IS NULL
        OR k."knowledgeType" = p_knowledgeType
      )

      AND (
        array_length(v_terms, 1) IS NULL

        OR EXISTS (
          SELECT 1
          FROM unnest(v_terms) t
          WHERE lower(COALESCE(k."title", '')) LIKE '%' || t || '%'
             OR lower(COALESCE(k."statement", '')) LIKE '%' || t || '%'
             OR lower(COALESCE(k."interpretation", '')) LIKE '%' || t || '%'
        )
      )

    ORDER BY relevance DESC

    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))

  ) r;


  RETURN COALESCE(v_result, '[]'::jsonb);

END;
$$;


-- ============================================================================
-- 13. RPC — INDUSTRY KNOWLEDGE STATS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.industry_knowledge_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN

  IF v_user IS NULL THEN
    RETURN jsonb_build_object(
      'totalDocuments', 0,
      'totalChunks', 0,
      'totalKnowledge', 0,
      'byStatus', '{}'::jsonb,
      'byClassification', '{}'::jsonb,
      'byType', '{}'::jsonb
    );
  END IF;


  RETURN (
    SELECT jsonb_build_object(

      'totalDocuments',
      (
        SELECT count(*)::integer
        FROM public."atlasIndustryDocuments"
      ),

      'totalChunks',
      (
        SELECT count(*)::integer
        FROM public."atlasIndustryChunks"
      ),

      'totalKnowledge',
      (
        SELECT count(*)::integer
        FROM public."atlasIndustryKnowledge"
      ),

      'byStatus',
      (
        SELECT COALESCE(
          jsonb_object_agg(status, cnt),
          '{}'::jsonb
        )
        FROM (
          SELECT
            "status" AS status,
            count(*)::integer AS cnt
          FROM public."atlasIndustryDocuments"
          GROUP BY "status"
        ) s
      ),

      'byClassification',
      (
        SELECT COALESCE(
          jsonb_object_agg(sourceClassification, cnt),
          '{}'::jsonb
        )
        FROM (
          SELECT
            "sourceClassification"::text AS sourceClassification,
            count(*)::integer AS cnt
          FROM public."atlasIndustryKnowledge"
          GROUP BY "sourceClassification"
        ) c
      ),

      'byType',
      (
        SELECT COALESCE(
          jsonb_object_agg(knowledgeType, cnt),
          '{}'::jsonb
        )
        FROM (
          SELECT
            "knowledgeType" AS knowledgeType,
            count(*)::integer AS cnt
          FROM public."atlasIndustryKnowledge"
          GROUP BY "knowledgeType"
        ) t
      )

    )
  );

END;
$$;


-- ============================================================================
-- 14. RPC — INDUSTRY KNOWLEDGE GRAPH
-- ============================================================================

CREATE OR REPLACE FUNCTION public.industry_knowledge_graph()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_nodes jsonb;
  v_edges jsonb;
BEGIN

  IF v_user IS NULL THEN
    RETURN jsonb_build_object(
      'nodes', '[]'::jsonb,
      'edges', '[]'::jsonb
    );
  END IF;


  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', k."_id",
        'type', k."knowledgeType",
        'title', k."title"
      )
    ),
    '[]'::jsonb
  )
  INTO v_nodes
  FROM public."atlasIndustryKnowledge" k
  WHERE k."status" = 'active';


  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'source', k."documentId",
        'target', k."_id",
        'relationship', 'contains'
      )
    ),
    '[]'::jsonb
  )
  INTO v_edges
  FROM public."atlasIndustryKnowledge" k
  WHERE k."status" = 'active'
    AND k."documentId" IS NOT NULL;


  RETURN jsonb_build_object(
    'nodes', v_nodes,
    'edges', v_edges
  );

END;
$$;


-- ============================================================================
-- 15. RPC — SEED INDUSTRY KNOWLEDGE
--
-- This function is called by the Atlas application.
--
-- It does NOT invent seed data itself. It accepts the seed arrays generated
-- from src/lib/knowledge/seed.ts.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.industry_seed_knowledge(
  p_documents jsonb DEFAULT '[]'::jsonb,
  p_knowledge jsonb DEFAULT '[]'::jsonb,
  p_provenance jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_role text;

  v_doc jsonb;
  v_know jsonb;
  v_prov jsonb;

  v_seeded_docs integer := 0;
  v_seeded_know integer := 0;
  v_seeded_prov integer := 0;
BEGIN

  -- ========================================================================
  -- Authorization
  -- ========================================================================

  SELECT p.platform_role
  INTO v_role
  FROM public.profiles p
  WHERE p."_id" = v_user;


  IF v_role IS NULL
     OR v_role NOT IN ('super_admin', 'atlas_admin')
  THEN
    RAISE EXCEPTION
      'Only Atlas administrators can seed industry knowledge.';
  END IF;


  -- ========================================================================
  -- Documents
  -- ========================================================================

  FOR v_doc IN
    SELECT *
    FROM jsonb_array_elements(
      COALESCE(p_documents, '[]'::jsonb)
    )
  LOOP

    INSERT INTO public."atlasIndustryDocuments" (
      "title",
      "description",
      "filename",
      "mimeType",
      "size",
      "storagePath",
      "sourceType",
      "sourceUrl",
      "sourceId",
      "classification",
      "status",
      "industry",
      "jurisdiction",
      "version",
      "contentHash",
      "tags",
      "metadata"
    )
    VALUES (
      v_doc ->> 'title',
      v_doc ->> 'description',
      v_doc ->> 'filename',
      v_doc ->> 'mimeType',
      COALESCE(
        (v_doc ->> 'size')::bigint,
        0
      ),
      v_doc ->> 'storagePath',
      v_doc ->> 'sourceType',
      v_doc ->> 'sourceUrl',
      v_doc ->> 'sourceId',

      COALESCE(
        (v_doc ->> 'classification')::public.source_classification,
        'ATLAS_CURATED'
      ),

      COALESCE(
        (v_doc ->> 'status')::public.ingestion_status,
        'indexed'
      ),

      v_doc ->> 'industry',
      v_doc ->> 'jurisdiction',
      v_doc ->> 'version',
      v_doc ->> 'contentHash',

      COALESCE(
        v_doc -> 'tags',
        '[]'::jsonb
      ),

      COALESCE(
        v_doc -> 'metadata',
        '{}'::jsonb
      )
    );

    v_seeded_docs := v_seeded_docs + 1;

  END LOOP;


  -- ========================================================================
  -- Provenance
  -- ========================================================================

  FOR v_prov IN
    SELECT *
    FROM jsonb_array_elements(
      COALESCE(p_provenance, '[]'::jsonb)
    )
  LOOP

    INSERT INTO public."atlasIndustryProvenance" (
      "sourceId",
      "sourceName",
      "organization",
      "authorityTier",
      "sourceType",
      "canonicalUrl",
      "jurisdiction",
      "industry",
      "status"
    )
    VALUES (
      v_prov ->> 'sourceId',
      v_prov ->> 'sourceName',
      v_prov ->> 'organization',

      COALESCE(
        v_prov ->> 'authorityTier',
        'tier3_industry'
      ),

      COALESCE(
        v_prov ->> 'sourceType',
        'curated'
      ),

      v_prov ->> 'canonicalUrl',
      v_prov ->> 'jurisdiction',
      v_prov ->> 'industry',

      COALESCE(
        v_prov ->> 'status',
        'active'
      )
    )

    ON CONFLICT ("sourceId")
    DO NOTHING;

    v_seeded_prov := v_seeded_prov + 1;

  END LOOP;


  -- ========================================================================
  -- Knowledge
  -- ========================================================================

  FOR v_know IN
    SELECT *
    FROM jsonb_array_elements(
      COALESCE(p_knowledge, '[]'::jsonb)
    )
  LOOP

    INSERT INTO public."atlasIndustryKnowledge" (
      "title",
      "statement",
      "interpretation",
      "knowledgeType",
      "sourceClassification",
      "industry",
      "jurisdiction",
      "version",
      "confidence",
      "status",
      "isInference",
      "tags"
    )
    VALUES (
      v_know ->> 'title',
      v_know ->> 'statement',
      v_know ->> 'interpretation',
      v_know ->> 'knowledgeType',

      COALESCE(
        (v_know ->> 'sourceClassification')::public.source_classification,
        'ATLAS_CURATED'
      ),

      v_know ->> 'industry',
      v_know ->> 'jurisdiction',
      v_know ->> 'version',

      COALESCE(
        (v_know ->> 'confidence')::double precision,
        0.7
      ),

      COALESCE(
        v_know ->> 'status',
        'active'
      ),

      COALESCE(
        (v_know ->> 'isInference')::boolean,
        false
      ),

      COALESCE(
        v_know -> 'tags',
        '[]'::jsonb
      )
    );

    v_seeded_know := v_seeded_know + 1;

  END LOOP;


  -- ========================================================================
  -- Return result
  -- ========================================================================

  RETURN jsonb_build_object(
    'seededDocuments', v_seeded_docs,
    'seededKnowledge', v_seeded_know,
    'seededProvenance', v_seeded_prov
  );

END;
$$;


-- ============================================================================
-- 16. GRANTS
--
-- RPCs are callable by authenticated Atlas users.
-- The seed RPC still performs its own super_admin / atlas_admin check.
-- ============================================================================

GRANT EXECUTE
  ON FUNCTION public.industry_list_documents()
  TO authenticated;

GRANT EXECUTE
  ON FUNCTION public.industry_get_document_detail(uuid)
  TO authenticated;

GRANT EXECUTE
  ON FUNCTION public.industry_search_knowledge(
    text,
    text,
    text,
    text,
    text,
    integer
  )
  TO authenticated;

GRANT EXECUTE
  ON FUNCTION public.industry_knowledge_stats()
  TO authenticated;

GRANT EXECUTE
  ON FUNCTION public.industry_knowledge_graph()
  TO authenticated;

GRANT EXECUTE
  ON FUNCTION public.industry_seed_knowledge(
    jsonb,
    jsonb,
    jsonb
  )
  TO authenticated;


-- ============================================================================
-- 17. FINAL DEPLOYMENT VERIFICATION
--
-- These SELECTs intentionally run at the end so the SQL editor will return
-- immediate confirmation after a successful migration.
-- ============================================================================

SELECT
  table_schema,
  table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'atlasIndustryDocuments',
    'atlasIndustryChunks',
    'atlasIndustryKnowledge',
    'atlasIndustryProvenance'
  )
ORDER BY table_name;


SELECT
  'atlasIndustryDocuments' AS table_name,
  count(*) AS row_count
FROM public."atlasIndustryDocuments"

UNION ALL

SELECT
  'atlasIndustryChunks',
  count(*)
FROM public."atlasIndustryChunks"

UNION ALL

SELECT
  'atlasIndustryKnowledge',
  count(*)
FROM public."atlasIndustryKnowledge"

UNION ALL

SELECT
  'atlasIndustryProvenance',
  count(*)
FROM public."atlasIndustryProvenance";


-- ============================================================================
-- END MIGRATION
-- ============================================================================
