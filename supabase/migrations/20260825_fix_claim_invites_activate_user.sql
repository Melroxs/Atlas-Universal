-- ==========================================================================
-- Fix tenants_claim_invites to activate user profile on invite claim
--
-- When an invited user signs up and claims their pending invite, their
-- profile is created by the handle_new_user trigger with account_status='pending'.
-- This migration updates tenants_claim_invites to ALSO set account_status='active'
-- so the user can pass the access gate immediately after claiming.
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.tenants_claim_invites()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_email text;
  v_pending record;
  v_claimed bigint := 0;
  v_dup uuid;
  v_profile record;
BEGIN
  IF v_user IS NULL THEN return jsonb_build_object('claimed', 0); END IF;
  SELECT lower(trim(coalesce(email, ''))) INTO v_email FROM public.profiles WHERE _id = v_user;
  IF v_email = '' THEN return jsonb_build_object('claimed', 0); END IF;

  for v_pending in
    SELECT * FROM public.invites i
    WHERE i.email = v_email AND i.status = 'pending'
  loop
    SELECT m._id INTO v_dup FROM public.memberships m
    WHERE m."tenantId" = v_pending."tenantId" AND m."userId" = v_user LIMIT 1;
    IF v_dup IS NOT NULL THEN continue; END IF;

    INSERT INTO public.memberships ("tenantId", "userId", role, status, "invitedBy", "joinedAt")
    VALUES (v_pending."tenantId", v_user, v_pending.role, 'active', v_pending."invitedBy", public.epoch_ms());

    UPDATE public.invites SET status = 'accepted' WHERE _id = v_pending._id;

    -- NEW: Activate the user's profile so they can pass the access gate.
    -- This is critical for invited users whose profiles were created by the
    -- handle_new_user trigger with account_status='pending'.
    UPDATE public.profiles
    SET account_status = 'active'
    WHERE _id = v_user AND account_status = 'pending';

    -- Audit log (write directly since this is cross-tenant)
    INSERT INTO public.auditLogs ("tenantId", "actorType", "actorId", "actionType", "targetType", "metadata")
    VALUES (v_pending."tenantId", 'user', v_user, 'member_joined', 'membership', jsonb_build_object('email', v_email));

    v_claimed := v_claimed + 1;
  END loop;

  return jsonb_build_object('claimed', v_claimed);
END;
$$;
