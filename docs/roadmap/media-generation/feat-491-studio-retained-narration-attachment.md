---
id: "feat-491"
title: "Recover retained narration after attachment rejection"
owner: "tataihono"
priority: "P1"
status: "in-progress"
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
and the run completes with no provider calls. Production recovery remains
pending the normal PR-to-main deployment. The original failed run is preserved.
