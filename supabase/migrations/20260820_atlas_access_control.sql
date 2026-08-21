-- ==========================================================================
-- Atlas Access Control — Pilot Gating + Super Admin Security
-- ==========================================================================

-- ── 1. ACCOUNT STATUS ───────────────────────────────────────────────────
-- Add account_status to profiles for PENDING/ACTIVE/SUSPENDED/REVOKED
DO $$ BEGIN
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS account_status text default 'pending';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS platform_role text default 'user';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Platform roles: 'super_admin', 'user' (default)
-- Account status: 'pending', 'active', 'suspended', 'revoked'
-- Tenant roles remain: 'owner', 'admin', 'manager', 'analyst', 'viewer'

-- ── 2. PILOT APPLICATIONS TABLE ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pilot_applications (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null,
  company_name    text not null,
  email           text not null,
  phone           text,
  website         text,
  company_type    text,
  role            text,
  monthly_claims  text,
  current_workflow text,
  biggest_pain    text,
  heard_about     text,
  notes           text,
  status          text not null default 'pending',
  -- pending, approved, rejected, waitlist
  reviewed_by     uuid references auth.users (id),
  reviewed_at     timestamptz,
  review_notes    text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ── 3. ADMIN PROVISIONING TABLE ─────────────────────────────────────────
-- Tracks user provisioning events for audit
CREATE TABLE IF NOT EXISTS public.user_provisions (
  id              uuid primary key default gen_random_uuid(),
  provisioned_by  uuid not null references auth.users (id),
  provisioned_user uuid references auth.users (id),
  application_id  uuid references public.pilot_applications (id),
  email           text not null,
  tenant_id       uuid references public.tenants (_id),
  platform_role   text default 'user',
  tenant_role     text default 'viewer',
  account_status  text default 'active',
  notes           text,
  created_at      timestamptz default now()
);

-- ── 4. AUDIT LOG TABLE ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.atlas_audit_log (
  id              uuid primary key default gen_random_uuid(),
  actor_id        uuid references auth.users (id),
  actor_email     text,
  action          text not null,
  target_type     text,
  target_id       uuid,
  details         jsonb,
  created_at      timestamptz default now()
);

CREATE INDEX IF NOT EXISTS atlas_audit_log_actor_idx ON public.atlas_audit_log (actor_id);
CREATE INDEX IF NOT EXISTS atlas_audit_log_action_idx ON public.atlas_audit_log (action);
CREATE INDEX IF NOT EXISTS atlas_audit_log_created_idx ON public.atlas_audit_log (created_at desc);

-- ── 5. RLS ──────────────────────────────────────────────────────────────
ALTER TABLE public.pilot_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_provisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_audit_log ENABLE ROW LEVEL SECURITY;

-- Pilot applications: public can INSERT (submit), super_admin can SELECT/UPDATE
DO $$ BEGIN DROP POLICY IF EXISTS "pilot_apps_insert" ON public.pilot_applications; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "pilot_apps_select_admin" ON public.pilot_applications; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "pilot_apps_update_admin" ON public.pilot_applications; END $$;

CREATE POLICY "pilot_apps_insert" ON public.pilot_applications
  FOR INSERT WITH CHECK (true);

CREATE POLICY "pilot_apps_select_admin" ON public.pilot_applications
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE _id = auth.uid() AND platform_role = 'super_admin'
    )
  );

CREATE POLICY "pilot_apps_update_admin" ON public.pilot_applications
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE _id = auth.uid() AND platform_role = 'super_admin'
    )
  );

-- User provisions: super_admin only
DO $$ BEGIN DROP POLICY IF EXISTS "user_provisions_admin" ON public.user_provisions; END $$;

CREATE POLICY "user_provisions_admin" ON public.user_provisions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE _id = auth.uid() AND platform_role = 'super_admin'
    )
  );

-- Audit log: super_admin can read, system can insert
DO $$ BEGIN DROP POLICY IF EXISTS "audit_log_select_admin" ON public.atlas_audit_log; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "audit_log_insert_system" ON public.atlas_audit_log; END $$;

CREATE POLICY "audit_log_select_admin" ON public.atlas_audit_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE _id = auth.uid() AND platform_role = 'super_admin'
    )
  );

CREATE POLICY "audit_log_insert_system" ON public.atlas_audit_log
  FOR INSERT WITH CHECK (true);

-- ── 6. AUTHORIZATION FUNCTIONS ──────────────────────────────────────────

-- Check if current user is super_admin
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE _id = auth.uid() AND platform_role = 'super_admin'
  );
$$;

-- Get current user's platform role
CREATE OR REPLACE FUNCTION public.get_platform_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT platform_role FROM public.profiles WHERE _id = auth.uid()),
    'user'
  );
$$;

-- Get current user's account status
CREATE OR REPLACE FUNCTION public.get_account_status()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT account_status FROM public.profiles WHERE _id = auth.uid()),
    'pending'
  );
$$;

-- Check if user has active membership AND active account
CREATE OR REPLACE FUNCTION public.is_approved_user()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.memberships m ON m."userId" = p._id
    WHERE p._id = auth.uid()
      AND p.account_status = 'active'
      AND m.status = 'active'
  );
$$;

-- Check if user can access Atlas application
CREATE OR REPLACE FUNCTION public.can_access_atlas()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.is_super_admin() OR public.is_approved_user();
$$;

-- ── 7. PILOT APPLICATION RPCs ───────────────────────────────────────────

-- Submit a pilot application (public, no auth required)
CREATE OR REPLACE FUNCTION public.pilot_apply(
  p_full_name text,
  p_company_name text,
  p_email text,
  p_phone text DEFAULT NULL,
  p_website text DEFAULT NULL,
  p_company_type text DEFAULT NULL,
  p_role text DEFAULT NULL,
  p_monthly_claims text DEFAULT NULL,
  p_current_workflow text DEFAULT NULL,
  p_biggest_pain text DEFAULT NULL,
  p_heard_about text DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_app jsonb;
BEGIN
  INSERT INTO public.pilot_applications (
    full_name, company_name, email, phone, website,
    company_type, role, monthly_claims, current_workflow,
    biggest_pain, heard_about, notes
  ) VALUES (
    p_full_name, p_company_name, p_email, p_phone, p_website,
    p_company_type, p_role, p_monthly_claims, p_current_workflow,
    p_biggest_pain, p_heard_about, p_notes
  )
  RETURNING row_to_json(pilot_applications.*) INTO v_app;
  RETURN v_app;
END;
$$;

-- List pilot applications (super_admin only)
CREATE OR REPLACE FUNCTION public.pilot_list_applications(
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(a))
    FROM public.pilot_applications a
    WHERE (p_status IS NULL OR a.status = p_status)
    ORDER BY a.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ), '[]'::jsonb);
END;
$$;

-- Update pilot application status (super_admin only)
CREATE OR REPLACE FUNCTION public.pilot_review_application(
  p_id uuid,
  p_status text,
  p_review_notes text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  UPDATE public.pilot_applications SET
    status = p_status,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    review_notes = coalesce(p_review_notes, review_notes),
    updated_at = now()
  WHERE id = p_id;
  RETURN FOUND;
END;
$$;

-- Get pilot application stats (super_admin only)
CREATE OR REPLACE FUNCTION public.pilot_application_stats()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN (
    SELECT jsonb_build_object(
      'total', count(*),
      'pending', count(*) FILTER (WHERE status = 'pending'),
      'approved', count(*) FILTER (WHERE status = 'approved'),
      'rejected', count(*) FILTER (WHERE status = 'rejected'),
      'waitlist', count(*) FILTER (WHERE status = 'waitlist')
    )
    FROM public.pilot_applications
  );
END;
$$;

-- ── 8. USER PROVISIONING RPCs ───────────────────────────────────────────

-- Provision a new user (super_admin only)
-- This creates the profile + membership entry for an approved applicant
CREATE OR REPLACE FUNCTION public.admin_provision_user(
  p_email text,
  p_name text,
  p_tenant_name text,
  p_tenant_role text default 'admin',
  p_application_id uuid default null,
  p_notes text default null
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tenant_id uuid;
  v_user_id uuid;
  v_result jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Create tenant if not exists
  INSERT INTO public.tenants (name, slug, status)
  VALUES (p_tenant_name, lower(replace(p_tenant_name, ' ', '-')), 'active')
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
  RETURNING _id INTO v_tenant_id;

  -- We cannot create auth users from RPC — that requires the Admin API.
  -- This function records the provisioning intent. The actual user creation
  -- must happen via the Supabase Admin API (Edge Function or dashboard).
  -- For now, we store the provision record.

  INSERT INTO public.user_provisions (
    provisioned_by, application_id, email, tenant_id,
    tenant_role, account_status, notes
  ) VALUES (
    auth.uid(), p_application_id, p_email, v_tenant_id,
    p_tenant_role, 'active', p_notes
  )
  RETURNING row_to_json(user_provisions.*) INTO v_result;

  -- Log the action
  INSERT INTO public.atlas_audit_log (actor_id, actor_email, action, target_type, details)
  VALUES (
    auth.uid(),
    (SELECT email FROM public.profiles WHERE _id = auth.uid()),
    'USER_PROVISIONED',
    'user',
    jsonb_build_object('email', p_email, 'tenant_id', v_tenant_id, 'role', p_tenant_role)
  );

  RETURN v_result;
END;
$$;

-- List user provisions (super_admin only)
CREATE OR REPLACE FUNCTION public.admin_list_provisions()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(up))
    FROM public.user_provisions up
    ORDER BY up.created_at DESC
  ), '[]'::jsonb);
END;
$$;

-- ── 9. AUDIT LOG RPC ────────────────────────────────────────────────────

-- List audit logs (super_admin only)
CREATE OR REPLACE FUNCTION public.admin_list_audit_log(
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(al))
    FROM public.atlas_audit_log al
    ORDER BY al.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ), '[]'::jsonb);
END;
$$;

-- ── 10. UPDATE EXISTING FUNCTIONS ───────────────────────────────────────
-- The existing my_tenant_id() and is_member() remain unchanged.
-- They already enforce tenant isolation.
-- We add the account_status check to can_access_atlas() above.

-- ── 11. SET SUPER ADMIN ─────────────────────────────────────────────────
-- This is a one-time setup. After migration, run:
--   UPDATE public.profiles SET platform_role = 'super_admin' WHERE _id = '<your-user-id>';
-- Or use the Supabase dashboard SQL editor.

-- ── 12. DEFAULT NEW SIGNUPS TO PENDING ──────────────────────────────────
-- Ensure new Supabase auth users get 'pending' status by default.
-- NOTE: "emailVerificationTime" is a BIGINT epoch-ms column — the confirmed-at
-- timestamp MUST be converted (the previous version passed the timestamptz
-- directly, which threw a type error and broke ALL new user creation with
-- "Database error creating new user").
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (_id, name, email, "emailVerificationTime", "isAnonymous", role, account_status, platform_role)
  VALUES (
    NEW.id,
    coalesce(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    case when NEW.email_confirmed_at is not null
      then (extract(epoch from NEW.email_confirmed_at) * 1000)::bigint
      else null end,
    false,
    'user',
    'pending',
    'user'
  )
  ON CONFLICT (_id) DO UPDATE SET
    name = coalesce(EXCLUDED.name, public.profiles.name),
    email = coalesce(EXCLUDED.email, public.profiles.email);
  RETURN NEW;
END;
$$;
