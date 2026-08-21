-- ===========================================================================
-- URGENT PRODUCTION FIX — broken on_auth_user_created trigger
-- ===========================================================================
--
-- SYMPTOM (verified live): creating ANY new Supabase Auth user fails with
--   HTTP 500 "Database error creating new user"
-- because the deployed public.handle_new_user() passes NEW.email_confirmed_at
-- (timestamptz) directly into profiles."emailVerificationTime", which is a
-- BIGINT epoch-milliseconds column. The type mismatch raises inside the
-- AFTER INSERT trigger and aborts every user creation.
--
-- IMPACT: no new user can ever be provisioned (admin invite, signup, magic
-- link, anonymous guest) until this is applied. The two existing accounts
-- (YC Demo, Melissa) are unaffected — the trigger only fires on INSERT.
--
-- ACTION: run this whole script in Supabase Dashboard → SQL Editor.
-- Idempotent: safe to run more than once.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    _id, name, email, "emailVerificationTime", "isAnonymous",
    role, account_status, platform_role
  )
  VALUES (
    NEW.id,
    coalesce(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name'),
    NEW.email,
    -- FIX: convert timestamptz -> bigint epoch ms (was passed raw before)
    case when NEW.email_confirmed_at is not null
      then (extract(epoch from NEW.email_confirmed_at) * 1000)::bigint
      else null end,
    NEW.is_anonymous,
    'user',
    -- Pilot gating: every new identity starts unapproved.
    'pending',
    'user'
  )
  on conflict (_id) do nothing;
  return new;
END;
$$;

-- The trigger itself already exists from migration 0001; re-assert it so the
-- repaired function is guaranteed to be the one wired to auth.users.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- --------------------------------------------------------------------------
-- Verification (run after applying — should return the fixed source):
--   select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and proname = 'handle_new_user';
-- The source must contain "extract(epoch from NEW.email_confirmed_at)".
-- --------------------------------------------------------------------------
