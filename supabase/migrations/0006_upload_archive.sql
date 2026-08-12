-- ============================================================================
-- Atlas on Supabase — migration 0006: storage upload + archive processing.
--
--  * documents_upload_folder  — tenant-scoped folder prefix for Storage
--    uploads (RLS requires every object to live under <tenantId>/…).
--  * archive_patch_file       — mark a single archive file ingested/failed.
--  * archive_patch            — advance an archive ingestion's status/progress.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Storage upload folder
-- ---------------------------------------------------------------------------

create or replace function public.documents_upload_folder()
returns text
language sql
stable
as $$
  select public.my_tenant_id()::text;
$$;

-- ---------------------------------------------------------------------------
-- Archive processing patches
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
    error = coalesce(p_patch ->> 'error', error),
    "retryCount" = coalesce((p_patch ->> 'retryCount')::double precision, "retryCount")
  where _id = p_fileId;

  perform public.log_audit('archive_file_patched', 'archiveFiles', p_fileId::text, jsonb_build_object('ingestStatus', p_patch ->> 'ingestStatus'));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.archive_patch(p_archiveId uuid, p_patch jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_archive public.archiveIngestions;
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;

  select * into v_archive from public.archiveIngestions a
  where a._id = p_archiveId and a."tenantId" = v_tenant;
  if v_archive._id is null then raise exception 'Archive not found.'; end if;

  update public.archiveIngestions set
    status = coalesce(p_patch ->> 'status', status),
    progress = coalesce((p_patch ->> 'progress')::double precision, progress),
    stats = coalesce(p_patch -> 'stats', stats),
    warnings = coalesce(p_patch -> 'warnings', warnings),
    "failureReason" = coalesce(p_patch ->> 'failureReason', "failureReason"),
    "startedAt" = coalesce((p_patch ->> 'startedAt')::bigint, "startedAt"),
    "updatedAt" = public.epoch_ms()
  where _id = p_archiveId;

  perform public.log_audit('archive_patched', 'archiveIngestions', p_archiveId::text, jsonb_build_object('status', p_patch ->> 'status'));
  return jsonb_build_object('ok', true);
end;
$$;
