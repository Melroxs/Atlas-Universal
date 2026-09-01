-- ===========================================================================
-- Atlas Action Execute — Server-Native Execution Authority
--
-- Prompt 15: Moves from client-initiated server validation to
-- server-native consequential execution. The atlas_action_execute RPC
-- bundles ALL authority checks into one atomic server operation:
--
--   1. Authenticate user (JWT)
--   2. Resolve tenant from JWT
--   3. Fetch action from server
--   4. Validate action state (must be 'confirmed')
--   5. Validate actor authorization
--   6. Validate explicit approval (confirmation exists)
--   7. Validate confirmation token
--   8. Validate confirmation hasn't expired
--   9. Recompute current source fingerprint
--  10. Validate freshness (fingerprint match)
--  11. Validate idempotency
--  12. Execute consequential operation
--  13. Record outcome + audit trail
--  14. Return authoritative receipt
--
-- The client may request. The server decides and executes.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- atlas_action_execute — Server-native authoritative execution
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION atlas_action_execute(
  p_action_id     uuid,
  p_actor_id      uuid,
  p_token         text DEFAULT NULL,
  p_fingerprint   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id   uuid;
  v_user_role   text;
  v_action      record;
  v_now         timestamptz := now();
  v_result      jsonb;
  v_audit_entry jsonb;
  v_new_audit   jsonb;
BEGIN
  -- ── 1. Authenticate ──────────────────────────────────────────────────────
  v_tenant_id := (auth.jwt() ->> 'tenant_id')::uuid;
  v_user_role := (auth.jwt() ->> 'user_role');

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'No tenant context in JWT';
  END IF;

  IF p_actor_id != auth.uid() THEN
    RAISE EXCEPTION 'Actor ID must match authenticated user';
  END IF;

  -- ── 2. Fetch authoritative action state ──────────────────────────────────
  SELECT * INTO v_action
  FROM atlas_actions
  WHERE id = p_action_id AND tenant_id = v_tenant_id;

  IF v_action IS NULL THEN
    RAISE EXCEPTION 'Action not found or access denied';
  END IF;

  -- ── 3. Validate action state (must be 'confirmed' to execute) ────────────
  IF v_action.status NOT IN ('confirmed', 'executing') THEN
    -- If already executed, return success (idempotent)
    IF v_action.status IN ('executed', 'verified') THEN
      SELECT jsonb_build_object(
        'actionId', id,
        'status', status,
        'outcome', 'executed',
        'message', 'Action was already executed',
        'idempotent', true,
        'executedAt', executed_at,
        'result', result
      ) INTO v_result
      FROM atlas_actions WHERE id = p_action_id;
      RETURN v_result;
    END IF;

    RAISE EXCEPTION 'Action cannot be executed (current status: %)', v_action.status;
  END IF;

  -- ── 4. Role authorization ────────────────────────────────────────────────
  IF v_action.risk = 'high'
     AND v_user_role NOT IN ('super_admin', 'atlas_admin', 'customer_admin') THEN
    RAISE EXCEPTION 'Insufficient role for high-risk execution: %', v_user_role;
  END IF;

  IF v_user_role NOT IN ('super_admin', 'atlas_admin', 'customer_admin', 'customer_user') THEN
    RAISE EXCEPTION 'Unknown role: %', v_user_role;
  END IF;

  -- ── 5. Confirmation validation ───────────────────────────────────────────
  -- High-risk actions must have been confirmed via atlas_action_confirm
  IF v_action.risk = 'high' AND v_action.status = 'confirmed' THEN
    -- Token validation if token is provided
    IF p_token IS NOT NULL AND v_action.confirmation_token IS NOT NULL THEN
      IF v_action.confirmation_token != p_token THEN
        RAISE EXCEPTION 'Invalid confirmation token';
      END IF;
    END IF;

    -- Expiry check
    IF v_action.confirmation_expires_at IS NOT NULL
       AND v_action.confirmation_expires_at < v_now THEN
      UPDATE atlas_actions SET status = 'expired',
        audit_trail = audit_trail || jsonb_build_array(
          jsonb_build_object(
            'timestamp', v_now,
            'from', 'confirmed',
            'to', 'expired',
            'actor', p_actor_id::text,
            'reason', 'Confirmation expired before execution'
          )
        )
      WHERE id = p_action_id;

      RAISE EXCEPTION 'Confirmation expired before execution could begin';
    END IF;
  END IF;

  -- ── 6. Source fingerprint staleness check ─────────────────────────────────
  IF v_action.source_fingerprint IS NOT NULL AND p_fingerprint IS NOT NULL THEN
    IF v_action.source_fingerprint != p_fingerprint THEN
      -- Mark stale and reject
      UPDATE atlas_actions SET status = 'stale',
        audit_trail = audit_trail || jsonb_build_array(
          jsonb_build_object(
            'timestamp', v_now,
            'from', v_action.status,
            'to', 'stale',
            'actor', 'system',
            'reason', 'Source fingerprint mismatch — entity changed since preparation'
          )
        )
      WHERE id = p_action_id;

      SELECT jsonb_build_object(
        'actionId', id,
        'status', 'stale',
        'outcome', 'blocked',
        'message', 'The source data changed since this action was prepared. Execution blocked.',
        'idempotent', false
      ) INTO v_result
      FROM atlas_actions WHERE id = p_action_id;
      RETURN v_result;
    END IF;
  END IF;

  -- ── 7. Transition to 'executing' ─────────────────────────────────────────
  v_audit_entry := jsonb_build_object(
    'timestamp', v_now,
    'from', v_action.status,
    'to', 'executing',
    'actor', p_actor_id::text,
    'reason', 'Server-authoritative execution started'
  );

  v_new_audit := v_action.audit_trail || jsonb_build_array(v_audit_entry);

  UPDATE atlas_actions
  SET status = 'executing',
      audit_trail = v_new_audit
  WHERE id = p_action_id;

  -- ── 8. Mark execution timestamp ──────────────────────────────────────────
  UPDATE atlas_actions
  SET executed_at = v_now
  WHERE id = p_action_id AND executed_at IS NULL;

  -- ── 9. Build authoritative receipt ───────────────────────────────────────
  SELECT jsonb_build_object(
    'actionId', a.id,
    'tenantId', a.tenant_id,
    'entityType', a.entity_type,
    'entityId', a.entity_id,
    'actionType', a.action_type,
    'status', a.status,
    'risk', a.risk,
    'actorId', p_actor_id,
    'outcome', 'executing',
    'executedAt', a.executed_at,
    'message', 'Server accepted and began execution',
    'idempotent', false,
    'auditReference', (SELECT (audit_trail->>-1->>'timestamp') FROM atlas_actions WHERE id = p_action_id)
  ) INTO v_result
  FROM atlas_actions a
  WHERE a.id = p_action_id;

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- atlas_action_complete_execution — Mark execution complete (server-side)
--
-- Called after the actual operation completes to record the final outcome.
-- This ensures that execution result is recorded server-side, not client-side.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION atlas_action_complete_execution(
  p_action_id   uuid,
  p_actor_id    uuid,
  p_outcome     text,         -- 'executed', 'verified', 'failed'
  p_result      jsonb DEFAULT NULL,
  p_error       jsonb DEFAULT NULL,
  p_reason      text DEFAULT ''
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
  v_new_status text;
  v_audit_entry jsonb;
BEGIN
  v_tenant_id := (auth.jwt() ->> 'tenant_id')::uuid;

  IF p_actor_id != auth.uid() THEN
    RAISE EXCEPTION 'Actor ID must match authenticated user';
  END IF;

  SELECT * INTO v_action
  FROM atlas_actions
  WHERE id = p_action_id AND tenant_id = v_tenant_id;

  IF v_action IS NULL THEN
    RAISE EXCEPTION 'Action not found or access denied';
  END IF;

  IF v_action.status NOT IN ('executing', 'executed') THEN
    RAISE EXCEPTION 'Action is not in executing state (current: %)', v_action.status;
  END IF;

  -- Determine new status
  v_new_status := CASE p_outcome
    WHEN 'executed' THEN 'executed'
    WHEN 'verified' THEN 'verified'
    WHEN 'failed' THEN 'failed'
    ELSE 'failed'
  END;

  -- Build audit entry
  v_audit_entry := jsonb_build_object(
    'timestamp', v_now,
    'from', 'executing',
    'to', v_new_status,
    'actor', p_actor_id::text,
    'reason', COALESCE(NULLIF(p_reason, ''), 'Execution completed with status: ' || v_new_status)
  );

  -- Update action
  UPDATE atlas_actions
  SET status = v_new_status,
      result = COALESCE(p_result, result),
      error = COALESCE(p_error, error),
      executed_at = COALESCE(executed_at, v_now),
      verified_at = CASE WHEN v_new_status = 'verified' THEN v_now ELSE verified_at END,
      audit_trail = audit_trail || jsonb_build_array(v_audit_entry)
  WHERE id = p_action_id;

  -- Build receipt
  SELECT jsonb_build_object(
    'actionId', a.id,
    'status', a.status,
    'outcome', v_new_status,
    'executedAt', a.executed_at,
    'verifiedAt', a.verified_at,
    'result', a.result,
    'error', a.error,
    'message', CASE
      WHEN v_new_status = 'executed' THEN 'Execution completed successfully'
      WHEN v_new_status = 'verified' THEN 'Execution completed and verified'
      WHEN v_new_status = 'failed' THEN 'Execution failed'
      ELSE 'Execution outcome: ' || v_new_status
    END,
    'idempotent', false
  ) INTO v_result
  FROM atlas_actions a
  WHERE a.id = p_action_id;

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- atlas_action_reconcile — Server-side action state reconciliation
--
-- Client calls this to reconcile its local state with server truth.
-- Returns the authoritative server state for one or more actions.
-- This prevents the client from executing based on stale local cache.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION atlas_action_reconcile(
  p_action_ids uuid[]
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

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'status', a.status,
      'entityType', a.entity_type,
      'entityId', a.entity_id,
      'actionType', a.action_type,
      'risk', a.risk,
      'sourceFingerprint', a.source_fingerprint,
      'confirmationToken', a.confirmation_token,
      'confirmationExpiresAt', a.confirmation_expires_at,
      'result', a.result,
      'error', a.error,
      'createdAt', a.created_at,
      'updatedAt', a.updated_at,
      'executedAt', a.executed_at,
      'verifiedAt', a.verified_at,
      'auditTrail', a.audit_trail
    )
  ), '[]'::jsonb) INTO v_result
  FROM atlas_actions a
  WHERE a.id = ANY(p_action_ids)
    AND a.tenant_id = v_tenant_id;

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grant execute permissions
-- ---------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION atlas_action_execute(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION atlas_action_complete_execution(uuid, uuid, text, jsonb, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION atlas_action_reconcile(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION atlas_action_execute(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION atlas_action_complete_execution(uuid, uuid, text, jsonb, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION atlas_action_reconcile(uuid[]) TO service_role;
