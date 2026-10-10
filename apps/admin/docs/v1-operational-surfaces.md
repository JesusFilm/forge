# Admin V1 Operational Surfaces

This branch is intended to be the final PR candidate for the first operational
version of `apps/admin`.

## What Is Operational

- `/api/auth/login` starts the Auth SSO OAuth flow and stores only an admin-local session
  after callback verification.
- `/dashboard` and `/dashboard/system-status` now read live counts, persisted
  sync status, and recent activity from the admin database.
- `/dashboard/experiences` reads real experience rows and can create a new
  experience through the existing service layer.
- `/dashboard/experiences/[id]` now supports direct locale editing, publish
  actions, locale switching, and revision/audit visibility for experience
  locales.
- `/dashboard/videos` reads paginated video catalog rows with type labels,
  thumbnails, dub coverage, and visitor-facing watch-page handoff links when a
  safe public URL can be resolved.
- `/dashboard/workflows` lists real Workflow runtime runs; each
  `/dashboard/workflows/[runId]` route embeds the `@workflow/web-shared`
  trace/detail UI for runtime events.
- `/dashboard/embeddings` shows real embedding coverage and lets an authorized
  operator trigger the experience-embedding workflow for a locale id.
- `/dashboard/search` performs a real text-to-vector semantic search when an
  supported embedding provider is configured.
- `/dashboard/users` reflects admin-local role mappings for Auth SSO
  principals. This surface is now admin-only.
- `/dashboard/settings` shows the runtime configuration posture from validated
  env state. This surface is now admin-only.
- `/dashboard/languages` and `/dashboard/media` read real reference/media rows
  from the admin database.

## What Is Intentionally Limited In V1

- Several routes are read-only operational views rather than full CRUD UIs.
- Workflow run inspection uses the Workflow runtime event log. Forge-owned
  trigger actions still live on their domain surfaces, such as Core Sync on
  `/dashboard/system-status`.
- Semantic search requires `OPENROUTER_API_PAID_KEY` or the legacy
  `OPENROUTER_API_KEY`. Without either, the page stays usable but reports the
  missing provider explicitly.

## Validation

Run the admin-only suite before cutting the PR:

```bash
pnpm --filter @forge/admin typecheck
pnpm --filter @forge/admin test
pnpm --filter @forge/admin lint
pnpm --filter @forge/admin build
```
