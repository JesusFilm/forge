---
id: "feat-715"
title: "Keep full Studio source preparation inside its execution deadline"
owner: "tataihono"
priority: "P1"
status: "in-progress"
start_date: "2026-10-17"
duration: 1
depends_on: ["feat-714"]
blocks: []
tags: [studio, sources, rendering]
---

## Problem

After feat-713/714 deployed and revision 21 repaired source ranges, full-render
attempt `cmvbliu6b0001lb5i8r11t7lu` failed before committing preparation at
91 seconds. Both VM input transport and Manager preparation allow 90 seconds.
Measure the actual preparation stages before choosing a correction.

## Entry Points — Read These First

- `apps/manager/src/services/studio-broker.ts`
- `apps/manager/src/services/studio-render-input.ts`
- `apps/manager/src/services/studio-render-pool-http.ts`
- `apps/studio-render/src/vm/job-api.mjs`
- `docs/plans/2026-10-17-studio-source-duration.md`

## Constraints

Keep exact source eligibility, immutable proofs, bounded memory/transfer and
cancellation. Reuse only identical verified work within one preparation. Normal
PR/main deployment; no direct production source publishing or historical edits.

## Verification

Reproduce the measured cause, test the correction and run Manager validation.
After release, verify the full repaired revision through the existing worker pool.
