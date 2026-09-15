---
id: "feat-455"
title: "Update Mastra runtime and validate a production-derived stage canary"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-09-04"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "mastra"
  - "dependencies"
  - "railway"
---

## Problem

The production `@forge/mastra` service pins the coordinated Mastra release set
led by `mastra@1.21.0` and `@mastra/core@1.55.0`. Current stable releases are
newer and include Studio, runtime, storage, memory, and observability fixes.
The upgrade must be proven against a Railway environment derived from
production without changing production or the shared long-lived `stage`
environment.

## Entry Points - Read These First

1. `apps/mastra/package.json` - exact Mastra runtime dependency pins.
2. `apps/mastra/railway.toml` - build, start, and health-check contract.
3. `apps/mastra/src/mastra/index.ts` - runtime and Postgres storage wiring.
4. `apps/mastra/src/mastra/memory.ts` - Postgres and vector-store initialization.
5. `pnpm-lock.yaml` - resolved coordinated dependency graph.

## Grep These

- `@mastra/`
- `PostgresStore`
- `PgVector`
- `mastra build --studio`
- `MASTRA_STUDIO_PATH`

## What To Build

1. Update every direct Mastra package in `apps/mastra` to one mutually
   compatible current stable release set, preserving exact pins.
2. Regenerate `pnpm-lock.yaml` without upgrading unrelated direct dependencies.
3. Adapt Forge code and tests for any relevant Mastra API changes.
4. Create an isolated Railway environment by duplicating production and deploy
   only the upgraded `@forge/mastra` service from this worktree.
5. Verify build, deployment health, Studio availability, runtime health, and
   successful automatic Postgres schema initialization from deployment logs.

## Constraints

- Do not deploy, redeploy, or change variables in Railway production.
- Do not overwrite or mutate the shared long-lived `stage` environment.
- Do not upgrade unrelated non-Mastra dependency families.
- Keep direct Mastra dependency versions exact and coordinated.
- Preserve authentication, storage isolation, observability redaction, and
  devotional workflow lifecycle safeguards.

## Verification

- `pnpm install --filter @forge/mastra...`
- `pnpm --filter @forge/mastra test`
- `pnpm --filter @forge/mastra typecheck`
- `pnpm --filter @forge/mastra lint`
- `pnpm --filter @forge/mastra build`
- `pnpm --filter @forge/mastra outdated`
- Railway canary deployment reaches `SUCCESS` and passes `/health`.
- Railway logs show no failed storage migration or runtime initialization.
- Studio and API surfaces respond in the isolated environment.

## Outcome

Completed on 2026-09-04.

- Updated the coordinated direct release set to `mastra@1.27.3`,
  `@mastra/core@1.64.0`, `@mastra/pg@1.22.3`, and the matching current stable
  versions of the other direct `@mastra/*` packages. `pnpm outdated` reports
  no remaining Mastra updates.
- Regenerated `pnpm-lock.yaml` from the full workspace so the repository's
  required mobile and TV patches remained applied. No unrelated direct
  dependency manifest was changed.
- Passed the Mastra package typecheck, lint, full Vitest suite, and
  `mastra build --studio`. The suite reported 3,015 passing tests, 27 skipped
  tests, 248 passing files, and 6 skipped files.
- Duplicated Railway production into the isolated environment
  `mastra-update-stage-20260904` (`9e37cf71-dea0-49f7-9f98-be015f7521a8`).
  Railway duplicated service configuration but created empty, isolated volume
  instances for the target Mastra service and database; no production Mastra
  database rows or Mastra volume contents were copied.
- Replaced the clone's stale literal `DATABASE_URL` with a Railway reference
  to the cloned `@forge/mastra-gateway/db` service. The original copied value
  could not authenticate because the new database instance generated its own
  password.
- Applied the repository's three idempotent SQL migrations to the empty clone;
  the second run reported `applied=0 skipped=3`, and devotional database
  readiness returned `{"ready":true,"version":1}`.
- The upgraded canary deployment
  `66ac34fe-c3e5-463b-a085-b9eb025af34a` reached Railway `SUCCESS` with a
  running instance. Private in-container probes returned HTTP 200 for
  `/health`, `/studio`, and `/api/agents`.
- Kept the canary private (no Railway public domain) and disabled clone-only
  automated writes/exports. Firecrawl points at a `.invalid` stage sink;
  YouTube, discovery ingest, and Langfuse credentials are blank. Startup logs
  confirm Langfuse retention is disabled for missing configuration. SEO,
  title repair, support research, Datadog triage, devotional new runs,
  production eval imports, and Langfuse tracing/media upload are explicitly
  disabled.
- A read-only production preflight found zero rows and therefore zero duplicate
  `(traceId, spanId)` pairs in both `mastra.mastra_ai_spans` and
  `ai_chat.mastra_ai_spans`; both tables already have the required composite
  primary key. The known manual `mastra migrate` de-duplication path is not
  required. The updated Postgres store initialized eight new additive runtime
  tables in each stage schema (knowledge storage, thread state, and workflow
  definitions) without a manual migration.
- Production remained on its existing successful deployment, and the shared
  long-lived `stage` environment was not targeted.
