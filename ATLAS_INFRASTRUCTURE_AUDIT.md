# Atlas Infrastructure Audit & Milestone 1 Completion Report

## Phase 0 — Architecture Audit

### What Already Exists

| Layer | Technology | Status |
|-------|-----------|--------|
| **Frontend** | React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui | Production-ready |
| **Backend** | Supabase (PostgreSQL + RLS + Edge Functions + Storage) | Production-ready |
| **Auth** | Supabase Auth (email/password + anonymous + password reset) | Production-ready |
| **RBAC** | Custom access-gate.ts (super_admin, atlas_admin, customer_admin, customer_user, pilot_user) | Production-ready |
| **Database** | PostgreSQL via Supabase, all operations through RPCs | Production-ready |
| **Edge Functions** | Supabase Edge Functions (conversation-converse, voice, tools-execute, connections-sync) | Production-ready |
| **AI** | Single Edge Function for conversation, client-side deterministic analyzers | Partial |
| **Evidence Engine** | Deterministic analyzers in `src/lib/insurance/` — completeness, findings, timeline, reconciliation | Production-ready |
| **Claim Discovery** | Deterministic document clustering, claim reconstruction, candidate approval | Production-ready |
| **Contradictions** | Deterministic cross-document contradiction detection | Production-ready |
| **Evidence Requirements** | Workflow-relative evidence assessment (§42 absence problem) | Production-ready |
| **Workflows** | 3 real workflows (drive intelligence, document review, revenue review) with approval gates | Production-ready |
| **Events** | 15+ event types (Drive + Authority + 8 planned roadmap) with policy system | Production-ready |
| **CRM** | Lead management, tasks, custom fields, CSV import | Production-ready |
| **Recommendations** | Decision state machine (open → approved → executed) | Production-ready |
| **Documents** | PDF/DOCX/text/OCR ingestion, chunking, entity extraction | Production-ready |
| **Pilot** | Company management, sessions, insights, outcomes, testimonials, analytics | Production-ready |
| **Mail** | Templates, outreach, signatures | Production-ready |
| **Knowledge** | Entity management, graph visualization, assertion confirmation | Production-ready |
| **Voice** | Browser STT/TTS, wake word engine, voice recognition | Production-ready |
| **Testing** | 488 passing tests across 46 files, Vitest | Solid |

### What Does NOT Exist (Gaps for the Agentic Infrastructure)

1. **No durable background jobs** — all processing is client-side or synchronous Edge Functions
2. **No job queue** — no mechanism for background work that survives page close
3. **No agent runtime** — no concept of specialized AI agents with tool restrictions
4. **No model router** — AI calls go to a single provider with no task-based selection
5. **No AI cost controls** — no token/cost tracking or budgets
6. **No agent observability** — no dashboard for agent runs, failures, queue depth
7. **No human-in-the-loop system** — no review queue for AI outputs
8. **No memory/context architecture** — no separation of global vs tenant vs claim memory
9. **No pipeline orchestration** — evidence stages are sequential client calls, not durable workflows
10. **No agent tools layer** — agents have no restricted tool interface
11. **No infrastructure agent** — no self-monitoring capability
12. **No load testing** — no verified capacity measurements

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Adding job tables to existing Postgres | Low | RLS enforced, service_role for workers, no data migration needed |
| Edge Function compute limits | Medium | Workers are stateless; scale via Supabase's Edge Function scaling |
| RLS policy overhead at 14K users | Medium | Index on tenant_id + status; partial indexes for dequeue |
| AI provider failures | High | Model router with fallbacks; graceful degradation already exists in converse |

---

## Milestone 1 — Database/Job Architecture ✅ COMPLETE

### What Was Built

#### 1. Database Migration (`supabase/migrations/0020_atlas_jobs.sql`)
- **4 tables**: `atlas_jobs`, `atlas_job_steps`, `atlas_job_attempts`, `atlas_job_events`
- **RLS policies**: Tenant isolation for all tables (service_role for workers, authenticated read for users)
- **Indexes**: 11 targeted indexes for dequeue, status monitoring, lock expiry, scheduled jobs
- **12 RPC functions**:
  - `jobs_create_job` — idempotent enqueue
  - `jobs_create_step` — add workflow steps
  - `jobs_dequeue` — `SELECT ... FOR UPDATE SKIP LOCKED` for safe concurrent claiming
  - `jobs_complete_job` / `jobs_fail_job` — lifecycle management with exponential backoff
  - `jobs_complete_step` / `jobs_fail_step` / `jobs_retry_step` — step-level restart
  - `jobs_cancel_job` — cascade cancel
  - `jobs_get_job` / `jobs_list_jobs` / `jobs_get_events` — queries
  - `jobs_unlock_stuck` — dead worker reclamation
  - `jobs_stats` — observability dashboard aggregates

#### 2. TypeScript Types (`src/lib/jobs/types.ts`)
- Complete type system for jobs, steps, attempts, events
- Status enums with literal types
- Agent types, model policies, tool system types
- Human review types, provenance records
- Pipeline definition types
- AI metadata with token/cost tracking

#### 3. Job Engine (`src/lib/jobs/engine.ts`)
- **Pure TypeScript** — no database calls, fully testable
- Status transition validation (job + step state machines)
- Exponential backoff with jitter (15s base, 1h cap, ±20% jitter)
- Idempotency key generation (deterministic + unique)
- Input validation
- Next-action determination (dequeue/execute/complete/retry/escalate)
- AI metadata accumulation across steps
- Stuck-job detection
- Step restart logic (find downstream steps needing re-execution)
- Pipeline planning and input resolution

#### 4. RPC Layer (`src/lib/jobs/rpc.ts`)
- Client-side functions wrapping all Supabase RPCs
- Typed function signatures matching the database functions
- Convenience functions: `enqueueEvidencePipeline`, `enqueueAgentTask`
- Job listing, event queries, stats retrieval

#### 5. API Registry Extension (`src/lib/api.ts`)
- Added `jobs` namespace to the API registry
- 14 new RPC entries for job management

#### 6. Tests (`src/lib/jobs/engine.test.ts`)
- **67 tests** covering:
  - Job status transitions (15 tests)
  - Step status transitions (7 tests)
  - Exponential backoff math (6 tests)
  - Idempotency key generation (4 tests)
  - Input validation (6 tests)
  - Transition helpers (2 tests)
  - Next-action determination (7 tests)
  - AI metadata merging (3 tests)
  - Error creation (2 tests)
  - Stuck-job detection (3 tests)
  - Retry readiness (3 tests)
  - Step restart logic (2 tests)
  - Step summarization (1 test)
  - Pipeline planning (1 test)
  - Input resolution (3 tests)

### Verification Results

| Check | Result |
|-------|--------|
| TypeScript compilation | ✅ Clean (0 errors) |
| Existing tests | ✅ 488 → 555 pass (+67 new) |
| Pre-existing failures | ⚠️ 9 voice/speech tests (unchanged, unrelated) |
| Pre-existing errors | ⚠️ 6 test infrastructure errors (unchanged, unrelated) |
| Regressions | ✅ None |

### Architecture Decisions

1. **Database-backed jobs (not in-memory)** — jobs survive process/page restart
2. **SKIP LOCKED for dequeue** — safe concurrent worker claiming without distributed locks
3. **Pure engine (no DB calls)** — fully unit-testable, testable in isolation
4. **Step-level granularity** — enables restarting individual failed pipeline stages
5. **Idempotency at the database level** — UNIQUE partial index prevents duplicate active jobs
6. **Tenant isolation in every layer** — RLS + service_role separation
7. **Structured AI metadata** — track provider, model, tokens, cost per step
8. **Immutable event log** — full audit trail for observability and debugging

### Files Changed

| File | Action |
|------|--------|
| `supabase/migrations/0020_atlas_jobs.sql` | **Created** — Database schema + RPCs |
| `src/lib/jobs/types.ts` | **Created** — TypeScript type definitions |
| `src/lib/jobs/engine.ts` | **Created** — Pure job engine logic |
| `src/lib/jobs/rpc.ts` | **Created** — Supabase RPC wrappers |
| `src/lib/jobs/index.ts` | **Created** — Barrel export |
| `src/lib/jobs/engine.test.ts` | **Created** — 67 unit tests |
| `src/lib/api.ts` | **Modified** — Added jobs namespace to API registry |

### What Remains for Future Milestones

| Milestone | Description |
|-----------|-------------|
| Milestone 2 | Durable queue worker (Edge Function or polling mechanism) |
| Milestone 3 | Convert Evidence Reasoning Engine into durable pipeline steps |
| Milestone 4 | Agent Runtime (execute agents through job system) |
| Milestone 5 | Evidence Agent + Gap Agent + Supplement Agent |
| Milestone 6 | QA Agent |
| Milestone 7 | Agent tools + authorization layer |
| Milestone 8 | Agent Orchestrator |
| Milestone 9 | Memory + model routing + cost controls |
| Milestone 10 | Human review + autonomy controls |
| Milestone 11 | Operations/Infrastructure agents |
| Milestone 12 | Load testing and production scaling |
