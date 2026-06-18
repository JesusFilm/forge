---
id: "feat-184"
title: "Mastra subtitle enrichment execution"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-12"
duration: 2
depends_on:
  - "feat-031"
  - "feat-129"
blocks:
  - "feat-188"
  - "feat-192"
tags:
  - "manager"
  - "mastra"
  - "subtitle-enrichment"
  - "ai-pipeline"
---

## Problem

Manager still runs subtitle translation and retiming inside
`apps/manager/src/services/subtitleTranslation`, while Mastra is now the
service-runtime boundary for AI workflows. Subtitle enrichment should move the
AI subtitle work to Mastra without resurrecting stale draft PRs or regressing
the current Manager job, artifact, and Mux sync contracts.

## Entry Points - Read These First

1. `docs/plans/2026-06-12-002-feat-mastra-subtitle-enrichment-execution-plan.md`
   - implementation plan for the clean current-main migration.
2. `docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md`
   - Manager enrichment umbrella and current job/artifact contract.
3. `docs/roadmap/platform/feat-129-mastra-railway-workflow-runtime.md`
   - Mastra runtime, Studio, and service-bearer prerequisite.
4. `apps/manager/src/workflows/videoEnrichment.ts`
   - current translation step owner and Mux sync handoff.
5. `apps/mastra/src/services/subtitle-enrichment/`
   - Mastra-owned subtitle chunking, translation, retiming, and artifact writes.
6. `apps/mastra/src/mastra/index.ts`
   - current service route registration pattern.
7. `apps/mastra/src/config/env.ts`
   - Mastra runtime env validation and provider keys.

## What To Build

- Move subtitle chunking, translation, retiming, and subtitle artifact writes
  into a Mastra workflow protected by `MASTRA_SERVICE_API_KEYS`.
- Add a Manager client that calls the Mastra workflow from the existing
  `translation` workflow step and returns the same `LanguageResult` shape the
  Mux sync step already consumes.
- Keep Manager as the operator/job state owner and keep existing Mux subtitle
  sync in Manager for this PR.
- Reuse the current artifact key contract:
  `subtitles-{language}.vtt` and `translation-{language}.json`.
- Preserve no-op same-language subtitle behavior.
- Update Manager and Mastra env docs for the shared artifact storage and
  subtitle workflow timeout/model configuration.

## Constraints

- Do not merge or revive PR #886 or PR #1087 directly; salvage only designs or
  tests that fit current `origin/main`.
- Do not import from `apps/manager` inside `apps/mastra`; use local schemas and
  copied/extracted runtime primitives.
- Do not move Manager UI, approval, canonical job state, or Mux sync ownership
  into Mastra in this slice.
- Do not expose Mastra subtitle routes without service-bearer validation.
- Do not hand-edit generated GraphQL artifacts.

## Verification

- `pnpm --filter @forge/mastra test -- subtitle-enrichment` passed on 2026-06-12.
- `pnpm --filter @forge/manager test -- mastra-subtitle-enrichment videoEnrichment` passed on 2026-06-12.
- `pnpm --filter @forge/mastra typecheck` passed on 2026-06-12.
- `pnpm --filter @forge/manager typecheck` passed on 2026-06-12.
- `pnpm --filter @forge/mastra lint` passed on 2026-06-12.
- `pnpm --filter @forge/manager lint` passed on 2026-06-12.

## Resolution

Completed on 2026-06-12.

- Added a Mastra subtitle enrichment runtime under
  `apps/mastra/src/services/subtitle-enrichment/` that reads transcript
  artifacts, chunks source segments, translates/retimes target subtitles, and
  writes Manager-compatible VTT/translation JSON artifacts.
- Registered the `subtitle-enrichment` Mastra workflow and protected
  `POST /forge-subtitle-enrichment` with the existing service-bearer allowlist.
- Added `apps/manager/src/services/mastra-subtitle-enrichment.ts` and migrated
  Manager's `translation` workflow step to call Mastra while preserving the
  existing language result shape used by Manager Mux sync.
- Removed the old Manager-local subtitle translation service and language
  config after the workflow stopped importing them.
- Updated Manager/Mastra env docs for the caller timeout, subtitle provider
  defaults, and shared Railway S3 artifact storage.

## Plan

Implementation plan:
`docs/plans/2026-06-12-002-feat-mastra-subtitle-enrichment-execution-plan.md`
