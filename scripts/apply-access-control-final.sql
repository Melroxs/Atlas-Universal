-- ==========================================================================
-- Atlas Access Control — Final Setup Script
-- Run this in Supabase Dashboard → SQL Editor
-- ==========================================================================

-- 1. Add access control columns to profiles (idempotent)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS account_status text DEFAULT 'pending';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS platform_role text DEFAULT 'user';

-- 2. Configure Melissa October as Super Admin
--    UID: 0e914537-e62b-4982-a49d-3056f0deb2b8
--    Email: melissa.o.rox@gmail.com
UPDATE public.profiles
SET account_status = 'active',
    platform_role = 'super_admin'
WHERE _id = '0e914537-e62b-4982-a49d-3056f0deb2b8';

-- 3. Configure YC Demo as Active
--    UID: c7e29b03-81d5-49c3-9504-151aa0dcd510
--    Email: ycdemo@gmail.com
UPDATE public.profiles
SET account_status = 'active',
    platform_role = 'user'
WHERE _id = 'c7e29b03-81d5-49c3-9504-151aa0dcd510';

-- 4. Create authorization functions (idempotent)
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE _id = auth.uid() AND platform_role = 'super_admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_platform_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT platform_role FROM public.profiles WHERE _id = auth.uid()),
    'user'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_account_status()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT account_status FROM public.profiles WHERE _id = auth.uid()),
    'pending'
  );
$$;

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

CREATE OR REPLACE FUNCTION public.can_access_atlas()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.is_super_admin() OR public.is_approved_user();
$$;

-- 5. Update new user handler to set defaults (idempotent)
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

-- 6. Verify results
SELECT
  p._id,
  p.name,
  p.email,
  p.account_status,
  p.platform_role
FROM public.profiles p
ORDER BY p.platform_role DESC, p.name;
