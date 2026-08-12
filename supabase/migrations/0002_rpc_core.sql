-- ============================================================================
-- Atlas on Supabase — migration 0002: core RPCs.
--
-- The frontend calls these via PostgREST (supabase.rpc). Every function is
-- `security invoker` so RLS applies; tenant scoping is enforced both by RLS
-- and by explicit my_tenant_id() checks. All return jsonb matching the
-- shapes the app already consumes.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- users / auth status
-- ---------------------------------------------------------------------------

create or replace function public.users_current_user()
returns jsonb
language sql
stable
as $$
  select to_jsonb(p)
  from public.profiles p
  where p._id = auth.uid();
$$;

create or replace function public.auth_status()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'supabaseConfigured', true,
    'guestConfigured', true,
    'authUsable', true
  );
$$;

-- ---------------------------------------------------------------------------
-- tenants / workspace / team
-- ---------------------------------------------------------------------------

create or replace function public.tenants_get_my_workspace()
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
  v_user uuid := auth.uid();
  v_tenant_row jsonb;
  v_profile jsonb;
  v_membership jsonb;
  v_systems jsonb;
  v_packs jsonb;
  v_members jsonb;
  v_invites jsonb;
begin
  if v_user is null then return null; end if;
  if v_tenant is null then return null; end if;

  select to_jsonb(t) into v_tenant_row
  from public.tenants t where t._id = v_tenant;

  select to_jsonb(cp) into v_profile
  from public.companyProfiles cp
  where cp."tenantId" = v_tenant limit 1;

  select to_jsonb(m) into v_membership
  from public.memberships m
  where m."tenantId" = v_tenant and m."userId" = v_user
  order by m."_creationTime" limit 1;

  select coalesce(jsonb_agg(to_jsonb(cs) order by cs."_creationTime"), '[]'::jsonb) into v_systems
  from public.companySystems cs where cs."tenantId" = v_tenant;

  select coalesce(jsonb_agg(to_jsonb(tp) order by tp."_creationTime"), '[]'::jsonb) into v_packs
  from public.tenantPacks tp where tp."tenantId" = v_tenant;

  select coalesce(jsonb_agg(
    to_jsonb(m) || jsonb_build_object('user', (
      case when p._id is null then null
           else jsonb_build_object('_id', p._id, 'name', p.name, 'email', p.email, 'image', p.image)
      end
    ))
    order by m."_creationTime"
  ), '[]'::jsonb) into v_members
  from public.memberships m
  left join public.profiles p on p._id = m."userId"
  where m."tenantId" = v_tenant;

  select coalesce(jsonb_agg(to_jsonb(i) order by i."_creationTime"), '[]'::jsonb) into v_invites
  from public.invites i where i."tenantId" = v_tenant;

  return jsonb_build_object(
    'tenant', v_tenant_row,
    'profile', v_profile,
    'membership', v_membership,
    'systems', v_systems,
    'packs', v_packs,
    'members', v_members,
    'invites', v_invites
  );
end;
$$;

-- Security definer: this is the bootstrap insert — the caller has no
-- membership yet, so RLS (which scopes by my_tenant_id()) would block the
-- tenant/membership/profile rows it must create. The function still enforces
-- auth + tenant scoping explicitly below.
create or replace function public.tenants_create_tenant(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_slug text;
  v_existing uuid;
begin
  if v_user is null then raise exception 'You must be signed in.'; end if;
  v_existing := public.my_tenant_id();
  if v_existing is not null then raise exception 'You already belong to a workspace.'; end if;
  if p_name is null or trim(p_name) = '' then raise exception 'Workspace name is required.'; end if;

  v_slug := lower(regexp_replace(trim(p_name), '[^a-z0-9]+', '-', 'g'));
  v_slug := left(trim(both '-' from v_slug), 40);
  if v_slug = '' then v_slug := 'workspace'; end if;
  v_slug := v_slug || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 4);

  insert into public.tenants (name, slug, status)
  values (trim(p_name), v_slug, 'active')
  returning _id into v_tenant;

  insert into public.memberships ("tenantId", "userId", role, status, "joinedAt")
  values (v_tenant, v_user, 'owner', 'active', public.epoch_ms());

  insert into public.companyProfiles ("tenantId", "companyName", "onboardingStep", "onboardingComplete")
  values (v_tenant, trim(p_name), 0, false);

  perform public.log_audit('tenant_created', 'tenant', v_tenant::text, jsonb_build_object('name', p_name));

  return jsonb_build_object('tenantId', v_tenant);
end;
$$;

create or replace function public.tenants_invite_member(p_email text, p_role text)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_normalized text;
  v_existing_invite uuid;
  v_existing_user uuid;
  v_membership_created boolean := false;
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if public.my_member_role() not in ('owner', 'admin', 'manager') then
    raise exception 'Only managers and above can invite members.';
  end if;
  if p_role is null or p_role not in ('owner', 'admin', 'manager', 'analyst', 'viewer') then
    raise exception 'Invalid role.';
  end if;

  v_normalized := lower(trim(p_email));
  if v_normalized = '' then raise exception 'Email is required.'; end if;

  select _id into v_existing_invite from public.invites
  where "tenantId" = v_tenant and email = v_normalized limit 1;
  if v_existing_invite is not null then raise exception 'That person was already invited.'; end if;

  select _id into v_existing_user from public.profiles where email = v_normalized limit 1;
  if v_existing_user is not null then
    perform 1 from public.memberships m
    where m."tenantId" = v_tenant and m."userId" = v_existing_user;
    if not found then
      insert into public.memberships ("tenantId", "userId", role, status, "invitedBy", "joinedAt")
      values (v_tenant, v_existing_user, p_role, 'active', v_user, public.epoch_ms());
      v_membership_created := true;
    end if;
  end if;

  if not v_membership_created then
    insert into public.invites ("tenantId", email, role, "invitedBy", status)
    values (v_tenant, v_normalized, p_role, v_user, 'pending');
  end if;

  perform public.log_audit(
    case when v_membership_created then 'member_added' else 'member_invited' end,
    'user', v_existing_user::text,
    jsonb_build_object('email', v_normalized, 'role', p_role)
  );
  return jsonb_build_object('membershipCreated', v_membership_created);
end;
$$;

create or replace function public.tenants_claim_invites()
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_pending record;
  v_claimed bigint := 0;
  v_dup uuid;
begin
  if v_user is null then return jsonb_build_object('claimed', 0); end if;
  select lower(trim(coalesce(email, ''))) into v_email from public.profiles where _id = v_user;
  if v_email = '' then return jsonb_build_object('claimed', 0); end if;

  for v_pending in
    select * from public.invites i
    where i.email = v_email and i.status = 'pending'
  loop
    select m._id into v_dup from public.memberships m
    where m."tenantId" = v_pending."tenantId" and m."userId" = v_user limit 1;
    if v_dup is not null then continue; end if;

    insert into public.memberships ("tenantId", "userId", role, status, "invitedBy", "joinedAt")
    values (v_pending."tenantId", v_user, v_pending.role, 'active', v_pending."invitedBy", public.epoch_ms());

    update public.invites set status = 'accepted' where _id = v_pending._id;

    -- log_audit writes to the caller's own tenant; claim is cross-tenant so write directly.
    insert into public.auditLogs ("tenantId", "actorType", "actorId", "actionType", "targetType", "metadata")
    values (v_pending."tenantId", 'user', v_user, 'member_joined', 'membership', jsonb_build_object('email', v_email));

    v_claimed := v_claimed + 1;
  end loop;

  return jsonb_build_object('claimed', v_claimed);
end;
$$;

create or replace function public.tenants_update_member_role(p_userId uuid, p_role text)
returns jsonb
language plpgsql
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_membership public.memberships;
  v_owner_count bigint;
begin
  if v_actor is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if public.my_member_role() not in ('owner', 'admin', 'manager') then
    raise exception 'Only managers and above can change roles.';
  end if;
  if p_role is null or p_role not in ('owner', 'admin', 'manager', 'analyst', 'viewer') then
    raise exception 'Invalid role.';
  end if;

  select * into v_membership from public.memberships m
  where m."tenantId" = v_tenant and m."userId" = p_userId limit 1;
  if v_membership._id is null then raise exception 'Member not found.'; end if;

  if v_membership.role = 'owner' and p_role <> 'owner' then
    select count(*) into v_owner_count from public.memberships m
    where m."tenantId" = v_tenant and m.role = 'owner';
    if v_owner_count <= 1 then raise exception 'A workspace must keep at least one owner.'; end if;
  end if;

  update public.memberships set role = p_role where _id = v_membership._id;

  perform public.log_audit('member_role_changed', 'user', p_userId::text,
    jsonb_build_object('from', v_membership.role, 'to', p_role));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.tenants_remove_member(p_userId uuid)
returns jsonb
language plpgsql
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_membership public.memberships;
begin
  if v_actor is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if public.my_member_role() not in ('owner', 'admin', 'manager') then
    raise exception 'Only managers and above can remove members.';
  end if;
  select * into v_membership from public.memberships m
  where m."tenantId" = v_tenant and m."userId" = p_userId limit 1;
  if v_membership._id is null then raise exception 'Member not found.'; end if;
  if v_membership.role = 'owner' then raise exception 'Owners cannot be removed.'; end if;

  delete from public.memberships where _id = v_membership._id;
  perform public.log_audit('member_removed', 'user', p_userId::text);
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Onboarding
-- ---------------------------------------------------------------------------

create or replace function public.onboarding_update_company_profile(
  p_companyName text default null,
  p_country text default null,
  p_stateProvince text default null,
  p_city text default null,
  p_operatingGeography text default null,
  p_industry text default null,
  p_subIndustry text default null,
  p_companySize text default null,
  p_employeeCount double precision default null,
  p_businessModel text default null,
  p_servicesProducts jsonb default null,
  p_website text default null,
  p_onboardingStep double precision default null
)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_profile public.companyProfiles;
  v_patch jsonb := '{}'::jsonb;
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;

  select * into v_profile from public.companyProfiles cp
  where cp."tenantId" = v_tenant limit 1;
  if v_profile._id is null then raise exception 'Workspace profile missing.'; end if;

  if p_companyName is not null then v_patch := v_patch || jsonb_build_object('companyName', p_companyName); end if;
  if p_country is not null then v_patch := v_patch || jsonb_build_object('country', p_country); end if;
  if p_stateProvince is not null then v_patch := v_patch || jsonb_build_object('stateProvince', p_stateProvince); end if;
  if p_city is not null then v_patch := v_patch || jsonb_build_object('city', p_city); end if;
  if p_operatingGeography is not null then v_patch := v_patch || jsonb_build_object('operatingGeography', p_operatingGeography); end if;
  if p_industry is not null then v_patch := v_patch || jsonb_build_object('industry', p_industry); end if;
  if p_subIndustry is not null then v_patch := v_patch || jsonb_build_object('subIndustry', p_subIndustry); end if;
  if p_companySize is not null then v_patch := v_patch || jsonb_build_object('companySize', p_companySize); end if;
  if p_employeeCount is not null then v_patch := v_patch || jsonb_build_object('employeeCount', p_employeeCount); end if;
  if p_businessModel is not null then v_patch := v_patch || jsonb_build_object('businessModel', p_businessModel); end if;
  if p_servicesProducts is not null then v_patch := v_patch || jsonb_build_object('servicesProducts', p_servicesProducts); end if;
  if p_website is not null then v_patch := v_patch || jsonb_build_object('website', p_website); end if;
  if p_onboardingStep is not null then v_patch := v_patch || jsonb_build_object('onboardingStep', p_onboardingStep); end if;
  v_patch := v_patch || jsonb_build_object('updatedAt', public.epoch_ms());

  execute 'update public.companyProfiles set ' ||
    (select string_agg(quote_ident(k) || ' = ' || quote_nullable(v #>> '{}'), ', ' order by k)
     from jsonb_each(v_patch) e(k, v))
    || ' where _id = ' || quote_literal(v_profile._id::text);

  -- Keep the Everest organization context in sync (idempotent).
  if exists (select 1 from public.organizationContexts o where o."tenantId" = v_tenant) then
    update public.organizationContexts o set
      "updatedAt" = public.epoch_ms(),
      industry = coalesce(p_industry, o.industry),
      country = coalesce(p_country, o.country),
      "businessModel" = coalesce(p_businessModel, o."businessModel"),
      "companySize" = coalesce(p_companySize, o."companySize")
    where o."tenantId" = v_tenant;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.onboarding_save_company_system(
  p_name text,
  p_category text default null,
  p_vendor text default null,
  p_status text default 'planned'
)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_exists uuid;
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if p_status <> 'none' then
    select _id into v_exists from public.companySystems cs
    where cs."tenantId" = v_tenant and cs.name = p_name limit 1;
    if v_exists is null then
      insert into public.companySystems ("tenantId", name, category, vendor, status)
      values (v_tenant, p_name, p_category, p_vendor, p_status);
    end if;
  end if;
  perform public.log_audit('system_added', 'company_system', null,
    jsonb_build_object('name', p_name, 'category', p_category, 'vendor', p_vendor, 'status', p_status));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.onboarding_complete_onboarding()
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_profile public.companyProfiles;
  v_industry text;
  v_country text;
  v_activation text[] := '{}'::text[];
  v_activation_slice text;
  v_conn uuid;
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;

  select * into v_profile from public.companyProfiles cp
  where cp."tenantId" = v_tenant limit 1;
  if v_profile._id is null then raise exception 'Workspace profile missing.'; end if;

  update public.companyProfiles set
    "onboardingStep" = 5, "onboardingComplete" = true, "updatedAt" = public.epoch_ms()
  where _id = v_profile._id;

  v_industry := lower(coalesce(v_profile.industry, ''));
  v_country := lower(coalesce(v_profile.country, ''));

  v_activation := v_activation || array['atlas-core', 'general-business'];
  if v_industry like '%property management%' then
    v_activation := v_activation || array['property-management'];
  elsif v_industry ~ 'restoration|construction|mitigation|roof|property' then
    v_activation := v_activation || array['insurance-restoration'];
  elsif v_industry ~ 'legal|law' then
    v_activation := v_activation || array['legal'];
  elsif v_industry ~ 'health' then
    v_activation := v_activation || array['healthcare'];
  elsif v_industry ~ 'software|saas|technology' then
    v_activation := v_activation || array['saas'];
  elsif v_industry ~ 'real estate' then
    v_activation := v_activation || array['real-estate'];
  elsif v_industry ~ 'solar' then
    v_activation := v_activation || array['solar'];
  elsif v_industry ~ 'manufacturing' then
    v_activation := v_activation || array['manufacturing'];
  elsif v_industry ~ 'logistic|supply chain' then
    v_activation := v_activation || array['logistics'];
  elsif v_industry ~ 'financial' then
    v_activation := v_activation || array['financial-services'];
  elsif v_industry ~ 'professional services|consulting' then
    v_activation := v_activation || array['professional-services'];
  end if;
  if v_country like '%united%' then
    v_activation := v_activation || array['us-federal'];
  end if;

  foreach v_activation_slice in array v_activation loop
    insert into public.tenantPacks ("tenantId", "packKey", "activatedAt", "activatedBy", status)
    values (v_tenant, v_activation_slice, public.epoch_ms(), v_user, 'active')
    on conflict ("tenantId", "packKey") do update set status = 'active';
  end loop;

  select _id into v_conn from public.connections c
  where c."tenantId" = v_tenant and c.provider = 'manual_upload' limit 1;
  if v_conn is null then
    insert into public.connections ("tenantId", name, provider, category, status, notes, settings)
    values (v_tenant, 'Manual file uploads', 'manual_upload', 'document_storage', 'connected',
      'Files uploaded directly to Atlas.', jsonb_build_object('kind', 'upload'));
  end if;

  if not exists (select 1 from public.organizationContexts o where o."tenantId" = v_tenant) then
    insert into public.organizationContexts ("tenantId", country, industry, "businessModel", "companySize", "updatedAt")
    values (v_tenant, v_profile.country, v_profile.industry, v_profile."businessModel", v_profile."companySize", public.epoch_ms());
  end if;

  perform public.log_audit('onboarding_completed', 'tenant', v_tenant::text,
    jsonb_build_object('industry', v_profile.industry, 'activatedPacks', to_jsonb(v_activation)));

  return jsonb_build_object('activatedPacks', to_jsonb(v_activation));
end;
$$;

-- ---------------------------------------------------------------------------
-- Intelligence
-- ---------------------------------------------------------------------------

create or replace function public.intelligence_seed_packs(p_packs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pack jsonb;
  v_item jsonb;
  v_count bigint := 0;
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  for v_pack in select * from jsonb_array_elements(p_packs)
  loop
    insert into public.intelligencePacks (key, name, "packType", publisher, description, version, status)
    values (
      v_pack ->> 'key', v_pack ->> 'name', v_pack ->> 'packType',
      v_pack ->> 'publisher', v_pack ->> 'description', v_pack ->> 'version', 'active'
    )
    on conflict (key) do nothing;

    if exists (select 1 from public.intelligencePacks where key = v_pack ->> 'key') then
      for v_item in select * from jsonb_array_elements(coalesce(v_pack -> 'items', '[]'::jsonb))
      loop
        insert into public.intelligenceItems ("packKey", "itemType", key, title, summary, content, jurisdiction, industry, status, confidence)
        values (
          v_pack ->> 'key', v_item ->> 'itemType', v_item ->> 'key', v_item ->> 'title',
          v_item ->> 'summary', v_item -> 'content', v_item ->> 'jurisdiction',
          v_item ->> 'industry', 'active', (v_item ->> 'confidence')::double precision
        )
        on conflict do nothing;
      end loop;
      v_count := v_count + 1;
    end if;
  end loop;
  return jsonb_build_object('seeded', v_count);
end;
$$;

create or replace function public.intelligence_list_workspace_packs()
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
      to_jsonb(p) || jsonb_build_object(
        'activated', exists (
          select 1 from public.tenantPacks tp
          where tp."tenantId" = v_tenant and tp."packKey" = p.key and tp.status = 'active'
        ),
        'activatedAt', (
          select tp."activatedAt" from public.tenantPacks tp
          where tp."tenantId" = v_tenant and tp."packKey" = p.key
          order by tp."_creationTime" desc limit 1
        )
      ) order by p."_creationTime"
    )
    from public.intelligencePacks p
  ), '[]'::jsonb);
end;
$$;

create or replace function public.intelligence_list_pack_items(p_packKey text)
returns jsonb
language plpgsql
stable
as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(i) order by i."_creationTime")
    from public.intelligenceItems i where i."packKey" = p_packKey
  ), '[]'::jsonb);
end;
$$;

create or replace function public.intelligence_set_pack_activation(p_packKey text, p_active boolean)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if p_active then
    insert into public.tenantPacks ("tenantId", "packKey", "activatedAt", "activatedBy", status)
    values (v_tenant, p_packKey, public.epoch_ms(), v_user, 'active')
    on conflict ("tenantId", "packKey") do update set status = 'active';
  else
    update public.tenantPacks set status = 'dismissed'
    where "tenantId" = v_tenant and "packKey" = p_packKey;
  end if;
  perform public.log_audit(
    case when p_active then 'pack_activated' else 'pack_dismissed' end,
    'intelligence_pack', null, jsonb_build_object('packKey', p_packKey));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------

create or replace function public.documents_list_documents()
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(d) order by d."_creationTime" desc)
    from (
      select * from public.documents where "tenantId" = v_tenant
      order by "_creationTime" desc limit 80
    ) d
  ), '[]'::jsonb);
end;
$$;

create or replace function public.documents_document_stats()
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
  v_total bigint; v_ready bigint; v_processing bigint; v_failed bigint; v_chunks bigint;
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  select count(*) into v_total from public.documents where "tenantId" = v_tenant;
  select count(*) into v_ready from public.documents where "tenantId" = v_tenant and status = 'ready';
  select count(*) into v_processing from public.documents where "tenantId" = v_tenant and status = 'processing';
  select count(*) into v_failed from public.documents where "tenantId" = v_tenant and status = 'failed';
  select count(*) into v_chunks from public.documentChunks where "tenantId" = v_tenant;
  return jsonb_build_object(
    'total', v_total, 'ready', v_ready, 'processing', v_processing,
    'failed', v_failed, 'chunks', v_chunks
  );
end;
$$;

create or replace function public.documents_get_document(p_documentId uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
  v_doc jsonb;
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  select to_jsonb(d) into v_doc from public.documents d
  where d._id = p_documentId and d."tenantId" = v_tenant;
  return v_doc;
end;
$$;

create or replace function public.documents_get_document_detail(p_documentId uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
  v_doc jsonb;
  v_chunks jsonb;
  v_entities jsonb;
  v_assertions jsonb;
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  select to_jsonb(d) into v_doc from public.documents d
  where d._id = p_documentId and d."tenantId" = v_tenant;
  if v_doc is null then return null; end if;

  select coalesce(jsonb_agg(to_jsonb(c) order by c."chunkIndex"), '[]'::jsonb) into v_chunks
  from public.documentChunks c where c."documentId" = p_documentId;

  select coalesce(jsonb_agg(to_jsonb(e) order by e."_creationTime"), '[]'::jsonb) into v_entities
  from public.entities e where e."tenantId" = v_tenant and e."sourceDocumentId" = p_documentId;

  select coalesce(jsonb_agg(to_jsonb(a) order by a."_creationTime" desc), '[]'::jsonb) into v_assertions
  from (
    select * from public.knowledgeAssertions a
    where a."tenantId" = v_tenant and a."sourceDocumentId" = p_documentId
    limit 40
  ) a;

  return jsonb_build_object('doc', v_doc, 'chunks', v_chunks, 'entities', v_entities, 'assertions', v_assertions);
end;
$$;

create or replace function public.documents_delete_document(p_documentId uuid)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_doc public.documents;
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if public.my_member_role() not in ('owner', 'admin', 'manager') then
    raise exception 'Only managers and above can delete documents.';
  end if;
  select * into v_doc from public.documents d
  where d._id = p_documentId and d."tenantId" = v_tenant;
  if v_doc._id is null then raise exception 'Document not found.'; end if;

  delete from public.documentChunks where "documentId" = p_documentId;
  delete from public.documents where _id = p_documentId;
  perform public.log_audit('document_deleted', 'document', p_documentId::text,
    jsonb_build_object('title', v_doc.title));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Knowledge graph
-- ---------------------------------------------------------------------------

create or replace function public.knowledge_list_entities(p_type text default null)
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if p_type is not null and p_type <> '' then
    return coalesce((
      select jsonb_agg(to_jsonb(e) order by e."_creationTime" desc)
      from (select * from public.entities where "tenantId" = v_tenant and "entityTypeKey" = p_type limit 200) e
    ), '[]'::jsonb);
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(e) order by e."_creationTime" desc)
    from (select * from public.entities where "tenantId" = v_tenant order by "_creationTime" desc limit 200) e
  ), '[]'::jsonb);
end;
$$;

create or replace function public.knowledge_get_entity(p_entityId uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
  v_entity jsonb;
  v_rels jsonb;
  v_assertions jsonb;
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  select to_jsonb(e) into v_entity from public.entities e
  where e._id = p_entityId and e."tenantId" = v_tenant;
  if v_entity is null then return null; end if;

  select coalesce(jsonb_agg(
    to_jsonb(r) || jsonb_build_object('object', (
      select jsonb_build_object('_id', o._id, 'name', o.name, 'entityTypeKey', o."entityTypeKey")
      from public.entities o where o._id = r."objectEntityId"
    ))
  ), '[]'::jsonb) into v_rels
  from public.entityRelationships r where r."subjectEntityId" = p_entityId;

  select coalesce(jsonb_agg(to_jsonb(a) order by a."_creationTime" desc), '[]'::jsonb) into v_assertions
  from (
    select * from public.knowledgeAssertions a
    where a."tenantId" = v_tenant and a."entityId" = p_entityId limit 20
  ) a;

  return jsonb_build_object('entity', v_entity, 'relationships', v_rels, 'assertions', v_assertions);
end;
$$;

create or replace function public.knowledge_list_assertions()
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(a) order by a."_creationTime" desc)
    from (select * from public.knowledgeAssertions where "tenantId" = v_tenant order by "_creationTime" desc limit 60) a
  ), '[]'::jsonb);
end;
$$;

create or replace function public.knowledge_entity_stats()
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
  v_entities bigint; v_relationships bigint; v_assertions bigint;
  v_type_counts jsonb;
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  select count(*) into v_entities from public.entities where "tenantId" = v_tenant;
  select count(*) into v_relationships from public.entityRelationships where "tenantId" = v_tenant;
  select count(*) into v_assertions from public.knowledgeAssertions where "tenantId" = v_tenant;

  select coalesce(jsonb_object_agg("entityTypeKey", cnt), '{}'::jsonb) into v_type_counts
  from (select "entityTypeKey", count(*) as cnt from public.entities where "tenantId" = v_tenant group by "entityTypeKey") t;

  return jsonb_build_object(
    'entities', v_entities, 'relationships', v_relationships,
    'assertions', v_assertions, 'typeCounts', v_type_counts
  );
end;
$$;

create or replace function public.knowledge_graph_snapshot()
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
  v_nodes jsonb;
  v_edges jsonb;
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e._id::text, 'label', e.name, 'type', e."entityTypeKey", 'confidence', e.confidence
  )), '[]'::jsonb) into v_nodes
  from (select * from public.entities where "tenantId" = v_tenant order by "_creationTime" desc limit 80) e;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r._id::text, 'source', r."subjectEntityId"::text,
    'target', r."objectEntityId"::text, 'type', r."relationshipTypeKey"
  )), '[]'::jsonb) into v_edges
  from (select * from public.entityRelationships where "tenantId" = v_tenant limit 200) r
  where exists (select 1 from jsonb_array_elements(v_nodes) n where n ->> 'id' = r."subjectEntityId"::text)
    and exists (select 1 from jsonb_array_elements(v_nodes) n where n ->> 'id' = r."objectEntityId"::text);

  return jsonb_build_object('nodes', v_nodes, 'edges', v_edges);
end;
$$;

create or replace function public.knowledge_confirm_entity(p_entityId uuid)
returns jsonb
language plpgsql
as $$
declare
  v_tenant uuid := public.my_tenant_id();
  v_entity public.entities;
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  select * into v_entity from public.entities e
  where e._id = p_entityId and e."tenantId" = v_tenant;
  if v_entity._id is null then raise exception 'Entity not found.'; end if;
  update public.entities set status = 'confirmed', confidence = greatest(coalesce(confidence, 0), 0.9)
  where _id = p_entityId;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Recommendations
-- ---------------------------------------------------------------------------

create or replace function public.recommendations_list()
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
      to_jsonb(r) || jsonb_build_object('evidence', (
        select coalesce(jsonb_agg(to_jsonb(re) order by re."_creationTime"), '[]'::jsonb)
        from public.recommendationEvidence re where re."recommendationId" = r._id
      ))
      order by r."_creationTime" desc
    )
    from (select * from public.recommendations where "tenantId" = v_tenant order by "_creationTime" desc limit 60) r
  ), '[]'::jsonb);
end;
$$;

create or replace function public.recommendations_counts()
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  return (
    select jsonb_build_object(
      'open', count(*) filter (where status = 'open'),
      'approved', count(*) filter (where status = 'approved'),
      'rejected', count(*) filter (where status = 'rejected'),
      'dismissed', count(*) filter (where status = 'dismissed'),
      'executed', count(*) filter (where status = 'executed')
    )
    from public.recommendations where "tenantId" = v_tenant
  );
end;
$$;

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
    raise exception 'Invalid decision.';
  end if;
  select * into v_rec from public.recommendations r
  where r._id = p_recommendationId and r."tenantId" = v_tenant;
  if v_rec._id is null then raise exception 'Recommendation not found.'; end if;

  if p_status <> 'dismissed' and public.my_member_role() not in ('owner', 'admin', 'manager') then
    raise exception 'Only managers and above can approve or reject recommendations.';
  end if;

  update public.recommendations set status = p_status, "decidedBy" = v_user, "decidedAt" = public.epoch_ms()
  where _id = p_recommendationId;

  perform public.log_audit('recommendation_' || p_status, 'recommendation', p_recommendationId::text,
    jsonb_build_object('title', v_rec.title));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- History / audit
-- ---------------------------------------------------------------------------

create or replace function public.history_list_ask_sessions()
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
      to_jsonb(s) || jsonb_build_object('evidence', (
        select coalesce(jsonb_agg(to_jsonb(ae) order by ae."_creationTime"), '[]'::jsonb)
        from public.askEvidence ae where ae."sessionId" = s._id
      ))
      order by s."_creationTime" desc
    )
    from (select * from public.askSessions where "tenantId" = v_tenant order by "_creationTime" desc limit 30) s
  ), '[]'::jsonb);
end;
$$;

create or replace function public.history_recent_activity()
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
      to_jsonb(l) || jsonb_build_object('actorName', (
        select coalesce(p.name, p.email) from public.profiles p where p._id = l."actorId"
      ))
      order by l."_creationTime" desc
    )
    from (select * from public.auditLogs where "tenantId" = v_tenant order by "_creationTime" desc limit 30) l
  ), '[]'::jsonb);
end;
$$;

create or replace function public.audit_list_logs(p_limit bigint default 60)
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
      to_jsonb(l) || jsonb_build_object('actorName', (
        select coalesce(p.name, p.email) from public.profiles p where p._id = l."actorId"
      ))
      order by l."_creationTime" desc
    )
    from (select * from public.auditLogs where "tenantId" = v_tenant order by "_creationTime" desc limit p_limit) l
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Archives
-- ---------------------------------------------------------------------------

create or replace function public.archive_list()
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(a) order by a."createdAt" desc)
    from (select * from public.archiveIngestions where "tenantId" = v_tenant order by "createdAt" desc limit 40) a
  ), '[]'::jsonb);
end;
$$;

create or replace function public.archive_stats()
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
  v_total bigint; v_completed bigint; v_with_warnings bigint; v_failed bigint; v_in_progress bigint;
  v_files bigint := 0; v_claims bigint := 0;
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  select count(*) into v_total from public.archiveIngestions where "tenantId" = v_tenant;
  select count(*) into v_completed from public.archiveIngestions where "tenantId" = v_tenant and status = 'completed';
  select count(*) into v_with_warnings from public.archiveIngestions where "tenantId" = v_tenant and status = 'completed_with_warnings';
  select count(*) into v_failed from public.archiveIngestions where "tenantId" = v_tenant and status = 'failed';
  select count(*) into v_in_progress from public.archiveIngestions
  where "tenantId" = v_tenant and status not in ('completed', 'completed_with_warnings', 'failed', 'cancelled');

  select coalesce(sum(coalesce((a.stats ->> 'ingested')::double precision, 0)), 0) into v_files
  from public.archiveIngestions a where a."tenantId" = v_tenant;
  select coalesce(sum(jsonb_array_length(coalesce(a.stats -> 'potentialClaims', '[]'::jsonb))), 0) into v_claims
  from public.archiveIngestions a where a."tenantId" = v_tenant;

  return jsonb_build_object(
    'total', v_total, 'completed', v_completed, 'completedWithWarnings', v_with_warnings,
    'failed', v_failed, 'inProgress', v_in_progress, 'filesIngested', v_files,
    'potentialClaims', v_claims
  );
end;
$$;

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

  select coalesce(jsonb_agg(to_jsonb(f) order by f.path), '[]'::jsonb) into v_files
  from (select * from public.archiveFiles f where f."archiveId" = p_archiveId order by path limit 2000) f;

  select coalesce(jsonb_object_agg(f."documentId"::text, jsonb_build_object(
    '_id', d._id, 'title', d.title, 'classification', d.classification, 'status', d.status
  )), '{}'::jsonb) into v_docs
  from public.archiveFiles f
  join public.documents d on d._id = f."documentId"
  where f."archiveId" = p_archiveId and f."documentId" is not null and d."tenantId" = v_tenant
  limit 300;

  select coalesce(jsonb_agg(to_jsonb(c) order by c."createdAt"), '[]'::jsonb) into v_candidates
  from (select * from public.claimCandidates c where c."archiveId" = p_archiveId limit 50) c;

  return jsonb_build_object('archive', v_archive, 'files', v_files, 'docs', v_docs, 'candidates', v_candidates);
end;
$$;

create or replace function public.archive_begin(
  p_filename text,
  p_fileType text,
  p_size double precision,
  p_checksum text,
  p_rawStorageId text default null,
  p_clientWarnings jsonb default null
)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_ext text;
  v_archive_id uuid;
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if public.my_member_role() not in ('owner', 'admin', 'manager', 'analyst') then
    raise exception 'Viewers can read the knowledge base but not import company data.';
  end if;
  v_ext := lower(coalesce(split_part(p_filename, '.', -1), ''));
  if v_ext not in ('zip', 'rar') and lower(p_fileType) not in ('zip', 'rar') then
    raise exception 'Only .zip and .rar company data packages are supported.';
  end if;
  if p_size > 1048576000 then raise exception 'Archive exceeds the maximum compressed size.'; end if;
  if p_checksum !~ '^[0-9a-f]{64}$' then raise exception 'Archive checksum is missing or malformed.'; end if;

  insert into public.archiveIngestions (
    "tenantId", filename, "fileType", "compressedSize", "extractedSize", "fileCount",
    status, progress, checksum, "rawRetained", "rawStorageId", "uploadedBy", limits,
    warnings, "startedAt", "createdAt", "updatedAt"
  )
  values (
    v_tenant, p_filename, case when v_ext in ('zip', 'rar') then v_ext else lower(p_fileType) end,
    p_size, 0, 0, 'uploaded', 0, p_checksum, p_rawStorageId is not null, p_rawStorageId, v_user,
    jsonb_build_object('maxCompressedSize', 1048576000, 'maxExtractedSize', 5242880000,
      'maxFiles', 5000, 'maxBatchFiles', 200, 'maxFileSize', 104857600, 'rawRetainLimit', 8388608),
    coalesce(p_clientWarnings, '[]'::jsonb), public.epoch_ms(), public.epoch_ms(), public.epoch_ms()
  )
  returning _id into v_archive_id;

  perform public.log_audit('archive_uploaded', 'archiveIngestions', v_archive_id::text,
    jsonb_build_object('filename', p_filename, 'size', p_size, 'fileType', p_fileType));
  return jsonb_build_object('archiveId', v_archive_id);
end;
$$;

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

    if v_ingest_status = 'queued' then
      v_prior := null;
      select _id into v_prior from public.archiveFiles f
      where f."tenantId" = v_tenant and f.checksum = v_file ->> 'checksum' and f."ingestStatus" = 'ingested'
      limit 1;
      if v_prior is not null then
        v_dupe := true;
        select path into v_dupe_path from public.archiveFiles where _id = v_prior;
        v_ingest_status := 'duplicate';
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

create or replace function public.archive_cancel(p_archiveId uuid)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_archive public.archiveIngestions;
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
  update public.archiveIngestions set status = 'cancelled', "updatedAt" = public.epoch_ms(),
    "failureReason" = 'Cancelled by a user.'
  where _id = p_archiveId;
  perform public.log_audit('archive_cancelled', 'archiveIngestions', p_archiveId::text,
    jsonb_build_object('filename', v_archive.filename));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.archive_delete(p_archiveId uuid)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_archive public.archiveIngestions;
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if public.my_member_role() not in ('owner', 'admin', 'manager') then
    raise exception 'Only managers and above can delete an import.';
  end if;
  select * into v_archive from public.archiveIngestions a
  where a._id = p_archiveId and a."tenantId" = v_tenant;
  if v_archive._id is null then raise exception 'Archive not found.'; end if;

  delete from public.archiveFiles where "archiveId" = p_archiveId;
  delete from public.archiveIngestions where _id = p_archiveId;
  perform public.log_audit('archive_deleted', 'archiveIngestions', p_archiveId::text,
    jsonb_build_object('filename', v_archive.filename));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Generic ingestion writers (used by client-side ingestion / detectors / demo)
-- ---------------------------------------------------------------------------

create or replace function public.ingestion_create_document(
  p_title text,
  p_mimeType text default null,
  p_size double precision default null,
  p_sourceType text default 'upload',
  p_classification text default 'Unknown',
  p_status text default 'uploaded',
  p_storageId text default null,
  p_summary text default null,
  p_sourceId text default null,
  p_sourceModifiedAt bigint default null
)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_doc_id uuid;
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if public.my_member_role() not in ('owner', 'admin', 'manager', 'analyst') then
    raise exception 'Viewers can read the knowledge base but not upload files.';
  end if;
  insert into public.documents (
    "tenantId", title, "sourceType", "mimeType", size, classification, status,
    "storageId", "uploadedBy", summary, "sourceId", "sourceModifiedAt"
  )
  values (
    v_tenant, p_title, p_sourceType, p_mimeType, p_size, p_classification, p_status,
    p_storageId, v_user, p_summary, p_sourceId, p_sourceModifiedAt
  )
  returning _id into v_doc_id;
  perform public.log_audit('document_uploaded', 'document', v_doc_id::text, jsonb_build_object('title', p_title));
  return jsonb_build_object('docId', v_doc_id);
end;
$$;

create or replace function public.ingestion_patch_document(p_documentId uuid, p_patch jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_tenant uuid := public.my_tenant_id();
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if not exists (select 1 from public.documents d where d._id = p_documentId and d."tenantId" = v_tenant) then
    raise exception 'Document not found.';
  end if;
  execute 'update public.documents set ' ||
    (select string_agg(quote_ident(k) || ' = ' || case when v is null then 'null' else quote_literal(v #>> '{}') end, ', ')
     from jsonb_each(p_patch) e(k, v)
     where k not in ('_id', '_creationTime', 'tenantId'))
    || ' where _id = ' || quote_literal(p_documentId::text);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.ingestion_insert_chunk(
  p_documentId uuid,
  p_chunkIndex double precision,
  p_content text,
  p_embedding jsonb default null,
  p_tokenCount double precision default null
)
returns jsonb
language plpgsql
as $$
declare
  v_tenant uuid := public.my_tenant_id();
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  insert into public.documentChunks ("tenantId", "documentId", "chunkIndex", content, embedding, "tokenCount")
  values (v_tenant, p_documentId, p_chunkIndex, p_content, p_embedding, p_tokenCount);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.ingestion_insert_entity(
  p_entityTypeKey text,
  p_name text,
  p_confidence double precision default 0.5,
  p_sourceDocumentId uuid default null,
  p_status text default null,
  p_attributes jsonb default null
)
returns jsonb
language plpgsql
as $$
declare
  v_tenant uuid := public.my_tenant_id();
  v_id uuid;
  v_now bigint := public.epoch_ms();
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  insert into public.entities ("tenantId", "entityTypeKey", name, confidence, "sourceDocumentId", status, attributes, "firstObservedAt", "lastObservedAt")
  values (v_tenant, p_entityTypeKey, p_name, p_confidence, p_sourceDocumentId, p_status, p_attributes, v_now, v_now)
  returning _id into v_id;
  return jsonb_build_object('entityId', v_id);
end;
$$;

create or replace function public.ingestion_patch_entity(p_entityId uuid, p_patch jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_tenant uuid := public.my_tenant_id();
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if not exists (select 1 from public.entities e where e._id = p_entityId and e."tenantId" = v_tenant) then
    raise exception 'Entity not found.';
  end if;
  execute 'update public.entities set ' ||
    (select string_agg(quote_ident(k) || ' = ' || case when v is null then 'null' else quote_literal(v #>> '{}') end, ', ')
     from jsonb_each(p_patch) e(k, v)
     where k not in ('_id', '_creationTime', 'tenantId'))
    || ' where _id = ' || quote_literal(p_entityId::text);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.ingestion_insert_relationship(
  p_subjectEntityId uuid,
  p_relationshipTypeKey text,
  p_objectEntityId uuid,
  p_confidence double precision default 0.5,
  p_sourceDocumentId uuid default null,
  p_evidence text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_tenant uuid := public.my_tenant_id();
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  insert into public.entityRelationships ("tenantId", "subjectEntityId", "relationshipTypeKey", "objectEntityId", confidence, "sourceDocumentId", evidence)
  values (v_tenant, p_subjectEntityId, p_relationshipTypeKey, p_objectEntityId, p_confidence, p_sourceDocumentId, p_evidence);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.ingestion_insert_assertion(
  p_classification text,
  p_statement text,
  p_confidence double precision default 0.5,
  p_sourceDocumentId uuid default null,
  p_entityId uuid default null,
  p_evidence text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_tenant uuid := public.my_tenant_id();
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  insert into public.knowledgeAssertions ("tenantId", classification, statement, confidence, "sourceDocumentId", "entityId", evidence, status)
  values (v_tenant, p_classification, p_statement, p_confidence, p_sourceDocumentId, p_entityId, p_evidence, 'proposed');
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.recommendations_create(
  p_title text,
  p_summary text,
  p_reason text,
  p_detectorKey text,
  p_priority text,
  p_confidence double precision,
  p_expectedImpact text default null,
  p_risk text default null,
  p_evidence jsonb default null
)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_rec_id uuid;
  v_ev jsonb;
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if exists (select 1 from public.recommendations r
             where r."tenantId" = v_tenant and r."detectorKey" = p_detectorKey and r.status = 'open') then
    return jsonb_build_object('created', false);
  end if;
  insert into public.recommendations (
    "tenantId", title, summary, reason, classification, "detectorKey", priority,
    confidence, status, "expectedImpact", risk, "requiredApprovalMode"
  )
  values (
    v_tenant, p_title, p_summary, p_reason, 'RECOMMENDATION', p_detectorKey, p_priority,
    p_confidence, 'open', p_expectedImpact, p_risk, 'APPROVE'
  )
  returning _id into v_rec_id;

  for v_ev in select * from jsonb_array_elements(coalesce(p_evidence, '[]'::jsonb))
  loop
    insert into public.recommendationEvidence (
      "recommendationId", kind, "documentId", "chunkId", "entityId", title, snippet, relevance
    )
    values (
      v_rec_id, v_ev ->> 'kind', nullif(v_ev ->> 'documentId', '')::uuid,
      nullif(v_ev ->> 'chunkId', '')::uuid, nullif(v_ev ->> 'entityId', '')::uuid,
      v_ev ->> 'title', v_ev ->> 'snippet', coalesce((v_ev ->> 'relevance')::double precision, 0.5)
    );
  end loop;

  return jsonb_build_object('created', true, 'recommendationId', v_rec_id);
end;
$$;

create or replace function public.recommendations_close_stale(p_detectorKeys jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_tenant uuid := public.my_tenant_id();
  v_closed bigint;
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  update public.recommendations set status = 'dismissed', "decidedAt" = public.epoch_ms()
  where "tenantId" = v_tenant and status = 'open'
    and not ("detectorKey" = any (select jsonb_array_elements_text(p_detectorKeys)));
  get diagnostics v_closed = row_count;
  return jsonb_build_object('closed', v_closed);
end;
$$;

-- Ask sessions (written by the client-side Ask engine / edge function).
create or replace function public.ask_insert_session(
  p_question text,
  p_answer text,
  p_classification text default 'FACT',
  p_confidence double precision default 0.5,
  p_mode text default 'local',
  p_suggestedActions jsonb default null,
  p_toolPlan jsonb default null,
  p_limitations text default null,
  p_questionType text default null,
  p_investigation jsonb default null,
  p_evidence jsonb default null
)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_session_id uuid;
  v_ev jsonb;
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  insert into public.askSessions (
    "tenantId", "userId", question, answer, classification, confidence, mode,
    "suggestedActions", "toolPlan", limitations, "questionType", investigation
  )
  values (
    v_tenant, v_user, p_question, p_answer, p_classification, p_confidence, p_mode,
    p_suggestedActions, p_toolPlan, p_limitations, p_questionType, p_investigation
  )
  returning _id into v_session_id;

  for v_ev in select * from jsonb_array_elements(coalesce(p_evidence, '[]'::jsonb))
  loop
    insert into public.askEvidence (
      "sessionId", kind, "documentId", "chunkId", "entityId", "documentTitle", title, snippet, relevance, "evidenceType"
    )
    values (
      v_session_id, v_ev ->> 'kind', nullif(v_ev ->> 'documentId', '')::uuid,
      nullif(v_ev ->> 'chunkId', '')::uuid, nullif(v_ev ->> 'entityId', '')::uuid,
      v_ev ->> 'documentTitle', v_ev ->> 'title', v_ev ->> 'snippet',
      coalesce((v_ev ->> 'relevance')::double precision, 0.5), v_ev ->> 'evidenceType'
    );
  end loop;

  return jsonb_build_object('sessionId', v_session_id);
end;
$$;

-- Conversation sessions.
create or replace function public.conversation_list_sessions()
returns jsonb
language plpgsql
stable
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(c) order by c."updatedAt" desc)
    from (select * from public.conversationSessions where "tenantId" = v_tenant order by "updatedAt" desc limit 30) c
  ), '[]'::jsonb);
end;
$$;

create or replace function public.conversation_get_session(p_sessionId uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  return (select to_jsonb(c) from public.conversationSessions c
    where c._id = p_sessionId and c."tenantId" = v_tenant);
end;
$$;

create or replace function public.conversation_delete_session(p_sessionId uuid)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  delete from public.conversationSessions c
  where c._id = p_sessionId and c."tenantId" = v_tenant;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.conversation_save_session(
  p_title text,
  p_messages jsonb,
  p_context jsonb default null,
  p_sessionId uuid default null
)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_id uuid;
  v_now bigint := public.epoch_ms();
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if p_sessionId is null then
    insert into public.conversationSessions ("tenantId", "userId", title, messages, context, "updatedAt")
    values (v_tenant, v_user, p_title, p_messages, p_context, v_now)
    returning _id into v_id;
  else
    update public.conversationSessions set title = p_title, messages = p_messages,
      context = coalesce(p_context, context), "updatedAt" = v_now
    where _id = p_sessionId and "tenantId" = v_tenant
    returning _id into v_id;
  end if;
  return jsonb_build_object('sessionId', v_id);
end;
$$;
