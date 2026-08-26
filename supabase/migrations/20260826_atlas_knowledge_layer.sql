-- ---------------------------------------------------------------------------
-- Atlas Knowledge Layer — Industry Knowledge Tables
--
-- Migration 20260826: Establishes the foundational industry knowledge layer
-- for Atlas. This is Layer 1 knowledge — shared across all customers, not
-- tenant-specific.
--
-- Tables:
--   atlasIndustryDocuments  — Source documents for industry knowledge
--   atlasIndustryChunks     — Text chunks with embeddings
--   atlasIndustryKnowledge  — Extracted knowledge items
--   atlasIndustryProvenance — Source provenance records
--
-- All tables are RLS-protected: customers can read published industry
-- knowledge but cannot modify it. Only super_admin/atlas_admin can manage.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Required PostgreSQL extensions / helper functions
-- ---------------------------------------------------------------------------

-- Supabase normally has pgcrypto available, but make this migration
-- self-contained and safe to run on a project where it has not been enabled.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Atlas stores timestamps as Unix epoch milliseconds.
-- Create the helper used by the Atlas schema.
CREATE OR REPLACE FUNCTION public.epoch_ms()
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
  SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
$$;


-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Enum for knowledge layers
DO $$ BEGIN
  CREATE TYPE knowledge_layer AS ENUM (
    'atlas_industry',
    'customer',
    'live_evidence'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


-- Enum for source classification
DO $$ BEGIN
  CREATE TYPE source_classification AS ENUM (
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
END $$;


-- Enum for ingestion status
DO $$ BEGIN
  CREATE TYPE ingestion_status AS ENUM (
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
END $$;


-- ---------------------------------------------------------------------------
-- Industry knowledge documents
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.atlasIndustryDocuments (
  _id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  _creationTime   bigint DEFAULT public.epoch_ms(),

  title           text NOT NULL,
  description     text,
  filename        text,
  mimeType        text,
  size            bigint DEFAULT 0,

  storagePath     text,
  sourceType      text,
  sourceUrl       text,
  sourceId        text,

  classification  source_classification DEFAULT 'ATLAS_CURATED',
  status          ingestion_status DEFAULT 'uploaded',

  error           text,
  chunkCount      int DEFAULT 0,
  entityCount     int DEFAULT 0,

  processedAt     bigint,
  publishedAt     bigint,

  industry        text,
  jurisdiction    text,
  version         text,
  contentHash     text,

  tags            jsonb DEFAULT '[]'::jsonb,
  metadata        jsonb DEFAULT '{}'::jsonb
);


-- ---------------------------------------------------------------------------
-- Industry knowledge chunks
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.atlasIndustryChunks (
  _id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  _creationTime   bigint DEFAULT public.epoch_ms(),

  documentId      uuid NOT NULL
                  REFERENCES public.atlasIndustryDocuments(_id)
                  ON DELETE CASCADE,

  chunkIndex      int NOT NULL DEFAULT 0,
  content         text NOT NULL,
  tokenCount      int,

  -- Embedding vector stored as JSONB array.
  -- This intentionally avoids requiring pgvector for the initial layer.
  embedding       jsonb,

  metadata        jsonb DEFAULT '{}'::jsonb,

  UNIQUE (documentId, chunkIndex)
);


-- ---------------------------------------------------------------------------
-- Industry knowledge items
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.atlasIndustryKnowledge (
  _id                     uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  _creationTime           bigint DEFAULT public.epoch_ms(),

  documentId              uuid
                          REFERENCES public.atlasIndustryDocuments(_id)
                          ON DELETE SET NULL,

  title                   text NOT NULL,
  statement               text NOT NULL,
  interpretation          text,

  knowledgeType           text NOT NULL,

  sourceClassification    source_classification
                          DEFAULT 'ATLAS_CURATED',

  industry                text,
  jurisdiction            text,
  version                 text,

  confidence              double precision DEFAULT 0.7,

  status                  text DEFAULT 'active',

  isInference             boolean DEFAULT false,

  tags                    jsonb DEFAULT '[]'::jsonb,

  -- References to atlasIndustryChunks._id.
  chunkIds                jsonb DEFAULT '[]'::jsonb,

  publishedAt             bigint,
  updatedAt               bigint
);


-- ---------------------------------------------------------------------------
-- Source provenance records
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.atlasIndustryProvenance (
  _id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  _creationTime   bigint DEFAULT public.epoch_ms(),

  sourceId        text NOT NULL UNIQUE,
  sourceName      text NOT NULL,
  organization    text NOT NULL,

  authorityTier   text DEFAULT 'tier3_industry',
  sourceType      text DEFAULT 'curated',

  canonicalUrl    text,

  jurisdiction    text,
  industry        text,

  publicationDate bigint,
  retrievalDate   bigint,
  effectiveDate   bigint,

  version         text,

  status          text DEFAULT 'active',

  supersededBy    jsonb DEFAULT '[]'::jsonb,
  metadata        jsonb DEFAULT '{}'::jsonb
);


-- ---------------------------------------------------------------------------
-- Indexes for retrieval performance
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_industry_chunks_doc
  ON public.atlasIndustryChunks(documentId);

CREATE INDEX IF NOT EXISTS idx_industry_knowledge_doc
  ON public.atlasIndustryKnowledge(documentId);

CREATE INDEX IF NOT EXISTS idx_industry_knowledge_type
  ON public.atlasIndustryKnowledge(knowledgeType);

CREATE INDEX IF NOT EXISTS idx_industry_knowledge_industry
  ON public.atlasIndustryKnowledge(industry);

CREATE INDEX IF NOT EXISTS idx_industry_knowledge_status
  ON public.atlasIndustryKnowledge(status);

CREATE INDEX IF NOT EXISTS idx_industry_knowledge_source
  ON public.atlasIndustryKnowledge(sourceClassification);

CREATE INDEX IF NOT EXISTS idx_industry_documents_status
  ON public.atlasIndustryDocuments(status);


-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE public.atlasIndustryDocuments
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.atlasIndustryChunks
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.atlasIndustryKnowledge
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.atlasIndustryProvenance
  ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- Read policies
--
-- Authenticated users can read industry knowledge.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "industry_docs_read"
  ON public.atlasIndustryDocuments;

CREATE POLICY "industry_docs_read"
  ON public.atlasIndustryDocuments
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
  );


DROP POLICY IF EXISTS "industry_chunks_read"
  ON public.atlasIndustryChunks;

CREATE POLICY "industry_chunks_read"
  ON public.atlasIndustryChunks
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
  );


DROP POLICY IF EXISTS "industry_knowledge_read"
  ON public.atlasIndustryKnowledge;

CREATE POLICY "industry_knowledge_read"
  ON public.atlasIndustryKnowledge
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
  );


DROP POLICY IF EXISTS "industry_provenance_read"
  ON public.atlasIndustryProvenance;

CREATE POLICY "industry_provenance_read"
  ON public.atlasIndustryProvenance
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
  );


-- ---------------------------------------------------------------------------
-- Admin write policies
--
-- Only super_admin / atlas_admin may modify industry knowledge.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "industry_docs_admin"
  ON public.atlasIndustryDocuments;

CREATE POLICY "industry_docs_admin"
  ON public.atlasIndustryDocuments
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles._id = auth.uid()
        AND profiles.platform_role IN ('super_admin', 'atlas_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles._id = auth.uid()
        AND profiles.platform_role IN ('super_admin', 'atlas_admin')
    )
  );


DROP POLICY IF EXISTS "industry_chunks_admin"
  ON public.atlasIndustryChunks;

CREATE POLICY "industry_chunks_admin"
  ON public.atlasIndustryChunks
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles._id = auth.uid()
        AND profiles.platform_role IN ('super_admin', 'atlas_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles._id = auth.uid()
        AND profiles.platform_role IN ('super_admin', 'atlas_admin')
    )
  );


DROP POLICY IF EXISTS "industry_knowledge_admin"
  ON public.atlasIndustryKnowledge;

CREATE POLICY "industry_knowledge_admin"
  ON public.atlasIndustryKnowledge
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles._id = auth.uid()
        AND profiles.platform_role IN ('super_admin', 'atlas_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles._id = auth.uid()
        AND profiles.platform_role IN ('super_admin', 'atlas_admin')
    )
  );


DROP POLICY IF EXISTS "industry_provenance_admin"
  ON public.atlasIndustryProvenance;

CREATE POLICY "industry_provenance_admin"
  ON public.atlasIndustryProvenance
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles._id = auth.uid()
        AND profiles.platform_role IN ('super_admin', 'atlas_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles._id = auth.uid()
        AND profiles.platform_role IN ('super_admin', 'atlas_admin')
    )
  );


-- ---------------------------------------------------------------------------
-- RPC: List industry knowledge documents
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.industry_list_documents()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
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
          '_id', d._id,
          'title', d.title,
          'filename', d.filename,
          'status', d.status,
          'classification', d.classification,
          'chunkCount', d.chunkCount,
          'entityCount', d.entityCount,
          'industry', d.industry,
          'jurisdiction', d.jurisdiction,
          'version', d.version,
          'publishedAt', d.publishedAt,
          '_creationTime', d._creationTime,
          'tags', d.tags
        )
        ORDER BY d._creationTime DESC
      ),
      '[]'::jsonb
    )
    FROM public.atlasIndustryDocuments d
  );
END;
$$;


-- ---------------------------------------------------------------------------
-- RPC: Get industry knowledge document detail
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.industry_get_document_detail(
  p_documentId uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_user      uuid := auth.uid();
  v_doc       jsonb;
  v_chunks    jsonb;
  v_knowledge jsonb;
BEGIN
  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    '_id', d._id,
    'title', d.title,
    'filename', d.filename,
    'status', d.status,
    'classification', d.classification,
    'chunkCount', d.chunkCount,
    'entityCount', d.entityCount,
    'industry', d.industry,
    'jurisdiction', d.jurisdiction,
    'version', d.version,
    'publishedAt', d.publishedAt,
    '_creationTime', d._creationTime,
    'tags', d.tags,
    'description', d.description,
    'sourceId', d.sourceId,
    'contentHash', d.contentHash
  )
  INTO v_doc
  FROM public.atlasIndustryDocuments d
  WHERE d._id = p_documentId;

  IF v_doc IS NULL THEN
    RETURN NULL;
  END IF;


  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        '_id', c._id,
        'chunkIndex', c.chunkIndex,
        'content', c.content,
        'tokenCount', c.tokenCount
      )
      ORDER BY c.chunkIndex
    ),
    '[]'::jsonb
  )
  INTO v_chunks
  FROM public.atlasIndustryChunks c
  WHERE c.documentId = p_documentId;


  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        '_id', k._id,
        'title', k.title,
        'statement', k.statement,
        'interpretation', k.interpretation,
        'knowledgeType', k.knowledgeType,
        'sourceClassification', k.sourceClassification,
        'confidence', k.confidence,
        'status', k.status,
        'industry', k.industry,
        'jurisdiction', k.jurisdiction
      )
      ORDER BY k.confidence DESC
    ),
    '[]'::jsonb
  )
  INTO v_knowledge
  FROM public.atlasIndustryKnowledge k
  WHERE k.documentId = p_documentId;

  RETURN jsonb_build_object(
    'doc', v_doc,
    'chunks', v_chunks,
    'knowledge', v_knowledge
  );
END;
$$;


-- ---------------------------------------------------------------------------
-- RPC: Search industry knowledge
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.industry_search_knowledge(
  p_query text DEFAULT '',
  p_industry text DEFAULT NULL,
  p_jurisdiction text DEFAULT NULL,
  p_sourceClassification text DEFAULT NULL,
  p_knowledgeType text DEFAULT NULL,
  p_limit int DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_terms  text[];
  v_result jsonb;
BEGIN
  IF v_user IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Tokenize query into search terms.
  v_terms := string_to_array(
    lower(
      regexp_replace(
        p_query,
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
      k._id,
      k.title,
      k.statement,
      k.interpretation,
      k.knowledgeType,
      k.sourceClassification,
      k.confidence,
      k.industry,
      k.jurisdiction,
      k.version,
      k.status,
      k.tags,

      (
        CASE
          WHEN array_length(v_terms, 1) > 0 THEN
            (
              SELECT count(*)
              FROM unnest(v_terms) t
              WHERE lower(k.title) LIKE '%' || t || '%'
                 OR lower(k.statement) LIKE '%' || t || '%'
                 OR lower(COALESCE(k.interpretation, '')) LIKE '%' || t || '%'
            )::double precision
            / array_length(v_terms, 1)
          ELSE 0.5
        END
        * 0.7
        + k.confidence * 0.3
      ) AS relevance

    FROM public.atlasIndustryKnowledge k

    WHERE k.status = 'active'

      AND (
        p_industry IS NULL
        OR k.industry = p_industry
      )

      AND (
        p_jurisdiction IS NULL
        OR k.jurisdiction ILIKE '%' || p_jurisdiction || '%'
      )

      AND (
        p_sourceClassification IS NULL
        OR k.sourceClassification::text = p_sourceClassification
      )

      AND (
        p_knowledgeType IS NULL
        OR k.knowledgeType = p_knowledgeType
      )

      AND (
        array_length(v_terms, 1) IS NULL

        OR EXISTS (
          SELECT 1
          FROM unnest(v_terms) t
          WHERE lower(k.title) LIKE '%' || t || '%'
             OR lower(k.statement) LIKE '%' || t || '%'
             OR lower(COALESCE(k.interpretation, '')) LIKE '%' || t || '%'
        )
      )

    ORDER BY relevance DESC

    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))
  ) r;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;


-- ---------------------------------------------------------------------------
-- RPC: Get industry knowledge statistics
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.industry_knowledge_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
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
        SELECT count(*)::int
        FROM public.atlasIndustryDocuments
      ),

      'totalChunks',
      (
        SELECT count(*)::int
        FROM public.atlasIndustryChunks
      ),

      'totalKnowledge',
      (
        SELECT count(*)::int
        FROM public.atlasIndustryKnowledge
      ),

      'byStatus',
      (
        SELECT COALESCE(
          jsonb_object_agg(status, cnt),
          '{}'::jsonb
        )
        FROM (
          SELECT
            status,
            count(*)::int AS cnt
          FROM public.atlasIndustryDocuments
          GROUP BY status
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
            sourceClassification,
            count(*)::int AS cnt
          FROM public.atlasIndustryKnowledge
          GROUP BY sourceClassification
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
            knowledgeType,
            count(*)::int AS cnt
          FROM public.atlasIndustryKnowledge
          GROUP BY knowledgeType
        ) t
      )
    )
  );
END;
$$;


-- ---------------------------------------------------------------------------
-- RPC: Get industry knowledge graph snapshot
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.industry_knowledge_graph()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_nodes jsonb;
  v_edges jsonb;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object(
      'nodes',
      '[]'::jsonb,
      'edges',
      '[]'::jsonb
    );
  END IF;


  -- Build nodes from knowledge items.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', k._id,
        'type', k.knowledgeType,
        'title', k.title
      )
    ),
    '[]'::jsonb
  )
  INTO v_nodes
  FROM public.atlasIndustryKnowledge k
  WHERE k.status = 'active';


  -- Build edges from document → knowledge relationships.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'source', k.documentId,
        'target', k._id,
        'relationship', 'contains'
      )
    ),
    '[]'::jsonb
  )
  INTO v_edges
  FROM public.atlasIndustryKnowledge k
  WHERE k.status = 'active'
    AND k.documentId IS NOT NULL;


  RETURN jsonb_build_object(
    'nodes', v_nodes,
    'edges', v_edges
  );
END;
$$;


-- ---------------------------------------------------------------------------
-- RPC: Seed industry knowledge
--
-- IMPORTANT:
-- This function does NOT contain Atlas's TypeScript seed records itself.
-- The application passes the seed arrays into this RPC.
--
-- Expected seed payload:
--   p_documents
--   p_knowledge
--   p_provenance
--
-- Authorization:
--   super_admin / atlas_admin only.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.industry_seed_knowledge(
  p_documents jsonb DEFAULT '[]'::jsonb,
  p_knowledge jsonb DEFAULT '[]'::jsonb,
  p_provenance jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_user          uuid := auth.uid();
  v_role          text;

  v_doc           jsonb;
  v_know          jsonb;
  v_prov          jsonb;

  v_seeded_docs   int := 0;
  v_seeded_know   int := 0;
  v_seeded_prov   int := 0;
BEGIN

  -- ---------------------------------------------------------------
  -- Authorization
  -- ---------------------------------------------------------------

  SELECT platform_role
  INTO v_role
  FROM public.profiles
  WHERE _id = v_user;

  IF v_role IS NULL
     OR v_role NOT IN ('super_admin', 'atlas_admin')
  THEN
    RAISE EXCEPTION
      'Only Atlas administrators can seed industry knowledge.';
  END IF;


  -- ---------------------------------------------------------------
  -- Seed provenance
  -- ---------------------------------------------------------------

  FOR v_prov IN
    SELECT *
    FROM jsonb_array_elements(
      COALESCE(p_provenance, '[]'::jsonb)
    )
  LOOP

    INSERT INTO public.atlasIndustryProvenance (
      sourceId,
      sourceName,
      organization,
      authorityTier,
      sourceType,
      canonicalUrl,
      jurisdiction,
      industry,
      status
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

    ON CONFLICT (sourceId)
    DO NOTHING;

    v_seeded_prov := v_seeded_prov + 1;

  END LOOP;


  -- ---------------------------------------------------------------
  -- Seed knowledge items
  --
  -- Seed knowledge is intentionally not linked to a document because
  -- these are Atlas-curated foundational knowledge records.
  -- ---------------------------------------------------------------

  FOR v_know IN
    SELECT *
    FROM jsonb_array_elements(
      COALESCE(p_knowledge, '[]'::jsonb)
    )
  LOOP

    INSERT INTO public.atlasIndustryKnowledge (
      title,
      statement,
      interpretation,
      knowledgeType,
      sourceClassification,
      industry,
      jurisdiction,
      version,
      confidence,
      status,
      isInference,
      tags
    )
    VALUES (
      v_know ->> 'title',
      v_know ->> 'statement',
      v_know ->> 'interpretation',

      v_know ->> 'knowledgeType',

      COALESCE(
        v_know ->> 'sourceClassification',
        'ATLAS_CURATED'
      )::source_classification,

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


  -- ---------------------------------------------------------------
  -- Return results
  -- ---------------------------------------------------------------

  RETURN jsonb_build_object(
    'seededDocuments', v_seeded_docs,
    'seededKnowledge', v_seeded_know,
    'seededProvenance', v_seeded_prov
  );

END;
$$;


-- ---------------------------------------------------------------------------
-- Permissions
--
-- Supabase normally exposes functions through the API according to the
-- caller role. Explicitly grant execute to authenticated users; the RPC
-- itself enforces admin authorization for seeding.
-- ---------------------------------------------------------------------------

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
  int
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


-- ---------------------------------------------------------------------------
-- Migration verification metadata
-- ---------------------------------------------------------------------------

COMMENT ON TABLE public.atlasIndustryDocuments IS
  'Atlas Layer 1 shared industry knowledge source documents.';

COMMENT ON TABLE public.atlasIndustryChunks IS
  'Chunked content from Atlas Layer 1 industry knowledge documents.';

COMMENT ON TABLE public.atlasIndustryKnowledge IS
  'Extracted and curated Atlas Layer 1 industry knowledge items.';

COMMENT ON TABLE public.atlasIndustryProvenance IS
  'Provenance and authority metadata for Atlas Layer 1 industry knowledge sources.';


-- ---------------------------------------------------------------------------
-- END OF MIGRATION
-- ---------------------------------------------------------------------------
