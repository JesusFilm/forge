---
id: "feat-453"
title: "Prove isolated dynamic Remotion runtime"
owner: "tataihono"
priority: "P1"
status: "not-started"
start_date: "2026-09-07"
duration: 3
depends_on:
  - "feat-450"
  - "feat-451"
blocks:
  - "feat-454"
  - "feat-456"
tags:
  - "ai-pipeline"
  - "manager"
---

## Problem

Official Remotion supports dynamic code, but Forge has no isolated runtime or proof that generated components remain editable and render consistently.

## Entry Points — Read These First

1. `docs/plans/2026-09-07-001-feat-studio-video-authoring-plan.md` — full contract, rollout and verification design.
2. `docs/research/devotional-editor-feasibility.md`
3. `apps/shorts-worker/src/devotional-render.ts`
4. `apps/shorts-worker/CLAUDE.md`
5. `packages/shorts-compositions/src/`
6. `apps/manager/src/features/shorts/short-preview.tsx`

Paths marked proposed do not exist yet. Frontmatter dates/durations are planning placeholders, not delivery commitments.

## Grep These

- `bundle|renderMedia|DynamicComp|inputProps|SHORTS_WORKER_DEVOTIONAL_BUNDLE_DIR`

## What To Build

1. Build a bounded feasibility implementation for generated TSX plus an editable props schema, declared asset references, duration, and version identity.
2. Prove the same component previews with library HLS and exports through a fixed host bundle without an application deployment per design.
3. Separate trusted asset brokering from credential-free generated code. Test preview iframe policy and render-process isolation, resource limits, network restrictions, and dependency resolution.
4. Measure source-seeking, subtitle alignment, cold preview startup and export duration. Decide whether the current worker isolation is sufficient or a separate execution service is required.
5. Record whether the licensed Editor Starter will be adopted or its interaction patterns implemented independently; do not assume access to unprovided template source.

## Constraints

- No arbitrary generated code in authenticated application pages or credential-bearing workers.
- No paid asset generation is needed for the proof. No production rollout.
- Preserve pinned Remotion versions and React-free server imports.

## Verification

- One custom animated component exposes text/style controls and survives save/reload, preview, and real Chromium export.
- Compile errors and unbounded code fail within limits without affecting the host or exposing credentials.
- Record real source-media/time mapping and performance evidence; screenshots alone are insufficient.
