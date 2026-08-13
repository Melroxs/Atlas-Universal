-- ---------------------------------------------------------------------------
-- Preserve client-detected duplicate provenance in the archive inventory.
--
-- The archive engine (client) detects exact duplicates by checksum BEFORE
-- upload and does not upload the redundant bytes, so a duplicate file is
-- submitted to archive_submit_inventory_batch with status 'duplicate' and a
-- duplicateOfPath. The original RPC only populated isDuplicate/duplicateOfPath
-- for 'queued' entries that hit the server-side checksum dedupe — entries the
-- client already flagged as duplicates were recorded with
-- isDuplicate = false and duplicateOfPath = null, so the archive detail lost
-- the duplicate provenance the UI and audit trail rely on.
--
-- Fix: honor the client's duplicateOfPath for 'duplicate' entries (with a
-- server-side checksum lookup as a fallback when the client did not provide
-- one), keeping the server-side dedupe for 'queued' entries unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.archive_submit_inventory_batch(
  p_archiveId uuid,
  p_files jsonb,
  p_clientWarnings jsonb default null
)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_archive public.archiveIngestions;
  v_file jsonb;
  v_path text;
  v_ingest_status text;
  v_prior uuid;
  v_dupe boolean := false;
  v_dupe_path text;
  v_total bigint;
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if public.my_member_role() not in ('owner', 'admin', 'manager', 'analyst') then
    raise exception 'Viewers cannot import company data.';
  end if;

  select * into v_archive from public.archiveIngestions a
  where a._id = p_archiveId and a."tenantId" = v_tenant;
  if v_archive._id is null then raise exception 'Archive not found.'; end if;
  if v_archive.status in ('completed', 'completed_with_warnings', 'failed', 'cancelled') then
    raise exception 'This archive has already finished processing.';
  end if;

  if jsonb_array_length(p_files) = 0 then raise exception 'Inventory batch is empty.'; end if;
  if jsonb_array_length(p_files) > 200 then raise exception 'Inventory batch too large.'; end if;

  for v_file in select * from jsonb_array_elements(p_files)
  loop
    v_path := v_file ->> 'path';
    v_ingest_status := case v_file ->> 'status'
      when 'ok' then 'queued'
      when 'blocked' then 'blocked'
      when 'unsupported' then 'unsupported'
      when 'too_large' then 'too_large'
      when 'duplicate' then 'duplicate'
      when 'skipped_nested' then 'skipped'
      else 'skipped'
    end;

    v_dupe := false;
    v_dupe_path := null;
    if v_ingest_status = 'queued' then
      -- Server-side checksum dedupe: a queued file whose checksum already
      -- ingested is recorded as a duplicate of the earlier file.
      v_prior := null;
      select _id into v_prior from public.archiveFiles f
      where f."tenantId" = v_tenant and f.checksum = v_file ->> 'checksum' and f."ingestStatus" = 'ingested'
      limit 1;
      if v_prior is not null then
        v_dupe := true;
        select path into v_dupe_path from public.archiveFiles where _id = v_prior;
        v_ingest_status := 'duplicate';
      end if;
    elsif v_ingest_status = 'duplicate' then
      -- Client-detected duplicate: honor the client's provenance (the
      -- engine deduped by checksum before upload, so this file was never
      -- uploaded and the server-side lookup above cannot see it).
      v_dupe := true;
      v_dupe_path := v_file ->> 'duplicateOfPath';
      if v_dupe_path is null then
        select path into v_dupe_path from public.archiveFiles f
        where f."tenantId" = v_tenant and f.checksum = v_file ->> 'checksum'
        limit 1;
      end if;
    end if;

    insert into public.archiveFiles (
      "tenantId", "archiveId", path, filename, extension, "mimeType", size, checksum, depth,
      "isDuplicate", "duplicateOfPath", "versionGroup", "isSuperseded", "supersedesPath",
      supported, classification, "classificationBasis", "classificationConfidence",
      "claimHints", blocked, "blockReason", "ingestStatus", "storageId", error, "retryCount"
    )
    values (
      v_tenant, p_archiveId, v_path, v_file ->> 'filename', v_file ->> 'extension',
      v_file ->> 'mimeType', (v_file ->> 'size')::double precision, v_file ->> 'checksum',
      (v_file ->> 'depth')::double precision, v_dupe, v_dupe_path, v_file ->> 'versionGroup',
      (v_file ->> 'isSuperseded')::boolean, v_file ->> 'supersedesPath',
      (v_file ->> 'supported')::boolean, v_file ->> 'classification', v_file ->> 'classificationBasis',
      (v_file ->> 'classificationConfidence')::double precision, v_file -> 'claimHints',
      v_ingest_status in ('blocked', 'unsupported', 'too_large', 'duplicate'),
      case when v_ingest_status = 'blocked' then v_file ->> 'blockReason' else null end,
      v_ingest_status, v_file ->> 'storageId',
      case when v_ingest_status = 'failed' then v_file ->> 'note' else null end, 0
    );
  end loop;

  v_total := v_archive."fileCount" + jsonb_array_length(p_files);
  update public.archiveIngestions set
    "fileCount" = v_total,
    "extractedSize" = v_archive."extractedSize" + coalesce((
      select sum((x ->> 'size')::double precision) from jsonb_array_elements(p_files) x
    ), 0),
    status = 'inventorying',
    warnings = coalesce(p_clientWarnings, v_archive.warnings),
    "updatedAt" = public.epoch_ms()
  where _id = p_archiveId;

  perform public.log_audit('archive_inventory_submitted', 'archiveIngestions', p_archiveId::text,
    jsonb_build_object('batchFiles', jsonb_array_length(p_files), 'totalFiles', v_total));
  return jsonb_build_object('archiveId', p_archiveId, 'batchFiles', jsonb_array_length(p_files),
    'totalFiles', v_total, 'ingestedDupes', 0);
end;
$$;
