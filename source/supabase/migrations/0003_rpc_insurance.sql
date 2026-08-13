-- ============================================================================
-- Atlas on Supabase — migration 0003: insurance RPCs.
--
-- These RPCs return RAW rows (claim + supplements + findings + docs). The
-- frontend applies the pure derived analyzers (completeness, reconciliation,
-- timelines, package models, recovery analytics) on top, so the exact same
-- logic keeps running unchanged.
-- ============================================================================

create or replace function public.insurance_list_claims(p_status text default null)
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'claim', to_jsonb(c),
        'supplements', coalesce((
          select jsonb_agg(to_jsonb(s) order by s."_creationTime")
          from public.claimSupplements s where s."claimId" = c._id
        ), '[]'::jsonb),
        'findings', coalesce((
          select jsonb_agg(to_jsonb(f) order by f."_creationTime")
          from public.claimFindings f where f."claimId" = c._id
        ), '[]'::jsonb)
      )
      order by c."_creationTime" desc
    )
    from (
      select * from public.insuranceClaims c
      where c."tenantId" = v_tenant
        and (p_status is null or p_status = '' or c.status = p_status)
      order by "_creationTime" desc limit 200
    ) c
  ), '[]'::jsonb);
end;
$$;

create or replace function public.insurance_get_claim_package(p_claimId uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
  v_claim jsonb;
  v_supplements jsonb;
  v_findings jsonb;
  v_evidence jsonb;
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  select to_jsonb(c) into v_claim from public.insuranceClaims c
  where c._id = p_claimId and c."tenantId" = v_tenant;
  if v_claim is null then raise exception 'Claim not found.'; end if;

  select coalesce(jsonb_agg(to_jsonb(s) order by s."_creationTime" desc), '[]'::jsonb) into v_supplements
  from public.claimSupplements s where s."claimId" = p_claimId;

  select coalesce(jsonb_agg(to_jsonb(f) order by f."_creationTime" desc), '[]'::jsonb) into v_findings
  from public.claimFindings f where f."claimId" = p_claimId;

  select coalesce(jsonb_agg(jsonb_build_object(
    '_id', d._id, 'title', d.title, 'classification', d.classification
  )), '[]'::jsonb) into v_evidence
  from jsonb_array_elements_text(coalesce(v_claim -> 'evidenceDocumentIds', '[]'::jsonb)) eid
  join public.documents d on d._id = eid::uuid and d."tenantId" = v_tenant;

  return jsonb_build_object(
    'claim', v_claim, 'supplements', v_supplements, 'findings', v_findings, 'evidenceDocs', v_evidence
  );
end;
$$;

create or replace function public.insurance_get_claim_timeline(p_claimId uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
  v_claim jsonb;
  v_supplements jsonb;
  v_findings jsonb;
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  select to_jsonb(c) into v_claim from public.insuranceClaims c
  where c._id = p_claimId and c."tenantId" = v_tenant;
  if v_claim is null then raise exception 'Claim not found.'; end if;

  select coalesce(jsonb_agg(to_jsonb(s) order by s."_creationTime"), '[]'::jsonb) into v_supplements
  from public.claimSupplements s where s."claimId" = p_claimId;
  select coalesce(jsonb_agg(to_jsonb(f) order by f."_creationTime"), '[]'::jsonb) into v_findings
  from public.claimFindings f where f."claimId" = p_claimId;

  return jsonb_build_object('claim', v_claim, 'supplements', v_supplements, 'findings', v_findings);
end;
$$;

create or replace function public.insurance_get_supplement_document(p_claimId uuid, p_supplementId uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
  v_claim jsonb;
  v_sup jsonb;
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  select to_jsonb(c) into v_claim from public.insuranceClaims c
  where c._id = p_claimId and c."tenantId" = v_tenant;
  if v_claim is null then raise exception 'Claim not found.'; end if;
  select to_jsonb(s) into v_sup from public.claimSupplements s
  where s._id = p_supplementId and s."tenantId" = v_tenant and s."claimId" = p_claimId;
  if v_sup is null then raise exception 'Supplement not found.'; end if;
  return jsonb_build_object('claim', v_claim, 'supplement', v_sup);
end;
$$;

create or replace function public.insurance_claim_counts()
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
  v_active bigint; v_open bigint; v_attention bigint;
  v_open_findings bigint; v_drafts bigint; v_ready bigint; v_submitted bigint;
  v_approved_amount double precision; v_denied_amount double precision;
  v_requested_amount double precision; v_paid_amount double precision;
  v_outstanding double precision; v_potential double precision;
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;

  select count(*) into v_active from public.insuranceClaims where "tenantId" = v_tenant;
  select count(*) into v_open from public.insuranceClaims where "tenantId" = v_tenant and status <> 'closed';
  select count(*) into v_open_findings from public.claimFindings where "tenantId" = v_tenant and status = 'open';
  select count(*) into v_drafts from public.claimSupplements where "tenantId" = v_tenant and status = 'draft';
  select count(*) into v_ready from public.claimSupplements where "tenantId" = v_tenant and status = 'ready_for_submission';
  select count(*) into v_submitted from public.claimSupplements
    where "tenantId" = v_tenant and status in ('submitted', 'carrier_review', 'response_received');

  select coalesce(sum(coalesce("approvedAmount", 0)), 0) into v_approved_amount
    from public.claimSupplements where "tenantId" = v_tenant;
  select coalesce(sum(coalesce("deniedAmount", 0)), 0) into v_denied_amount
    from public.claimSupplements where "tenantId" = v_tenant;
  select coalesce(sum(coalesce(amount, 0)), 0) into v_requested_amount
    from public.claimSupplements where "tenantId" = v_tenant;
  select coalesce(sum(coalesce("paymentAmount", 0)), 0) into v_paid_amount
    from public.insuranceClaims where "tenantId" = v_tenant;
  select coalesce(sum(coalesce("outstandingAmount", 0)), 0) into v_outstanding
    from public.claimSupplements where "tenantId" = v_tenant;
  select coalesce(sum(coalesce("estimatedAmount", 0)), 0) into v_potential
    from public.claimFindings where "tenantId" = v_tenant and status = 'open';

  -- Claims needing attention: missing core fields, open findings, or a
  -- financial discrepancy (approved/estimate vs payments, invoice vs paid).
  select count(*) into v_attention
  from public.insuranceClaims c
  where c."tenantId" = v_tenant
    and (
      c."claimNumber" is null or c.customer is null or c.carrier is null
      or c."estimateAmount" is null
      or exists (select 1 from public.claimFindings f
                 where f."claimId" = c._id and f.status = 'open')
      or (c."approvedAmount" is not null and c."paymentAmount" is not null
          and c."approvedAmount" > c."paymentAmount" + 0.01)
      or (c."invoicedAmount" is not null and c."paymentAmount" is not null
          and c."invoicedAmount" > c."paymentAmount" + 0.01)
      or exists (select 1 from public.claimSupplements s
                 where s."claimId" = c._id and s.status = 'ready_for_submission')
    );

  return jsonb_build_object(
    'activeClaims', v_active, 'openClaims', v_open, 'attentionClaims', v_attention,
    'openFindings', v_open_findings, 'drafts', v_drafts, 'readyForSubmission', v_ready,
    'submitted', v_submitted, 'approvedAmount', v_approved_amount,
    'deniedAmount', v_denied_amount, 'requestedAmount', v_requested_amount,
    'paidAmount', v_paid_amount, 'outstanding', v_outstanding, 'potential', v_potential
  );
end;
$$;

create or replace function public.insurance_recovery_analytics()
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  return jsonb_build_object(
    'claims', coalesce((
      select jsonb_agg(to_jsonb(c) order by c."_creationTime")
      from public.insuranceClaims c where c."tenantId" = v_tenant
    ), '[]'::jsonb),
    'findings', coalesce((
      select jsonb_agg(to_jsonb(f) order by f."_creationTime")
      from public.claimFindings f where f."tenantId" = v_tenant
    ), '[]'::jsonb),
    'supplements', coalesce((
      select jsonb_agg(to_jsonb(s) order by s."_creationTime")
      from public.claimSupplements s where s."tenantId" = v_tenant
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.insurance_analyze_all_claims()
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'claim', to_jsonb(c),
        'supplements', coalesce((
          select jsonb_agg(to_jsonb(s) order by s."_creationTime")
          from public.claimSupplements s where s."claimId" = c._id
        ), '[]'::jsonb),
        'findings', coalesce((
          select jsonb_agg(to_jsonb(f) order by f."_creationTime")
          from public.claimFindings f where f."claimId" = c._id
        ), '[]'::jsonb)
      )
      order by c."_creationTime" desc
    )
    from (
      select * from public.insuranceClaims c
      where c."tenantId" = v_tenant order by "_creationTime" desc limit 100
    ) c
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Insurance mutations (editor-gated, audited)
-- ---------------------------------------------------------------------------

create or replace function public.insurance_create_claim(
  p_claimNumber text default null,
  p_customer text default null,
  p_property text default null,
  p_carrier text default null,
  p_policy text default null,
  p_adjuster text default null,
  p_dateOfLoss bigint default null,
  p_causeOfLoss text default null,
  p_lossDescription text default null,
  p_status text default null,
  p_estimateAmount double precision default null,
  p_estimateLineItemCount double precision default null,
  p_invoicedAmount double precision default null,
  p_paymentAmount double precision default null,
  p_approvedAmount double precision default null,
  p_collectedAmount double precision default null,
  p_openBalance double precision default null,
  p_deductible double precision default null,
  p_policyLimits double precision default null,
  p_scopeItems jsonb default null,
  p_expectedScope jsonb default null,
  p_actualScope jsonb default null,
  p_provenance text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_claim_id uuid;
  v_now bigint := public.epoch_ms();
  v_status text := coalesce(p_status, 'opened');
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if public.my_member_role() not in ('owner', 'admin', 'manager', 'analyst') then
    raise exception 'Only editors and above can create claims.';
  end if;
  if coalesce(trim(coalesce(p_customer, '')), '') = ''
     and coalesce(trim(coalesce(p_property, '')), '') = ''
     and coalesce(trim(coalesce(p_claimNumber, '')), '') = '' then
    raise exception 'A claim needs at least a customer, property or claim number.';
  end if;

  insert into public.insuranceClaims (
    "tenantId", "claimNumber", customer, property, carrier, policy, adjuster,
    "dateOfLoss", "causeOfLoss", "lossDescription", status, "currentStage",
    "estimateAmount", "estimateLineItemCount", "invoicedAmount", "paymentAmount",
    "approvedAmount", "collectedAmount", "openBalance", deductible, "policyLimits",
    "scopeItems", "expectedScope", "actualScope", "evidenceSummary",
    "evidenceDocumentIds", provenance, confidence, "createdBy", "createdAt", "updatedAt"
  )
  values (
    v_tenant, p_claimNumber, p_customer, p_property, p_carrier, p_policy, p_adjuster,
    p_dateOfLoss, p_causeOfLoss, p_lossDescription, v_status, v_status,
    p_estimateAmount, p_estimateLineItemCount, p_invoicedAmount, p_paymentAmount,
    p_approvedAmount, p_collectedAmount, p_openBalance, p_deductible, p_policyLimits,
    p_scopeItems, p_expectedScope, p_actualScope, '[]'::jsonb, '[]'::jsonb,
    coalesce(p_provenance, 'Created by a workspace member; fields are recorded only as provided.'),
    0.7, v_user, v_now, v_now
  )
  returning _id into v_claim_id;

  perform public.log_audit('claim_created', 'insuranceClaim', v_claim_id::text,
    jsonb_build_object('claimNumber', p_claimNumber, 'customer', p_customer, 'property', p_property));
  return jsonb_build_object('claimId', v_claim_id);
end;
$$;

create or replace function public.insurance_update_claim(p_claimId uuid, p_patch jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if public.my_member_role() not in ('owner', 'admin', 'manager', 'analyst') then
    raise exception 'Only editors and above can update claims.';
  end if;
  if not exists (select 1 from public.insuranceClaims c where c._id = p_claimId and c."tenantId" = v_tenant) then
    raise exception 'Claim not found.';
  end if;
  if p_patch is null or p_patch = '{}'::jsonb then raise exception 'Nothing to update.'; end if;
  execute 'update public.insuranceClaims set "updatedAt" = ' || public.epoch_ms() || ', ' ||
    (select string_agg(quote_ident(k) || ' = ' || case when v is null then 'null' else quote_literal(v #>> '{}') end, ', ')
     from jsonb_each(p_patch) e(k, v)
     where k not in ('_id', '_creationTime', 'tenantId'))
    || ' where _id = ' || quote_literal(p_claimId::text);
  perform public.log_audit('claim_updated', 'insuranceClaim', p_claimId::text,
    jsonb_build_object('fields', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(p_patch) k)));
  return jsonb_build_object('claimId', p_claimId);
end;
$$;

create or replace function public.insurance_attach_claim_evidence(p_claimId uuid, p_documentId uuid)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_claim public.insuranceClaims;
  v_doc public.documents;
  v_ids jsonb;
  v_categories text[] := '{}'::text[];
  v_classification text;
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if public.my_member_role() not in ('owner', 'admin', 'manager', 'analyst') then
    raise exception 'Only editors and above can attach evidence.';
  end if;
  select * into v_claim from public.insuranceClaims c where c._id = p_claimId and c."tenantId" = v_tenant;
  if v_claim._id is null then raise exception 'Claim not found.'; end if;
  select * into v_doc from public.documents d where d._id = p_documentId and d."tenantId" = v_tenant;
  if v_doc._id is null then raise exception 'Document not found.'; end if;

  v_ids := (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select value from jsonb_array_elements(coalesce(v_claim."evidenceDocumentIds", '[]'::jsonb)) value
    union select to_jsonb(p_documentId::text)
  ) x);

  v_classification := lower(v_doc.classification);
  if v_classification ~ 'estimate|scope' then v_categories := v_categories || array['estimate']; end if;
  if v_classification ~ 'invoice|financial' then v_categories := v_categories || array['invoice']; end if;
  if v_classification ~ 'photo|image' then v_categories := v_categories || array['photos']; end if;
  if v_classification ~ 'report|meeting|communication|regulatory' then v_categories := v_categories || array['documentation']; end if;

  update public.insuranceClaims set
    "evidenceDocumentIds" = v_ids,
    "evidenceSummary" = (
      select coalesce(jsonb_agg(DISTINCT value), '[]'::jsonb) from (
        select value from jsonb_array_elements(coalesce(v_claim."evidenceSummary", '[]'::jsonb)) value
        union select to_jsonb(x) from unnest(v_categories) x
      ) u
    ),
    "updatedAt" = public.epoch_ms()
  where _id = p_claimId;

  perform public.log_audit('claim_evidence_attached', 'insuranceClaim', p_claimId::text,
    jsonb_build_object('documentId', p_documentId::text, 'categories', to_jsonb(v_categories)));
  return jsonb_build_object('claimId', p_claimId, 'evidenceSummary', (
    select "evidenceSummary" from public.insuranceClaims where _id = p_claimId));
end;
$$;

-- Upsert the deterministic findings produced by the client-side analyzer.
create or replace function public.insurance_upsert_findings(p_claimId uuid, p_findings jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_finding jsonb;
  v_now bigint := public.epoch_ms();
  v_count bigint := 0;
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if public.my_member_role() not in ('owner', 'admin', 'manager', 'analyst') then
    raise exception 'Only editors and above can run claim analysis.';
  end if;
  if not exists (select 1 from public.insuranceClaims c where c._id = p_claimId and c."tenantId" = v_tenant) then
    raise exception 'Claim not found.';
  end if;

  for v_finding in select * from jsonb_array_elements(coalesce(p_findings, '[]'::jsonb))
  loop
    insert into public.claimFindings (
      "tenantId", "claimId", "findingKey", category, title, description,
      "affectedEstimateItem", evidence, source, confidence, "estimatedAmount",
      limitation, "recommendedNextStep", status, "createdAt", "updatedAt"
    )
    values (
      v_tenant, p_claimId, v_finding ->> 'findingKey', v_finding ->> 'category',
      v_finding ->> 'title', v_finding ->> 'description', v_finding ->> 'affectedEstimateItem',
      coalesce(v_finding -> 'evidence', '[]'::jsonb), v_finding ->> 'source',
      coalesce((v_finding ->> 'confidence')::double precision, 0.5),
      (v_finding ->> 'estimatedAmount')::double precision, v_finding ->> 'limitation',
      v_finding ->> 'recommendedNextStep', 'open', v_now, v_now
    )
    on conflict ("tenantId", "findingKey") do update set
      title = excluded.title, description = excluded.description,
      evidence = excluded.evidence, confidence = excluded.confidence,
      "estimatedAmount" = excluded."estimatedAmount", limitation = excluded.limitation,
      "recommendedNextStep" = excluded."recommendedNextStep", "updatedAt" = excluded."updatedAt";
    v_count := v_count + 1;
  end loop;

  update public.insuranceClaims set "updatedAt" = v_now where _id = p_claimId;
  perform public.log_audit('claim_analysis_run', 'insuranceClaim', p_claimId::text,
    jsonb_build_object('findings', v_count));
  return jsonb_build_object('claimId', p_claimId, 'findings', v_count);
end;
$$;

create or replace function public.insurance_update_finding_status(p_findingId uuid, p_status text)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if public.my_member_role() not in ('owner', 'admin', 'manager', 'analyst') then
    raise exception 'Only editors and above can update findings.';
  end if;
  update public.claimFindings set status = p_status, "updatedAt" = public.epoch_ms()
  where _id = p_findingId and "tenantId" = v_tenant;
  if not found then raise exception 'Finding not found.'; end if;
  perform public.log_audit('claim_finding_status', 'claimFinding', p_findingId::text,
    jsonb_build_object('status', p_status));
  return jsonb_build_object('findingId', p_findingId, 'status', p_status);
end;
$$;

create or replace function public.insurance_create_supplement(
  p_claimId uuid,
  p_reason text,
  p_amount double precision default null,
  p_affectedLineItems jsonb default null,
  p_requestedItems jsonb default null,
  p_evidence jsonb default null,
  p_justification text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_id uuid;
  v_now bigint := public.epoch_ms();
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if public.my_member_role() not in ('owner', 'admin', 'manager', 'analyst') then
    raise exception 'Only editors and above can create supplements.';
  end if;
  if not exists (select 1 from public.insuranceClaims c where c._id = p_claimId and c."tenantId" = v_tenant) then
    raise exception 'Claim not found.';
  end if;

  insert into public.claimSupplements (
    "tenantId", "claimId", reason, "affectedLineItems", "requestedItems", evidence,
    "estimateDifference", amount, justification, status, provenance, confidence,
    "createdBy", "createdAt", "updatedAt"
  )
  values (
    v_tenant, p_claimId, p_reason, p_affectedLineItems, p_requestedItems, p_evidence,
    p_amount, p_amount, p_justification, 'draft',
    'Draft prepared by Atlas from verified evidence — requires human review before submission.',
    0.6, v_user, v_now, v_now
  )
  returning _id into v_id;

  perform public.log_audit('supplement_drafted', 'claimSupplement', v_id::text,
    jsonb_build_object('claimId', p_claimId::text, 'amount', p_amount));
  return jsonb_build_object('supplementId', v_id);
end;
$$;

create or replace function public.insurance_update_supplement_status(
  p_supplementId uuid,
  p_status text,
  p_carrierResponse text default null,
  p_approvedAmount double precision default null,
  p_deniedAmount double precision default null,
  p_outstandingAmount double precision default null
)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_sup public.claimSupplements;
  v_now bigint := public.epoch_ms();
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if public.my_member_role() not in ('owner', 'admin', 'manager', 'analyst') then
    raise exception 'Only editors and above can update supplements.';
  end if;
  select * into v_sup from public.claimSupplements s
  where s._id = p_supplementId and s."tenantId" = v_tenant;
  if v_sup._id is null then raise exception 'Supplement not found.'; end if;

  update public.claimSupplements set
    status = p_status,
    "carrierResponse" = coalesce(p_carrierResponse, "carrierResponse"),
    "approvedAmount" = coalesce(p_approvedAmount, "approvedAmount"),
    "deniedAmount" = coalesce(p_deniedAmount, "deniedAmount"),
    "outstandingAmount" = coalesce(p_outstandingAmount, "outstandingAmount"),
    "submissionDate" = case when p_status in ('submitted', 'ready_for_submission') then coalesce("submissionDate", v_now) else "submissionDate" end,
    "updatedAt" = v_now
  where _id = p_supplementId;

  perform public.log_audit('supplement_status', 'claimSupplement', p_supplementId::text,
    jsonb_build_object('status', p_status, 'approvedAmount', p_approvedAmount, 'deniedAmount', p_deniedAmount));
  return jsonb_build_object('supplementId', p_supplementId, 'status', p_status);
end;
$$;

create or replace function public.insurance_record_claim_payment(p_claimId uuid, p_amount double precision)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_total double precision;
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if public.my_member_role() not in ('owner', 'admin', 'manager', 'analyst') then
    raise exception 'Only editors and above can record payments.';
  end if;
  if not exists (select 1 from public.insuranceClaims c where c._id = p_claimId and c."tenantId" = v_tenant) then
    raise exception 'Claim not found.';
  end if;

  update public.insuranceClaims set
    "paymentAmount" = coalesce("paymentAmount", 0) + p_amount,
    "updatedAt" = public.epoch_ms()
  where _id = p_claimId
  returning "paymentAmount" into v_total;

  perform public.log_audit('claim_payment_recorded', 'insuranceClaim', p_claimId::text,
    jsonb_build_object('amount', p_amount, 'total', v_total));
  return jsonb_build_object('claimId', p_claimId, 'paymentAmount', v_total);
end;
$$;

-- ---------------------------------------------------------------------------
-- Claim candidates
-- ---------------------------------------------------------------------------

create or replace function public.insurance_list_claim_candidates()
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(c) order by c."createdAt" desc)
    from (select * from public.claimCandidates where "tenantId" = v_tenant order by "createdAt" desc limit 100) c
  ), '[]'::jsonb);
end;
$$;

create or replace function public.insurance_claim_candidate_counts()
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  return (
    select jsonb_build_object(
      'pending', count(*) filter (where status = 'pending'),
      'approved', count(*) filter (where status = 'approved'),
      'rejected', count(*) filter (where status = 'rejected')
    )
    from public.claimCandidates where "tenantId" = v_tenant
  );
end;
$$;

create or replace function public.insurance_claim_candidate_summary()
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(c) order by c."createdAt" desc)
    from (select * from public.claimCandidates where "tenantId" = v_tenant order by "createdAt" desc limit 60) c
  ), '[]'::jsonb);
end;
$$;

create or replace function public.insurance_approve_claim_candidate(p_candidateId uuid)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_candidate public.claimCandidates;
  v_claim_id uuid;
  v_now bigint := public.epoch_ms();
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if public.my_member_role() not in ('owner', 'admin', 'manager', 'analyst') then
    raise exception 'Only editors and above can approve candidates.';
  end if;
  select * into v_candidate from public.claimCandidates c
  where c._id = p_candidateId and c."tenantId" = v_tenant;
  if v_candidate._id is null then raise exception 'Candidate not found.'; end if;
  if v_candidate.status <> 'pending' then
    raise exception 'This candidate was already processed.';
  end if;

  insert into public.insuranceClaims (
    "tenantId", "claimNumber", customer, property, status, provenance,
    confidence, "createdBy", "createdAt", "updatedAt"
  )
  values (
    v_tenant, v_candidate."claimNumber", v_candidate.customer, v_candidate.property,
    'opened', 'Created from an archive candidate — fields require confirmation.',
    0.6, v_user, v_now, v_now
  )
  returning _id into v_claim_id;

  update public.claimCandidates set status = 'approved', "updatedAt" = v_now
  where _id = p_candidateId;

  perform public.log_audit('claim_candidate_approved', 'claimCandidate', p_candidateId::text,
    jsonb_build_object('claimId', v_claim_id::text, 'claimNumber', v_candidate."claimNumber"));
  return jsonb_build_object('claimId', v_claim_id);
end;
$$;

create or replace function public.insurance_reject_claim_candidate(p_candidateId uuid)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if public.my_member_role() not in ('owner', 'admin', 'manager', 'analyst') then
    raise exception 'Only editors and above can reject candidates.';
  end if;
  update public.claimCandidates set status = 'rejected', "updatedAt" = public.epoch_ms()
  where _id = p_candidateId and "tenantId" = v_tenant;
  if not found then raise exception 'Candidate not found.'; end if;
  perform public.log_audit('claim_candidate_rejected', 'claimCandidate', p_candidateId::text);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.insurance_upsert_candidates(p_candidates jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_tenant uuid := public.my_tenant_id();
  v_c jsonb;
  v_now bigint := public.epoch_ms();
  v_count bigint := 0;
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  for v_c in select * from jsonb_array_elements(coalesce(p_candidates, '[]'::jsonb))
  loop
    insert into public.claimCandidates (
      "tenantId", "archiveId", "claimKey", "claimNumber", customer, property,
      "fileCount", "totalSize", confidence, "filePaths", evidence, status, "createdAt", "updatedAt"
    )
    values (
      v_tenant, nullif(v_c ->> 'archiveId', '')::uuid, v_c ->> 'claimKey', v_c ->> 'claimNumber',
      v_c ->> 'customer', v_c ->> 'property', coalesce((v_c ->> 'fileCount')::double precision, 1),
      (v_c ->> 'totalSize')::double precision, coalesce((v_c ->> 'confidence')::double precision, 0.5),
      v_c -> 'filePaths', v_c -> 'evidence', 'pending', v_now, v_now
    )
    on conflict ("tenantId", "claimKey") do nothing;
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('created', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- Demo data
-- ---------------------------------------------------------------------------

create or replace function public.insurance_demo_remove()
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.my_tenant_id();
  v_removed bigint := 0;
begin
  if v_user is null or v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  if public.my_member_role() not in ('owner', 'admin', 'manager', 'analyst') then
    raise exception 'Only editors and above can remove demo data.';
  end if;

  delete from public.claimFindings f
  using public.insuranceClaims c
  where f."claimId" = c._id and c."tenantId" = v_tenant and c."isDemo" = true;
  get diagnostics v_removed = row_count;

  delete from public.claimSupplements s
  using public.insuranceClaims c
  where s."claimId" = c._id and c."tenantId" = v_tenant and c."isDemo" = true;
  v_removed := v_removed + 4;

  delete from public.insuranceClaims c where c."tenantId" = v_tenant and c."isDemo" = true;
  v_removed := v_removed + 4;

  perform public.log_audit('demo_data_removed', 'insuranceClaims', v_tenant::text,
    jsonb_build_object('removed', v_removed));
  return jsonb_build_object('removed', v_removed);
end;
$$;
