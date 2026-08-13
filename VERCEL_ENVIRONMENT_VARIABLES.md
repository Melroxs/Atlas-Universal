# ATLAS — Vercel Environment Variable Manifest

Complete inventory of every environment variable referenced by the Atlas V1
codebase, where each one must be configured, and where to obtain the value.

**Where things run:**
- **Vercel** — builds the frontend (`vite build`) and serves the static site.
  `VITE_*` variables are baked into the bundle at build time.
- **Supabase** — Postgres schema, RLS, RPCs and Auth are managed in the
  Supabase project (via `supabase/migrations/`). Edge Functions read their
  secrets from the Supabase dashboard (Project Settings → Edge Functions →
  Secrets).
- **Both** — variables the build needs *and* the backend needs at runtime.

## Variable table

| Variable | Environment | Required | Secret | Purpose | Where to obtain |
|---|---|---|---|---|---|
| `VITE_SUPABASE_URL` | Vercel (Prod, Preview, Dev) | ✅ Required | No | Supabase project URL (`https://<ref>.supabase.co`) | Supabase dashboard → Project Settings → API |
| `VITE_SUPABASE_ANON_KEY` | Vercel (Prod, Preview, Dev) | ✅ Required | No* | Public anon key for the browser client; RLS gates all data | Supabase dashboard → Project Settings → API |
| `VLY_INTEGRATION_KEY` | Supabase edge secrets (build plugin may also read it) | ✅ Required for AI | **Yes** | Freebuff/VLY gateway key for AI completions, embeddings and usage billing | Freebuff platform / integration settings |
| `VLY_INTEGRATION_BASE_URL` | Supabase edge secrets | Optional | No | VLY gateway base URL override (default `https://integrations.freebuff.com/`) | Freebuff platform (rarely needed) |
| `GOOGLE_CLIENT_ID` | Supabase edge secrets | Optional | Yes* | Google Drive OAuth client ID | Google Cloud Console → APIs & Services → Credentials |
| `GOOGLE_CLIENT_SECRET` | Supabase edge secrets | Optional | **Yes** | Google Drive OAuth client secret | Google Cloud Console → APIs & Services → Credentials |
| `NODE_ENV` | Runtime (auto) | — | No | Set by the runtime; enables VLY debug logging in dev | Auto-provided |

\* The anon key and `GOOGLE_CLIENT_ID` are not "secrets" per se, but treat all
non-`VITE_` values as secrets and never expose them to the browser.

## Environment scoping

### Production (Vercel: `Production` scope)
| Variable | Configured in |
|---|---|
| `VITE_SUPABASE_URL` | Vercel |
| `VITE_SUPABASE_ANON_KEY` | Vercel |
| `VLY_INTEGRATION_KEY` | Supabase edge secrets |
| `VLY_INTEGRATION_BASE_URL` | Supabase edge secrets |
| `GOOGLE_CLIENT_ID` | Supabase edge secrets (only when Drive is enabled) |
| `GOOGLE_CLIENT_SECRET` | Supabase edge secrets (only when Drive is enabled) |

### Preview (Vercel: `Preview` scope)
Same set as Production. Preview deployments can point at a separate Supabase
project by overriding `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. Google
Drive credentials may be omitted on preview unless you want Drive to work
there too (each environment resolves its own redirect URI).

### Development (Vercel: `Development` scope / local)
Same set, plus locally:
- `.env.local` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from
  `supabase start` (or your project's API keys).

## Notes

- **Never** put secrets in `.env.example` (it is committed to GitHub).
- All database access is via RLS-gated Postgres RPCs — there are no backend
  database credentials in the frontend.
- Storage (file uploads) uses Supabase Storage buckets with tenant-scoped
  RLS policies — **no** env vars.
- OCR: no engine is configured, so **no** OCR env vars exist today. When an
  engine is wired in, add its key here.
