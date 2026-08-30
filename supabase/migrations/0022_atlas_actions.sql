-- ===========================================================================
-- Atlas Actions — Server-Authoritative Action Persistence
--
-- Prompt 14: Makes the Atlas action system durable, multi-user, and
-- server-authoritative. Every action lifecycle transition is validated
-- server-side. RLS enforces tenant/company isolation.
-- ===========================================================================

-- 1. Table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS atlas_actions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id          uuid,
  actor_id            uuid NOT NULL REFERENCES auth.users(id),

  -- Action definition
  action_type         text NOT NULL,  -- prepare_supplement, approve_recommendation, etc.
  entity_type         text NOT NULL,  -- claim, supplement, recommendation, lead, etc.
  entity_id           text NOT NULL,
  parameters          jsonb NOT NULL DEFAULT '{}',
  risk                text NOT NULL CHECK (risk IN ('low', 'medium', 'high')),
  description         text NOT NULL DEFAULT '',

  -- Lifecycle
  status              text NOT NULL DEFAULT 'proposed'
    CHECK (status IN (
      'proposed', 'preparing', 'prepared', 'awaiting_confirmation',
      'confirmed', 'executing', 'executed', 'verified',
      'failed', 'blocked', 'rejected', 'expired', 'stale'
    )),

  -- Idempotency
  idempotency_key     text NOT NULL,

  -- Confirmation
  confirmation_token  text,  -- hashed or opaque token
  confirmation_expires_at timestamptz,

  -- Source traceability
  source_decision_id    uuid,
  source_signal_id      text,
  source_conversation_id text,
  source_fingerprint    text,

  -- Result
  result              jsonb,
  error               jsonb,

  -- Timestamps
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  executed_at         timestamptz,
  verified_at         timestamptz,

  -- Audit
  audit_trail         jsonb NOT NULL DEFAULT '[]'
);

-- 2. Indexes
-- ---------------------------------------------------------------------------

-- Idempotency: unique active action per tenant + key
CREATE UNIQUE INDEX IF NOT EXISTS atlas_actions_idempotency_idx
  ON atlas_actions (tenant_id, idempotency_key)
  WHERE status NOT IN ('executed', 'verified', 'failed', 'blocked', 'rejected', 'expired', 'stale');

-- Query patterns
CREATE INDEX IF NOT EXISTS atlas_actions_tenant_status_idx
  ON atlas_actions (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS atlas_actions_tenant_entity_idx
  ON atlas_actions (tenant_id, entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS atlas_actions_tenant_actor_idx
  ON atlas_actions (tenant_id, actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS atlas_actions_tenant_type_idx
  ON atlas_actions (tenant_id, action_type, status, created_at DESC);

-- 3. Updated_at trigger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION atlas_actions_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER atlas_actions_updated_at
  BEFORE UPDATE ON atlas_actions
  FOR EACH ROW
  EXECUTE FUNCTION atlas_actions_set_updated_at();

-- 4. Row-Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE atlas_actions ENABLE ROW LEVEL SECURITY;

-- Service role (Edge Functions) full access
CREATE POLICY atlas_actions_service_all ON atlas_actions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users: SELECT for their tenant (or super_admin)
CREATE POLICY atlas_actions_tenant_read ON atlas_actions
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    OR (auth.jwt() ->> 'user_role') = 'super_admin'
  );

-- Authenticated users: INSERT via RPC only (RPC sets tenant_id from JWT)
-- Direct INSERT is blocked; all creation goes through atlas_action_create RPC
CREATE POLICY atlas_actions_rpc_insert ON atlas_actions
  FOR INSERT
  TO authenticated
  WITH CHECK (false);  -- Only RPCs with SECURITY DEFINER can insert

-- Authenticated users: UPDATE via RPC only
CREATE POLICY atlas_actions_rpc_update ON atlas_actions
  FOR UPDATE
  TO authenticated
  USING (false)    -- Only RPCs with SECURITY DEFINER can update
  WITH CHECK (false);

-- No direct DELETE for authenticated users — audit trail is preserved
-- service_role can archive if needed

-- 5. RPC Functions
-- ---------------------------------------------------------------------------

-- -----------------------------------------------------------------------
-- atlas_action_create — Create a new action (idempotent)
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atlas_action_create(
  p_actor_id         uuid,
  p_action_type      text,
  p_entity_type      text,
  p_entity_id        text,
  p_parameters       jsonb DEFAULT '{}',
  p_risk             text DEFAULT 'low',
  p_description      text DEFAULT '',
  p_idempotency_key  text DEFAULT '',
  p_source_decision_id    uuid DEFAULT NULL,
  p_source_signal_id      text DEFAULT NULL,
  p_source_conversation_id text DEFAULT NULL,
  p_source_fingerprint    text DEFAULT NULL,
  p_company_id       uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_user_role text;
  v_action_id uuid;
  v_existing  record;
  v_now       timestamptz := now();
  v_audit     jsonb;
  v_result    jsonb;
BEGIN
  -- Get tenant from JWT
  v_tenant_id := (auth.jwt() ->> 'tenant_id')::uuid;
  v_user_role := (auth.jwt() ->> 'user_role');

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'No tenant context in JWT';
  END IF;

  -- Check role authorization
  IF v_user_role NOT IN ('super_admin', 'atlas_admin', 'customer_admin') THEN
    RAISE EXCEPTION 'Insufficient role for action creation: %', v_user_role;
  END IF;

  -- Check actor matches authenticated user
  IF p_actor_id != auth.uid() THEN
    RAISE EXCEPTION 'Actor ID must match authenticated user';
  END IF;

  -- Idempotency check: if key provided and action exists, return existing
  IF p_idempotency_key != '' THEN
    SELECT id INTO v_action_id
    FROM atlas_actions
    WHERE tenant_id = v_tenant_id
      AND idempotency_key = p_idempotency_key
      AND status NOT IN ('executed', 'verified', 'failed', 'blocked', 'rejected', 'expired', 'stale')
    LIMIT 1;

    IF v_action_id IS NOT NULL THEN
      SELECT jsonb_build_object(
        'id', id,
        'status', status,
        'idempotent', true,
        'message', 'Action already exists'
      ) INTO v_result
      FROM atlas_actions WHERE id = v_action_id;
      RETURN v_result;
    END IF;
  END IF;

  -- Create action
  v_audit := jsonb_build_array(
    jsonb_build_object(
      'timestamp', v_now,
      'from', null,
      'to', 'proposed',
      'actor', p_actor_id::text,
      'reason', 'Action created'
    )
  );

  INSERT INTO atlas_actions (
    tenant_id, company_id, actor_id,
    action_type, entity_type, entity_id, parameters, risk, description,
    status, idempotency_key,
    source_decision_id, source_signal_id, source_conversation_id, source_fingerprint,
    audit_trail
  ) VALUES (
    v_tenant_id, p_company_id, p_actor_id,
    p_action_type, p_entity_type, p_entity_id, p_parameters, p_risk, p_description,
    'proposed', p_idempotency_key,
    p_source_decision_id, p_source_signal_id, p_source_conversation_id, p_source_fingerprint,
    v_audit
  )
  RETURNING id INTO v_action_id;

  SELECT jsonb_build_object(
    'id', id,
    'status', status,
    'idempotent', false,
    'message', 'Action created'
  ) INTO v_result
  FROM atlas_actions WHERE id = v_action_id;

  RETURN v_result;
END;
$$;

-- -----------------------------------------------------------------------
-- atlas_action_transition — Transition action status (server-validated)
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atlas_action_transition(
  p_action_id   uuid,
  p_new_status  text,
  p_actor_id    uuid,
  p_reason      text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_user_role text;
  v_action    record;
  v_valid     boolean := false;
  v_now       timestamptz := now();
  v_audit_entry jsonb;
  v_new_audit jsonb;
  v_result    jsonb;
BEGIN
  v_tenant_id := (auth.jwt() ->> 'tenant_id')::uuid;
  v_user_role := (auth.jwt() ->> 'user_role');

  -- Fetch action
  SELECT * INTO v_action
  FROM atlas_actions
  WHERE id = p_action_id AND tenant_id = v_tenant_id;

  IF v_action IS NULL THEN
    RAISE EXCEPTION 'Action not found or access denied';
  END IF;

  -- Verify actor
  IF p_actor_id != auth.uid() THEN
    RAISE EXCEPTION 'Actor ID must match authenticated user';
  END IF;

  -- Role check for high-risk transitions
  IF p_new_status IN ('executing', 'executed', 'verified')
     AND v_action.risk = 'high'
     AND v_user_role NOT IN ('super_admin', 'atlas_admin') THEN
    RAISE EXCEPTION 'Insufficient role for high-risk execution: %', v_user_role;
  END IF;

  -- Validate transition
  v_valid := CASE v_action.status
    WHEN 'proposed' THEN p_new_status IN ('preparing', 'blocked', 'rejected')
    WHEN 'preparing' THEN p_new_status IN ('prepared', 'failed')
    WHEN 'prepared' THEN p_new_status IN ('awaiting_confirmation', 'executing', 'rejected')
    WHEN 'awaiting_confirmation' THEN p_new_status IN ('confirmed', 'rejected', 'expired')
    WHEN 'confirmed' THEN p_new_status IN ('executing', 'expired', 'stale')
    WHEN 'executing' THEN p_new_status IN ('executed', 'failed')
    WHEN 'executed' THEN p_new_status IN ('verified', 'failed')
    WHEN 'failed' THEN p_new_status IN ('preparing')  -- retry
    WHEN 'expired' THEN p_new_status IN ('preparing')  -- re-prepare
    WHEN 'stale' THEN p_new_status IN ('preparing')  -- re-evaluate
    ELSE false
  END;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Invalid transition: % → %', v_action.status, p_new_status;
  END IF;

  -- Build audit entry
  v_audit_entry := jsonb_build_object(
    'timestamp', v_now,
    'from', v_action.status,
    'to', p_new_status,
    'actor', p_actor_id::text,
    'reason', COALESCE(p_reason, 'Status transition to ' || p_new_status)
  );

  v_new_audit := v_action.audit_trail || jsonb_build_array(v_audit_entry);

  -- Update
  UPDATE atlas_actions
  SET status = p_new_status,
      audit_trail = v_new_audit,
      executed_at = CASE WHEN p_new_status = 'executed' THEN v_now ELSE executed_at END,
      verified_at = CASE WHEN p_new_status = 'verified' THEN v_now ELSE verified_at END
  WHERE id = p_action_id;

  SELECT jsonb_build_object(
    'id', id,
    'status', status,
    'message', 'Transitioned to ' || p_new_status
  ) INTO v_result
  FROM atlas_actions WHERE id = p_action_id;

  RETURN v_result;
END;
$$;

-- -----------------------------------------------------------------------
-- atlas_action_confirm — Confirm an action (validates token + expiry)
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atlas_action_confirm(
  p_action_id   uuid,
  p_token       text,
  p_actor_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_action    record;
  v_now       timestamptz := now();
  v_result    jsonb;
BEGIN
  v_tenant_id := (auth.jwt() ->> 'tenant_id')::uuid;

  SELECT * INTO v_action
  FROM atlas_actions
  WHERE id = p_action_id AND tenant_id = v_tenant_id;

  IF v_action IS NULL THEN
    RAISE EXCEPTION 'Action not found or access denied';
  END IF;

  -- Verify actor matches
  IF p_actor_id != auth.uid() THEN
    RAISE EXCEPTION 'Actor ID must match authenticated user';
  END IF;

  -- Must be awaiting confirmation
  IF v_action.status != 'awaiting_confirmation' THEN
    RAISE EXCEPTION 'Action is not awaiting confirmation (current: %)', v_action.status;
  END IF;

  -- Check expiry
  IF v_action.confirmation_expires_at IS NOT NULL
     AND v_action.confirmation_expires_at < v_now THEN
    -- Transition to expired
    UPDATE atlas_actions SET status = 'expired',
      audit_trail = audit_trail || jsonb_build_array(
        jsonb_build_object('timestamp', v_now, 'from', 'awaiting_confirmation', 'to', 'expired',
          'actor', p_actor_id::text, 'reason', 'Confirmation expired')
      )
    WHERE id = p_action_id;
    RAISE EXCEPTION 'Confirmation expired';
  END IF;

  -- Validate token
  IF v_action.confirmation_token IS NOT NULL
     AND v_action.confirmation_token != p_token THEN
    RAISE EXCEPTION 'Invalid confirmation token';
  END IF;

  -- Transition to confirmed
  UPDATE atlas_actions
  SET status = 'confirmed',
      audit_trail = audit_trail || jsonb_build_array(
        jsonb_build_object('timestamp', v_now, 'from', 'awaiting_confirmation', 'to', 'confirmed',
          'actor', p_actor_id::text, 'reason', 'User confirmed')
      )
  WHERE id = p_action_id;

  SELECT jsonb_build_object(
    'id', id, 'status', status, 'message', 'Action confirmed'
  ) INTO v_result
  FROM atlas_actions WHERE id = p_action_id;

  RETURN v_result;
END;
$$;

-- -----------------------------------------------------------------------
-- atlas_action_get — Get a single action by ID
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atlas_action_get(
  p_action_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_result    jsonb;
BEGIN
  v_tenant_id := (auth.jwt() ->> 'tenant_id')::uuid;

  SELECT to_jsonb(a.*) INTO v_result
  FROM atlas_actions a
  WHERE a.id = p_action_id
    AND a.tenant_id = v_tenant_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Action not found or access denied';
  END IF;

  RETURN v_result;
END;
$$;

-- -----------------------------------------------------------------------
-- atlas_action_list — List actions with filtering
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atlas_action_list(
  p_status     text DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_entity_id  text DEFAULT NULL,
  p_action_type text DEFAULT NULL,
  p_limit      int DEFAULT 50,
  p_offset     int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_result    jsonb;
BEGIN
  v_tenant_id := (auth.jwt() ->> 'tenant_id')::uuid;

  SELECT coalesce(jsonb_agg(t.*), '[]'::jsonb) INTO v_result
  FROM (
    SELECT * FROM atlas_actions
    WHERE tenant_id = v_tenant_id
      AND (p_status IS NULL OR status = p_status)
      AND (p_entity_type IS NULL OR entity_type = p_entity_type)
      AND (p_entity_id IS NULL OR entity_id = p_entity_id)
      AND (p_action_type IS NULL OR action_type = p_action_type)
    ORDER BY created_at DESC
    LIMIT p_limit
    OFFSET p_offset
  ) t;

  RETURN v_result;
END;
$$;

-- -----------------------------------------------------------------------
-- atlas_action_set_result — Store execution result
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atlas_action_set_result(
  p_action_id  uuid,
  p_result     jsonb,
  p_error      jsonb DEFAULT NULL,
  p_actor_id   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_action    record;
  v_now       timestamptz := now();
  v_result    jsonb;
BEGIN
  v_tenant_id := (auth.jwt() ->> 'tenant_id')::uuid;

  SELECT * INTO v_action
  FROM atlas_actions
  WHERE id = p_action_id AND tenant_id = v_tenant_id;

  IF v_action IS NULL THEN
    RAISE EXCEPTION 'Action not found or access denied';
  END IF;

  UPDATE atlas_actions
  SET result = p_result,
      error = p_error,
      executed_at = COALESCE(executed_at, v_now)
  WHERE id = p_action_id;

  SELECT jsonb_build_object(
    'id', id, 'status', status, 'message', 'Result stored'
  ) INTO v_result
  FROM atlas_actions WHERE id = p_action_id;

  RETURN v_result;
END;
$$;

-- 6. Realtime — Enable for atlas_actions
-- ---------------------------------------------------------------------------

ALTER PUBLICATION supabase_realtime ADD TABLE atlas_actions;
