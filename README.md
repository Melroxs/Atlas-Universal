## Overview

This project uses the following tech stack:
- Vite
- Typescript
- React Router v7 (all imports from `react-router` instead of `react-router-dom`)
- React 19 (for frontend components)
- Tailwind v4 (for styling)
- Shadcn UI (for UI components library)
- Lucide Icons (for icons)
- Supabase (for database, backend RPCs, auth & storage)
- Framer Motion (for animations)
- Three js (for 3d models)

All relevant files live in the 'src' directory.

Use bun for the package manager.

## Setup

The entire backend runs on Supabase: Postgres schema + row-level security + RPC functions (see `supabase/migrations/`) plus Supabase Auth and Storage. The frontend talks to it through `@/lib/api.ts` (the typed function registry) and `@/hooks/use-supabase.ts` (useQuery / useMutation / useAction drop-ins).

### Apply the backend to your Supabase project

1. Create a project at https://supabase.com (free tier is fine).
2. Link the CLI to it (needs a Supabase access token from account settings):

   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```

   `supabase db push` applies everything in `supabase/migrations/` — schema, RLS policies, storage buckets, RPC functions, and the profile auto-create trigger. (Alternatively, run each `supabase/migrations/*.sql` file in the Supabase SQL editor.)

## Environment Variables

Copy `.env.example` to `.env.local` and fill in your Supabase project keys (Settings → API):

- `VITE_SUPABASE_URL` — project URL (e.g. `https://<ref>.supabase.co`)
- `VITE_SUPABASE_ANON_KEY` — the anon/public key

Restart `npm run dev` after adding them. Server-side secrets (`SUPABASE_SERVICE_ROLE_KEY`) are only used by Edge Functions, never by the browser bundle. Without the client keys the app still renders; the `/auth` page shows an honest "not configured" banner.


# Using Authentication (Important!)

You must follow these conventions when using authentication.

## Auth is already set up.

Authentication is fully backed by **Supabase Auth** (email/password sign-up,
sign-in, anonymous guests). The `/auth` page handles all login/sign-up
sequences, and a `handle_new_user` database trigger auto-creates the user's
`profiles` row (including a `tenantId` once a workspace is created).

## Using Supabase Auth on the backend

Auth lives in Postgres: `auth.users` (managed by Supabase Auth) plus the
`profiles`, `tenants`, and `memberships` tables. All data access goes through
RLS-gated Postgres RPCs defined in `supabase/migrations/`. Sign-up triggers,
role checks, and audit logging are all server-side.

## Using Supabase Auth on the frontend

The `/auth` page is already set up to use auth. Navigate to `/auth` for all log in / sign up sequences.

You MUST use this hook to get user data. Never do this yourself without the hook:
```typescript
import { useAuth } from "@/hooks/use-auth";

const { isLoading, isAuthenticated, user, signIn, signOut } = useAuth();
```

## Protected Routes

The starter `/dashboard` route is protected with `RequireAuth`, which sends
signed-out users to `/auth?returnTo=<current route>`. Extend that page for the
product's authenticated experience, and reuse `RequireAuth` when adding another
protected route.

## Auth Page

The auth page is defined in `src/pages/Auth.tsx`. Send sign-in and sign-up actions
to `/auth`.

## Authorization

You can perform authorization checks on the frontend and backend.

On the frontend, you can use the `useAuth` hook to get the current user's data and authentication state.

You should also be protecting queries, mutations, and actions at the base level, checking for authorization securely.

## Adding a redirect after auth

The `/auth` route in `src/main.tsx` redirects to `/dashboard` by default. If the
product's main authenticated route is different, update `redirectAfterAuth` to
that route. A validated same-origin `returnTo` query parameter takes priority so
users can resume the protected page they originally requested. Never leave an
authenticated product redirecting back to the public landing page.

## Complete authenticated products

When the requested product implies accounts, a workspace, a dashboard, or other
signed-in functionality, the task is not complete with only a landing page and
auth form. Build the main authenticated experience, protect its route, and verify
that signing in reaches it.

# Frontend Conventions

You will be using the Vite frontend with React 19, Tailwind v4, and Shadcn UI.

Generally, pages should be in the `src/pages` folder, and components should be in the `src/components` folder.

Shadcn primitives are located in the `src/components/ui` folder and should be used by default.

## Page routing

Your page component should go under the `src/pages` folder.

When adding a page, update the react router configuration in `src/main.tsx` to include the new route you just added.

## Shad CN conventions

Follow these conventions when using Shad CN components, which you should use by default.
- Remember to use "cursor-pointer" to make the element clickable
- For title text, use the "tracking-tight font-bold" class to make the text more readable
- Always make apps MOBILE RESPONSIVE. This is important
- AVOID NESTED CARDS. Try and not to nest cards, borders, components, etc. Nested cards add clutter and make the app look messy.
- AVOID SHADOWS. Avoid adding any shadows to components. stick with a thin border without the shadow.
- Avoid skeletons; instead, use the loader2 component to show a spinning loading state when loading data.


## Landing Pages

You must always create good-looking designer-level styles to your application. 
- Make it well animated and fit a certain "theme", ie neo brutalist, retro, neumorphism, glass morphism, etc

Use known images and emojis from online.

If the user is logged in already, show the get started button to say "Dashboard" or "Profile" instead to take them there.

## Responsiveness and formatting

Make sure pages are wrapped in a container to prevent the width stretching out on wide screens. Always make sure they are centered aligned and not off-center.

Always make sure that your designs are mobile responsive. Verify the formatting to ensure it has correct max and min widths as well as mobile responsiveness.

- Always create sidebars for protected dashboard pages and navigate between pages
- Always create navbars for landing pages
- On these bars, the created logo should be clickable and redirect to the index page

## Animating with Framer Motion

You must add animations to components using Framer Motion. It is already installed and configured in the project.

To use it, import the `motion` component from `framer-motion` and use it to wrap the component you want to animate.


### Other Items to animate
- Fade in and Fade Out
- Slide in and Slide Out animations
- Rendering animations
- Button clicks and UI elements

Animate for all components, including on landing page and app pages.

## Three JS Graphics

Your app comes with three js by default. You can use it to create 3D graphics for landing pages, games, etc.


## Colors

You can override colors in: `src/index.css`

This uses the oklch color format for tailwind v4.

Always use these color variable names.

Make sure all ui components are set up to be mobile responsive and compatible with both light and dark mode.

Set theme using `dark` or `light` variables at the parent className.

## Styling and Theming

When changing the theme, always change the underlying theme of the shad cn components app-wide under `src/components/ui` and the colors in the index.css file.

Avoid hardcoding in colors unless necessary for a use case, and properly implement themes through the underlying shad cn ui components.

When styling, ensure buttons and clickable items have pointer-click on them (don't by default).

Always follow a set theme style and ensure it is tuned to the user's liking.

## Toasts

You should always use toasts to display results to the user, such as confirmations, results, errors, etc.

Use the shad cn Sonner component as the toaster. For example:

```
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
export function SonnerDemo() {
  return (
    <Button
      variant="outline"
      onClick={() =>
        toast("Event has been created", {
          description: "Sunday, December 03, 2023 at 9:00 AM",
          action: {
            label: "Undo",
            onClick: () => console.log("Undo"),
          },
        })
      }
    >
      Show Toast
    </Button>
  )
}
```

Remember to import { toast } from "sonner". Usage: `toast("Event has been created.")`

## Dialogs

Always ensure your larger dialogs have a scroll in its content to ensure that its content fits the screen size. Make sure that the content is not cut off from the screen.

Ideally, instead of using a new page, use a Dialog instead. 

# Using the Supabase backend

All backend logic is Postgres. The schema and every RPC live in
`supabase/migrations/` (numbered, applied in order by `supabase db push`).

## The schema

Tables keep the app's existing contract: `_id uuid` primary keys, `_creationTime`
epoch-ms bigints, camelCase columns. Row Level Security is enabled on every
table; the `anon`/`authenticated` roles get base GRANTs (0007) and RLS policies
gate every read/write to the caller's own workspace.

## RPC conventions

- Read hooks and write mutations call Postgres RPCs through the registry in
  `src/lib/api.ts` — the single typed contract between the frontend and backend
  (the old Convex codegen equivalent).
- Function names are snake_case (`tenants_get_my_workspace`); parameters are
  `p_camelCase`; the data layer sends them lowercased (Postgres folds unquoted
  param names).
- RPCs that write on behalf of the caller run `security definer` with explicit
  `auth.uid()` / role checks inside, so RLS can't block bootstrap operations
  (e.g. creating your own tenant).
- Write RPCs log to `auditLogs` via `log_audit`; roles are enforced with
  `my_member_role()`.

## Common mistakes to avoid

- Don't call `supabase.rpc` directly from pages — go through `src/lib/api.ts`.
- RPC params are `p_`-prefixed and folded to lowercase by Postgres; keep the
  `toRpcArgs` normalization in `src/hooks/use-supabase.ts` in sync.
- jsonb patch updates must use `v #>> '{}'` (not `v::text`) or string values get
  double-encoded with literal quotes.
- Tables with RLS but no write policy (e.g. `intelligencePacks`) require
  `security definer` RPCs — never add per-user INSERT policies to global
  catalog tables.
- Typecheck with `npx tsc -b --noEmit` and run `npm test` before pushing
  migrations.

---

# Atlas V1 Production Deployment

Atlas V1 is a Vite + React SPA backed by **Supabase** (Postgres, Auth, Storage,
Edge Functions). This section documents how the production baseline is
deployed and how future changes ship.

## Architecture

```
GitHub
   \|
   v
Vercel  ──►  serves the built SPA (dist/)
   \|
   v
Supabase ──► Postgres (schema + RPCs) · Auth · Storage · Edge Functions
   \|
   v
Atlas application
```

All data and auth logic lives in Postgres (`supabase/migrations/`): tables,
RLS policies, and the RPCs the frontend calls. Vercel only builds and hosts the
frontend; the frontend talks to Supabase through `VITE_SUPABASE_URL`.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in values (see manifest below)
supabase start                # local Supabase stack (Docker)
supabase db reset             # apply migrations from scratch
npm run dev                   # Vite dev server
```

The local stack's keys go into `.env.local` as `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`. Migrations are versioned in `supabase/migrations/`
and applied in order.

## Environment variables

> Names only — values live in the Supabase project dashboard, Vercel project
> settings, and the project's Keys/API keys UI. Never commit secrets.

### Frontend / public (safe in the browser)

| Variable                   | Used by                        | Notes                                       |
| -------------------------- | ------------------------------ | ------------------------------------------- |
| `VITE_SUPABASE_URL`        | `src/lib/supabase.ts`          | Supabase project URL baked into the build.   |
| `VITE_SUPABASE_ANON_KEY`   | `src/lib/supabase.ts`          | Public anon key (RLS protects the data).    |
| `VITE_VLY_APP_ID`          | `src/instrumentation.tsx`      | Freebuff app id for instrumentation (public). |
| `VITE_VLY_MONITORING_URL`  | `src/instrumentation.tsx`      | Freebuff monitoring endpoint (public).       |

### Supabase project (secrets — Supabase dashboard → Project Settings)

| Variable                  | Used in                          | Notes                                        |
| ------------------------- | -------------------------------- | -------------------------------------------- |
| `GOOGLE_CLIENT_ID`        | Google Drive connector           | Google OAuth client ID (server-side).        |
| `GOOGLE_CLIENT_SECRET`    | Google Drive connector           | Google OAuth client secret (server-side).    |

Additional connector credentials are defined centrally in `src/lib/atlas-data/connectors-registry.ts`. The Connections page shows **"Not configured"** until the relevant variables exist, and **"Authorization required"** once they do — status is never faked. Roadmap connectors below are fully documented (real APIs, scopes, auth endpoints) but have no client yet:

| Variable | Connector | Purpose |
|---|---|---|
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` / `MICROSOFT_TENANT_ID` | Microsoft 365 (roadmap) | Entra app credentials for OneDrive/SharePoint via Graph. |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | Slack (roadmap) | Slack OAuth app credentials. |
| `HUBSPOT_CLIENT_ID` / `HUBSPOT_CLIENT_SECRET` | HubSpot (roadmap) | HubSpot OAuth app credentials (CRM). |
| `QUICKBOOKS_CLIENT_ID` / `QUICKBOOKS_CLIENT_SECRET` | QuickBooks (roadmap) | Intuit OAuth app credentials (accounting). |
| `STRIPE_SECRET_KEY` | Stripe (roadmap) | Stripe secret API key — server-side only, never a publishable key. |
| `DROPBOX_CLIENT_ID` / `DROPBOX_CLIENT_SECRET` | Dropbox (roadmap) | Dropbox OAuth app credentials. |
| `NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET` | Notion (roadmap) | Notion OAuth integration credentials. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub (roadmap) | GitHub OAuth app credentials. |

## Google OAuth setup

1. Create an OAuth 2.0 Client ID in Google Cloud Console (Desktop/Web app).
2. Add the authorized redirect URI — derived at runtime from `VITE_SUPABASE_URL`,
   so register exactly:
   `https://<your-project>.supabase.co/functions/v1/connections-sync-google-drive/google/oauth/callback`
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the Supabase project's
   Edge Function secrets.

Drive connects with `drive.readonly` scope. Connectors are only ever shown as
"connected" after a real OAuth exchange — no simulated syncs exist.

## Supabase migrations

- **Development:** `supabase start` runs the local stack; `supabase db push`
  applies pending migrations, `supabase db reset` rebuilds from scratch.
- **Production:** `supabase db push --linked` applies migrations to the linked
  project; Edge Functions deploy with `supabase functions deploy`.

## Vercel deployment

1. Push the repository to GitHub (see Git workflow below).
2. In Vercel, **Import Project** → pick the Atlas repo. Vercel auto-detects
   Vite; output directory is `dist` (see `vercel.json` SPA rewrite).
3. **Build command:**
   ```
   npm run build
   ```
   The frontend build is `tsc -b && vite build`; it needs `VITE_SUPABASE_URL`
   and `VITE_SUPABASE_ANON_KEY` available at build time.
4. **Environment variables on Vercel:**
   - `VITE_SUPABASE_URL` — production Supabase project URL (public)
   - `VITE_SUPABASE_ANON_KEY` — public anon key (RLS protects the data)
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — server-side, if Drive ships
5. Deploy. Every subsequent push to the production branch triggers the same
   build automatically.

### Deployment flow for future changes

```
Change code → validate locally (tsc + build + supabase db reset) → commit → push GitHub
   → Vercel builds automatically → supabase db push (apply migrations) → live Atlas
```

## Git workflow

- Intended repository: `https://github.com/Melroxs/ATLAS-YC-MVP.git`
- The production baseline commit is: `feat: finalize Atlas V1 production baseline`
- Never force-push, never rewrite published history, never commit `.env*`
  files or keys (see `.gitignore`).
- This workspace manages version control through the platform; to push from a
  local clone:
  ```bash
  git init && git add -A
  git commit -m "feat: finalize Atlas V1 production baseline"
  git remote add origin https://github.com/Melroxs/ATLAS-YC-MVP.git
  git branch -M main
  git push -u origin main
  ```

## Known V1 limitations

- **Connectors:** Google Drive (OAuth, change detection, dedupe, sync) is the
  only implemented connector. CRM / accounting / PM / email / communication
  connectors are catalog entries only ("coming soon") — nothing is faked.
- **OCR:** Scanned PDFs report an honest error when no text layer exists; OCR
  credentials are not configured yet (the ingestion pipeline in
  `src/lib/actions/ingestion.ts` has the hook).
- **Legacy formats:** `.doc` (old Word) is not supported; save as `.docx`.
- **AI:** Ask Atlas and extraction degrade to deterministic heuristics when
  `VLY_INTEGRATION_KEY` is not configured.
- **Background jobs:** connector sync is triggered on app load / after OAuth
  connect; scheduled cron sync is not enabled on the deployment.
- **Auth:** email/password sign-up + anonymous guests (Supabase Auth). Google
  Drive OAuth is separate from app sign-in.
