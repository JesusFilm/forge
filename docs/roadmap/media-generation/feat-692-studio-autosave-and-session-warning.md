---
id: "feat-692"
title: "Studio autosave and expired-session edit protection"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-12"
duration: 2
depends_on: []
blocks: ["feat-693"]
tags: [manager, studio]
---

## Problem

Lyuba deleted an audio clip in `prodigal-ru-intro-teaser-20261009` while her
interactive session had expired. Preview reported authentication failure, but
revision history did not contain the edit. She needs automatic persistence,
clear unsaved/session warnings, and a warning before leaving.

## Entry Points — Read These First

1. `apps/manager/src/features/video-studio/editor-session.ts` — revision-bound saves, receipts, recovery, undo/redo.
2. `apps/manager/src/features/video-studio/editor.tsx` — local recovery, status and navigation.
3. `apps/manager/src/features/video-studio/preview.tsx` — preview authentication failure.
4. `apps/manager/src/features/video-studio/client.ts` — HTTP status-bearing errors.
5. `docs/plans/2026-10-12-studio-autosave-and-session-warning.md` — scope and verification.

## Grep These

- `EditorSession|studio-recovery|Interactive Manager session required`
- `expectedRevision|idempotencyKey|beforeunload`

## What To Build

Debounce edits into serialized revision-bound saves. Preserve the exact receipt
on ambiguous failure, pause automatic saves on failure/conflict/authentication,
and retain all edits made during a save. Surface expired authentication from both
save and preview, allow sign-in in a separate tab and explicit retry, and warn
before navigation with pending changes. Keep browser recovery intact.

## Constraints

No canonical schema changes, production project writes, direct production deploys,
or Slack replies. Never automatically overwrite a newer revision. No polling or
save requests for initial load, selection, or playback.

## Verification

Run focused session and browser regression tests, Manager type checking, lint,
formatting and build. Compare baseline/candidate editor load and preview readiness
using the synthetic fixture. Record evidence and durable learnings.

Evidence: `docs/validation/studio-autosave/README.md`. Implementation and local
validation are complete; production delivery follows the normal PR-to-main flow.
