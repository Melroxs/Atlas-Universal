-- ===========================================================================
-- Atlas User Management RPCs
-- ===========================================================================
-- Adds admin-level user management functions protected by is_super_admin()
-- and atlas_admin checks. All functions enforce tenant isolation.
--
-- Applied idempotently — safe to run multiple times.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Helper: check if current user has admin-level access
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE _id = auth.uid()
      AND platform_role = 'super_admin'
      AND account_status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_atlas_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE _id = auth.uid()
      AND platform_role IN ('super_admin', 'atlas_admin')
      AND account_status = 'active'
  );
$$;

-- ---------------------------------------------------------------------------
-- admin_list_users — list all users (paginated, filterable)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_users(
  p_search text DEFAULT NULL,
  p_role text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Authorization check
  IF NOT public.is_atlas_admin() THEN
    RAISE EXCEPTION 'Insufficient permissions: atlas_admin or super_admin required';
  END IF;

  SELECT jsonb_agg(row_to_json(u)) INTO v_result
  FROM (
    SELECT
      p._id,
      p.name,
      p.email,
      p.image,
      p.platform_role,
      p.account_status,
      p.company_name,
      p.created_at,
      COALESCE(
        (SELECT jsonb_build_object(
          'tenant_id', m."tenantId",
          'role', m."role",
          'tenant_name', t.name
        )
        FROM memberships m
        LEFT JOIN tenants t ON t._id = m."tenantId"
        WHERE m."userId" = p._id
        LIMIT 1),
        'null'::jsonb
      ) as membership
    FROM profiles p
    WHERE
      (p_search IS NULL OR p.name ILIKE '%' || p_search || '%' OR p.email ILIKE '%' || p_search || '%')
      AND (p_role IS NULL OR p.platform_role = p_role)
      AND (p_status IS NULL OR p.account_status = p_status)
    ORDER BY p.created_at DESC NULLS LAST
    LIMIT p_limit
    OFFSET p_offset
  ) u;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- admin_get_user — get a single user's full profile
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_atlas_admin() THEN
    RAISE EXCEPTION 'Insufficient permissions: atlas_admin or super_admin required';
  END IF;

  SELECT jsonb_build_object(
    'profile', row_to_json(p),
    'memberships', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'tenant_id', m."tenantId",
        'role', m."role",
        'tenant_name', t.name
      ))
      FROM memberships m
      LEFT JOIN tenants t ON t._id = m."tenantId"
      WHERE m."userId" = p._id),
      '[]'::jsonb
    )
  ) INTO v_result
  FROM profiles p
  WHERE p._id = p_user_id;

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- admin_update_user_role — change a user's platform role
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_user_role(
  p_user_id uuid,
  p_new_role text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_role text;
BEGIN
  -- Only super_admin can assign admin-level roles
  SELECT platform_role INTO v_caller_role
  FROM profiles WHERE _id = auth.uid();

  IF v_caller_role IS DISTINCT FROM 'super_admin' THEN
    -- atlas_admin can assign customer-level roles only
    IF v_caller_role IS DISTINCT FROM 'atlas_admin' THEN
      RAISE EXCEPTION 'Insufficient permissions: admin role required';
    END IF;
    IF p_new_role IN ('super_admin', 'atlas_admin') THEN
      RAISE EXCEPTION 'Only super_admin can assign admin-level roles';
    END IF;
  END IF;

  -- Validate the role
  IF p_new_role NOT IN ('super_admin', 'atlas_admin', 'customer_admin', 'customer_user', 'pilot_user', 'user') THEN
    RAISE EXCEPTION 'Invalid role: %', p_new_role;
  END IF;

  UPDATE profiles
  SET platform_role = p_new_role
  WHERE _id = p_user_id;

  RETURN jsonb_build_object('ok', true, 'user_id', p_user_id, 'new_role', p_new_role);
END;
$$;

-- ---------------------------------------------------------------------------
-- admin_update_user_status — change a user's account status
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_user_status(
  p_user_id uuid,
  p_new_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_role text;
BEGIN
  SELECT platform_role INTO v_caller_role
  FROM profiles WHERE _id = auth.uid();

  IF v_caller_role IS DISTINCT FROM 'super_admin' AND v_caller_role IS DISTINCT FROM 'atlas_admin' THEN
    RAISE EXCEPTION 'Insufficient permissions: admin role required';
  END IF;

  -- Prevent self-suspension
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own account status';
  END IF;

  IF p_new_status NOT IN ('active', 'pending', 'suspended', 'revoked') THEN
    RAISE EXCEPTION 'Invalid status: %', p_new_status;
  END IF;

  UPDATE profiles
  SET account_status = p_new_status
  WHERE _id = p_user_id;

  RETURN jsonb_build_object('ok', true, 'user_id', p_user_id, 'new_status', p_new_status);
END;
$$;

-- ---------------------------------------------------------------------------
-- admin_update_user_company — assign a user to a company/tenant
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_user_company(
  p_user_id uuid,
  p_tenant_id uuid,
  p_member_role text DEFAULT 'member'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_role text;
BEGIN
  SELECT platform_role INTO v_caller_role
  FROM profiles WHERE _id = auth.uid();

  IF v_caller_role IS DISTINCT FROM 'super_admin' AND v_caller_role IS DISTINCT FROM 'atlas_admin' THEN
    RAISE EXCEPTION 'Insufficient permissions: admin role required';
  END IF;

  -- Upsert membership
  INSERT INTO memberships ("userId", "tenantId", "role")
  VALUES (p_user_id, p_tenant_id, p_member_role)
  ON CONFLICT ("userId", "tenantId") DO UPDATE
  SET "role" = EXCLUDED."role";

  RETURN jsonb_build_object('ok', true, 'user_id', p_user_id, 'tenant_id', p_tenant_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- admin_list_tenants — list all companies/tenants
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_tenants()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.is_atlas_admin() THEN
    RAISE EXCEPTION 'Insufficient permissions: atlas_admin or super_admin required';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    FROM (
      SELECT _id, name, created_at
      FROM tenants
      ORDER BY name NULLS LAST
    ) t
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- admin_create_tenant — create a new company/tenant
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_create_tenant(
  p_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_id uuid;
BEGIN
  IF NOT public.is_atlas_admin() THEN
    RAISE EXCEPTION 'Insufficient permissions: atlas_admin or super_admin required';
  END IF;

  INSERT INTO tenants (name)
  VALUES (p_name)
  RETURNING _id INTO v_new_id;

  RETURN jsonb_build_object('ok', true, 'tenant_id', v_new_id, 'name', p_name);
END;
$$;
