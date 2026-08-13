-- ============================================================================
-- Atlas on Supabase — migration 0008: archive contract hardening.
--
-- archive_get_detail() already returns data only for the caller's tenant via
-- RLS (the function runs as the authenticated caller). This migration makes
-- the tenant isolation explicit inside the function for every sub-query —
-- archive files and claim candidates were previously filtered by archive id
-- alone and relied on RLS to prevent cross-tenant reads. Defense-in-depth:
-- even if a future change weakens the RLS policies, the RPC itself can never
-- return another tenant's files or claim candidates.
--
-- No schema/table changes; no data migrations; fully idempotent.
-- ============================================================================

create or replace function public.archive_get_detail(p_archiveId uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
  v_archive jsonb;
  v_files jsonb;
  v_docs jsonb;
  v_candidates jsonb;
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  select to_jsonb(a) into v_archive from public.archiveIngestions a
  where a._id = p_archiveId and a."tenantId" = v_tenant;
  if v_archive is null then return null; end if;

  -- Files: explicit tenant check (RLS would also filter, but never rely on it).
  select coalesce(jsonb_agg(to_jsonb(f) order by f.path), '[]'::jsonb) into v_files
  from (select * from public.archiveFiles f
        where f."archiveId" = p_archiveId and f."tenantId" = v_tenant
        order by path limit 2000) f;

  -- Docs: joined tenant check on the document itself.
  select coalesce(jsonb_object_agg(f."documentId"::text, jsonb_build_object(
    '_id', d._id, 'title', d.title, 'classification', d.classification, 'status', d.status
  )), '{}'::jsonb) into v_docs
  from public.archiveFiles f
  join public.documents d on d._id = f."documentId"
  where f."archiveId" = p_archiveId and f."documentId" is not null
    and f."tenantId" = v_tenant and d."tenantId" = v_tenant
  limit 300;

  -- Claim candidates: explicit tenant check (RLS would also filter).
  select coalesce(jsonb_agg(to_jsonb(c) order by c."createdAt"), '[]'::jsonb) into v_candidates
  from (select * from public.claimCandidates c
        where c."archiveId" = p_archiveId and c."tenantId" = v_tenant
        limit 50) c;

  return jsonb_build_object('archive', v_archive, 'files', v_files, 'docs', v_docs, 'candidates', v_candidates);
end;
$$;

-- Recreated functions keep their grants under `alter default privileges`, but
-- state the grant explicitly so the contract survives any environment that
-- resets defaults.
grant execute on function public.archive_get_detail(uuid) to anon, authenticated;
