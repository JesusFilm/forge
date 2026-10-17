---
id: "feat-715"
title: "Keep full Studio source preparation inside its execution deadline"
owner: "tataihono"
priority: "P1"
status: "in-progress"
start_date: "2026-10-17"
duration: 1
depends_on: ["feat-714"]
blocks: ["feat-716"]
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

## Measured follow-up after registration reuse

PR #2767 deployed as `b1a3913acd99e0aa6bc0bd64096dec5d282676a2`,
Manager deployment `91e60a23-4911-43b3-b1cf-683ed53c7780`. Retry
`cmvbmxkuj0001lbfdyof1lsxr` committed source preparation at
2026-10-17T00:06:21.999Z, 72.347 seconds after its lease was created.
It still failed at 00:06:43.570Z while delivering/packaging input.

Reuse successful complete codec verification for identical ordered actual byte
digests, durations and expected height within one preparation. Keep range proofs
and per-clip materialization separate. Use content-derived playlist/manifest
filenames so identical registrations and retained references can also be reused.
Measure the complete production input path again after normal PR/main rollout.

## Final measurement

After PR #2768 (`674cd28d80058b41e906b0483d872e056f56c0ea`), attempt
`cmvbom8yu0001lbo7l9xcnwn3` committed preparation in 80.177 seconds. A separate
read-only packaging measurement took 26.407 seconds for 24 files / 47,716,903
bytes. The 90-second combined input deadline cannot fit these measured stages.
Continue with the explicitly versioned execution contract in feat-716.
