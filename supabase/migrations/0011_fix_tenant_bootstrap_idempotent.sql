-- ---------------------------------------------------------------------------
-- Migration 0011 — tenant bootstrap idempotency + concurrency safety
--
-- Production defect: onboarding fired `tenants_create_tenant` more than once
-- (Auth auto-provision racing /setup, double submits, refresh mid-onboarding).
-- Two behaviors were broken:
--
--   1. Repeated calls raised `You already belong to a workspace.` (P0001 → HTTP
--      400) instead of returning the caller's existing workspace.
--   2. Concurrent calls both passed the `my_tenant_id()` null check, then one
--      died on `companyProfiles.tenantId` unique violation (23505 → HTTP 409),
--      rolling back its tenant + membership — exactly the 409 seen in
--      production onboarding.
--
-- Fix: the function is now idempotent (existing membership → return it, and
-- repair a missing company profile) and serializes concurrent bootstraps for
-- the same user with a transaction-scoped advisory lock before the create.
--
-- RLS is untouched. The function stays `security definer` (the bootstrap
-- caller has no membership yet, so tenant-scoped RLS would block its own
-- inserts) and still enforces auth + validation explicitly.
-- ---------------------------------------------------------------------------

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
  if p_name is null or trim(p_name) = '' then raise exception 'Workspace name is required.'; end if;

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

  return jsonb_build_object('tenantId', v_tenant, 'existing', false);
end;
$$;
