---
id: "feat-082"
title: "Job Detail Enrichment Review Player"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-04-12"
duration: 7
depends_on:
  - "feat-031"
blocks: []
tags:
  - "manager"
  - "web"
  - "mux"
  - "ai-pipeline"
---

## Problem

The manager job details page exposes artifacts, step status, and targeted
compare cards, but it still lacks one coherent review surface for seeing what a
job changed on the video itself. Operators need to review subtitles, chapters,
metadata, and related enrichment outcomes in context, using the actual player,
instead of assembling the story from separate workflow rows and raw artifacts.

## Entry Points — Read These First

1. `apps/manager/src/app/dashboard/jobs/[id]/page.tsx` — job detail page layout and the insertion point below the `Error Log`.
2. `apps/manager/src/features/jobs/live-job-detail-header.tsx` — live job page composition and existing Mux watch context.
3. `apps/manager/src/features/jobs/live-job-steps-table.tsx` — current inline compare patterns for subtitles, embeddings, and step-level detail rendering.
4. `apps/manager/src/lib/job-artifacts.ts` — canonical job artifact key mapping and downloadable artifact URLs.
5. `apps/manager/src/types/job.ts` — current durable compare/read-model types for mux sync, embedding sync, and job artifacts.
6. `apps/web/src/components/sections/Video.tsx` — canonical reusable web player controls and `video.js` setup to reuse.
7. `apps/web/src/components/sections/MediaCollection.tsx` — precedent for displaying metadata around a player rather than inside the player itself.
8. `docs/plans/2026-04-09-feat-sync-enrichment-results-into-cms-models-plan.md` — existing product direction for before/after compare flows on job details.

## Grep These

- `Error Log\|LiveJobStepsTable\|Watch on Mux` in `apps/manager/src/`
- `muxSync\|embeddingSync\|sceneEmbeddingSync\|comparison` in `apps/manager/src/`
- `subtitles-\|metadata\|chapters\|transcript` in `apps/manager/src/`
- `videojs\|VideoPlayer\|formatTime` in `apps/web/src/components/sections/`
- `before / after\|before/after\|CMS Sync` in `docs/plans/ docs/roadmap/`

## What To Build

1. Add a new bottom-of-page review card on the manager job detail page, placed below the existing `Error Log`.
2. Give the card a tab strip with two operator-facing modes:
   - `Before` = current live Mux and CMS state for the target video
   - `After` = generated outputs from the current enrichment job
3. Make tab changes switch both:
   - the player surface
   - the surrounding review details
4. Reuse the existing web player behavior and controls instead of designing a separate manager-only player stack.
5. Show the most relevant enrichment outputs around the player in one review surface:
   - subtitle state
   - chapter state
   - title / description state
   - related sync status or provenance when already available in the job read model
6. Support partial comparisons gracefully:
   - live state exists but generated output is missing
   - generated output exists but live Mux or CMS state is empty
   - some domains are comparable while others are not
7. Keep existing step-level compare and override flows working unless the new review card intentionally replaces a specific piece of them.

## Constraints

- Reuse the existing manager page structure and visual language. Do not redesign the whole job details page.
- Reuse the canonical web player controls. Do not introduce a third diverging `video.js` player implementation for manager.
- Do not require a new frozen pre-job snapshot model for v1. `Before` is the current live Mux and CMS state.
- Keep the feature review-first. Do not expand scope into a generic enrichment editor or new approval workflow unless planning proves it is required.
- Use current durable job artifacts and compare reports where possible. Do not handwave over missing data with fake derived state.

## Verification

- Open a completed job detail page and confirm the new review card renders below `Error Log`.
- Switch between `Before` and `After` and confirm both the player and detail panel change together.
- Confirm the player surface preserves the existing shared web control behavior: play/pause, mute, seek, fullscreen, and poster handling.
- Confirm a job with generated subtitles and metadata can show generated results without forcing every domain to have a live compare target.
- Confirm a job with existing live Mux or CMS data shows that current state in `Before`.
- `pnpm --filter @forge/manager typecheck`
- `pnpm --filter @forge/manager lint`

## Success Criteria

- Operators can review enrichment outcomes in one coherent player-centered surface on the job details page.
- `Before` reflects live current Mux and CMS state.
- `After` reflects the current job's generated outputs.
- Manager and web do not drift into separate player behaviors for the same review task.
