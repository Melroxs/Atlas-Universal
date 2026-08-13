-- ---------------------------------------------------------------------------
-- Fix "cannot extract elements from a scalar" (SQLSTATE 22023) in
-- insurance_get_claim_package and nested evidence ids in
-- insurance_attach_claim_evidence.
--
-- 1. A claim row with NULL "evidenceDocumentIds" / "evidenceSummary" is
--    serialized by to_jsonb() with JSON `null` scalars for those keys. The
--    coalesce(v_claim -> 'evidenceDocumentIds', '[]'::jsonb) idiom only
--    defends against SQL NULL, not JSON null, so jsonb_array_elements_text()
--    raises 22023. This affected every claim created before evidence was
--    attached (candidate approval, manual creation) — breaking ClaimDetail
--    and runClaimAnalysis in production.
-- 2. insurance_attach_claim_evidence aggregated the derived-table ROW
--    (jsonb_agg(x)) instead of the column (jsonb_agg(value)), wrapping each
--    id as {"value": ...} and nesting one level per attach call. Reading
--    those ids back then failed with invalid input syntax for type uuid.
--    The reader is also hardened to skip any non-string elements so legacy
--    rows never crash the package view again.
-- 3. Approve initializes the evidence arrays so new claims start clean.
-- ---------------------------------------------------------------------------

create or replace function public.insurance_get_claim_package(p_claimId uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
  v_claim jsonb;
  v_supplements jsonb;
  v_findings jsonb;
  v_evidence jsonb;
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  select to_jsonb(c) into v_claim from public.insuranceClaims c
  where c._id = p_claimId and c."tenantId" = v_tenant;
  if v_claim is null then raise exception 'Claim not found.'; end if;

  select coalesce(jsonb_agg(to_jsonb(s) order by s."_creationTime" desc), '[]'::jsonb) into v_supplements
  from public.claimSupplements s where s."claimId" = p_claimId;

  select coalesce(jsonb_agg(to_jsonb(f) order by f."_creationTime" desc), '[]'::jsonb) into v_findings
  from public.claimFindings f where f."claimId" = p_claimId;

  -- Only string elements are document ids. Legacy rows written by the old
  -- attach (nested {"value": …} wrappers) are skipped rather than crashing.
  select coalesce(jsonb_agg(jsonb_build_object(
    '_id', d._id, 'title', d.title, 'classification', d.classification
  )), '[]'::jsonb) into v_evidence
  from jsonb_array_elements(
    coalesce(nullif(v_claim -> 'evidenceDocumentIds', 'null'::jsonb), '[]'::jsonb)
  ) e
  join public.documents d on d._id = (e #>> '{}')::uuid and d."tenantId" = v_tenant
  where jsonb_typeof(e) = 'string';

  return jsonb_build_object(
    'claim', v_claim, 'supplements', v_supplements, 'findings', v_findings, 'evidenceDocs', v_evidence
  );
end;
$$;

-- Aggregate the column (jsonb_agg(value)), never the derived-table row, so
-- evidence ids stay a flat array of strings no matter how often evidence is
-- attached.
create or replace function public.insurance_attach_claim_evidence(p_claimId uuid, p_documentId uuid)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_claim public.insuranceClaims;
  v_doc public.documents;
  v_ids jsonb;
  v_categories text[] := '{}'::text[];
  v_classification text;
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if public.my_member_role() not in ('owner', 'admin', 'manager', 'analyst') then
    raise exception 'Only editors and above can attach evidence.';
  end if;
  select * into v_claim from public.insuranceClaims c where c._id = p_claimId and c."tenantId" = v_tenant;
  if v_claim._id is null then raise exception 'Claim not found.'; end if;
  select * into v_doc from public.documents d where d._id = p_documentId and d."tenantId" = v_tenant;
  if v_doc._id is null then raise exception 'Document not found.'; end if;

  v_ids := (select coalesce(jsonb_agg(value), '[]'::jsonb) from (
    select value from jsonb_array_elements(coalesce(v_claim."evidenceDocumentIds", '[]'::jsonb)) value
    union select to_jsonb(p_documentId::text)
  ) x);

  v_classification := lower(v_doc.classification);
  if v_classification ~ 'estimate|scope' then v_categories := v_categories || array['estimate']; end if;
  if v_classification ~ 'invoice|financial' then v_categories := v_categories || array['invoice']; end if;
  if v_classification ~ 'photo|image' then v_categories := v_categories || array['photos']; end if;
  if v_classification ~ 'report|meeting|communication|regulatory' then v_categories := v_categories || array['documentation']; end if;

  update public.insuranceClaims set
    "evidenceDocumentIds" = v_ids,
    "evidenceSummary" = (
      select coalesce(jsonb_agg(DISTINCT value), '[]'::jsonb) from (
        select value from jsonb_array_elements(coalesce(v_claim."evidenceSummary", '[]'::jsonb)) value
        union select to_jsonb(x) from unnest(v_categories) x
      ) u
    ),
    "updatedAt" = public.epoch_ms()
  where _id = p_claimId;

  perform public.log_audit('claim_evidence_attached', 'insuranceClaim', p_claimId::text,
    jsonb_build_object('documentId', p_documentId::text, 'categories', to_jsonb(v_categories)));
  return jsonb_build_object('claimId', p_claimId, 'evidenceSummary', (
    select "evidenceSummary" from public.insuranceClaims where _id = p_claimId));
end;
$$;

-- Initialize the evidence arrays when a candidate is approved so newly
-- created claims never carry JSON-null columns into readers.
create or replace function public.insurance_approve_claim_candidate(p_candidateId uuid)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_candidate public.claimCandidates;
  v_claim_id uuid;
  v_now bigint := public.epoch_ms();
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if public.my_member_role() not in ('owner', 'admin', 'manager', 'analyst') then
    raise exception 'Only editors and above can approve candidates.';
  end if;
  select * into v_candidate from public.claimCandidates c
  where c._id = p_candidateId and c."tenantId" = v_tenant;
  if v_candidate._id is null then raise exception 'Candidate not found.'; end if;
  if v_candidate.status <> 'pending' then
    raise exception 'This candidate was already processed.';
  end if;

  insert into public.insuranceClaims (
    "tenantId", "claimNumber", customer, property, status, provenance,
    confidence, "evidenceDocumentIds", "evidenceSummary", "createdBy", "createdAt", "updatedAt"
  )
  values (
    v_tenant, v_candidate."claimNumber", v_candidate.customer, v_candidate.property,
    'opened', 'Created from an archive candidate — fields require confirmation.',
    0.6, '[]'::jsonb, '[]'::jsonb, v_user, v_now, v_now
  )
  returning _id into v_claim_id;

  update public.claimCandidates set status = 'approved', "updatedAt" = v_now
  where _id = p_candidateId;

  perform public.log_audit('claim_candidate_approved', 'claimCandidate', p_candidateId::text,
    jsonb_build_object('claimId', v_claim_id::text, 'claimNumber', v_candidate."claimNumber"));
  return jsonb_build_object('claimId', v_claim_id);
end;
$$;
