# ATLAS V1 — Vercel Deployment Checklist

Exact sequence for deploying Atlas to Vercel with a production Convex backend.
No secret values are included in this document.

> **Prerequisite knowledge:** the Convex deployment you point at must have
> auth, schema and seed applied once (the app creates its own tables on first
> deploy; the seed/demo data runs via the onboarding flow).

---

## 1. Import the GitHub repository into Vercel
- Vercel Dashboard → **Add New → Project** → import the repo.

## 2. Select the correct framework
- Framework preset: **Vite** (detected automatically from `vite.config.ts`).
- Root directory: repository root.

## 3. Configure the build command
- Build command: `bun run build` (which runs `tsc -b && vite build`).
- Install command: `bun install` (the repo uses Bun; omit if you prefer
  Vercel's default `npm install` — `package-lock.json` is not present, so
  stick with `bun install` or run `npm i` once and commit a lockfile).
- Leave Node version at the Vercel default or pin `>= 20`.

## 4. Configure the output directory
- Output directory: `dist` (Vite's default; usually auto-detected).

## 5. Add required Vercel environment variables
Add these with **Production / Preview / Development** scopes:
| Variable | Scope |
|---|---|
| `VITE_CONVEX_URL` | All three |
| `VLY_INTEGRATION_KEY` | All three (build plugin needs it) |
| `CONVEX_DEPLOY_KEY` | All three (or auto-set in step 6) |

See `VERCEL_ENVIRONMENT_VARIABLES.md` for details.

## 6. Configure the Convex production deployment
- In the **Convex dashboard** (`https://dashboard.convex.dev`), create/locate
  the production deployment and note its URL (e.g. `https://atlas-xxx.convex.cloud`).
- Set `VITE_CONVEX_URL` in Vercel to that URL.

## 7. Add the required `CONVEX_DEPLOY_KEY`
- Convex dashboard → your deployment → **Settings → Deploy Key** → copy the key.
- Paste it into Vercel as `CONVEX_DEPLOY_KEY` (Secret). Do **not** commit it.
- **Alternative (recommended):** Convex dashboard → **Deploy → Vercel** — the
  official integration auto-creates the Vercel project, sets
  `CONVEX_DEPLOY_KEY` / `CONVEX_DEPLOY_URL`, and configures
  `npx convex deploy --cmd "npm run build"` for you.

## 8. Configure production Convex environment variables
In the Convex dashboard → your deployment → **Settings → Environment
Variables** → **Production** environment, set:
| Variable | Value |
|---|---|
| `VLY_INTEGRATION_KEY` | Your Freebuff/VLY key |
| `VLY_INTEGRATION_BASE_URL` | Optional override (default set by provider) |
| `VLY_APP_NAME` | e.g. `Atlas` |
| `VLY_CONVEX_AUTH_ISSUER` | Only if you use a custom federated JWT issuer |
| `GOOGLE_CLIENT_ID` | Only when enabling Google Drive |
| `GOOGLE_CLIENT_SECRET` | Only when enabling Google Drive |

Repeat for the **Preview** and **Development** environments if those
deployments should behave identically. `CONVEX_SITE_URL` is injected
automatically — do not set it.

## 9. Configure the Google OAuth production redirect URI
- The OAuth callback is served by **Convex** at:
  `https://<your-production-deployment>.convex.site/google/oauth/callback`
- Add exactly this URL (plus preview/dev variants if used) to your Google
  Cloud Console OAuth client's **Authorized redirect URIs**.

## 10. Add Google OAuth credentials
- Google Cloud Console → **APIs & Services → Credentials → OAuth 2.0 Client
  IDs** → create a **Web application** client.
- Copy `Client ID` → `GOOGLE_CLIENT_ID` and `Client secret` →
  `GOOGLE_CLIENT_SECRET` into the Convex environment (step 8).
- Enable the **Google Drive API** for the project.

## 11. Deploy
- Push to the production branch (or click **Deploy** in Vercel). The build
  runs `npx convex deploy` (functions push) then `vite build` and serves
  `dist`.

## 12. Verify authentication
- Open the production URL → **Connect Your Company** → complete sign-in
  (email OTP or federated token). Confirm the redirect lands on `/dashboard`.

## 13. Verify onboarding
- Complete the 4-step workspace setup (company profile → systems → initialize).
- Confirm the applicable Intelligence Packs activate and the manual-upload
  connection is registered.

## 14. Verify file upload
- Upload a PDF, DOCX, XLSX/XLS, and CSV. Confirm each reaches `ready` and
  entities/assertions appear in Knowledge.

## 15. Verify Ask Atlas
- Ask a cross-source question (e.g. "Who are our largest customers?"). Confirm
  an evidence-backed answer with citations and confidence appears, and that
  history is saved.
- If `VLY_INTEGRATION_KEY` is absent, answers still work via deterministic
  local fallback but are less rich — that is expected behavior, not a bug.

## 16. Verify Google Drive when credentials are configured
- Connections → **Google Drive → Connect** → complete OAuth.
- Confirm status shows **connected**, a sync runs, files appear in Knowledge
  with Drive provenance, and a second sync reports `unchanged` (dedupe works).
- If credentials are not configured, the card must show **Not configured**
  with setup instructions — never a fake "connected" state.

## 17. Verify both themes
- Use the theme toggle: confirm Light and Dark modes apply consistently across
  Landing, Auth, Dashboard, Ask, Knowledge, Connections, Settings, and modals.

## 18. Verify production API/backend connectivity
- Confirm all authenticated screens load data (Dashboard stats, Knowledge
  lists, Audit log) — proving the frontend reaches the production Convex
  deployment and that auth tokens are accepted.

---

## Rollback / troubleshooting
- **Build fails on `convex deploy`** → check `CONVEX_DEPLOY_KEY` is set in
  Vercel and matches the target deployment.
- **App loads but no data / auth loops** → `VITE_CONVEX_URL` points at the
  wrong (e.g. dev) deployment; fix and redeploy.
- **Google Drive shows error on connect** → verify redirect URI matches the
  `*.convex.site` URL exactly and Drive API is enabled.
- **Emails not sending** → confirm the Freebuff email endpoint key in
  `src/convex/auth/emailOtp.ts` is still valid (see audit note) and
  `VLY_APP_NAME` if customized.
