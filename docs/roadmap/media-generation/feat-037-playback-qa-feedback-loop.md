---
id: "feat-037"
title: "Playback QA and Feedback Loop"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-05-19"
duration: 21
depends_on:
  - "feat-031"
blocks: []
tags:
  - "manager"
  - "ai-pipeline"
  - "quality"
---

## Problem

The manager app can link out to Mux, but it does not let operators validate the actual playback experience or capture quality feedback from caption/voiceover usage. A QA loop is needed so playback issues become structured signals rather than anecdotal reports.

## Entry Points — Read These First

1. `apps/manager/src/features/jobs/live-job-detail-header.tsx` — current Mux watch entry point
2. `apps/manager/src/features/jobs/live-job-steps-table.tsx` — current artifact inventory and step detail
3. `apps/manager/src/services/mux.ts` — playback URL, thumbnail, and asset utility functions
4. `apps/manager/src/types/job.ts` — job artifact and output typing
5. `apps/manager/src/app/dashboard/jobs/[id]/page.tsx` — current detail page composition

## Grep These

- `muxWatchUrl|Watch on Mux` in `apps/manager/src/features/jobs/live-job-detail-header.tsx`
- `voiceover|subtitlesVtt|mux_upload` in `apps/manager/src/features/jobs/live-job-steps-table.tsx`
- `muxPlaybackId|artifact` in `apps/manager/src/types/job.ts`

## What To Build

1. Add an in-app playback QA panel to job/video detail.
   - Default Mux player with caption controls and track selection.
   - Output switcher for Mux, downloadable artifacts, YouTube delivery, and voiceover variants when available.
2. Add viewer feedback capture.
   - After roughly two minutes of caption-enabled playback, prompt for a simple good/bad quality response with optional reason.
   - Record video, language, track, playback target, current timestamp, and response.
3. Add manager review surfaces.
   - Aggregate feedback by language/output.
   - Jump from a feedback item back to the affected playback moment/output.
4. Add download affordances for relevant output artifacts from the same QA surface.

## Constraints

- Keep Mux as the primary playback reference. Do NOT replace it with a custom media stack.
- Do NOT turn this into a generic user analytics product.
- Keep prompts conditional and low-friction; no constant interruption loops.

## Verification

- Job detail renders an inline player when a Mux playback ID exists.
- Caption-enabled playback can trigger a feedback prompt after the eligibility threshold.
- Feedback rows persist and can be reviewed by managers with the right video/language context.
- Operators can switch outputs and download related artifacts from one place.
