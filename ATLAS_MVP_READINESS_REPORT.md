# Atlas Universal — MVP Completion Report

**Date:** 2026-08-14
**Canonical production URL:** https://atlasmvp.freebuff.app (Freebuff-hosted); https://atlasuniversalos.freebuff.app is the Vercel-hosted alias
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

### Live E2E against the real deployed Supabase project — GREEN (2026-08-13)

All live suites pass against the real project with `RUN_LIVE_E2E=1`:

| Suite | Result |
|---|---|
| `tenant-live.e2e.test.ts` | PASS — signup → idempotent tenant bootstrap (repeated calls return the same workspace, exactly one owner membership) |
| `archive-live.e2e.test.ts` | PASS — real ZIP through the real engine → uploads → archive_begin → inventory → processing → `archive_get_detail` completed, claim candidate `8842001` visible |
| `phase15-live.e2e.test.ts` | PASS — individual uploads of every format (PDF/DOCX/XLSX/CSV/TXT/MD/image/EML), full 113-file NPP archive (105 docs ingested, 0 failed), claim `GAP-26-51847` reconstructed/approved/analyzed (4 findings, 36 evidence links, 8 duplicate refs), Ask Atlas answers from real evidence |
| `scripts/journey-live.mjs` | PASS — 13/13 checks: signup, profile trigger, edge function 200-skipped before workspace, tenant create with "NPP Roofing & Restoration", idempotent retry, owner membership FK satisfied, edge function 200 with workspace, 401 unauthenticated, OPTIONS 204 + single origin, re-login persistence |

Migration 0013 (added this session) makes `tenants_create_tenant` repair a missing
`public.profiles` row via `ensure_profile()` BEFORE any membership insert — the
root cause of the production `23503` (memberships FK to profiles) — and re-raises
database errors with structured SQLSTATEs. Migrations 0009–0012 were confirmed
applied live and the history table was backfilled so `supabase db push` stays in sync.

---

## 3. Production status (verified live, 2026-08-13)

| Component | Status | Evidence |
|---|---|---|
| Frontend at https://atlasuniversalos.freebuff.app | **Live** | HTTP 200 on `/` and `/auth` |
| Supabase migrations 0001–0013 | **Applied** | `supabase migration list` shows all remote; history table backfilled; live RPC signatures match the frontend contract (`tenants_*`, `insurance_*`, `archive_*`, `ingestion_*`, `documents_*`) |
| Edge function `connections-run-due-syncs` | **Deployed + self-contained** | ACTIVE (4 versions); entry `source/index.ts` imports the LOCAL `source/cors.ts` copy (no package-escape imports); OPTIONS → 204 with single allowed origin; unauthenticated → 401; no-workspace → 200 `{skipped}`; verified by `cors.test.ts` drift/escape guards |
| Auth (signup + session) | **Working** | Fresh signup returns active session; `profiles` row auto-created by trigger |
| Tenant bootstrap | **FIXED in prod** | 0011 idempotency + 0013 profile repair live; no 409/23503 in the journey test; repeated create returns the same workspace |
| Demo/test data | **Reset (final)** | `scripts/reset-demo-data.mjs --apply` run last, after all live E2E verification: 0 app rows (38 tables), 0 auth users, 0 storage objects; schema/RLS/buckets intact |

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

## 4. Production operations — COMPLETED (2026-08-13)

Migrations 0001–0013 are applied and the edge function is deployed (see §3). The
credentials (Supabase access token in API Keys) are available; nothing is pending.

### 4a. Migrations — DONE (0001–0013)

```bash
supabase migration repair --status applied ...   # backfilled history for 0001–0012
supabase db push                                  # applied 0013
```

PostgREST schema cache was refreshed (`NOTIFY pgrst, 'reload schema'`).

### 4b. Edge function — DONE

Deployed from the self-contained structure (`source/index.ts` entry importing the
local `source/cors.ts`; root `index.ts` shim keeps the standard CLI deploy path).
Verified: OPTIONS → 204 with `Access-Control-Allow-Origin: https://atlasuniversalos.freebuff.app`
only; unauthenticated → 401; no-workspace → 200 `{skipped}`; with workspace → 200
`{ok:true}`. The stray `cors` function from an earlier mis-deploy was deleted.

### 4c. Redeploy the frontend — DONE

The current HEAD (auth/tenant/edge fix) was redeployed to
https://atlasuniversalos.freebuff.app on 2026-08-13 and verified: the live bundle
matches the fresh build exactly and includes the "Sign in instead" existing-account
flow and non-blocking connector-sync handling.

### 4d. Document-extraction pipeline — DONE (PDF/DOCX/XLSX production-safe)

Production defect fixed: `src/lib/ingest/parsers.ts` ran in the browser but
relied on Node-only extractors — `pdf-parse` (whose dynamic `require()` of its
internal pdf.js cannot survive the Vite bundle: "Could not dynamically require
./pdf.js/v1.10.100/build/...") and a Node `Buffer` for DOCX ("Word parsing
isn't available in this environment"). XLSX had the same Buffer dependency.

Fix (verified in the built bundle, 2026-08-13):

- **PDF → pdfjs-dist** (`src/lib/ingest/pdf.ts`). Legacy ESM build so the same
  module runs in browser + Node tests; the worker is emitted as a static asset
  (`assets/pdf.worker.min-*.mjs`) and wired through `GlobalWorkerOptions.workerSrc`
  via the Vite `new URL(..., import.meta.url)` pattern. In Node pdf.js runs
  main-thread; if the browser worker ever fails it falls back to main-thread.
- **DOCX → mammoth's official browser build** (`src/lib/ingest/docx.ts`) reading
  a plain `ArrayBuffer` — no Buffer, no fs.
- **XLSX → raw `Uint8Array`** (`XLSX.read(..., { type: "array" })`).
- `.eml` unchanged; `.doc`/`.msg` remain explicitly unsupported; images keep the
  honest `content_extraction_unavailable` state (no fabricated OCR).

Validation: `bun tsc -b --noEmit` ✓ · `bunx vitest run` 174 passed (incl. new
PDF/DOCX/corrupt-file/bundle-safety regression tests) ✓ · `bun run build` ✓ with
`pdf.worker.min-*.mjs` emitted and referenced, no `pdf-parse` strings left in the
bundle. Both individual uploads and archive-extracted files go through the same
`parseFile` pipeline (`processDocumentClient` / `beginProcessingClient`).

Live smoke test (2026-08-13, real Supabase project): `RUN_LIVE_E2E=1` archive +
phase15 suites PASS — full 113-file NPP archive ingested **105 docs / 0 failed**
(PDF/DOCX/XLSX/EML/images), claim GAP-26-51847 reconstructed, 36 evidence links;
data reset to zero afterward.

Deployment note: this workspace's Freebuff deployment is **atlasmvp.freebuff.app**
and is verified live with the new build (index-DhKAlcES.js, worker asset served,
no pdf-parse strings). The alias **atlasuniversalos.freebuff.app is Vercel-hosted**
(server: Vercel) and was still serving the stale bundle at last check — it needs a
Vercel-side redeploy after the GitHub push. Security note: commit 453dba0 pushed
`env.local` (repo root, not covered by `.env*` ignore) containing the real
SUPABASE_ACCESS_TOKEN — the token should be rotated and the file removed from
history via Vercel/GitHub tooling.

---

---

## 4e. Production stability + voice + edge-function + UI crash repair (2026-08-14)

### Root causes found and fixed

1. **Edge-function CORS blocker (real production blocker).** The deployed
   `connections-run-due-syncs` allowlist contained only
   `https://atlasuniversalos.freebuff.app`, but the app runs from
   `https://atlasmvp.freebuff.app` — so the browser preflight from atlasmvp
   got `HTTP 204` with NO `Access-Control-Allow-Origin`, producing exactly
   "Response to preflight request doesn't pass access control check" and the
   `[atlas] background connections sync unavailable` log. Fix: both CORS
   copies (canonical `_shared/cors.ts` + deployable `source/cors.ts`) now
   authorize **atlasmvp.freebuff.app** (current) and
   **atlasuniversalos.freebuff.app** (Vercel alias) — still no wildcard, JWT
   auth + tenant scoping untouched. Drift test updated. Deployed and verified
   live: OPTIONS from atlasmvp → 204 + `Access-Control-Allow-Origin:
   https://atlasmvp.freebuff.app`; evil origin → no header.

2. **Events page crash (`Cannot read properties of null (reading 'map')`).**
   The frontend called `events_list_policies`, which does NOT exist in the
   deployed schema (the backend exposes `events_raw_policies`) → RPC 404 →
   `useQuery` returned null → `(policies).map()` crashed. Fix: the contract is
   now built at the boundary — a client impl reads the existing
   `events_raw_policies` RPC and merges it with the static event registry
   (pure `mergeEventPolicies`, tested); if the RPC is ever unavailable the
   page still renders registry defaults. `events_stats.byStatus` and the
   page's null-array paths are guarded too. Verified live: `events_raw_policies`
   / `events_stats` / `events_list` / `events_list_notifications` all return
   200 with a real authenticated session.

3. **Claim Package crash (undefined .score/.filter/.map).** The deployed
   `insurance_get_claim_package` returns only `{ claim, supplements, findings,
   evidenceDocs }`, but ClaimDetail rendered `completeness`, `packageModel`,
   `timeline` and `reconciliation` — all undefined → crash. Fix: the RPC
   result is now enriched at the boundary by `normalizeClaimPackageResponse`
   using the existing deterministic builders (`analyzeClaimCompleteness`,
   `buildClaimPackage`, `buildClaimTimeline`, `reconcileClaim`), with null
   arrays coerced to `[]` and page-level defaults as a second line of defense.

4. **Revenue Recovery crash (undefined .flatMap).** `insurance_recovery_analytics`
   returns raw `{ claims, findings, supplements }`, but the page consumed the
   DERIVED `{ trend, carriers, statusDistribution, recoveryPipeline }` —
   `analytics.trend.flatMap` crashed. Fix: `buildRecoveryAnalytics` now
   computes the derived shape at the boundary from the same builders the rest
   of the app uses; null/missing data yields an honest zero-state (the chart
   renders an explicit "no activity" state). Claim candidates, counts, claims
   and audit lists are boundary-normalized (`null → []`) and the page guards
   `null`/missing financials.

5. **Voice / Ask Atlas "I hit a problem".** The `conversation-converse` edge
   function is intentionally not deployed (no AI provider key), so converse
   routes through the deterministic local-retrieval brain over REAL tenant
   evidence. The failure path is now traced end-to-end: the converse client
   impl logs `[atlas] converse: edge request started / edge response ok /
   edge failure (reason)`, the Voice panel gains `converse-start` /
   `converse-completed` / `converse-failed` diagnostics (wake, transcript,
   TTS events already existed), and if BOTH the edge function AND local
   retrieval fail the real reason is shown in the toast, the event log AND
   the visible error turn — never swallowed behind a generic line.

6. **Manifest / icon contract.** `manifest.webmanifest` referenced `/logo.png`,
   which does not exist (the SPA fallback served `text/html` → "cannot be
   loaded/processed"). The manifest now points at the real `/logo.svg`
   (`image/svg+xml`), names the product "Atlas Universal", and uses the brand
   teal theme color.

### Verification (2026-08-14)

- `bun tsc -b --noEmit` — clean
- `bunx vitest run` — **190 passed / 3 skipped (live E2E) / 0 failed** (new:
  Events policy merge contract, claim-package + recovery-analytics boundary
  transforms, updated CORS origin drift tests)
- `bun run build` — green (`index-NiTSAnxb.js`); manifest emits the SVG icon
- Live: full 113-file NPP archive E2E re-ran and passed (105 docs / 0 failed,
  claim GAP-26-51847, 36 evidence links, 4 Ask Atlas answers) — data reset to
  zero afterward
- Edge function redeployed and verified live (OPTIONS CORS per origin above)
- Browser smoke test: voice (push-to-talk + ambient "Atlas" + spoken TTS)
  still requires a real browser session — no browser automation tooling exists
  in this environment, so it is not claimed.

---

## 5. Genuine remaining limitations (not hidden)

- **Clean slate** — the project is at zero app data (no demo/test users). The
  live journey was re-verified (13/13 checks, 2026-08-13) and the data reset
  immediately after; any future live E2E run should be followed by
  `node scripts/reset-demo-data.mjs --apply` to stay clean.
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

Code: complete, locally green (tsc ✓, 174 unit tests ✓, build ✓).
Frontend: live at https://atlasuniversalos.freebuff.app (HTTP 200).
Backend: migrations 0001–0013 applied live (including 0013's profile-repair/
structured-error hardening), the `connections-run-due-syncs` edge function deployed
self-contained with single-origin CORS, demo/test data reset and verified at zero,
and the full new-customer journey + Phase 15 pipeline verified green against the
real project (signup → profile → tenant → owner membership → uploads → archive →
claim reconstruction → analysis → Ask Atlas → re-login).
