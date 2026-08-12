-- ============================================================================
-- Atlas on Supabase — migration 0005: Everest RPCs.
--
-- Static knowledge (business brain, insurance intelligence, value engines,
-- authority seeds) ships with the frontend; these RPCs serve tenant context
-- and the global authoritative registries the Everest UI renders.
-- ============================================================================

create or replace function public.everest_get_organization_context()
returns jsonb
language plpgsql
stable
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_context jsonb;
  v_locations jsonb;
  v_profile jsonb;
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  select to_jsonb(o) into v_context from public.organizationContexts o where o."tenantId" = v_tenant limit 1;
  select coalesce(jsonb_agg(to_jsonb(l) order by l."_creationTime"), '[]'::jsonb) into v_locations
  from public.operatingLocations l where l."tenantId" = v_tenant;
  select to_jsonb(cp) into v_profile from public.companyProfiles cp where cp."tenantId" = v_tenant limit 1;

  return jsonb_build_object(
    'tenantId', v_tenant,
    'context', v_context,
    'timezoneNote', v_context ->> 'timezoneNote',
    'profile', case when v_profile is null then null else jsonb_build_object(
      'companyName', v_profile ->> 'companyName',
      'country', v_profile ->> 'country',
      'stateProvince', v_profile ->> 'stateProvince',
      'city', v_profile ->> 'city',
      'industry', v_profile ->> 'industry',
      'businessModel', v_profile ->> 'businessModel',
      'companySize', v_profile ->> 'companySize',
      'onboardingComplete', v_profile ->> 'onboardingComplete'
    ) end,
    'locations', v_locations
  );
end;
$$;

create or replace function public.everest_update_organization_context(p_patch jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_timezone text;
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;

  insert into public.organizationContexts ("tenantId", "updatedAt")
  values (v_tenant, public.epoch_ms())
  on conflict ("tenantId") do nothing;

  execute 'update public.organizationContexts set "updatedAt" = ' || public.epoch_ms() || ', ' ||
    (select string_agg(quote_ident(k) || ' = ' || case when v is null then 'null' else quote_literal(v #>> '{}') end, ', ')
     from jsonb_each(p_patch) e(k, v)
     where k not in ('_id', '_creationTime', 'tenantId'))
    || ' where "tenantId" = ' || quote_literal(v_tenant::text);

  select "primaryTimezone" into v_timezone from public.organizationContexts where "tenantId" = v_tenant;
  perform public.log_audit('org_context_updated', 'organization_context', null,
    jsonb_build_object('timezone', v_timezone));
  return jsonb_build_object('timezone', v_timezone);
end;
$$;

create or replace function public.everest_upsert_operating_location(
  p_name text,
  p_kind text default 'branch',
  p_timezone text default null,
  p_jurisdiction text default null,
  p_country text default null,
  p_region text default null,
  p_city text default null,
  p_businessHours jsonb default null,
  p_primary boolean default null,
  p_id uuid default null
)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if p_id is not null then
    if not exists (select 1 from public.operatingLocations l
                   where l._id = p_id and l."tenantId" = v_tenant) then
      raise exception 'Location not found.';
    end if;
    update public.operatingLocations set
      name = p_name, kind = p_kind, timezone = p_timezone, jurisdiction = p_jurisdiction,
      country = p_country, region = p_region, city = p_city,
      "businessHours" = coalesce(p_businessHours, "businessHours"),
      "primary" = coalesce(p_primary, "primary")
    where _id = p_id;
  else
    insert into public.operatingLocations (
      "tenantId", name, kind, timezone, jurisdiction, country, region, city, "businessHours", "primary"
    )
    values (v_tenant, p_name, p_kind, p_timezone, p_jurisdiction, p_country, p_region, p_city, p_businessHours, coalesce(p_primary, false));
  end if;
  perform public.log_audit(case when p_id is not null then 'location_updated' else 'location_added' end,
    'operating_location', null, jsonb_build_object('name', p_name, 'kind', p_kind));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.everest_remove_operating_location(p_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_name text;
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  select name into v_name from public.operatingLocations l where l._id = p_id and l."tenantId" = v_tenant;
  if v_name is null then raise exception 'Location not found.'; end if;
  delete from public.operatingLocations where _id = p_id;
  perform public.log_audit('location_removed', 'operating_location', null, jsonb_build_object('name', v_name));
  return jsonb_build_object('ok', true);
end;
$$;

-- Authoritative registries (global; readable by any signed-in user).

create or replace function public.everest_list_authoritative_knowledge()
returns jsonb
language plpgsql
stable
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_context jsonb;
begin
  if v_user is null then raise exception 'You must be signed in.'; end if;
  select to_jsonb(o) into v_context from public.organizationContexts o where o."tenantId" = v_tenant limit 1;

  return jsonb_build_object(
    'jurisdiction', jsonb_build_object(
      'path', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select v_context ->> 'country' as x
        union all select (v_context -> 'regions' -> 0)::text
        union all select (v_context -> 'cities' -> 0)::text
      ) t where x is not null and x <> 'null' and x <> ''),
      'industry', v_context ->> 'industry'
    ),
    'tiers', '{}'::jsonb, -- static tiers are merged client-side
    'sources', coalesce((
      select jsonb_agg(
        to_jsonb(s) || jsonb_build_object(
          'knowledgeCount', (select count(*) from public.authoritativeKnowledge k
                             where k."sourceId" = s."sourceId" and k.status = 'active')
        ) order by s."sourceId"
      )
      from public.authoritativeSources s
    ), '[]'::jsonb),
    'knowledge', coalesce((
      select jsonb_agg(
        to_jsonb(k) || jsonb_build_object('source', (
          select to_jsonb(s) from public.authoritativeSources s where s."sourceId" = k."sourceId"
        ))
        order by k."_creationTime"
      )
      from (select * from public.authoritativeKnowledge k where k.status = 'active') k
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.everest_authority_monitor()
returns jsonb
language plpgsql
stable
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'You must be signed in.'; end if;
  return jsonb_build_object(
    'now', public.epoch_ms(),
    'sources', coalesce((
      select jsonb_agg(
        to_jsonb(s) || jsonb_build_object(
          'recentChecks', '[]'::jsonb,
          'tierLabel', s."authorityTier"
        ) order by s."authorityTier", s.name
      )
      from public.authoritativeSources s
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.everest_list_knowledge_changes(p_limit bigint default 50)
returns jsonb
language plpgsql
stable
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'You must be signed in.'; end if;
  return coalesce((
    select jsonb_agg(
      to_jsonb(k) || jsonb_build_object(
        'versionId', k._id::text,
        'sourceName', (select s.name from public.authoritativeSources s where s."sourceId" = k."sourceId"),
        'sourceTier', (select s."authorityTier" from public.authoritativeSources s where s."sourceId" = k."sourceId")
      ) order by k."_creationTime" desc
    )
    from (select * from public.authoritativeKnowledge k order by "_creationTime" desc limit p_limit) k
  ), '[]'::jsonb);
end;
$$;

create or replace function public.everest_list_impact_assessments()
returns jsonb
language plpgsql
stable
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
begin
  if v_user is null then raise exception 'You must be signed in.'; end if;
  return coalesce((
    select jsonb_agg(
      to_jsonb(a) || jsonb_build_object(
        'sourceName', coalesce(a."sourceName",
          (select s.name from public.authoritativeSources s where s."sourceId" = a."sourceId"), a."sourceId"),
        'tierLabel', a."authorityTier"
      ) order by a."createdAt" desc
    )
    from (
      select * from public.impactAssessments a
      where a."affectedTenantIds" is null or a."affectedTenantIds" = '[]'::jsonb
         or a."affectedTenantIds" ? v_tenant::text
      order by "createdAt" desc limit 100
    ) a
  ), '[]'::jsonb);
end;
$$;

create or replace function public.everest_decide_impact_review(
  p_assessmentId uuid,
  p_decision text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_assessment public.impactAssessments;
  v_now bigint := public.epoch_ms();
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if public.my_member_role() not in ('owner', 'admin', 'manager') then
    raise exception 'Manager role required to decide authority reviews.';
  end if;
  if p_decision not in ('approved', 'rejected', 'disputed') then raise exception 'Invalid decision.'; end if;

  select * into v_assessment from public.impactAssessments a where a._id = p_assessmentId;
  if v_assessment._id is null then raise exception 'Assessment not found.'; end if;
  if v_assessment."affectedTenantIds" is not null
     and v_assessment."affectedTenantIds" <> '[]'::jsonb
     and not (v_assessment."affectedTenantIds" ? v_tenant::text) then
    raise exception 'Assessment is not scoped to this workspace.';
  end if;

  update public.impactAssessments set status = p_decision,
    "reviewNote" = p_note, "decidedBy" = v_user, "decidedAt" = v_now
  where _id = p_assessmentId;

  perform public.log_audit('authority_review_' || p_decision, 'impact_assessment', p_assessmentId::text,
    jsonb_build_object('sourceId', v_assessment."sourceId", 'changeType', v_assessment."changeType", 'note', p_note));
  return jsonb_build_object('ok', true);
end;
$$;

-- Raw state readers used by the client-side Everest computations.

create or replace function public.everest_raw_knowledge()
returns jsonb
language plpgsql
stable
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'You must be signed in.'; end if;
  return jsonb_build_object(
    'packs', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.key) from public.intelligencePacks p
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(to_jsonb(i)) from public.intelligenceItems i
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(to_jsonb(s)) from public.authoritativeSources s
    ), '[]'::jsonb),
    'knowledge', coalesce((
      select jsonb_agg(to_jsonb(k)) from public.authoritativeKnowledge k
    ), '[]'::jsonb),
    'tenantPacks', coalesce((
      select jsonb_agg(to_jsonb(tp)) from public.tenantPacks tp where tp."tenantId" = public.my_tenant_id()
    ), '[]'::jsonb)
  );
end;
$$;

-- Seed the authoritative registries (client provides the static seeds).
create or replace function public.everest_seed(p_sources jsonb, p_knowledge jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_src jsonb;
  v_know jsonb;
  v_seeded_sources bigint := 0;
  v_seeded_knowledge bigint := 0;
begin
  if v_user is null then raise exception 'You must be signed in.'; end if;
  for v_src in select * from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb))
  loop
    insert into public.authoritativeSources (
      "sourceId", name, organization, "authorityTier", industry, industries, subjects,
      jurisdiction, "sourceType", "canonicalUrl", "retrievalMethod", "updateFrequency",
      "implementationStatus", enabled, active
    )
    values (
      v_src ->> 'sourceId', v_src ->> 'name', v_src ->> 'organization',
      v_src ->> 'authorityTier', v_src ->> 'industry', v_src -> 'industries',
      v_src -> 'subjects', v_src ->> 'jurisdiction', v_src ->> 'sourceType',
      v_src ->> 'canonicalUrl', v_src ->> 'retrievalMethod', v_src ->> 'updateFrequency',
      coalesce(v_src ->> 'implementationStatus', 'declared'),
      coalesce((v_src ->> 'enabled')::boolean, false), true
    )
    on conflict ("sourceId") do nothing;
    v_seeded_sources := v_seeded_sources + 1;
  end loop;

  for v_know in select * from jsonb_array_elements(coalesce(p_knowledge, '[]'::jsonb))
  loop
    insert into public.authoritativeKnowledge (
      "knowledgeId", "sourceId", title, statement, interpretation, "knowledgeType",
      jurisdiction, industry, status, "reviewStatus", "publicationDate", "effectiveDate",
      "retrievalDate", version, "contentHash", "normalizedFact", freshness, confidence
    )
    values (
      v_know ->> 'knowledgeId', v_know ->> 'sourceId', v_know ->> 'title',
      v_know ->> 'statement', v_know ->> 'interpretation', v_know ->> 'knowledgeType',
      v_know ->> 'jurisdiction', v_know ->> 'industry', 'active', 'approved',
      (v_know ->> 'publicationDate')::bigint, (v_know ->> 'effectiveDate')::bigint,
      public.epoch_ms(), v_know ->> 'version', v_know ->> 'contentHash',
      v_know ->> 'normalizedFact', 'unavailable',
      coalesce((v_know ->> 'confidence')::double precision, 0.7)
    )
    on conflict ("knowledgeId") do nothing;
    v_seeded_knowledge := v_seeded_knowledge + 1;
  end loop;

  return jsonb_build_object('seededSources', v_seeded_sources, 'seededKnowledge', v_seeded_knowledge);
end;
$$;

-- Conversation storage (used by the converse edge function via service role
-- and by the client for history).
create or replace function public.conversation_raw_messages(p_sessionId uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
begin
  if v_user is null or v_tenant is null then return null; end if;
  return (select c.messages from public.conversationSessions c
    where c._id = p_sessionId and c."tenantId" = v_tenant);
end;
$$;
