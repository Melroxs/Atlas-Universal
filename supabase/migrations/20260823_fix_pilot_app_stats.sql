-- Fix crm_dashboard_stats to count both 'new' and 'pending' pilot applications
-- The original only counted status='new' but submitted applications default to 'pending'.
CREATE OR REPLACE FUNCTION public.crm_dashboard_stats()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_total_leads integer;
  v_new_leads integer;
  v_new_apps integer;
  v_followups_due integer;
  v_followups_overdue integer;
  v_replies_waiting integer;
  v_active_pilots integer;
  v_stage_counts jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT count(*) INTO v_total_leads FROM public.crm_leads WHERE tenant_id = public.my_tenant_id();
  SELECT count(*) INTO v_new_leads FROM public.crm_leads WHERE tenant_id = public.my_tenant_id() AND pipeline_stage = 'new';
  -- Count both 'new' and 'pending' since submitted applications default to 'pending'
  SELECT count(*) INTO v_new_apps FROM public.pilot_applications WHERE status IN ('new', 'pending');

  SELECT count(*) INTO v_followups_due
  FROM public.crm_tasks WHERE tenant_id = public.my_tenant_id() AND status = 'pending' AND due_date::date <= now()::date;

  SELECT count(*) INTO v_followups_overdue
  FROM public.crm_tasks WHERE tenant_id = public.my_tenant_id() AND status = 'pending' AND due_date < now();

  SELECT count(*) INTO v_replies_waiting
  FROM public.email_outreach WHERE tenant_id = public.my_tenant_id() AND status = 'sent' AND replied_at IS NULL;

  SELECT count(*) INTO v_active_pilots
  FROM public.crm_leads WHERE tenant_id = public.my_tenant_id() AND pipeline_stage = 'pilot_active';

  SELECT jsonb_agg(jsonb_build_object('stage', s.stage, 'count', s.cnt)) INTO v_stage_counts
  FROM (
    SELECT pipeline_stage as stage, count(*) as cnt
    FROM public.crm_leads WHERE tenant_id = public.my_tenant_id()
    GROUP BY pipeline_stage
  ) s;

  RETURN jsonb_build_object(
    'totalLeads', v_total_leads,
    'newLeads', v_new_leads,
    'newApplications', v_new_apps,
    'followupsDue', v_followups_due,
    'followupsOverdue', v_followups_overdue,
    'repliesWaiting', v_replies_waiting,
    'activePilots', v_active_pilots,
    'pipelineCounts', coalesce(v_stage_counts, '[]'::jsonb)
  );
END;
$$;

-- Fix pilot_application_stats to count all statuses including 'new' and 'pending'
CREATE OR REPLACE FUNCTION public.pilot_application_stats()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN (
    SELECT jsonb_build_object(
      'total', count(*),
      'new', count(*) FILTER (WHERE status = 'new'),
      'pending', count(*) FILTER (WHERE status = 'pending'),
      'reviewing', count(*) FILTER (WHERE status = 'reviewing'),
      'approved', count(*) FILTER (WHERE status = 'approved'),
      'rejected', count(*) FILTER (WHERE status = 'rejected'),
      'waitlist', count(*) FILTER (WHERE status = 'waitlist')
    )
    FROM public.pilot_applications
  );
END;
$$;
