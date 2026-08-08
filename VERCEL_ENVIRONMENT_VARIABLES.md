# ATLAS — Vercel Environment Variable Manifest

Complete inventory of every environment variable referenced by the Atlas V1
codebase, where each one must be configured, and where to obtain the value.

**Where things run:**
- **Vercel** — builds the frontend (`vite build`) and serves the static site.
  `VITE_*` variables are baked into the bundle at build time.
- **Convex** — runs all backend code (mutations, queries, actions, HTTP routes).
  Server-side `process.env` variables **must** be set in the **Convex dashboard**
  (Deployments → your deployment → Settings → Environment Variables), per
  environment (Production / Preview / Development), **not** in Vercel.
- **Both** — variables the build needs *and* the backend needs at runtime.

## Variable table

| Variable | Environment | Required | Secret | Purpose | Where to obtain |
|---|---|---|---|---|---|
| `VITE_CONVEX_URL` | Vercel (Prod, Preview, Dev) | ✅ Required | No | Browser-facing Convex deployment URL (`https://<project>.convex.cloud`) | Convex dashboard → Deployments → URL |
| `CONVEX_SITE_URL` | Convex (auto-provided) | ✅ Required* | No | Deployment URL used by the self-issuing auth provider (OIDC discovery) | Auto-injected by Convex; do not set manually |
| `CONVEX_DEPLOY_KEY` | Vercel / CI | ✅ Required | **Yes** | Authenticates `npx convex deploy` so backend functions are pushed from builds | Convex dashboard → Settings → Deploy Key, or auto-set by the Convex Vercel integration |
| `CONVEX_DEPLOY_URL` | Vercel / CI (optional) | Optional | No | Override URL used by the deploy integration | Auto-set by the Convex Vercel integration |
| `VLY_INTEGRATION_KEY` | Convex **and** Vercel (build) | ✅ Required for AI | **Yes** | Freebuff/VLY gateway key for AI completions, embeddings and usage billing; also read by the Vite plugin at build | Freebuff platform / integration settings |
| `VLY_INTEGRATION_BASE_URL` | Convex | Optional | No | VLY gateway base URL override (default `https://integrations.freebuff.com/`) | Freebuff platform (rarely needed) |
| `VLY_EMAIL_API_KEY` | Convex | ✅ Required for email OTP | **Yes** | API key for the Freebuff email OTP service (`auth.freebuff.app/send_otp`) | Freebuff platform — obtain from your Freebuff dashboard or API settings |
| `VLY_APP_NAME` | Convex | Optional | No | App name shown in one-time-code emails (default `"a freebuff.com application"`) | Your choice |
| `VLY_CONVEX_AUTH_ISSUER` | Convex | Optional | No | Issuer for the custom-JWT auth provider (default `https://freebuff.com`) | Only if you issue your own federated tokens |
| `GOOGLE_CLIENT_ID` | Convex | Optional | Yes* | Google Drive OAuth client ID | Google Cloud Console → APIs & Services → Credentials |
| `GOOGLE_CLIENT_SECRET` | Convex | Optional | **Yes** | Google Drive OAuth client secret | Google Cloud Console → APIs & Services → Credentials |
| `NODE_ENV` | Runtime (auto) | — | No | Set by the runtime; enables VLY debug logging in dev | Auto-provided |

\* `GOOGLE_CLIENT_ID` is not a "secret" per se but is sensitive; treat both Google
values as secrets and never expose them to the browser.

## Environment scoping

### Production (Vercel: `Production` scope / Convex: `Production` environment)
| Variable | Configured in |
|---|---|
| `VITE_CONVEX_URL` | Vercel |
| `CONVEX_DEPLOY_KEY` | Vercel (or auto by integration) |
| `CONVEX_DEPLOY_URL` | Vercel (auto by integration) |
| `VLY_INTEGRATION_KEY` | **Both** Vercel (build) and Convex |
| `VLY_INTEGRATION_BASE_URL` | Convex |
| `VLY_EMAIL_API_KEY` | Convex |
| `VLY_APP_NAME` | Convex |
| `VLY_CONVEX_AUTH_ISSUER` | Convex (only if changed) |
| `GOOGLE_CLIENT_ID` | Convex |
| `GOOGLE_CLIENT_SECRET` | Convex |
| `CONVEX_SITE_URL` | Auto-provided by Convex |

### Preview (Vercel: `Preview` scope / Convex: `Preview` environment)
Same set as Production. For preview deployments that point at a separate
Convex deployment, set `VITE_CONVEX_URL` to that preview deployment's URL.
Google Drive credentials may be omitted on preview unless you want Drive to
work there too (each environment resolves its own redirect URI).

### Development (Vercel: `Development` scope / Convex: `Development` environment)
Same set, plus locally:
- `.env.local` with `VITE_CONVEX_URL` and (optionally) `CONVEX_DEPLOYMENT` for
  `npx convex dev`.
- Local `convex dev` deployments have `CONVEX_SITE_URL` injected automatically.

## Notes

- **Never** put secrets in `.env.example` (it is committed to GitHub).
- `VLY_EMAIL_API_KEY` was formerly hardcoded in `src/convex/auth/emailOtp.ts`.
  It has been moved to an environment variable for security. It must be set in
  the **Convex** environment (not Vercel) since email sending runs server-side.
- The Google OAuth callback route lives on Convex
  (`/google/oauth/callback`), so the **redirect URI** to register in Google
  Cloud Console is the **`*.convex.site`** URL
  (`https://<project>.convex.site/google/oauth/callback`), *not* the Vercel
  URL.
- Storage (file uploads) uses Convex's built-in `_storage` — **no** env vars.
- OCR: no engine is configured (`src/convex/lib/ocr.ts`), so **no** OCR env
  vars exist today. When an engine is wired in, add its key here.
