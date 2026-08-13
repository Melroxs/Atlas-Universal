-- ---------------------------------------------------------------------------
-- Migration 0013 — tenant bootstrap profile repair + structured errors.
--
-- Production defect: a signup whose public.profiles row is missing (an auth
-- user created before the handle_new_user trigger existed, a trigger insert
-- that failed, or a user provisioned out of band) makes the owner-membership
-- insert in tenants_create_tenant fail with:
--
--   insert or update on table "memberships" violates foreign key constraint
--   "memberships_userId_fkey" (SQLSTATE 23503)
--
-- because memberships."userId" references public.profiles(_id) — NOT
-- auth.users(id). The trigger normally creates the profile at signup, but the
-- contract "profile MUST exist before a membership insert" was only enforced
-- by timing, not by the bootstrap RPC.
--
-- Fix:
--  1. New ensure_profile() helper — idempotently materializes a profiles row
--     from auth.users for a given user (same shape the handle_new_user
--     trigger writes). Reusable by every RPC that inserts a membership.
--  2. tenants_create_tenant now calls ensure_profile() BEFORE any membership
--     insert, so a missing profile can never produce 23503 again. It keeps
--     the 0011 idempotent fast path and the advisory-lock serialization, and
--     re-raises database errors with clear messages (never swallowed) while
--     preserving RLS and the security definer contract.
--  3. tenants_claim_invites (the other membership-writer) uses the same
--     repair so invite claims can never hit 23503 either.
-- ---------------------------------------------------------------------------

-- Idempotent profile materialization from auth.users. Security definer so it
-- works even when the caller has no workspace yet (tenant-scoped RLS would
-- block the bootstrap insert otherwise); the caller is always the row being
-- repaired (auth.uid() checked by callers).
create or replace function public.ensure_profile(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (_id, name, email, "emailVerificationTime", "isAnonymous", role)
  select
    au.id,
    coalesce(au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name'),
    au.email,
    case when au.email_confirmed_at is not null
      then (extract(epoch from au.email_confirmed_at) * 1000)::bigint
      else null end,
    au.is_anonymous,
    'user'
  from auth.users au
  where au.id = p_user
  on conflict (_id) do nothing;
end;
$$;

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
  if v_user is null then
    raise exception 'You must be signed in.' using errcode = 'P0001';
  end if;
  if p_name is null or trim(p_name) = '' then
    raise exception 'Workspace name is required.' using errcode = 'P0001';
  end if;

  -- Root-cause repair (23503): the caller's profiles row must exist BEFORE any
  -- membership insert. This is the deterministic guarantee the signup flow
  -- relies on — never assume the auth trigger already ran.
  perform public.ensure_profile(v_user);

  -- Idempotent fast path: the caller already belongs to a workspace. Return it
  -- instead of raising, so repeated onboarding / refresh never produces an
  -- error state. Repair an incomplete relationship (missing company profile)
  -- rather than failing.
  v_existing := public.my_tenant_id();
  if v_existing is not null then
    perform 1 from public.companyProfiles cp where cp."tenantId" = v_existing;
    if not found then
      insert into public.companyProfiles ("tenantId", "companyName", "onboardingStep", "onboardingComplete")
      values (v_existing, trim(p_name), 0, false)
      on conflict ("tenantId") do nothing;
    end if;
    return jsonb_build_object('tenantId', v_existing, 'existing', true);
  end if;

  -- Serialize concurrent bootstrap attempts for the same user so two requests
  -- can never both pass the null check and create duplicate tenants,
  -- memberships or company profiles.
  perform pg_advisory_xact_lock(hashtextextended('atlas:tenant-bootstrap:' || v_user::text, 0));

  -- Re-check after acquiring the lock: a concurrent request may have created
  -- the workspace while we waited.
  v_existing := public.my_tenant_id();
  if v_existing is not null then
    return jsonb_build_object('tenantId', v_existing, 'existing', true);
  end if;

  begin
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
  exception
    when unique_violation then
      raise exception 'This workspace already exists. Please retry — you will be taken to your existing workspace.'
        using errcode = '23505';
    when foreign_key_violation then
      raise exception 'Your account profile could not be created. Please sign out and sign in again, then retry.'
        using errcode = '23503';
    when others then
      raise;
  end;

  return jsonb_build_object('tenantId', v_tenant, 'existing', false);
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
  -- Same profile-before-membership guarantee as tenant bootstrap.
  perform public.ensure_profile(v_user);
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
