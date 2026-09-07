---
id: "feat-453"
title: "Prove isolated dynamic Remotion runtime"
owner: "tataihono"
priority: "P1"
status: "complete"
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

## Completion evidence — 2026-09-07

Completed the bounded local feasibility proof; no production rollout or paid
media generation. See [runtime evidence and deployment decision](../../solutions/security-issues/studio-dynamic-runtime-proof.md)
for exact source IDs, measurements, commands, review findings and release checks.

- Fixed host accepts bounded TSX, text/color controls and immutable content identity.
  The edited manifest survives form input, save/reload, opaque iframe preview and
  real Chromium export without rebuilding the host.
- Exact English Forge Video/Dub/Edition and canonical primary non-AI VTT verified;
  270p library HLS preview and 1080p source export use identical trim/cue semantics.
  Actual output decodes to 60 frames / 2.000 seconds; source seek and subtitle gap
  verified with decoded-frame timing, rendered frames and extracted MP4 frames.
- Credential-free namespace execution and aggregate cgroup bounds exercised,
  including real OOM containment, network/filesystem/env denial, compile/import/
  thrown failures, infinite work and bounded output-flood termination.
- Ordinary Chrome 152, no special site-isolation flag: distinct-site opaque iframe
  retains parent responsiveness during infinite code. Headless Shell's weaker
  behavior is documented; unsupported browsers are not claimed verified.
- Both code-review axes cleared after fixes. 177 worker + 69 composition tests,
  package typechecks/lints, worker build and real host bundle/render passed.

Architecture: use a separate credential-free execution service and a preview site
with a distinct registrable domain. Deployment verification of equivalent limits,
headers/origins, the authenticated asset broker and browser support is required
before release. feat-456 implements the preview integration/media broker; feat-460
implements the production render launcher and trusted attempt/asset/result broker;
feat-462 verifies deployment and cutover. This is not a block caused merely by the absence of a
production deployment. It does not authorize evaluating code in the existing
credential-bearing worker or authenticated Manager page.

Neutral handoff: `@forge/shorts-compositions/studio-proof/manifest` at
`packages/shorts-compositions/src/studio-proof/manifest.ts` is React-free.
feat-454 may normalize that feasibility shape into `packages/studio-contracts`;
Admin must not import the browser-only `studio-proof/entry` or worker internals.
