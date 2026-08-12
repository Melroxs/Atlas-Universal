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

All convex authentication functions are already set up. The auth currently uses email OTP and anonymous users, but can support more.

The email OTP configuration is defined in `src/convex/auth/emailOtp.ts`. DO NOT MODIFY THIS FILE.

Also, DO NOT MODIFY THESE AUTH FILES: `src/convex/auth.config.ts` and `src/convex/auth.ts`.

## Using Convex Auth on the backend

On the `src/convex/users.ts` file, you can use the `getCurrentUser` function to get the current user's data.

## Using Convex Auth on the frontend

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

# Using the Convex backend

You will be implementing the convex backend. Follow your knowledge of convex and the documentation to implement the backend.

## The Convex Schema

You must correctly follow the convex schema implementation.

The schema is defined in `src/convex/schema.ts`.

Do not include the `_id` and `_creationTime` fields in your queries (it is included by default for each table).
Do not index `_creationTime` as it is indexed for you. Never have duplicate indexes.


## Convex Actions: Using CRUD operations

When running anything that involves external connections, you must use a convex action with "use node" at the top of the file.

You cannot have queries or mutations in the same file as a "use node" action file. Thus, you must use pre-built queries and mutations in other files.

You can also use the pre-installed internal crud functions for the database:

```ts
// in convex/users.ts
import { crud } from "convex-helpers/server/crud";
import schema from "./schema.ts";

export const { create, read, update, destroy } = crud(schema, "users");

// in some file, in an action:
const user = await ctx.runQuery(internal.users.read, { id: userId });

await ctx.runMutation(internal.users.update, {
  id: userId,
  patch: {
    status: "inactive",
  },
});
```


## Common Convex Mistakes To Avoid

When using convex, make sure:
- Document IDs are referenced as `_id` field, not `id`.
- Document ID types are referenced as `Id<"TableName">`, not `string`.
- Document object types are referenced as `Doc<"TableName">`.
- Keep schemaValidation to false in the schema file.
- You must correctly type your code so that it passes the type checker.
- You must handle null / undefined cases of your convex queries for both frontend and backend, or else it will throw an error that your data could be null or undefined.
- Always use the `@/folder` path, with `@/convex/folder/file.ts` syntax for importing convex files.
- This includes importing generated files like `@/convex/_generated/server`, `@/convex/_generated/api`
- Remember to import functions like useQuery, useMutation, useAction, etc. from `convex/react`
- NEVER have return type validators.

---

# Atlas V1 Production Deployment

Atlas V1 is a Vite + React SPA with a Convex backend. This section documents
how the production baseline is deployed and how future changes ship.

## Architecture

```
GitHub
   \|
   v
Vercel  ──►  serves the built SPA (dist/)
   \|
   v
Convex  ──►  database / functions / actions / storage
   \|
   v
Atlas application
```

Everything in `src/convex/` (schema, queries, mutations, actions, HTTP routes,
auth, Google Drive sync, Ask Atlas) runs on Convex. Vercel only builds and
hosts the frontend; the frontend talks to Convex through `VITE_CONVEX_URL`.

## Local development

```bash
bun install
cp .env.example .env.local   # fill in values (see manifest below)
bunx convex dev               # local Convex backend + regenerates code
bun run dev                   # Vite dev server
```

`src/convex/_generated/` is intentionally gitignored — the Convex CLI
regenerates it (`convex dev` locally, `convex deploy` on Vercel).

## Environment variables

> Names only — values live in the Convex dashboard, Vercel project settings,
> and the project's Keys/API keys UI. Never commit secrets.

### Frontend / public (safe in the browser)

| Variable                   | Used by                        | Notes                                       |
| -------------------------- | ------------------------------ | ------------------------------------------- |
| `VITE_CONVEX_URL`          | `src/main.tsx`, `src/pages/Connections.tsx` | Convex deployment URL baked into the build. |
| `VITE_VLY_APP_ID`          | `src/instrumentation.tsx`      | Freebuff app id for instrumentation (public). |
| `VITE_VLY_MONITORING_URL`  | `src/instrumentation.tsx`      | Freebuff monitoring endpoint (public).       |

### Convex CLI / deployment tooling

| Variable                | Notes                                                        |
| ----------------------- | ------------------------------------------------------------ |
| `CONVEX_DEPLOYMENT`     | Deployment URL used by `npx convex dev` / `convex deploy`. On Vercel set this to the **production** deployment URL (e.g. `https://<deployment>.convex.cloud`). |
| `CONVEX_DEPLOY_KEY`     | Deploy key for non-interactive `convex deploy` in CI (Convex dashboard → Deployment → Settings → Deploy Keys). Required for Vercel builds. |

### Convex server (secrets — Convex dashboard → Environment Variables)

| Variable                     | Used in                    | Notes                                                        |
| ---------------------------- | -------------------------- | ------------------------------------------------------------ |
| `CONVEX_SITE_URL`            | `src/convex/auth.config.ts`| Origin this app runs at (Convex Auth JWT issuer). Local: `http://localhost:5173`; production: the Vercel URL. |
| `VLY_CONVEX_AUTH_ISSUER`     | `src/convex/auth.config.ts`| Optional. Freebuff federated-auth issuer (defaults to `https://freebuff.com`). |
| `VLY_APP_NAME`               | `src/convex/auth/emailOtp.ts` | Optional. App name shown in emailed one-time passcodes. || `VLY_EMAIL_API_KEY`        | `src/convex/auth/emailOtp.ts` | **Required.** Freebuff email-relay key used to send OTP codes. Server-side only — never in `VITE_` form. |
| `VLY_INTEGRATION_KEY`      | `src/convex/ai/provider.ts`   | Freebuff AI gateway key (auto-injected). Absent ⇒ Ask Atlas and extraction fall back to deterministic heuristics. |
| `VLY_INTEGRATION_BASE_URL`   | `src/lib/vly-integrations.ts` | Optional gateway base URL override. |
| `GOOGLE_CLIENT_ID`           | `src/convex/http.ts`, `connections.ts`, `connectionsSync.ts` | Google OAuth client ID for the Google Drive connector. |
| `GOOGLE_CLIENT_SECRET`       | same as above              | Google OAuth client secret (server-side only). |

Additional connector credentials are defined centrally in `src/convex/connectors/registry.ts`. The Connections page shows **"Not configured"** until the relevant variables exist, and **"Authorization required"** once they do — status is never faked. Roadmap connectors below are fully documented (real APIs, scopes, auth endpoints) but have no client yet:

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
2. Add the authorized redirect URI — it is derived at runtime from the Convex
   site URL, so register exactly:
   `https://<your-deployment>.convex.cloud/google/oauth/callback`
   (dev: `http://localhost:5173`-equivalent Convex URL + same path).
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the Convex deployment
   (dev dashboard and production dashboard).

Drive connects with `drive.readonly` scope. Connectors are only ever shown as
"connected" after a real OAuth exchange — no simulated syncs exist.

## Convex deployments

- **Development:** `bunx convex dev` creates/runs the dev deployment and
  regenerates `src/convex/_generated/`.
- **Production:** `npx convex deploy` uploads functions to the deployment in
  `CONVEX_DEPLOYMENT`. Server env vars for production are set in the Convex
  dashboard for that deployment.

## Vercel deployment

1. Push the repository to GitHub (see Git workflow below).
2. In Vercel, **Import Project** → pick the Atlas repo. Vercel auto-detects
   Vite; output directory is `dist` (see `vercel.json` SPA rewrite).
3. **Build command:**
   ```
   npx convex deploy --cmd "npm run build" --yes
   ```
   This deploys the Convex functions to the production deployment first, then
   runs the existing frontend build (`tsc -b && vite build`) with
   `VITE_CONVEX_URL` available at build time.
4. **Environment variables on Vercel:**
   - `CONVEX_DEPLOYMENT` — production Convex deployment URL
   - `CONVEX_DEPLOY_KEY` — deploy key (non-interactive auth for step 3)
   - `VITE_CONVEX_URL` — same production URL (public, for the frontend build)
   - `CONVEX_SITE_URL` — the Vercel production URL (e.g. `https://<app>.vercel.app`)
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — passed through to Convex env
     during deploy
5. Deploy. Every subsequent push to the production branch triggers the same
   build automatically.

### Deployment flow for future changes

```
Change code → validate locally (tsc + build) → commit → push GitHub
   → Vercel builds automatically → Convex production functions deploy → live Atlas
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
  credentials are not configured yet (`src/convex/lib/ocr.ts` has the hook).
- **Legacy formats:** `.doc` (old Word) is not supported; save as `.docx`.
- **AI:** Ask Atlas and extraction degrade to deterministic heuristics when
  `VLY_INTEGRATION_KEY` is not configured.
- **Background jobs:** connector sync is triggered on app load / after OAuth
  connect; scheduled cron sync is not enabled on the deployment.
- **Auth:** email OTP + anonymous sign-in (Convex Auth). Google Drive OAuth is
  separate from app sign-in.
