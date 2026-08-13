# ATLAS V1 — Vercel Deployment Checklist

Exact sequence for deploying Atlas to Vercel with a production Supabase backend.
No secret values are included in this document.

> **Prerequisite knowledge:** the Supabase project you point at must have the
> migrations applied once (`supabase db push`), which create the schema, RLS
> policies, auth trigger, and all RPCs. Demo data runs via the onboarding flow.

---

## 1. Create the Supabase project
- Supabase dashboard → **New project** → note the project URL
  (e.g. `https://<ref>.supabase.co`) and the **anon** key
  (Project Settings → API).

## 2. Link and push migrations
- With the Supabase CLI installed and logged in:
  ```bash
  supabase link --project-ref <ref>
  supabase db push
  ```
- This applies `supabase/migrations/` in order (schema → RPCs → grants).

## 3. Import the GitHub repository into Vercel
- Vercel Dashboard → **Add New → Project** → import the repo.

## 4. Select the correct framework
- Framework preset: **Vite** (detected automatically from `vite.config.ts`).
- Root directory: repository root.
- Install command: `npm install` (or `bun install` — both lockfiles are
  committed).
- Build command: `npm run build` (which runs `tsc -b && vite build`).
- Output directory: `dist`.

## 5. Add required Vercel environment variables
Add these with **Production / Preview / Development** scopes:
| Variable | Scope |
|---|---|
| `VITE_SUPABASE_URL` | All three |
| `VITE_SUPABASE_ANON_KEY` | All three |
| `VLY_INTEGRATION_KEY` | All three (build plugin needs it) |

See `VERCEL_ENVIRONMENT_VARIABLES.md` for details.

## 6. Configure production Supabase secrets
In the Supabase dashboard → your project → **Edge Functions** secrets (or
Project Settings → Edge Functions → Secrets), set when relevant:
| Variable | Value |
|---|---|
| `VLY_INTEGRATION_KEY` | Your Freebuff/VLY key (if edge functions use it) |
| `GOOGLE_CLIENT_ID` | Only when enabling Google Drive |
| `GOOGLE_CLIENT_SECRET` | Only when enabling Google Drive |

## 7. Configure the Google OAuth production redirect URI
- The OAuth callback is served by the Supabase Edge Function at:
  `https://<your-project>.supabase.co/functions/v1/connections-sync-google-drive/google/oauth/callback`
- Add exactly this URL (plus preview/dev variants if used) to your Google
  Cloud Console OAuth client's **Authorized redirect URIs**.

## 8. Add Google OAuth credentials (only when enabling Drive)
- Google Cloud Console → **APIs & Services → Credentials → OAuth 2.0 Client
  IDs** → create a **Web application** client.
- Copy `Client ID` → `GOOGLE_CLIENT_ID` and `Client secret` →
  `GOOGLE_CLIENT_SECRET` into the Supabase edge secrets (step 6).
- Enable the **Google Drive API** for the project.

## 9. Deploy
- Push to the production branch (or click **Deploy** in Vercel). The build
  runs `tsc -b && vite build` and serves `dist`. There is no separate
  backend deploy step — the backend is the linked Supabase project.

## 10. Verify authentication
- Open the production URL → **Connect Your Company** → complete sign-up or
  sign-in (email/password or anonymous guest). Confirm the redirect lands on
  `/dashboard`.

## 11. Verify onboarding
- Complete the 4-step workspace setup (workspace name → company profile →
  systems → initialize). Confirm the applicable Intelligence Packs activate
  and the manual-upload connection is registered.

## 12. Verify file upload
- Upload a PDF, DOCX, XLSX/XLS, and CSV. Confirm each reaches `ready` and
  entities/assertions appear in Knowledge.

## 13. Verify Ask Atlas
- Ask a cross-source question (e.g. "Who are our largest customers?"). Confirm
  an evidence-backed answer with citations and confidence appears, and that
  history is saved.
- If `VLY_INTEGRATION_KEY` is absent, answers still work via deterministic
  local fallback but are less rich — that is expected behavior, not a bug.

## 14. Verify Google Drive when credentials are configured
- Connections → **Google Drive → Connect** → complete OAuth.
- Confirm status shows **connected**, a sync runs, files appear in Knowledge
  with Drive provenance, and a second sync reports `unchanged` (dedupe works).
- If credentials are not configured, the card must show **Not configured**
  with setup instructions — never a fake "connected" state.

## 15. Verify both themes
- Use the theme toggle: confirm Light and Dark modes apply consistently across
  Landing, Auth, Dashboard, Ask, Knowledge, Connections, Settings, and modals.

## 16. Verify production API/backend connectivity
- Confirm all authenticated screens load data (Dashboard stats, Knowledge
  lists, Audit log) — proving the frontend reaches the production Supabase
  project and that auth tokens are accepted.

---

## Rollback / troubleshooting
- **Migrations fail** → run `supabase db reset` locally to reproduce against a
  fresh database, fix the migration, then `supabase db push` again.
- **App loads but no data / auth loops** → `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_ANON_KEY` point at the wrong project; fix and redeploy.
- **RPC returns 403** → the table lacks an RLS write policy or the function
  needs `security definer` (see the RPC conventions section of the README).
- **Google Drive shows error on connect** → verify the redirect URI matches
  the Supabase edge function URL exactly and Drive API is enabled.
