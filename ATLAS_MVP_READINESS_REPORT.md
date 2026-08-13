# Atlas Universal — MVP Completion Report

**Date:** 2026-08-13
**Canonical production URL:** https://atlasuniversalos.freebuff.app
**Repo:** Melroxs/Atlas-Universal (branch `main`, HEAD `5c55053`)
**Stack:** Vite + React 19 + TypeScript + Tailwind v4 + shadcn/ui, Supabase (Postgres RPCs + Auth + Storage + Edge Functions), Bun.

---

## 1. What Atlas is

Atlas Universal is an AI operating system for restoration companies. A company uploads
its entire operating history (estimates, Xactimate scopes, invoices, payments, policy
documents, photos, email, spreadsheets) and Atlas turns that raw archive into
searchable knowledge, reconstructs potential insurance claims, surfaces revenue
recovery opportunities, flags contradictions, and answers questions with citations to
real documents.

Completed systems (all implemented in this repository):

| System | Status |
|---|---|
| Universal Business Brain | Implemented |
| Everest Intelligence Layer | Implemented |
| Authority Engine | Implemented |
| Industry Intelligence | Implemented |
| Organizational Memory | Implemented |
| Entity Graph | Implemented |
| Conversational Brain (Ask Atlas, deterministic retrieval + optional AI) | Implemented |
| Voice OS (wake word + recognition pipeline, browser APIs) | Implemented, browser-limited |
| Archive Intelligence (ZIP/RAR extraction, classify, ingest, dedupe) | Implemented |
| Claim Reconstruction (potential candidates, no auto-approval) | Implemented |
| Revenue Recovery OS (findings, contradictions, missing evidence) | Implemented |
| Evidence Graph (documents ↔ chunks ↔ entities ↔ claims) | Implemented |
| Workflow Engine | Implemented |

---

## 2. Validation status

### Local validation — GREEN

| Check | Result |
|---|---|
| `bun tsc -b --noEmit` | 0 errors |
| `bunx vitest run` | 154 passed, 3 skipped (live E2E, disabled by default), 0 failed |
| `bun run build` | Production build succeeds |

Coverage includes: archive classification/extraction/security/limits, claim-number
extraction (label formats like `Claim_12345` normalize to `12345`; `GAP-26-51847`
is preserved verbatim), duplicate checksum provenance, image handling with honest
`content_extraction_unavailable` warnings, tenant isolation, CORS contract tests for
the edge function, auth error mapping, voice/wake-word, retrieval, and parsers.

### Live E2E against the real deployed Supabase project — BLOCKED

`RUN_LIVE_E2E=1` was executed against the production project. It fails at the very
first production assertion, reproducing the exact defect the Phase 15 closure was
supposed to fix:

```
tenant-live.e2e.test.ts > tenants_create_tenant (repeated call)
Unknown Error: You already belong to a workspace.
```

A direct live probe of the production database confirmed the root cause: the deployed
project still runs the **pre-0011** `tenants_create_tenant`, which raises
`P0001` ("You already belong to a workspace.") instead of returning the caller's
existing workspace, and which can still race concurrent onboarding requests into the
409 the browser console reported.

**The Phase 15 live E2E suite (archive pipeline + full NPP ingestion) cannot pass
until migrations 0009–0012 are applied to the production Supabase project.** Running
it now would fail on the first tenant-bootstrap step; no results are claimed.

---

## 3. Production status (verified live)

| Component | Status | Evidence |
|---|---|---|
| Frontend at https://atlasuniversalos.freebuff.app | **Live** | HTTP 200 on `/` and `/auth` |
| Frontend bundle freshness | **Up to date** | Redeployed `5c55053` on 2026-08-13; deployed entry `index-DPicHwxK.js` + CSS `index-CUU3wShB.css` byte-match the fresh local build, and the live `Auth-ByL0hXC2.js` chunk contains the new existing-account fix |
| Supabase migrations 0009–0012 | **NOT applied** | Live probe: repeated `tenants_create_tenant` raises the old `P0001` |
| Edge function `connections-run-due-syncs` | **NOT deployed** | OPTIONS preflight returns HTTP 404 (the exact browser console error) |
| Auth (signup + session) | **Working** | Live probe: fresh user signup returns an active session |
| Tenant bootstrap idempotency | **BROKEN in prod** | Old RPC behavior confirmed (see above); fix is committed but not deployed to the DB |

### Env / setup requirements

Public config (safe in the browser bundle, already baked into the build):

- `VITE_SUPABASE_URL=https://ibxvzxblyhzwokljkslt.supabase.co`
- `VITE_SUPABASE_ANON_KEY` — public anon JWT

Server-side secrets (only used by Supabase Edge Functions / the platform):

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (used by `connections-run-due-syncs`)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Google Drive connector (OAuth; not
  yet wired end-to-end)
- `CARTESIA_API_KEY` — voice output (present in local `env.local`; verify in prod env)

Optional AI: `VLY_INTEGRATION_KEY` — Ask Atlas degrades to deterministic heuristics
when absent (honest, no fabricated answers).

---

## 4. Remaining production steps (the only things between this repo and a green MVP)

The code is complete and committed. Three production-side operations remain, and each
requires credentials this sandbox does not have (no `SUPABASE_ACCESS_TOKEN`,
`SUPABASE_SERVICE_ROLE_KEY` env, or DB password was provided in this environment —
nothing was faked or skipped).

### 4a. Apply migrations 0009–0012 to the production Supabase project

Easiest path — paste a **Supabase personal access token** (`sbp_...`) into the
project's **Keys/API keys** tab as `SUPABASE_ACCESS_TOKEN`, then the exact commands are:

```bash
supabase login --token "$SUPABASE_ACCESS_TOKEN"
supabase link --project-ref ibxvzxblyhzwokljkslt
supabase db push          # applies 0009–0012 (idempotent tenant bootstrap,
                          # claim-package scalar fix, duplicate provenance,
                          # documents cap)
```

Equivalent manual path (no token needed): open the Supabase dashboard → SQL Editor
and run, in order, the contents of:

```
supabase/migrations/0009_fix_claim_package_scalar.sql
supabase/migrations/0010_fix_archive_duplicate_provenance.sql
supabase/migrations/0011_fix_tenant_bootstrap_idempotent.sql
supabase/migrations/0012_fix_documents_list_cap.sql
```

Then refresh the PostgREST schema cache (dashboard → Settings → API, or
`NOTIFY pgrst, 'reload schema'`).

### 4b. Deploy the edge function

```bash
supabase functions deploy connections-run-due-syncs --project-ref ibxvzxblyhzwokljkslt
```

This deploys the shared-CORS handler (`_shared/cors.ts`) that answers OPTIONS with
204 + allowed origins (`https://atlasuniversalos.freebuff.app`) and enforces JWT auth
and tenant scoping on the actual request. Verify with:

```bash
curl -i -X OPTIONS \
  -H "Origin: https://atlasuniversalos.freebuff.app" \
  -H "Access-Control-Request-Method: POST" \
  https://ibxvzxblyhzwokljkslt.supabase.co/functions/v1/connections-run-due-syncs
# expect HTTP 204 + access-control-allow-origin
```

### 4c. Redeploy the frontend — DONE

The current HEAD (`5c55053`, auth/tenant/edge fix) was redeployed to
https://atlasuniversalos.freebuff.app on 2026-08-13 and verified: the live bundle
matches the fresh build exactly and includes the "Sign in instead" existing-account
flow and non-blocking connector-sync handling.

---

## 5. Genuine remaining limitations (not hidden)

- **Production DB migrations + edge function deploy are pending** — the single
  blocker for Phase 15 "complete". Everything else in this report is verified.
- **OCR:** scanned PDFs honestly report no text layer; OCR credentials are not
  configured (the pipeline hook exists).
- **Legacy formats:** `.doc` is unsupported (save as `.docx`); unsupported formats
  fail explicitly, never falsely advertised.
- **Connectors:** Google Drive is the only real connector and is not yet deployed;
  CRM/accounting/PM connectors are catalog entries only.
- **AI:** Ask Atlas uses deterministic retrieval when `VLY_INTEGRATION_KEY` is absent.
- **Voice:** implemented on browser APIs (Web Speech / wake word); full ambient-mode
  verification requires a real browser session (see voice test suite + `src/lib/wake-word.ts`).
- **Images:** stored as evidence with honest `content_extraction_unavailable` — no
  fabricated OCR/content.

---

## 6. Bottom line

Code: complete, committed, locally green (tsc ✓, 154 tests ✓, build ✓).
Frontend: live at the canonical URL, now serving the latest commit (verified).
Backend: the deployed Supabase project is missing migrations 0009–0012 and the
`connections-run-due-syncs` edge function — the exact root causes of the reported
production 422/409/CORS errors. The fixes are committed; applying them to Supabase
requires either a `SUPABASE_ACCESS_TOKEN` in API Keys (I can apply and re-verify
immediately) or running the four SQL files + one `functions deploy` command above.
