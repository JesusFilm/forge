---
id: "feat-749"
title: "Integrate selected TV recovery, track picker and readability improvements"
owner: "ekkasit"
priority: "P1"
status: "in-progress"
start_date: "2026-10-19"
duration: 3
depends_on: []
blocks: []
tags: [tv, android, apple-tv, testing, accessibility]
---

## Problem

Combine the selected comparison proposals onto current main while retaining the
current TV app and development harness. Verify the combined result on both TV
platforms rather than relying on previous isolated branch results.

## Entry Points — Read These First

- `docs/plans/2026-10-19-tv-selected-integration.md`
- `apps/tv/CLAUDE.md`
- `apps/tv/harnesses/development/HARNESS.md`
- `apps/tv/src/lib/apolloClient.ts`
- `apps/tv/src/components/watch/AndroidTrackChoice.tsx`
- `apps/tv/app/series/[slug].tsx`
- `apps/tv/src/components/home/`

## Grep These

`RetryLink|AbortError|showTrackChoice|GET_SERIES_LANGUAGES|readableFontSize`

## What To Build

Integrate comparison 02 recovery/network/configuration; 07 native Android track
pickers; only Home typography from 08; only environment validation tests from 12.
Address query cancellation and permanent errors, series language loading/error/
retry, and typed-search preservation across retry. Retain native player defaults,
Feedback, recommendations, Top Shelf and the development harness.

## Constraints

No storyboard/scrub/player rewrite, OTA dependency, old branding or protocol
changes. No generated GraphQL output edits. No production deployment, store upload
or PR mutation. Local branches and commits are the deliverable for this task.

## Verification

Run TV typecheck, lint, Jest, harness fixtures/check/evaluate, relevant transport
and native tests, native builds for tvOS and Android, and focused runtime journeys.
Verify Home content/focus/readability, native playback and Back, track search and
selection, retry/recovery, and comparable Home-ready timings. Record exact commit,
source digest, target, configuration, logs and captures; distinguish simulator
coverage from hardware or store verification.

## Current State

Selected implementation, native builds and focused recovery/picker/readability
checks are complete locally on `codex/tv-selected-improvements`. See the plan for
evidence, exact baseline and remaining limitations. Keep this ticket in progress:
Apple Native A pause/resume/Back remains unverified after the initial automated
clock check and two focused driver repairs. Hidden stale AVKit accessibility
values do not establish a player freeze, and moving frames do not establish
working pause/Back controls. A fresh, visibly grounded playback observation is
required before full acceptance; do not weaken or relabel the retained failures.
Android Media3 playback/pause/resume were observed, but clean player Back/exit and
restored focus still need verification. The native subtitle Off/no-match toggle
also remains unverified; its typed English selection and separate series picker
Back/retry flows passed. Keep these limits separate from the successful builds.
