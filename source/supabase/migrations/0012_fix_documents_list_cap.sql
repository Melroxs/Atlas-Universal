-- ---------------------------------------------------------------------------
-- Migration 0012 — documents_list_documents cap fix.
--
-- Production defect: the RPC returned at most the 80 most-recent documents.
-- A real restoration company quickly exceeds 80 documents, so older invoices,
-- estimates and policy files silently disappeared from the Knowledge page
-- (and from the Phase 15 live E2E's individually-uploaded-documents check).
-- The claim-analysis client already reads documents via the authenticated
-- REST path with a 1000-row limit; align the RPC with that same cap.
-- ---------------------------------------------------------------------------

create or replace function public.documents_list_documents()
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant uuid := public.my_tenant_id();
begin
  if v_tenant is null then raise exception 'You must be signed in and belong to a workspace.'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(d) order by d."_creationTime" desc)
    from (
      select * from public.documents where "tenantId" = v_tenant
      order by "_creationTime" desc limit 1000
    ) d
  ), '[]'::jsonb);
end;
$$;
