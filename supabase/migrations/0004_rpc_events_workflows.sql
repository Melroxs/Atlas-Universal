-- ============================================================================
-- Atlas on Supabase — migration 0004: events + workflows RPCs.
--
-- Workflow *definitions* and the event/workflow *registries* are static data
-- shipped with the frontend (src/lib/atlas-data); these RPCs serve the
-- tenant-scoped state those pages merge the registries with.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------

create or replace function public.events_list(
  p_limit bigint default 60,
  p_status text default null,
  p_eventType text default null
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  return coalesce((
    select jsonb_agg(
      to_jsonb(e) || jsonb_build_object(
        'connectorName', (select c.name from public.connections c where c._id = e."connectionId"),
        'resourceName', coalesce(e.payload ->> 'name', e.payload ->> 'fileId', e."sourceResourceId"),
        'summary', case when e.intelligence is not null and e.intelligence ? 'summary'
                        then e.intelligence ->> 'summary' else null end,
        'eventName', e.provider
      )
      order by e."receivedAt" desc
    )
    from (
      select * from public.events ev
      where ev."tenantId" = v_tenant
        and (p_status is null or p_status = '' or ev.status = p_status)
        and (p_eventType is null or p_eventType = '' or ev."eventType" = p_eventType)
      order by ev."receivedAt" desc
      limit greatest(1, p_limit)
    ) e
  ), '[]'::jsonb);
end;
$$;

create or replace function public.events_get_detail(p_eventId uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
  v_event jsonb;
  v_conn jsonb;
  v_notifications jsonb;
  v_action jsonb;
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  select to_jsonb(e) into v_event from public.events e
  where e._id = p_eventId and e."tenantId" = v_tenant;
  if v_event is null then raise exception 'Event not found.'; end if;

  select to_jsonb(c) into v_conn from public.connections c where c._id = (v_event ->> 'connectionId')::uuid;
  select coalesce(jsonb_agg(to_jsonb(n) order by n."createdAt" desc), '[]'::jsonb) into v_notifications
  from public.notifications n where n."tenantId" = v_tenant and n."sourceEventId" = p_eventId;

  if v_event ? 'actionId' and (v_event ->> 'actionId') is not null then
    select to_jsonb(t) into v_action from public.toolActions t where t._id = (v_event ->> 'actionId')::uuid;
  end if;

  return jsonb_build_object(
    'event', v_event, 'connection', v_conn,
    'notifications', v_notifications,
    'action', case when v_action is not null then v_action || jsonb_build_object('toolName', v_action ->> 'toolId') else null end
  );
end;
$$;

create or replace function public.events_stats()
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
  v_total bigint;
  v_duplicates bigint;
  v_actions bigint;
  v_retried bigint;
  v_avg double precision;
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  select count(*) into v_total from public.events where "tenantId" = v_tenant;
  select count(*) into v_duplicates from public.events where "tenantId" = v_tenant and "duplicateOf" is not null;
  select count(*) into v_actions from public.events where "tenantId" = v_tenant and "actionId" is not null;
  select count(*) into v_retried from public.events where "tenantId" = v_tenant and attempts > 1;
  select round(avg("processingMs")) into v_avg from public.events where "tenantId" = v_tenant and "processingMs" is not null;

  return jsonb_build_object(
    'total', v_total,
    'byStatus', coalesce((
      select jsonb_object_agg(status, cnt) from (
        select status, count(*) cnt from public.events where "tenantId" = v_tenant group by status
      ) s
    ), '{}'::jsonb),
    'byType', coalesce((
      select jsonb_object_agg("eventType", cnt) from (
        select "eventType", count(*) cnt from public.events where "tenantId" = v_tenant group by "eventType"
      ) t
    ), '{}'::jsonb),
    'duplicates', v_duplicates,
    'actionsTriggered', v_actions,
    'retried', v_retried,
    'avgProcessingMs', v_avg,
    'sourceMechanisms', coalesce((
      select jsonb_agg(DISTINCT "sourceMechanism") from public.events where "tenantId" = v_tenant
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.events_raw_policies()
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(ep) order by ep."eventType")
    from public.eventPolicies ep where ep."tenantId" = v_tenant
  ), '[]'::jsonb);
end;
$$;

create or replace function public.events_list_notifications(p_limit bigint default 25)
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
  v_items jsonb;
  v_unread bigint;
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  select coalesce(jsonb_agg(to_jsonb(n) order by n."createdAt" desc), '[]'::jsonb) into v_items
  from (select * from public.notifications where "tenantId" = v_tenant order by "createdAt" desc limit p_limit) n;
  select count(*) into v_unread from public.notifications where "tenantId" = v_tenant and read = false;
  return jsonb_build_object('items', v_items, 'unreadCount', v_unread);
end;
$$;

create or replace function public.events_retry(p_eventId uuid)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_evt public.events;
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  select * into v_evt from public.events e where e._id = p_eventId and e."tenantId" = v_tenant;
  if v_evt._id is null then raise exception 'Event not found.'; end if;
  if v_evt.status not in ('failed', 'retrying') then
    return jsonb_build_object('ok', false, 'reason',
      'Only failed or retrying events can be retried (this one is ' || v_evt.status || ').');
  end if;
  update public.events set status = 'received', attempts = 0, "lastError" = null
  where _id = p_eventId;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.events_set_policy(
  p_eventType text,
  p_enabled boolean,
  p_autoLowRiskWrite boolean default null,
  p_allowedTools jsonb default null,
  p_blockedTools jsonb default null
)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if public.my_member_role() not in ('owner', 'admin', 'manager') then
    raise exception 'Only managers and above can change event policies.';
  end if;
  insert into public.eventPolicies ("tenantId", "eventType", enabled, "autoLowRiskWrite", "allowedTools", "blockedTools", "updatedAt")
  values (v_tenant, p_eventType, p_enabled, coalesce(p_autoLowRiskWrite, false), p_allowedTools, p_blockedTools, public.epoch_ms())
  on conflict ("tenantId", "eventType") do update set
    enabled = excluded.enabled,
    "autoLowRiskWrite" = coalesce(excluded."autoLowRiskWrite", public.eventPolicies."autoLowRiskWrite"),
    "allowedTools" = excluded."allowedTools",
    "blockedTools" = excluded."blockedTools",
    "updatedAt" = excluded."updatedAt";
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.events_mark_notification_read(p_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  update public.notifications set read = true
  where _id = p_id and "tenantId" = v_tenant;
  return jsonb_build_object('ok', true);
end;
$$;

-- Internal event emitter (used by archive / drive / workflow client paths).
create or replace function public.events_emit(
  p_eventType text,
  p_sourceResourceId text,
  p_payload jsonb default null,
  p_provider text default 'atlas',
  p_connectionId uuid default null,
  p_occurredAt bigint default null
)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_now bigint := public.epoch_ms();
  v_key text;
  v_event_id uuid;
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  v_key := md5(p_eventType || ':' || p_sourceResourceId || ':' || coalesce(p_occurredAt::text, v_now::text));
  insert into public.events (
    "tenantId", "eventId", "eventType", provider, "connectionId", "sourceResourceId",
    "occurredAt", "receivedAt", payload, "payloadVersion", idempotencyKey, dedupeKey,
    status, attempts, "maxAttempts", "sourceMechanism", "createdBy", "createdAt"
  )
  values (
    v_tenant, v_key, p_eventType, p_provider, p_connectionId, p_sourceResourceId,
    coalesce(p_occurredAt, v_now), v_now, coalesce(p_payload, '{}'::jsonb), '1',
    v_key, v_key, 'processed', 0, 3, 'manual', 'client', v_now
  )
  returning _id into v_event_id;
  return jsonb_build_object('eventId', v_event_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Workflows
-- ---------------------------------------------------------------------------

create or replace function public.workflows_raw_settings()
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(ws) order by ws."workflowId")
    from public.workflowSettings ws where ws."tenantId" = v_tenant
  ), '[]'::jsonb);
end;
$$;

create or replace function public.workflows_raw_instances()
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(wi) order by wi."startedAt" desc)
    from (select * from public.workflowInstances where "tenantId" = v_tenant order by "startedAt" desc limit 100) wi
  ), '[]'::jsonb);
end;
$$;

create or replace function public.workflows_get_instance_detail(p_instanceId uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
  v_instance jsonb;
  v_steps jsonb;
  v_approvals jsonb;
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  select to_jsonb(wi) into v_instance from public.workflowInstances wi
  where wi._id = p_instanceId and wi."tenantId" = v_tenant;
  if v_instance is null then raise exception 'Workflow instance not found.'; end if;
  select coalesce(jsonb_agg(to_jsonb(ws) order by ws."createdAt"), '[]'::jsonb) into v_steps
  from public.workflowSteps ws where ws."instanceId" = p_instanceId;
  select coalesce(jsonb_agg(to_jsonb(wa) order by wa."createdAt"), '[]'::jsonb) into v_approvals
  from public.workflowApprovals wa where wa."instanceId" = p_instanceId;
  return jsonb_build_object('instance', v_instance, 'steps', v_steps, 'approvals', v_approvals);
end;
$$;

create or replace function public.workflows_raw_approvals()
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(wa) order by wa."createdAt" desc)
    from (select * from public.workflowApprovals where "tenantId" = v_tenant order by "createdAt" desc limit 50) wa
  ), '[]'::jsonb);
end;
$$;

create or replace function public.workflows_stats()
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
  v_total bigint; v_active bigint; v_completed bigint; v_failed bigint; v_pending bigint;
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  select count(*) into v_total from public.workflowInstances where "tenantId" = v_tenant;
  select count(*) into v_active from public.workflowInstances
    where "tenantId" = v_tenant and status in ('pending', 'running', 'waiting', 'awaiting_approval', 'paused');
  select count(*) into v_completed from public.workflowInstances
    where "tenantId" = v_tenant and status = 'completed';
  select count(*) into v_failed from public.workflowInstances
    where "tenantId" = v_tenant and status in ('failed', 'timed_out');
  select count(*) into v_pending from public.workflowApprovals
    where "tenantId" = v_tenant and status = 'pending';

  return jsonb_build_object(
    'total', v_total,
    'byStatus', coalesce((
      select jsonb_object_agg(status, cnt) from (
        select status, count(*) cnt from public.workflowInstances where "tenantId" = v_tenant group by status
      ) s
    ), '{}'::jsonb),
    'active', v_active, 'completed', v_completed, 'failed', v_failed, 'pendingApprovals', v_pending
  );
end;
$$;

create or replace function public.workflows_set_setting(
  p_workflowId text,
  p_enabled boolean,
  p_approvalRoleOverride text default null,
  p_maxActionsOverride double precision default null
)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if public.my_member_role() not in ('owner', 'admin', 'manager') then
    raise exception 'Only managers and above can configure workflows.';
  end if;
  insert into public.workflowSettings ("tenantId", "workflowId", enabled, "approvalRoleOverride", "maxActionsOverride", "updatedAt")
  values (v_tenant, p_workflowId, p_enabled, p_approvalRoleOverride, p_maxActionsOverride, public.epoch_ms())
  on conflict ("tenantId", "workflowId") do update set
    enabled = excluded.enabled,
    "approvalRoleOverride" = coalesce(excluded."approvalRoleOverride", public.workflowSettings."approvalRoleOverride"),
    "maxActionsOverride" = coalesce(excluded."maxActionsOverride", public.workflowSettings."maxActionsOverride"),
    "updatedAt" = excluded."updatedAt";
  perform public.log_audit('workflow_setting_changed', 'workflow', p_workflowId,
    jsonb_build_object('workflowId', p_workflowId, 'enabled', p_enabled));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.workflows_decide_approval(p_approvalId uuid, p_decision text)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_approval public.workflowApprovals;
  v_instance public.workflowInstances;
  v_role text;
  v_now bigint := public.epoch_ms();
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'Invalid decision.'; end if;

  select * into v_approval from public.workflowApprovals wa
  where wa._id = p_approvalId and wa."tenantId" = v_tenant;
  if v_approval._id is null then raise exception 'Approval not found.'; end if;
  if v_approval.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'This request is already ' || v_approval.status || '.');
  end if;

  select role into v_role from public.memberships m
  where m."tenantId" = v_tenant and m."userId" = v_user and m.status = 'active' limit 1;
  if v_role is null then raise exception 'Membership not found.'; end if;

  -- roleSatisfies: manager/owner satisfy manager+; owner satisfies owner+.
  if v_approval."requestedRole" = 'owner' then
    if v_role <> 'owner' then raise exception 'Only owners and above can decide this request.'; end if;
  elsif v_approval."requestedRole" = 'manager' then
    if v_role not in ('owner', 'admin', 'manager') then
      raise exception 'Only managers and above can decide this request.';
    end if;
  end if;

  if v_approval."expiresAt" is not null and v_approval."expiresAt" < v_now then
    update public.workflowApprovals set status = 'expired' where _id = p_approvalId;
    return jsonb_build_object('ok', false, 'reason', 'This request expired before it was decided.');
  end if;

  select * into v_instance from public.workflowInstances wi where wi._id = v_approval."instanceId";
  if v_instance._id is null then raise exception 'Workflow instance not found.'; end if;

  if p_decision = 'reject' then
    update public.workflowApprovals set status = 'rejected', "decidedBy" = v_user, "decidedAt" = v_now
    where _id = p_approvalId;
    update public.workflowInstances set status = 'failed',
      "failureReason" = 'The approval request was rejected.', "errorClass" = 'approval_rejected',
      "completedAt" = v_now, "updatedAt" = v_now
    where _id = v_instance._id;
    insert into public.notifications ("tenantId", severity, title, description, "sourceEventId", "createdAt", read)
    values (v_tenant, 'medium', 'Workflow stopped: ' || v_instance."definitionId",
      'The approval request was rejected, so the workflow did not continue.',
      v_instance."triggerEventId", v_now, false);
  else
    update public.workflowApprovals set status = 'approved', "decidedBy" = v_user, "decidedAt" = v_now
    where _id = p_approvalId;
    update public.workflowInstances set status = 'running',
      context = coalesce(context, '{}'::jsonb) || jsonb_build_object('approvalGranted',
        jsonb_build_object('stepId', v_approval."stepId", 'approvalId', p_approvalId::text)),
      "updatedAt" = v_now
    where _id = v_instance._id;
    insert into public.notifications ("tenantId", severity, title, description, "sourceEventId", "createdAt", read)
    values (v_tenant, 'low', 'Approval granted: ' || v_instance."definitionId",
      'The workflow will continue from where it paused.', v_instance."triggerEventId", v_now, false);
  end if;

  perform public.log_audit('workflow_approval_' || p_decision, 'workflow_approval', p_approvalId::text,
    jsonb_build_object('instanceId', v_instance._id::text, 'workflowId', v_instance."definitionId"));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.workflows_cancel_instance(p_instanceId uuid)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_instance public.workflowInstances;
  v_now bigint := public.epoch_ms();
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if public.my_member_role() not in ('owner', 'admin', 'manager') then
    raise exception 'Only managers and above can cancel workflows.';
  end if;
  select * into v_instance from public.workflowInstances wi
  where wi._id = p_instanceId and wi."tenantId" = v_tenant;
  if v_instance._id is null then raise exception 'Workflow instance not found.'; end if;
  if v_instance.status in ('completed', 'failed', 'cancelled', 'timed_out') then
    return jsonb_build_object('ok', false, 'reason', 'This workflow already ended (' || v_instance.status || ').');
  end if;
  update public.workflowInstances set status = 'cancelled', "completedAt" = v_now, "updatedAt" = v_now
  where _id = p_instanceId;
  perform public.log_audit('workflow_cancelled', 'workflow_instance', p_instanceId::text,
    jsonb_build_object('workflowId', v_instance."definitionId"));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.workflows_retry_instance(p_instanceId uuid)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_instance public.workflowInstances;
  v_now bigint := public.epoch_ms();
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if public.my_member_role() not in ('owner', 'admin', 'manager') then
    raise exception 'Only managers and above can retry workflows.';
  end if;
  select * into v_instance from public.workflowInstances wi
  where wi._id = p_instanceId and wi."tenantId" = v_tenant;
  if v_instance._id is null then raise exception 'Workflow instance not found.'; end if;
  if v_instance.status not in ('failed', 'timed_out') then
    return jsonb_build_object('ok', false, 'reason',
      'Only failed or timed-out workflows can be retried (this one is ' || v_instance.status || ').');
  end if;
  update public.workflowInstances set status = 'running',
    "failureReason" = null, "errorClass" = null, "completedAt" = null, "updatedAt" = v_now
  where _id = p_instanceId;
  return jsonb_build_object('ok', true);
end;
$$;

-- Tools
create or replace function public.tools_list_actions(p_limit bigint default 60)
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(t) order by t."_creationTime" desc)
    from (select * from public.toolActions where "tenantId" = v_tenant order by "_creationTime" desc limit p_limit) t
  ), '[]'::jsonb);
end;
$$;

-- Connections
create or replace function public.connections_raw()
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(c) order by c."_creationTime")
    from public.connections c where c."tenantId" = v_tenant
  ), '[]'::jsonb);
end;
$$;

create or replace function public.connections_disconnect_google_drive()
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if public.my_member_role() not in ('owner', 'admin', 'manager') then
    raise exception 'Only managers and above can disconnect sources.';
  end if;
  update public.connections set status = 'disconnected', "lastError" = null,
    settings = '{"kind":"oauth2"}'::jsonb
  where "tenantId" = v_tenant and provider = 'google_drive';
  delete from public.connectionTokens where "tenantId" = v_tenant and provider = 'google_drive';
  perform public.log_audit('google_drive_disconnected', 'connection', null);
  return jsonb_build_object('ok', true);
end;
$$;
