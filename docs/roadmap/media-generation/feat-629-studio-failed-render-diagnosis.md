---
id: "feat-629"
title: "Diagnose Lyuba's failed Studio export"
owner: "tataihono"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags: [manager, ai-pipeline, infrastructure]
---

## Problem

Lyuba can play her project in the updated Studio editor, but its render is marked
failed and she cannot obtain a finished file. The project link/name and render attempt
identity were not supplied. Browser preview and export run through different source
preparation and execution paths. Synthetic exports do not diagnose this incident.

## Entry Points — Read These First

1. `apps/manager/src/features/video-studio/render-panel.tsx` — attempt selection/state.
2. `apps/manager/src/services/studio-broker.ts` — export source materialization.
3. `apps/manager/src/services/studio-render-execution.ts` — execution admission.
4. `apps/manager/src/app/api/shorts/render-pool/[action]/route.ts` — pool gateway.
5. `apps/admin/src/services/studio-authoring/` — durable attempts, leases and receipts.
6. `docs/plans/2026-09-08-001-feat-studio-vm-execution-plan.md` — execution protocol.

## Grep These

- `FAILED|failure|renderJob|muxJob|render-state|render-evidence`

## What To Build

Obtain the project link/name requested in this chat. Inspect that project's attempt
and retained failure evidence read-only. Build a deterministic replay of the observed
failure at its real boundary before repairing it. Record the failure stage and verify
that the same scenario produces a retained, playable/downloadable MP4.

## Constraints

Do not resubmit paid production renders, modify the designer's saved document, or
change production service configuration as a diagnostic shortcut. Normal PR-to-main
release flow applies. Do not equate local synthetic export success with incident recovery.

## Verification

Record the exact project/attempt privately, reproduce the observed failure with redacted
inputs, add a regression at the appropriate seam, and verify the original failure pattern.
Editor feedback items 2–6 are tracked separately in feat-628.
