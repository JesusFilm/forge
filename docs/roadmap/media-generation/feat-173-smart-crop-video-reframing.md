---
id: "feat-173"
title: "Smart Crop AI video reframing with canonical plan reuse"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-06-09"
duration: 14
depends_on: []
blocks: []
tags:
  - "manager"
  - "ai-pipeline"
  - "infrastructure"
---

## Problem

Jesus Film distributes the same visual content in thousands of localized
language versions. Producing vertical (9:16) social cuts today requires manual
reframing per video — and naively running AI crop analysis per localized
version would multiply cost, produce inconsistent crops between languages, and
create unbounded review load. We need to generate an editorial crop plan ONCE
per canonical master, then reuse it across localized versions whose timing
drifts slightly (lip-sync, title cards, intros).

Related (no hard dependency): feat-057 automated rendering engine,
feat-043 visual shot detection fusion, feat-056 template system.

## Entry Points — Read These First

1. `docs/plans/2026-06-09-002-feat-smart-crop-plan.md` — full architecture,
   exact artifact/HTTP contracts, deviations from the original PRD.
2. `apps/manager/src/workflows/smartCrop.ts` — durable canonical + localized
   pipelines (workflow SDK, idempotent artifact-reusing steps).
3. `apps/manager/src/services/crop-worker.ts` + `src/services/mastra-smart-crop.ts`
   — outbound clients (submit/poll worker; launch mastra AI workflows).
4. `apps/mastra/src/mastra/workflows/smart-crop-plan.ts`, `smart-crop-align.ts`,
   `smart-crop-qa.ts` — AI crop intent → deterministic planner, shot
   alignment + confidence gates, preview QA.
5. `apps/crop-worker/src/` — FFmpeg fingerprint (scdet + dhash) and render
   (per-segment crop/encode/concat) service.
6. `apps/manager/src/app/dashboard/smart-crop/` — operator UI.

## Grep These

- `smart-crop` / `smartCrop` / `smart_crop` — all feature surfaces
- `smart-crop-fingerprint` / `smart-crop-canonical-plan` / `smart-crop-timeline-map` — artifact kind literals (must match across apps)
- `forge-smart-crop` — mastra service routes
- `CROP_WORKER_` — worker env + auth pair

## What To Build

See the plan doc for exact JSON contracts. Summary: crop-worker (new plain
node:http app) produces visual fingerprints and renders; mastra owns the three
bounded AI/decision workflows; manager owns durable orchestration, job state
(JobRecord with `options.smartCrop`), operator approval, retry, and Mux output
asset creation from presigned artifact URLs.

## Constraints

- Mastra never imports other apps; HTTP + local Zod only. No S3/Mux in mastra.
- All long-running video work outside manager's process (crop-worker).
- Artifact keys stay flat `{assetId}/{artifactType}.{ext}` (storage validator).
- Job/step statuses stay within existing closed enums; no admin schema changes.
- New env vars `.optional()` at schema load; production enforcement at runtime.
- 9:16 only in MVP; no frame-level tracking; no manual crop editor.
- For speaker/person shots, Mastra should prefer visible face/head centers
  over broader body centers when emitting deterministic 9:16 crop keyframes.

## Verification

- `pnpm --filter @forge/crop-worker test` / `@forge/mastra test` / `@forge/manager test`
- Typecheck + lint + build for all three apps.
- Mock-mode smoke per plan doc "Verification" section.
