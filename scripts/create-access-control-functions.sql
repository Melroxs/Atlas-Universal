-- ==========================================================================
-- Atlas Authorization Functions
-- Run this in Supabase Dashboard → SQL Editor
-- All statements are idempotent (CREATE OR REPLACE)
-- ==========================================================================

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

-- New user handler — sets pending status by default
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (_id, name, email, "emailVerificationTime", "isAnonymous", role, account_status, platform_role)
  VALUES (
    NEW.id,
    coalesce(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    NEW.email_confirmed_at,
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

-- Pilot application functions
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

-- User provisioning
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
  v_result jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  INSERT INTO public.tenants (name, slug, status)
  VALUES (p_tenant_name, lower(replace(p_tenant_name, ' ', '-')), 'active')
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
  RETURNING _id INTO v_tenant_id;

  INSERT INTO public.user_provisions (
    provisioned_by, application_id, email, tenant_id,
    tenant_role, account_status, notes
  ) VALUES (
    auth.uid(), p_application_id, p_email, v_tenant_id,
    p_tenant_role, 'active', p_notes
  )
  RETURNING row_to_json(user_provisions.*) INTO v_result;

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

-- Verify
SELECT 'Functions created successfully' as status;
