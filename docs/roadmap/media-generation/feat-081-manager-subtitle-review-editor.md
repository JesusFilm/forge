---
id: "feat-081"
title: "Manager Subtitle Review Editor"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-04-13"
duration: 14
depends_on: []
blocks: []
tags:
  - "manager"
  - "subtitles"
  - "translation"
  - "media"
---

## Problem

Manager can generate source and translated subtitle artifacts, but there is no human review flow for editors to adjust cue timing and text, save reviewed subtitles durably, and keep generated output separate for audit and rollback.

## Entry Points — Read These First

1. `docs/brainstorms/2026-04-11-manager-subtitle-editor-integration-requirements.md` — resolved product decisions for the editor integration
2. `docs/plans/2026-04-13-feat-manager-subtitle-review-editor-plan.md` — implementation plan with Red/Green TDD units and smoke test
3. `apps/manager/src/app/dashboard/jobs/[id]/page.tsx` — job detail data loading and job/artifact context
4. `apps/manager/src/features/jobs/live-job-steps-table.tsx` — artifact links and existing Mux subtitle compare/override UI
5. `apps/manager/src/app/api/jobs/[id]/artifacts/[artifact]/route.ts` — current authenticated read-only artifact endpoint
6. `apps/manager/src/lib/job-artifacts.ts` — logical artifact descriptors and artifact display helpers
7. `apps/manager/src/lib/state.ts` — Strapi-backed job state, artifact normalization, and artifact merge helpers
8. `apps/manager/src/services/storage.ts` — Railway S3/local `.tmp/artifacts` storage abstraction
9. `apps/manager/src/lib/vtt.ts` — existing WebVTT parse and emit helpers
10. `apps/manager/src/app/api/jobs/[id]/mux-sync/override/route.ts` — explicit Mux publish/override pattern to mirror later

## Grep These

- `subtitles-` in `apps/manager/src/` — generated subtitle artifact key conventions
- `muxSync` in `apps/manager/src/` — durable subtitle publish report pattern
- `buildMuxArtifactAccessUrl` in `apps/manager/src/` — signed artifact access pattern
- `writeArtifact` in `apps/manager/src/` — durable artifact writes
- `authenticateRequest` in `apps/manager/src/` — Manager route auth boundary
- `createEnv` in `apps/manager/src/config/env.ts` — environment validation pattern for a new app

## What To Build

1. Add a job-detail-first subtitle review launch action for generated `subtitles` and `subtitles-{lang}` artifacts.
2. Add Manager Route Handlers that mint short-lived, job-scoped subtitle edit sessions, bootstrap editor state, and save reviewed WebVTT revisions.
3. Store human-reviewed output as separate revisioned Manager artifacts, leaving generated artifacts unchanged.
4. Persist a `subtitleReviews` metadata artifact on the job with latest-reviewed pointers and audit metadata.
5. Add a Forge-hosted internal `apps/subtitle-editor` app based on the MIT upstream `laubonghaudoi/subtitle-editor`, with Forge-specific session/load/save adapters instead of file upload/download as the primary path.
6. Display reviewed subtitle state on the Manager job detail page so operators can open, download, and continue the latest review.
7. Keep CMS and Mux publishing explicit follow-up actions; do not auto-publish reviewed subtitles on save.

## Constraints

- Do NOT overwrite generated subtitle artifacts such as `subtitles-ru.vtt`.
- Do NOT give the editor app raw Strapi JWTs, `MANAGER_API_KEY`, or service credentials.
- Do NOT rely on browser `File` objects for the Forge-controlled load/save contract.
- Do NOT carry upstream Cloudflare/OpenNext/PWA deployment assumptions forward unchanged.
- Do NOT add CMS `video_subtitles` write-back in this feature unless a follow-up plan explicitly scopes it.
- If implementation changes CMS schema or generated GraphQL files, regenerate typed GraphQL outputs in the same PR.
- Create or use the feature branch `feat/manager-subtitle-review-editor` before implementation work.
- PRs target `main`; never skip pre-commit hooks.

## Verification

- Red/Green TDD for edit-session signing, reviewed artifact naming, save validation, conflict handling, Manager job-detail presentation, and editor load/save adapter behavior.
- `pnpm --filter @forge/manager test`
- `pnpm --filter @forge/manager lint`
- `pnpm --filter @forge/manager typecheck`
- `pnpm --filter @forge/subtitle-editor test`
- `pnpm --filter @forge/subtitle-editor lint`
- `pnpm --filter @forge/subtitle-editor typecheck`
- `pnpm --filter @forge/subtitle-editor build`
- `pnpm run format:check`
- User smoke test: open a completed Manager job, launch subtitle review, edit one cue, save, confirm a reviewed artifact is created, confirm the generated artifact remains unchanged, and reopen the editor to continue from the latest reviewed revision.
