-- ============================================================================
-- Atlas on Supabase — migration 0007: role grants.
--
-- RLS policies decide WHICH rows a role may touch, but Postgres still needs
-- base table privileges for the role to touch them at all. Without these
-- grants every RPC fails with `permission denied for table … (42501)`.
-- Grants follow the standard Supabase template: `all` on tables/routines/
-- sequences for both `anon` and `authenticated`; row-level security is the
-- actual gate (anon has no uid, so no rows pass its policies).
-- ============================================================================

grant usage on schema public to anon, authenticated;

grant all on all tables in schema public to anon, authenticated;
grant all on all routines in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;

-- Future tables/functions must inherit the same grants automatically.
alter default privileges in schema public
  grant all on tables to anon, authenticated;
alter default privileges in schema public
  grant all on routines to anon, authenticated;
alter default privileges in schema public
  grant all on sequences to anon, authenticated;
