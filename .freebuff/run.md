# Run doc — Atlas (Supabase migration)

## Reproduce the uncommitted artifacts

A fresh checkout needs nothing beyond a dependency install — there is no
`.env.local` or other secret file in the repo. To make auth/data work live,
copy `.env.example` to `.env.local` and fill in real Supabase project keys
(`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — copy from the Supabase
project dashboard → Settings → API). Without those keys the Auth page shows
an honest "not configured" banner and the app still renders.

The backend schema must be applied to the project first:
`supabase login` → `supabase link --project-ref <ref>` → `supabase db push`
(applies supabase/migrations/).

Steps:

1. Install dependencies with npm:

   ```bash
   npm install --no-audit --no-fund
   ```

   (The repo has both `bun.lock` and a stale `package-lock.json`; the running
   environment has only `npm`, so `npm install` is the working path and
   regenerates `package-lock.json`.)

2. No build step is required before `dev` — Vite compiles on demand.

## Run the server

Vite dev server on the default port:

```bash
npm run dev
```

Serves on http://localhost:5173 (default `vite` port; Vite picks 5174/5175
if taken). Restart the dev server after changing `.env.local` — Vite only
loads env vars at server start. Detached launch used for previews:

```powershell
powershell -NoProfile -Command "(Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -RedirectStandardOutput '<log>' -RedirectStandardError '<log>.err' -WindowStyle Hidden -PassThru).Id"
```

stdout and stderr must go to DIFFERENT files.

Notes:

- The app is a Vite + React SPA. No backend process is needed to view it —
  data calls go to Supabase and are no-ops without configured env keys.
- `npm run build` (vite build) and `npx tsc -b --noEmit` both pass.
