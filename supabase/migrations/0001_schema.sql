-- ============================================================================
-- Atlas on Supabase — migration 0001: schema, helpers, RLS.
--
-- Naming strategy: columns are quoted camelCase so `to_jsonb(row)` produces
-- exactly the shapes the frontend already consumes (Convex-era contract:
-- `_id` uuid + `_creationTime` epoch-ms + camelCase fields). All timestamps
-- are bigint epoch-milliseconds.
--
-- Every tenant-scoped table has a "tenantId" column and RLS policies so a
-- tenant can never see or write another tenant's rows. Global knowledge
-- tables (packs, authoritative sources) are readable by any signed-in user.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Monotonic epoch-ms clock for _creationTime defaults.
create or replace function public.epoch_ms()
returns bigint
language sql
stable
as $$
  select (extract(epoch from clock_timestamp()) * 1000)::bigint;
$$;

-- The tenant of the signed-in user (or null). Security definer so it can be
-- used inside RLS policies without recursion; it only reads memberships for
-- the caller's auth.uid() and takes no arguments.
create or replace function public.my_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m."tenantId"
  from public.memberships m
  where m."userId" = auth.uid()
    and m.status = 'active'
  order by m."joinedAt" nulls last, m."_creationTime"
  limit 1;
$$;

-- True when the signed-in user is a member of a tenant.
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and public.my_tenant_id() is not null;
$$;

-- Role of the signed-in user inside their tenant (or null).
create or replace function public.my_member_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role
  from public.memberships m
  where m."userId" = auth.uid()
    and m.status = 'active'
  order by m."joinedAt" nulls last, m."_creationTime"
  limit 1;
$$;

-- Manager+ check ("owner", "admin", "manager").
create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.my_member_role() in ('owner', 'admin', 'manager');
$$;

-- Editor+ check ("owner", "admin", "manager", "analyst").
create or replace function public.is_editor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.my_member_role() in ('owner', 'admin', 'manager', 'analyst');
$$;

-- Append an audit log row for the current tenant (used by RPCs).
create or replace function public.log_audit(
  p_action_type text,
  p_target_type text default null,
  p_target_id text default null,
  p_metadata jsonb default null,
  p_actor_type text default 'user',
  p_actor_id uuid default auth.uid()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_tenant uuid := public.my_tenant_id();
begin
  if v_tenant is null then return; end if;
  insert into public.auditLogs ("tenantId", "actorType", "actorId", "actionType", "targetType", "targetId", "metadata")
  values (v_tenant, p_actor_type, p_actor_id, p_action_type, p_target_type, p_target_id, p_metadata);
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles (replaces Convex `users`; id = auth.users.id)
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  _id uuid primary key references auth.users (id) on delete cascade,
  "_creationTime" bigint not null default public.epoch_ms(),
  name text,
  image text,
  email text,
  "emailVerificationTime" bigint,
  "isAnonymous" boolean default false,
  role text
);

create index if not exists profiles_email_idx on public.profiles (email);

-- Auto-create a profile row whenever a user signs up (email or anonymous).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (_id, name, email, "emailVerificationTime", "isAnonymous", role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.email,
    case when new.email_confirmed_at is not null
      then (extract(epoch from new.email_confirmed_at) * 1000)::bigint
      else null end,
    new.is_anonymous,
    'user'
  )
  on conflict (_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Identity & tenancy
-- ---------------------------------------------------------------------------

create table if not exists public.tenants (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  name text not null,
  slug text not null unique,
  status text not null default 'active',
  settings jsonb
);

create table if not exists public.memberships (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  "userId" uuid not null references public.profiles (_id) on delete cascade,
  role text not null default 'viewer',
  status text not null default 'active',
  "invitedBy" uuid references public.profiles (_id),
  "joinedAt" bigint
);
create index if not exists memberships_by_user_idx on public.memberships ("userId");
create index if not exists memberships_by_tenant_idx on public.memberships ("tenantId");
create index if not exists memberships_by_tenant_user_idx on public.memberships ("tenantId", "userId");

create table if not exists public.invites (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  email text not null,
  role text not null default 'viewer',
  "invitedBy" uuid not null references public.profiles (_id),
  status text not null default 'pending'
);
create index if not exists invites_by_tenant_idx on public.invites ("tenantId");
create index if not exists invites_by_email_idx on public.invites (email);

-- ---------------------------------------------------------------------------
-- Company profile & onboarding
-- ---------------------------------------------------------------------------

create table if not exists public.companyProfiles (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  "companyName" text not null,
  country text,
  "stateProvince" text,
  city text,
  "operatingGeography" text,
  industry text,
  "subIndustry" text,
  "companySize" text,
  "employeeCount" double precision,
  "businessModel" text,
  "servicesProducts" jsonb,
  website text,
  "onboardingStep" double precision,
  "onboardingComplete" boolean,
  "updatedAt" bigint
);
create index if not exists companyprofiles_by_tenant_idx on public.companyProfiles ("tenantId");

create table if not exists public.companySystems (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  name text not null,
  category text,
  vendor text,
  notes text,
  status text not null default 'planned'
);
create index if not exists companysystems_by_tenant_idx on public.companySystems ("tenantId");

-- ---------------------------------------------------------------------------
-- Intelligence packs (global catalog)
-- ---------------------------------------------------------------------------

create table if not exists public.intelligencePacks (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  key text not null unique,
  name text not null,
  "packType" text not null,
  publisher text,
  description text not null,
  version text not null,
  status text not null default 'active'
);

create table if not exists public.intelligenceItems (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "packKey" text not null references public.intelligencePacks (key) on delete cascade,
  "itemType" text not null,
  key text not null,
  title text not null,
  summary text,
  content jsonb,
  jurisdiction text,
  industry text,
  status text,
  confidence double precision
);
create index if not exists intelligenceitems_by_pack_idx on public.intelligenceItems ("packKey");

create table if not exists public.tenantPacks (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  "packKey" text not null,
  "activatedAt" bigint not null,
  "activatedBy" uuid references public.profiles (_id),
  status text not null default 'active',
  unique ("tenantId", "packKey")
);
create index if not exists tenantpacks_by_tenant_idx on public.tenantPacks ("tenantId");

-- ---------------------------------------------------------------------------
-- Documents & ingestion
-- ---------------------------------------------------------------------------

create table if not exists public.documents (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  title text not null,
  "sourceType" text not null default 'upload',
  "mimeType" text,
  size double precision,
  classification text not null default 'Unknown',
  status text not null default 'uploaded',
  "storageId" text,
  "uploadedBy" uuid references public.profiles (_id),
  error text,
  summary text,
  "chunkCount" double precision,
  "entityCount" double precision,
  "processedAt" bigint,
  "sourceId" text,
  "sourceModifiedAt" bigint,
  "externalDeletedAt" bigint,
  "externalParents" jsonb,
  "externalPermissionIds" jsonb
);
create index if not exists documents_by_tenant_idx on public.documents ("tenantId");
create index if not exists documents_by_tenant_status_idx on public.documents ("tenantId", status);
create index if not exists documents_by_tenant_source_idx on public.documents ("tenantId", "sourceId");

create table if not exists public.documentChunks (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  "documentId" uuid not null references public.documents (_id) on delete cascade,
  "chunkIndex" double precision not null,
  content text not null,
  embedding jsonb,
  "tokenCount" double precision
);
create index if not exists documentchunks_by_tenant_idx on public.documentChunks ("tenantId");
create index if not exists documentchunks_by_document_idx on public.documentChunks ("documentId");

create table if not exists public.ingestionJobs (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  "documentId" uuid references public.documents (_id) on delete set null,
  "jobType" text not null,
  status text not null default 'queued',
  payload jsonb,
  error text,
  "retryCount" double precision,
  "startedAt" bigint,
  "completedAt" bigint
);
create index if not exists ingestionjobs_by_tenant_idx on public.ingestionJobs ("tenantId");

-- ---------------------------------------------------------------------------
-- Knowledge graph
-- ---------------------------------------------------------------------------

create table if not exists public.entities (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  "entityTypeKey" text not null,
  name text not null,
  summary text,
  status text,
  confidence double precision not null default 0.5,
  attributes jsonb,
  "sourceDocumentId" uuid references public.documents (_id) on delete set null,
  "firstObservedAt" bigint,
  "lastObservedAt" bigint,
  identifiers jsonb,
  aliases jsonb,
  "mergeHistory" jsonb
);
create index if not exists entities_by_tenant_idx on public.entities ("tenantId");
create index if not exists entities_by_tenant_type_idx on public.entities ("tenantId", "entityTypeKey");

create table if not exists public.entityRelationships (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  "subjectEntityId" uuid not null references public.entities (_id) on delete cascade,
  "relationshipTypeKey" text not null,
  "objectEntityId" uuid not null references public.entities (_id) on delete cascade,
  confidence double precision not null default 0.5,
  "sourceDocumentId" uuid references public.documents (_id) on delete set null,
  evidence text
);
create index if not exists entityrelationships_by_tenant_idx on public.entityRelationships ("tenantId");
create index if not exists entityrelationships_by_subject_idx on public.entityRelationships ("subjectEntityId");

create table if not exists public.knowledgeAssertions (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  classification text not null default 'OBSERVATION',
  statement text not null,
  confidence double precision not null default 0.5,
  "sourceDocumentId" uuid references public.documents (_id) on delete set null,
  "entityId" uuid references public.entities (_id) on delete set null,
  evidence text,
  status text not null default 'proposed'
);
create index if not exists knowledgeassertions_by_tenant_idx on public.knowledgeAssertions ("tenantId");

-- ---------------------------------------------------------------------------
-- Ask Atlas
-- ---------------------------------------------------------------------------

create table if not exists public.askSessions (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  "userId" uuid not null references public.profiles (_id) on delete cascade,
  question text not null,
  answer text not null,
  classification text not null default 'FACT',
  confidence double precision not null default 0.5,
  mode text not null default 'local',
  "suggestedActions" jsonb,
  "toolPlan" jsonb,
  limitations text,
  "questionType" text,
  investigation jsonb
);
create index if not exists asksessions_by_tenant_idx on public.askSessions ("tenantId");
create index if not exists asksessions_by_tenant_user_idx on public.askSessions ("tenantId", "userId");

create table if not exists public.askEvidence (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "sessionId" uuid not null references public.askSessions (_id) on delete cascade,
  kind text not null,
  "documentId" uuid references public.documents (_id) on delete set null,
  "chunkId" uuid references public.documentChunks (_id) on delete set null,
  "entityId" uuid references public.entities (_id) on delete set null,
  "documentTitle" text,
  title text,
  snippet text,
  relevance double precision not null default 0.5,
  "evidenceType" text
);
create index if not exists askevidence_by_session_idx on public.askEvidence ("sessionId");

-- ---------------------------------------------------------------------------
-- Recommendations
-- ---------------------------------------------------------------------------

create table if not exists public.recommendations (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  title text not null,
  summary text not null,
  reason text not null,
  classification text not null default 'RECOMMENDATION',
  "detectorKey" text not null,
  priority text not null default 'medium',
  confidence double precision not null default 0.5,
  status text not null default 'open',
  "expectedImpact" text,
  risk text,
  "requiredApprovalMode" text not null default 'APPROVE',
  "decidedBy" uuid references public.profiles (_id),
  "decidedAt" bigint
);
create index if not exists recommendations_by_tenant_idx on public.recommendations ("tenantId");
create index if not exists recommendations_by_tenant_status_idx on public.recommendations ("tenantId", status);

create table if not exists public.recommendationEvidence (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "recommendationId" uuid not null references public.recommendations (_id) on delete cascade,
  kind text not null,
  "documentId" uuid references public.documents (_id) on delete set null,
  "chunkId" uuid references public.documentChunks (_id) on delete set null,
  "entityId" uuid references public.entities (_id) on delete set null,
  title text,
  snippet text,
  relevance double precision not null default 0.5
);
create index if not exists rec_evidence_by_recommendation_idx on public.recommendationEvidence ("recommendationId");

-- ---------------------------------------------------------------------------
-- Connections
-- ---------------------------------------------------------------------------

create table if not exists public.connections (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  name text not null,
  provider text not null,
  category text not null,
  status text not null default 'disconnected',
  "lastSyncAt" bigint,
  "lastError" text,
  "healthStatus" text,
  "lastTestedAt" bigint,
  "lastTestSuccessAt" bigint,
  "lastTestFailureAt" bigint,
  "lastTestLatencyMs" double precision,
  "accountName" text,
  "accountEmail" text,
  scopes jsonb,
  notes text,
  settings jsonb
);
create index if not exists connections_by_tenant_idx on public.connections ("tenantId");

-- OAuth tokens — only ever read/written by Edge Functions (service role).
create table if not exists public.connectionTokens (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  provider text not null default 'google_drive',
  "connectionId" uuid references public.connections (_id) on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "tokenExpiresAt" bigint,
  "accountEmail" text,
  "accountName" text,
  scopes jsonb,
  unique ("tenantId", provider)
);
create index if not exists connectiontokens_by_tenant_idx on public.connectionTokens ("tenantId");

-- ---------------------------------------------------------------------------
-- Tool & Action runtime
-- ---------------------------------------------------------------------------

create table if not exists public.toolActions (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  "actorId" uuid references public.profiles (_id),
  trigger text,
  "sourceEventId" uuid,
  "workflowInstanceId" uuid,
  "toolId" text not null,
  "connectorId" uuid references public.connections (_id) on delete set null,
  status text not null default 'proposed',
  input jsonb,
  result jsonb,
  error text,
  "confirmationRequired" boolean,
  "confirmationMessage" text,
  "confirmedAt" bigint,
  "confirmedBy" uuid references public.profiles (_id),
  "startedAt" bigint,
  "completedAt" bigint,
  "verificationStatus" text,
  "verificationResult" jsonb,
  evidence jsonb,
  "requestText" text,
  explanation jsonb,
  outcome text,
  "outcomeNote" text
);
create index if not exists toolactions_by_tenant_idx on public.toolActions ("tenantId");
create index if not exists toolactions_by_tenant_status_idx on public.toolActions ("tenantId", status);
create index if not exists toolactions_by_actor_idx on public.toolActions ("actorId");

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------

create table if not exists public.events (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  "eventId" text not null,
  "eventType" text not null,
  provider text not null,
  "connectorId" uuid references public.connections (_id) on delete set null,
  "connectionId" uuid references public.connections (_id) on delete set null,
  "sourceResourceId" text not null,
  "occurredAt" bigint not null,
  "receivedAt" bigint not null,
  payload jsonb,
  "payloadVersion" text not null default '1',
  "correlationId" text,
  "idempotencyKey" text not null,
  "dedupeKey" text not null unique,
  status text not null default 'received',
  attempts double precision not null default 0,
  "maxAttempts" double precision not null default 3,
  "lastError" text,
  "processedAt" bigint,
  "processingMs" double precision,
  "duplicateOf" uuid references public.events (_id),
  intelligence jsonb,
  "actionId" uuid,
  "sourceMechanism" text not null default 'manual',
  "providerEventId" text,
  "createdBy" text,
  "createdAt" bigint not null
);
create index if not exists events_by_tenant_received_idx on public.events ("tenantId", "receivedAt");
create index if not exists events_by_tenant_status_idx on public.events ("tenantId", status);
create index if not exists events_by_tenant_type_idx on public.events ("tenantId", "eventType");

create table if not exists public.notifications (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  "recipientId" uuid references public.profiles (_id),
  severity text not null default 'info',
  title text not null,
  description text,
  "sourceEventId" uuid references public.events (_id) on delete set null,
  "actionId" uuid references public.toolActions (_id) on delete set null,
  read boolean not null default false,
  "createdAt" bigint not null
);
create index if not exists notifications_by_tenant_created_idx on public.notifications ("tenantId", "createdAt");
create index if not exists notifications_by_tenant_unread_idx on public.notifications ("tenantId", read);

create table if not exists public.eventPolicies (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  "eventType" text not null,
  enabled boolean not null default true,
  "autoLowRiskWrite" boolean not null default false,
  "allowedTools" jsonb,
  "blockedTools" jsonb,
  "riskOverrides" jsonb,
  "confirmationOverride" text,
  "updatedAt" bigint,
  unique ("tenantId", "eventType")
);

-- ---------------------------------------------------------------------------
-- Workflows
-- ---------------------------------------------------------------------------

create table if not exists public.workflowSettings (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  "workflowId" text not null,
  enabled boolean not null default true,
  "descriptionOverride" text,
  "approvalRoleOverride" text,
  "maxActionsOverride" double precision,
  "updatedAt" bigint,
  unique ("tenantId", "workflowId")
);

create table if not exists public.workflowInstances (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  "definitionId" text not null,
  "workflowVersion" text not null default '1',
  "triggerEventId" uuid references public.events (_id) on delete set null,
  "triggerEventType" text,
  "sourceResourceId" text,
  status text not null default 'pending',
  "currentStepId" text,
  context jsonb,
  "evidenceReferences" jsonb,
  "actionReferences" jsonb,
  "approvalReferences" jsonb,
  "waitConditions" jsonb,
  "waitResumeKeys" jsonb,
  "completedStepIds" jsonb,
  "retryCounts" jsonb,
  "actionCount" double precision not null default 0,
  "loopGuard" jsonb,
  "failureReason" text,
  "errorClass" text,
  "dedupeKey" text not null unique,
  "startedAt" bigint not null,
  "updatedAt" bigint not null,
  "completedAt" bigint
);
create index if not exists workflowinstances_by_tenant_created_idx on public.workflowInstances ("tenantId", "startedAt");
create index if not exists workflowinstances_by_tenant_status_idx on public.workflowInstances ("tenantId", status);

create table if not exists public.workflowSteps (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  "instanceId" uuid not null references public.workflowInstances (_id) on delete cascade,
  "stepId" text not null,
  "stepType" text not null,
  attempt double precision not null default 1,
  "stepKey" text not null unique,
  status text not null default 'pending',
  "startedAt" bigint,
  "completedAt" bigint,
  "durationMs" double precision,
  output jsonb,
  error text,
  "actionId" uuid references public.toolActions (_id) on delete set null,
  "approvalId" uuid,
  "evidenceReferences" jsonb,
  "createdAt" bigint not null
);
create index if not exists workflowsteps_by_instance_idx on public.workflowSteps ("instanceId");
create index if not exists workflowsteps_by_tenant_idx on public.workflowSteps ("tenantId");

create table if not exists public.workflowApprovals (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  "instanceId" uuid not null references public.workflowInstances (_id) on delete cascade,
  "workflowDefinitionId" text not null,
  "stepId" text not null,
  title text not null,
  description text not null,
  "proposedAction" jsonb,
  "affectedSystem" text,
  "targetResource" text,
  "expectedConsequences" text,
  evidence jsonb,
  rationale text,
  reversibility text,
  "requestedRole" text not null default 'member',
  status text not null default 'pending',
  "expiresAt" bigint,
  "decidedBy" uuid references public.profiles (_id),
  "decidedAt" bigint,
  "createdAt" bigint not null
);
create index if not exists workflowapprovals_by_tenant_status_idx on public.workflowApprovals ("tenantId", status);
create index if not exists workflowapprovals_by_instance_idx on public.workflowApprovals ("instanceId");

-- ---------------------------------------------------------------------------
-- Everest — organization context
-- ---------------------------------------------------------------------------

create table if not exists public.organizationContexts (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  country text,
  regions jsonb,
  cities jsonb,
  "primaryTimezone" text,
  "timezoneNote" text,
  locale text,
  currency text,
  "fiscalYearStart" text,
  "businessDays" jsonb,
  "businessHours" jsonb,
  holidays jsonb,
  jurisdictions jsonb,
  industry text,
  "businessModel" text,
  "companySize" text,
  "updatedAt" bigint,
  unique ("tenantId")
);

create table if not exists public.operatingLocations (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  name text not null,
  kind text not null default 'branch',
  timezone text,
  jurisdiction text,
  country text,
  region text,
  city text,
  "businessHours" jsonb,
  primary boolean default false
);
create index if not exists operatinglocations_by_tenant_idx on public.operatingLocations ("tenantId");

-- ---------------------------------------------------------------------------
-- Everest — authoritative sources & knowledge (global registry)
-- ---------------------------------------------------------------------------

create table if not exists public.authoritativeSources (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "sourceId" text not null unique,
  name text not null,
  organization text not null,
  "authorityTier" text not null,
  industry text,
  industries jsonb,
  subjects jsonb,
  jurisdiction text,
  "sourceType" text not null,
  "canonicalUrl" text,
  "retrievalMethod" text,
  "updateFrequency" text,
  "implementationStatus" text,
  enabled boolean default true,
  "lastCheckedAt" bigint,
  "lastChangedAt" bigint,
  "lastSuccessfulSyncAt" bigint,
  "lastKnownVersion" text,
  "contentHash" text,
  "lastChangeType" text,
  "lastFetchError" text,
  "consecutiveFailures" double precision,
  "lastLatencyMs" double precision,
  "currentVersion" text,
  "effectiveDate" bigint,
  active boolean not null default true
);

create table if not exists public.authoritativeKnowledge (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "knowledgeId" text not null unique,
  "sourceId" text not null references public.authoritativeSources ("sourceId") on delete cascade,
  title text not null,
  statement text not null,
  interpretation text,
  "knowledgeType" text not null,
  jurisdiction text,
  industry text,
  status text not null default 'active',
  "reviewStatus" text,
  "publicationDate" bigint,
  "retrievalDate" bigint,
  "effectiveDate" bigint,
  "expirationDate" bigint,
  version text,
  "contentHash" text,
  "normalizedFact" text,
  "lastCheckedAt" bigint,
  "lastChangeType" text,
  freshness text,
  "supersedesId" text,
  "supersededById" text,
  supersedes jsonb,
  "supersededBy" jsonb,
  confidence double precision not null default 0.5
);
create index if not exists authknowledge_by_source_idx on public.authoritativeKnowledge ("sourceId");

create table if not exists public.impactAssessments (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "sourceId" text,
  "sourceName" text,
  "authorityTier" text,
  "knowledgeId" text,
  "knowledgeTitle" text,
  "versionId" text,
  "changeType" text not null,
  "affectedJurisdictions" jsonb,
  "affectedIndustries" jsonb,
  "affectedTenantIds" jsonb,
  "affectedWorkflowIds" jsonb,
  "affectedPolicyIds" jsonb,
  "affectedEntityIds" jsonb,
  evidence jsonb,
  confidence double precision not null default 0.5,
  severity text not null default 'medium',
  urgency text not null default 'scheduled',
  "recommendedAction" text not null,
  "requiresHumanReview" boolean not null default false,
  status text not null default 'pending_review',
  "reviewNote" text,
  "decidedBy" uuid references public.profiles (_id),
  "decidedAt" bigint,
  "createdAt" bigint not null
);
create index if not exists impactassessments_by_created_idx on public.impactAssessments ("createdAt");
create index if not exists impactassessments_by_status_idx on public.impactAssessments (status);

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

create table if not exists public.auditLogs (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  "actorType" text not null default 'user',
  "actorId" uuid references public.profiles (_id),
  "actionType" text not null,
  "targetType" text,
  "targetId" text,
  metadata jsonb
);
create index if not exists auditlogs_by_tenant_idx on public.auditLogs ("tenantId");

-- ---------------------------------------------------------------------------
-- Conversation sessions
-- ---------------------------------------------------------------------------

create table if not exists public.conversationSessions (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  "userId" uuid not null references public.profiles (_id) on delete cascade,
  title text not null,
  messages jsonb not null default '[]',
  context jsonb,
  "updatedAt" bigint not null
);
create index if not exists conversationsessions_by_tenant_user_idx on public.conversationSessions ("tenantId", "userId");
create index if not exists conversationsessions_by_tenant_idx on public.conversationSessions ("tenantId");

-- ---------------------------------------------------------------------------
-- Insurance restoration
-- ---------------------------------------------------------------------------

create table if not exists public.insuranceClaims (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  "claimNumber" text,
  customer text,
  property text,
  carrier text,
  policy text,
  adjuster text,
  "dateOfLoss" bigint,
  "causeOfLoss" text,
  "lossDescription" text,
  status text not null default 'opened',
  "currentStage" text,
  "estimateAmount" double precision,
  "estimateLineItemCount" double precision,
  "invoicedAmount" double precision,
  "paymentAmount" double precision,
  "approvedAmount" double precision,
  "collectedAmount" double precision,
  "openBalance" double precision,
  deductible double precision,
  "policyLimits" double precision,
  timeline jsonb,
  "scopeItems" jsonb,
  "expectedScope" jsonb,
  "actualScope" jsonb,
  "evidenceSummary" jsonb,
  "evidenceDocumentIds" jsonb,
  provenance text,
  confidence double precision,
  "isDemo" boolean default false,
  "createdBy" uuid references public.profiles (_id),
  "createdAt" bigint,
  "updatedAt" bigint
);
create index if not exists insuranceclaims_by_tenant_idx on public.insuranceClaims ("tenantId");
create index if not exists insuranceclaims_by_tenant_status_idx on public.insuranceClaims ("tenantId", status);

create table if not exists public.claimFindings (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  "claimId" uuid not null references public.insuranceClaims (_id) on delete cascade,
  "findingKey" text not null,
  category text not null,
  title text not null,
  description text,
  "affectedEstimateItem" text,
  evidence text,
  source text,
  confidence double precision,
  "estimatedAmount" double precision,
  limitation text,
  "recommendedNextStep" text,
  status text not null default 'open',
  "createdAt" bigint,
  "updatedAt" bigint,
  unique ("tenantId", "findingKey")
);
create index if not exists claimfindings_by_claim_idx on public.claimFindings ("claimId");
create index if not exists claimfindings_by_tenant_idx on public.claimFindings ("tenantId");

create table if not exists public.claimSupplements (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  "claimId" uuid not null references public.insuranceClaims (_id) on delete cascade,
  reason text not null,
  "affectedLineItems" jsonb,
  "requestedItems" jsonb,
  evidence jsonb,
  "estimateDifference" double precision,
  amount double precision,
  justification text,
  status text not null default 'draft',
  "carrierResponse" text,
  "approvedAmount" double precision,
  "deniedAmount" double precision,
  "outstandingAmount" double precision,
  "submissionDate" bigint,
  provenance text,
  confidence double precision,
  "isDemo" boolean default false,
  "createdBy" uuid references public.profiles (_id),
  "createdAt" bigint,
  "updatedAt" bigint
);
create index if not exists claimsupplements_by_claim_idx on public.claimSupplements ("claimId");
create index if not exists claimsupplements_by_tenant_idx on public.claimSupplements ("tenantId");

create table if not exists public.claimCandidates (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  "archiveId" uuid,
  "claimKey" text not null,
  "claimNumber" text,
  customer text,
  property text,
  "fileCount" double precision not null default 1,
  "totalSize" double precision,
  "confidence" double precision not null default 0.5,
  "filePaths" jsonb,
  "evidence" jsonb,
  "status" text not null default 'pending',
  "createdAt" bigint,
  "updatedAt" bigint,
  unique ("tenantId", "claimKey")
);
create index if not exists claimcandidates_by_tenant_idx on public.claimCandidates ("tenantId");
create index if not exists claimcandidates_by_archive_idx on public.claimCandidates ("archiveId");
create index if not exists claimcandidates_by_status_idx on public.claimCandidates (status);

-- ---------------------------------------------------------------------------
-- Archives (compressed company-data ingestion)
-- ---------------------------------------------------------------------------

create table if not exists public.archiveIngestions (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  filename text not null,
  "fileType" text not null,
  "compressedSize" double precision not null,
  "extractedSize" double precision not null default 0,
  "fileCount" double precision not null default 0,
  status text not null default 'uploaded',
  progress double precision not null default 0,
  checksum text not null,
  "rawRetained" boolean not null default false,
  "rawStorageId" text,
  "uploadedBy" uuid references public.profiles (_id),
  limits jsonb,
  stats jsonb,
  warnings jsonb,
  "failureReason" text,
  "startedAt" bigint,
  "createdAt" bigint not null,
  "updatedAt" bigint not null
);
create index if not exists archiveingestions_by_tenant_created_idx on public.archiveIngestions ("tenantId", "createdAt");

create table if not exists public.archiveFiles (
  _id uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default public.epoch_ms(),
  "tenantId" uuid not null references public.tenants (_id) on delete cascade,
  "archiveId" uuid not null references public.archiveIngestions (_id) on delete cascade,
  path text not null,
  filename text not null,
  extension text,
  "mimeType" text,
  size double precision,
  checksum text,
  depth double precision,
  "isDuplicate" boolean not null default false,
  "duplicateOfPath" text,
  "versionGroup" text,
  "isSuperseded" boolean,
  "supersedesPath" text,
  supported boolean,
  classification text,
  "classificationBasis" text,
  "classificationConfidence" double precision,
  "claimHints" jsonb,
  blocked boolean not null default false,
  "blockReason" text,
  "ingestStatus" text not null default 'queued',
  "storageId" text,
  "documentId" uuid references public.documents (_id) on delete set null,
  error text,
  "retryCount" double precision not null default 0
);
create index if not exists archivefiles_by_archive_idx on public.archiveFiles ("archiveId");
create index if not exists archivefiles_by_tenant_idx on public.archiveFiles ("tenantId");
create index if not exists archivefiles_by_tenant_checksum_idx on public.archiveFiles ("tenantId", checksum);

-- ============================================================================
-- Row-level security
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.tenants enable row level security;
alter table public.memberships enable row level security;
alter table public.invites enable row level security;
alter table public.companyProfiles enable row level security;
alter table public.companySystems enable row level security;
alter table public.intelligencePacks enable row level security;
alter table public.intelligenceItems enable row level security;
alter table public.tenantPacks enable row level security;
alter table public.documents enable row level security;
alter table public.documentChunks enable row level security;
alter table public.ingestionJobs enable row level security;
alter table public.entities enable row level security;
alter table public.entityRelationships enable row level security;
alter table public.knowledgeAssertions enable row level security;
alter table public.askSessions enable row level security;
alter table public.askEvidence enable row level security;
alter table public.recommendations enable row level security;
alter table public.recommendationEvidence enable row level security;
alter table public.connections enable row level security;
alter table public.connectionTokens enable row level security;
alter table public.toolActions enable row level security;
alter table public.events enable row level security;
alter table public.notifications enable row level security;
alter table public.eventPolicies enable row level security;
alter table public.workflowSettings enable row level security;
alter table public.workflowInstances enable row level security;
alter table public.workflowSteps enable row level security;
alter table public.workflowApprovals enable row level security;
alter table public.organizationContexts enable row level security;
alter table public.operatingLocations enable row level security;
alter table public.authoritativeSources enable row level security;
alter table public.authoritativeKnowledge enable row level security;
alter table public.impactAssessments enable row level security;
alter table public.auditLogs enable row level security;
alter table public.conversationSessions enable row level security;
alter table public.insuranceClaims enable row level security;
alter table public.claimFindings enable row level security;
alter table public.claimSupplements enable row level security;
alter table public.claimCandidates enable row level security;
alter table public.archiveIngestions enable row level security;
alter table public.archiveFiles enable row level security;

-- profiles: own row, or a row of a user in the same tenant.
create policy profiles_select on public.profiles for select
  using (
    _id = auth.uid()
    or _id in (
      select m."userId" from public.memberships m
      where m."tenantId" = public.my_tenant_id()
    )
  );
create policy profiles_update on public.profiles for update
  using (_id = auth.uid()) with check (_id = auth.uid());

-- Tenant-scoped tables: members can read/write their own tenant's rows.
create policy tenants_select on public.tenants for select
  using (_id = public.my_tenant_id());
create policy tenants_insert on public.tenants for insert
  with check (true);

create policy memberships_select on public.memberships for select
  using ("tenantId" = public.my_tenant_id());
create policy memberships_insert on public.memberships for insert
  with check ("tenantId" = public.my_tenant_id());
create policy memberships_update on public.memberships for update
  using ("tenantId" = public.my_tenant_id());
create policy memberships_delete on public.memberships for delete
  using ("tenantId" = public.my_tenant_id());

create policy invites_select on public.invites for select
  using ("tenantId" = public.my_tenant_id());
create policy invites_insert on public.invites for insert
  with check ("tenantId" = public.my_tenant_id());
create policy invites_delete on public.invites for delete
  using ("tenantId" = public.my_tenant_id());

create policy companyprofiles_select on public.companyProfiles for select
  using ("tenantId" = public.my_tenant_id());
create policy companyprofiles_all on public.companyProfiles for all
  using ("tenantId" = public.my_tenant_id())
  with check ("tenantId" = public.my_tenant_id());

create policy companysystems_select on public.companySystems for select
  using ("tenantId" = public.my_tenant_id());
create policy companysystems_all on public.companySystems for all
  using ("tenantId" = public.my_tenant_id())
  with check ("tenantId" = public.my_tenant_id());

create policy tenantpacks_select on public.tenantPacks for select
  using ("tenantId" = public.my_tenant_id());
create policy tenantpacks_all on public.tenantPacks for all
  using ("tenantId" = public.my_tenant_id())
  with check ("tenantId" = public.my_tenant_id());

create policy documents_select on public.documents for select
  using ("tenantId" = public.my_tenant_id());
create policy documents_all on public.documents for all
  using ("tenantId" = public.my_tenant_id())
  with check ("tenantId" = public.my_tenant_id());

create policy chunks_select on public.documentChunks for select
  using ("tenantId" = public.my_tenant_id());
create policy chunks_all on public.documentChunks for all
  using ("tenantId" = public.my_tenant_id())
  with check ("tenantId" = public.my_tenant_id());

create policy jobs_select on public.ingestionJobs for select
  using ("tenantId" = public.my_tenant_id());
create policy jobs_all on public.ingestionJobs for all
  using ("tenantId" = public.my_tenant_id())
  with check ("tenantId" = public.my_tenant_id());

create policy entities_select on public.entities for select
  using ("tenantId" = public.my_tenant_id());
create policy entities_all on public.entities for all
  using ("tenantId" = public.my_tenant_id())
  with check ("tenantId" = public.my_tenant_id());

create policy rels_select on public.entityRelationships for select
  using ("tenantId" = public.my_tenant_id());
create policy rels_all on public.entityRelationships for all
  using ("tenantId" = public.my_tenant_id())
  with check ("tenantId" = public.my_tenant_id());

create policy assertions_select on public.knowledgeAssertions for select
  using ("tenantId" = public.my_tenant_id());
create policy assertions_all on public.knowledgeAssertions for all
  using ("tenantId" = public.my_tenant_id())
  with check ("tenantId" = public.my_tenant_id());

create policy asksessions_select on public.askSessions for select
  using ("tenantId" = public.my_tenant_id());
create policy asksessions_all on public.askSessions for all
  using ("tenantId" = public.my_tenant_id())
  with check ("tenantId" = public.my_tenant_id());

create policy askevidence_select on public.askEvidence for select
  using (exists (select 1 from public.askSessions s where s._id = "sessionId" and s."tenantId" = public.my_tenant_id()));
create policy askevidence_all on public.askEvidence for all
  using (exists (select 1 from public.askSessions s where s._id = "sessionId" and s."tenantId" = public.my_tenant_id()))
  with check (exists (select 1 from public.askSessions s where s._id = "sessionId" and s."tenantId" = public.my_tenant_id()));

create policy recs_select on public.recommendations for select
  using ("tenantId" = public.my_tenant_id());
create policy recs_all on public.recommendations for all
  using ("tenantId" = public.my_tenant_id())
  with check ("tenantId" = public.my_tenant_id());

create policy rec_evidence_select on public.recommendationEvidence for select
  using (exists (select 1 from public.recommendations r where r._id = "recommendationId" and r."tenantId" = public.my_tenant_id()));
create policy rec_evidence_all on public.recommendationEvidence for all
  using (exists (select 1 from public.recommendations r where r._id = "recommendationId" and r."tenantId" = public.my_tenant_id()))
  with check (exists (select 1 from public.recommendations r where r._id = "recommendationId" and r."tenantId" = public.my_tenant_id()));

create policy connections_select on public.connections for select
  using ("tenantId" = public.my_tenant_id());
create policy connections_all on public.connections for all
  using ("tenantId" = public.my_tenant_id())
  with check ("tenantId" = public.my_tenant_id());

-- connectionTokens is service-role only — no RLS access for clients.
create policy connectiontokens_none on public.connectionTokens for select
  using (false);

create policy toolactions_select on public.toolActions for select
  using ("tenantId" = public.my_tenant_id());
create policy toolactions_all on public.toolActions for all
  using ("tenantId" = public.my_tenant_id())
  with check ("tenantId" = public.my_tenant_id());

create policy events_select on public.events for select
  using ("tenantId" = public.my_tenant_id());
create policy events_all on public.events for all
  using ("tenantId" = public.my_tenant_id())
  with check ("tenantId" = public.my_tenant_id());

create policy notifications_select on public.notifications for select
  using ("tenantId" = public.my_tenant_id());
create policy notifications_all on public.notifications for all
  using ("tenantId" = public.my_tenant_id())
  with check ("tenantId" = public.my_tenant_id());

create policy eventpolicies_select on public.eventPolicies for select
  using ("tenantId" = public.my_tenant_id());
create policy eventpolicies_all on public.eventPolicies for all
  using ("tenantId" = public.my_tenant_id())
  with check ("tenantId" = public.my_tenant_id());

create policy wfsettings_select on public.workflowSettings for select
  using ("tenantId" = public.my_tenant_id());
create policy wfsettings_all on public.workflowSettings for all
  using ("tenantId" = public.my_tenant_id())
  with check ("tenantId" = public.my_tenant_id());

create policy wfinstances_select on public.workflowInstances for select
  using ("tenantId" = public.my_tenant_id());
create policy wfinstances_all on public.workflowInstances for all
  using ("tenantId" = public.my_tenant_id())
  with check ("tenantId" = public.my_tenant_id());

create policy wfsteps_select on public.workflowSteps for select
  using ("tenantId" = public.my_tenant_id());
create policy wfsteps_all on public.workflowSteps for all
  using ("tenantId" = public.my_tenant_id())
  with check ("tenantId" = public.my_tenant_id());

create policy wfapprovals_select on public.workflowApprovals for select
  using ("tenantId" = public.my_tenant_id());
create policy wfapprovals_all on public.workflowApprovals for all
  using ("tenantId" = public.my_tenant_id())
  with check ("tenantId" = public.my_tenant_id());

create policy orgcontexts_select on public.organizationContexts for select
  using ("tenantId" = public.my_tenant_id());
create policy orgcontexts_all on public.organizationContexts for all
  using ("tenantId" = public.my_tenant_id())
  with check ("tenantId" = public.my_tenant_id());

create policy oplocations_select on public.operatingLocations for select
  using ("tenantId" = public.my_tenant_id());
create policy oplocations_all on public.operatingLocations for all
  using ("tenantId" = public.my_tenant_id())
  with check ("tenantId" = public.my_tenant_id());

-- Global knowledge: any signed-in user can read.
create policy sources_select on public.authoritativeSources for select
  using (auth.role() = 'authenticated');
create policy authknowledge_select on public.authoritativeKnowledge for select
  using (auth.role() = 'authenticated');
create policy impactassessments_select on public.impactAssessments for select
  using (auth.role() = 'authenticated');

create policy packs_select on public.intelligencePacks for select
  using (auth.role() = 'authenticated');
create policy packitems_select on public.intelligenceItems for select
  using (auth.role() = 'authenticated');

create policy auditlogs_select on public.auditLogs for select
  using ("tenantId" = public.my_tenant_id());
create policy auditlogs_insert on public.auditLogs for insert
  with check ("tenantId" = public.my_tenant_id());

create policy convsessions_select on public.conversationSessions for select
  using ("tenantId" = public.my_tenant_id());
create policy convsessions_all on public.conversationSessions for all
  using ("tenantId" = public.my_tenant_id())
  with check ("tenantId" = public.my_tenant_id());

create policy claims_select on public.insuranceClaims for select
  using ("tenantId" = public.my_tenant_id());
create policy claims_all on public.insuranceClaims for all
  using ("tenantId" = public.my_tenant_id())
  with check ("tenantId" = public.my_tenant_id());

create policy findings_select on public.claimFindings for select
  using ("tenantId" = public.my_tenant_id());
create policy findings_all on public.claimFindings for all
  using ("tenantId" = public.my_tenant_id())
  with check ("tenantId" = public.my_tenant_id());

create policy supplements_select on public.claimSupplements for select
  using ("tenantId" = public.my_tenant_id());
create policy supplements_all on public.claimSupplements for all
  using ("tenantId" = public.my_tenant_id())
  with check ("tenantId" = public.my_tenant_id());

create policy candidates_select on public.claimCandidates for select
  using ("tenantId" = public.my_tenant_id());
create policy candidates_all on public.claimCandidates for all
  using ("tenantId" = public.my_tenant_id())
  with check ("tenantId" = public.my_tenant_id());

create policy archives_select on public.archiveIngestions for select
  using ("tenantId" = public.my_tenant_id());
create policy archives_all on public.archiveIngestions for all
  using ("tenantId" = public.my_tenant_id())
  with check ("tenantId" = public.my_tenant_id());

create policy archivefiles_select on public.archiveFiles for select
  using ("tenantId" = public.my_tenant_id());
create policy archivefiles_all on public.archiveFiles for all
  using ("tenantId" = public.my_tenant_id())
  with check ("tenantId" = public.my_tenant_id());

-- FKs that reference tables created later in this migration.
alter table public.toolActions
  add constraint toolactions_sourceevent_fk foreign key ("sourceEventId")
    references public.events (_id) on delete set null,
  add constraint toolactions_workflowinstance_fk foreign key ("workflowInstanceId")
    references public.workflowInstances (_id) on delete set null;

alter table public.events
  add constraint events_action_fk foreign key ("actionId")
    references public.toolActions (_id) on delete set null;

alter table public.workflowSteps
  add constraint workflowsteps_approval_fk foreign key ("approvalId")
    references public.workflowApprovals (_id) on delete set null;

alter table public.claimCandidates
  add constraint claimcandidates_archive_fk foreign key ("archiveId")
    references public.archiveIngestions (_id) on delete cascade;

-- Storage bucket policies: documents are private; only members of the owning
-- tenant can read their bucket objects.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;
insert into storage.buckets (id, name, public)
values ('archives', 'archives', false)
on conflict (id) do nothing;

-- Objects are stored under "<tenantId>/<path>" so reads/writes stay tenant-scoped.
create policy documents_storage_insert on storage.objects for insert
  with check (
    (bucket_id = 'documents' or bucket_id = 'archives')
    and (storage.foldername(name))[1] = public.my_tenant_id()::text
  );
create policy documents_storage_select on storage.objects for select
  using (
    (bucket_id = 'documents' or bucket_id = 'archives')
    and (storage.foldername(name))[1] = public.my_tenant_id()::text
  );
create policy documents_storage_delete on storage.objects for delete
  using (
    (bucket_id = 'documents' or bucket_id = 'archives')
    and (storage.foldername(name))[1] = public.my_tenant_id()::text
  );
create policy documents_storage_update on storage.objects for update
  using (
    (bucket_id = 'documents' or bucket_id = 'archives')
    and (storage.foldername(name))[1] = public.my_tenant_id()::text
  );
