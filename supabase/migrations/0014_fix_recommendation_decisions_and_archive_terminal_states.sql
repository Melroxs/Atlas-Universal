-- ============================================================================
-- Atlas on Supabase — migration 0014: recommendation decisions + terminal
-- archive states.
--
-- Production defects this repairs (all live-verified against the deployed
-- project):
--
--   1. recommendations_decide(p_recommendationid, p_status) exists in the
--      deployed schema with BOTH arguments required, but the frontend called
--      it with only p_recommendationid → PGRST202 → every Approve/Reject/
--      Dismiss/Mark-executed button failed with "Action failed". The client
--      now always sends p_status (see src/lib/recommendations/decide.ts). This
--      migration additionally enforces the canonical state machine
--      (open → approved/rejected/dismissed, approved → executed) with
--      structured, user-displayable errors and returns the updated state.
--
--   2. Documents and archive files could be left in `processing` / `queued`
--      forever (a failed parse left the created document stuck in
--      `processing`; files submitted without a storage object could never be
--      ingested; a dead browser tab left the archive `inventorying` with no
--      resume path). This migration adds an explicit errorStage column for
--      structured errors and makes archive_cancel terminalize every
--      non-terminal file (→ skipped) so no record can remain indefinitely
--      queued/processing.
--
-- Fully idempotent: create-or-replace functions and `add column if not
-- exists`. Safe to apply repeatedly.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Structured error stage columns
-- ---------------------------------------------------------------------------

alter table public.documents add column if not exists "errorStage" text;
alter table public.archiveFiles add column if not exists "errorStage" text;

comment on column public.documents."errorStage" is
  'Which pipeline stage failed: upload | extraction | embedding | ingestion.';
comment on column public.archiveFiles."errorStage" is
  'Which pipeline stage failed: upload | extraction | embedding | ingestion.';

-- ---------------------------------------------------------------------------
-- 2. archive_patch_file — also patch errorStage (and support nulling it)
-- ---------------------------------------------------------------------------

create or replace function public.archive_patch_file(p_fileId uuid, p_patch jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_file public.archiveFiles;
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;

  select * into v_file from public.archiveFiles f
  where f._id = p_fileId and f."tenantId" = v_tenant;
  if v_file._id is null then raise exception 'Archive file not found.'; end if;

  update public.archiveFiles set
    "ingestStatus" = coalesce(p_patch ->> 'ingestStatus', "ingestStatus"),
    "documentId" = coalesce((p_patch ->> 'documentId')::uuid, "documentId"),
    error = case when p_patch ? 'error' then p_patch ->> 'error' else error end,
    "errorStage" = case when p_patch ? 'errorStage' then p_patch ->> 'errorStage' else "errorStage" end,
    "retryCount" = coalesce((p_patch ->> 'retryCount')::double precision, "retryCount")
  where _id = p_fileId;

  perform public.log_audit('archive_file_patched', 'archiveFiles', p_fileId::text, jsonb_build_object('ingestStatus', p_patch ->> 'ingestStatus'));
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.archive_patch_file(uuid, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2b. ingestion_patch_document — build the UPDATE only from columns that
--     actually exist, so a patch key that predates a migration can NEVER make
--     the whole update throw (which previously left documents stuck in
--     `processing` when the error was swallowed by the caller).
-- ---------------------------------------------------------------------------

create or replace function public.ingestion_patch_document(p_documentId uuid, p_patch jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_tenant uuid := public.my_tenant_id();
  v_set text;
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if not exists (select 1 from public.documents d where d._id = p_documentId and d."tenantId" = v_tenant) then
    raise exception 'Document not found.';
  end if;
  select string_agg(quote_ident(k) || ' = ' || case when v is null then 'null' else quote_literal(v #>> '{}') end, ', ')
  into v_set
  from jsonb_each(p_patch) e(k, v)
  where k not in ('_id', '_creationTime', 'tenantId')
    and exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'documents' and c.column_name = k
    );
  if v_set is not null then
    execute 'update public.documents set ' || v_set || ' where _id = ' || quote_literal(p_documentId::text);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.ingestion_patch_document(uuid, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. archive_cancel — terminalize every non-terminal file so nothing can
--    remain queued/processing indefinitely after a cancellation
-- ---------------------------------------------------------------------------

create or replace function public.archive_cancel(p_archiveId uuid)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_archive public.archiveIngestions;
  v_skipped bigint;
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if public.my_member_role() not in ('owner', 'admin', 'manager', 'analyst') then
    raise exception 'Only editors can cancel an import.';
  end if;
  select * into v_archive from public.archiveIngestions a
  where a._id = p_archiveId and a."tenantId" = v_tenant;
  if v_archive._id is null then raise exception 'Archive not found.'; end if;
  if v_archive.status in ('completed', 'completed_with_warnings', 'failed', 'cancelled') then
    raise exception 'This archive has already finished processing.';
  end if;

  update public.archiveFiles set "ingestStatus" = 'skipped',
    error = 'Cancelled before processing.', "errorStage" = 'cancelled'
  where "archiveId" = p_archiveId and "tenantId" = v_tenant
    and "ingestStatus" in ('queued', 'processing');
  get diagnostics v_skipped = row_count;

  update public.archiveIngestions set status = 'cancelled', "updatedAt" = public.epoch_ms(),
    "failureReason" = case when v_skipped > 0
      then 'Cancelled by a user — ' || v_skipped || ' pending file(s) skipped.'
      else 'Cancelled by a user.' end
  where _id = p_archiveId;

  perform public.log_audit('archive_cancelled', 'archiveIngestions', p_archiveId::text,
    jsonb_build_object('filename', v_archive.filename, 'skippedFiles', v_skipped));
  return jsonb_build_object('ok', true, 'skipped', v_skipped);
end;
$$;

grant execute on function public.archive_cancel(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. recommendations_decide — canonical state machine with structured errors
-- ---------------------------------------------------------------------------

create or replace function public.recommendations_decide(p_recommendationId uuid, p_status text)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_rec public.recommendations;
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if p_status not in ('approved', 'rejected', 'dismissed', 'executed') then
    raise exception 'Invalid decision: % is not a valid recommendation state.', p_status;
  end if;
  select * into v_rec from public.recommendations r
  where r._id = p_recommendationId and r."tenantId" = v_tenant;
  if v_rec._id is null then raise exception 'Recommendation not found.'; end if;

  if p_status <> 'dismissed' and public.my_member_role() not in ('owner', 'admin', 'manager') then
    raise exception 'Only managers and above can approve or reject recommendations.';
  end if;

  -- Canonical state machine. Re-deciding the SAME status is idempotent (safe
  -- to retry); anything else must follow: open → approved/rejected/dismissed,
  -- approved → executed.
  if v_rec.status = p_status then
    return jsonb_build_object('ok', true, 'status', v_rec.status, 'idempotent', true);
  end if;
  if v_rec.status = 'open' and p_status in ('approved', 'rejected', 'dismissed') then
    null;
  elsif v_rec.status = 'approved' and p_status = 'executed' then
    null;
  elsif v_rec.status = 'executed' then
    raise exception 'This recommendation is already executed and cannot be changed.';
  else
    raise exception 'Cannot mark a % recommendation as %.', v_rec.status, p_status;
  end if;

  update public.recommendations set status = p_status, "decidedBy" = v_user, "decidedAt" = public.epoch_ms()
  where _id = p_recommendationId;

  perform public.log_audit('recommendation_' || p_status, 'recommendation', p_recommendationId::text,
    jsonb_build_object('title', v_rec.title, 'previousStatus', v_rec.status));
  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

grant execute on function public.recommendations_decide(uuid, text) to anon, authenticated;
