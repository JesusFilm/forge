# Admin V1 Operational Surfaces

This branch is intended to be the final PR candidate for the first operational
version of `apps/admin`.

## What Is Operational

- `/login` uses the Better Auth + Firebase migration path already implemented in
  the backend and keeps provider visibility tied to validated env config.
- `/dashboard` and `/dashboard/system-status` now read live counts, persisted
  sync status, and recent activity from the admin database.
- `/dashboard/experiences` reads real experience rows and can create a new
  experience through the existing service layer.
- `/dashboard/experiences/[id]` now supports direct locale editing, publish
  actions, locale switching, and revision/audit visibility for experience
  locales.
- `/dashboard/videos` reads real video catalog rows and associated dub coverage.
- `/dashboard/workflows` lists real Workflow runtime runs; each
  `/dashboard/workflows/[runId]` route embeds the `@workflow/web-shared`
  trace/detail UI for runtime events.
- `/dashboard/embeddings` shows real embedding coverage and lets an authorized
  operator trigger the experience-embedding workflow for a locale id.
- `/dashboard/search` performs a real text-to-vector semantic search when an
  supported embedding provider is configured.
- `/dashboard/users` reflects persisted Better Auth users, linked accounts, and
  session posture. This surface is now admin-only.
- `/dashboard/settings` shows the runtime configuration posture from validated
  env state. This surface is now admin-only.
- `/dashboard/languages` and `/dashboard/media` read real reference/media rows
  from the admin database.

## What Is Intentionally Limited In V1

- Several routes are read-only operational views rather than full CRUD UIs.
- Workflow run inspection uses the Workflow runtime event log. Forge-owned
  trigger actions still live on their domain surfaces, such as Core Sync on
  `/dashboard/system-status`.
- Semantic search requires `OPENROUTER_API_KEY` or `OPENAI_API_KEY`. Without one
  of those, the page stays usable but reports the missing provider explicitly.

## Validation

Run the admin-only suite before cutting the PR:

```bash
pnpm --filter @forge/admin typecheck
pnpm --filter @forge/admin test
pnpm --filter @forge/admin lint
pnpm --filter @forge/admin build
```
