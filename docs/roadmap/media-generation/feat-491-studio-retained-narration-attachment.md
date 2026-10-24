---
id: "feat-491"
title: "Recover retained narration after attachment rejection"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-09-12"
duration: 2
depends_on: []
blocks: []
tags:
  - "manager"
  - "ai-pipeline"
---

## Problem

Production run `cmty79q5i558es00sw7225yze` for Peace in the Storm project
`bdadcc6a-f4d0-4d38-bf6c-70f079cc34dd`, base revision 10, retained all six
ElevenLabs recordings with `COMPLETED` calls but left its attempt `QUEUED` and
run `READY`. A retained `preflight-*` call reports `Studio command rejected`,
even though provider dispatch had already succeeded. One resume reused the
recordings but did not attach them.

Root cause established: S3 returns Uint8Array; manifest readers called
`.toString()` expecting Buffer UTF-8 decoding. A read-only production replay
failed at the root manifest JSON parse, and the same failure is now covered by
an owned-database regression. Normalize verified asset bytes to Buffer.

The operator recovered the files through Shared assets search `narration` and
placed them on the timeline manually. Revision 12 preserves six ten-second
cards and narration slots. Do not resume this old run against the edited project
or regenerate the paid recordings to reproduce the issue.

## Entry Points — Read These First

1. `apps/manager/src/services/studio-production/narration.ts` — manifest upload and completion.
2. `apps/admin/src/services/studio-authoring/production-rpc.ts` — completion and generic preflight diagnostics.
3. `apps/admin/src/services/studio-authoring/narration.ts` — manifest and identity validation.
4. `apps/admin/src/services/studio-authoring/completion.ts` — transactional attachment.
5. `apps/manager/src/features/video-studio/production-panel.tsx` — retained-run recovery UI.

## Grep These

- `narration-complete|attachStudioNarration|preflight-error|Studio command rejected`

## What To Build

Reproduce the attachment rejection with retained manifest/identity fixtures and
an owned database. Distinguish failures before provider dispatch from failures
after successful retention. Expose an actionable attachment diagnostic and a
recovery path that reuses the exact retained recordings. Preserve the original
failed run as evidence rather than rewriting history.

## Constraints

No automatic repeat of a consumed paid claim. Preserve exact voice, language,
text, pronunciation, dependency and asset verification. Do not bypass canonical
project transactions, revision checks or normal PR-to-main deployment.

## Verification

An integration regression must demonstrate six retained recordings attaching
without any new provider call. Cover a rejected attachment followed by retry,
stale revision, identity mismatch and timing conflict. Verify clear UI status
after completion and retained results after failure.

Local regression: six cached recordings attach, completion replays exactly,
and the run completes with no provider calls. Production recovery is verified
below. The original failed run is preserved.

## Production acceptance — 2026-09-13

PR #2261 shipped through main (`52272bcc5949bd01f5f2967ac4bf885ebc80aa1e`)
and Railway Admin deployment `6cdc55e7-07f5-467e-b06c-6a22f6b6e30f` succeeded.
The normal Studio UI admitted current revision 14, reused all six original
recordings, and completed run `cmtyf5sr1002rs40syyc7czm6`. Its attempt
`cmtyf5so0002ps40sqe7w9hyc` is SUCCEEDED, with `calls: []`, `costMicros: 0`,
and no timing conflicts. The resulting manifest is `cmtyf5w6g0032s40snf9wptti`.

The canonical attachment created revision 15. Revision 16 restores the intended
six ten-second cards and their six linked audio slots at frames
0/300/600/900/1200/1500. A read-only production check confirmed the exact six
retained asset versions, narration volume 1, source volume 0.08, music volume
0.18 and total 1800 frames. The temporary consolidated narration was removed.
Hosted render acceptance remains tracked separately in feat-492.
