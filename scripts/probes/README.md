# scripts/probes — development-only live verification probes

This directory holds **development tooling only**. Nothing in here ships in the
production build.

## What these are

Live probes that drive the **deployed Supabase project** the same way the
frontend does, using throwaway sign-ups + workspaces, and print only shapes,
statuses and counts — never secrets. Every probe cleans up every row it
creates (documents, candidates, claims, evidence links, findings,
supplements, memberships, tenant, user) in a `finally` block.

- `probe-claim-materialization.mjs` — end-to-end trace of the claim
  acceptance chain: document → candidate → approve → claim row → list →
  claim package → timeline → evidence linkage → reject (no claim) →
  double-approve (no duplicate) → cross-workspace isolation. 14 checks.
- `probe-approval-evidence.mjs` — does `insurance_approve_claim_candidate`
  auto-link the candidate's evidence documents to the created claim? What
  does the candidate row record after approval?
- `probe-claims-list-shape.mjs` — prints the exact raw rows the frontend
  receives from `insurance_list_claims` (keys + types, never values) to
  verify the API boundary contract.

Run any probe with:

```bash
node scripts/probes/<probe-name>.mjs
```

They read `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` from `.env.local` (service key is used only for
cleanup deletes scoped to the probe's own tenant/rows). Exit code 0 means all
checks passed; 1 means a check failed. Never run against a project you don't
own — they create and delete real rows, but only inside throwaway tenants.

## Why they live here and not in the app

- They are verification tooling, not product features — keeping them in a
  dedicated `scripts/probes/` area makes the dev-only boundary explicit.
- The production build (`bun run build` → `vite build`) bundles only what
  `index.html` → `src/` imports; nothing under `scripts/` is imported by the
  app, so probes are **structurally excluded** from the build and from
  `tsc -b` (both tsconfigs only include `src/` and `vite.config.ts`). No
  extra exclusion config is required or added.
- They never print credentials; `.env.local` is gitignored and the secrets
  themselves are never committed.
