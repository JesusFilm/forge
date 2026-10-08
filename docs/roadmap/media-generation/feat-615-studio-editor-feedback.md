---
id: "feat-615"
title: "Studio clip speed, named text components, canvas selection and sizing"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-08"
duration: 3
depends_on: []
blocks: []
tags: [manager, ai-pipeline]
---

## Problem

Lyuba reports failed exports, missing clip speed, indistinguishable custom blocks,
text components in Video, unusable canvas selection/dragging and a small vertical preview.

## Entry Points — Read These First

1. `apps/manager/src/features/video-studio/{editor,preview,timeline,inspector}.tsx`
2. `apps/manager/src/features/video-studio/timeline-layout.ts`
3. `packages/studio-contracts/src/index.ts`
4. `packages/shorts-compositions/src/studio/Composition.tsx`
5. `apps/manager/src/features/video-studio/render-panel.tsx`

## Grep These

- `itemLabel|itemGroup|Source trim must match|nle-canvas-item|playbackRate`

## What To Build

Support rate-aware video duration and trims in preview/export. Add optional component
names and explicit text/video presentation classification with legacy fallbacks.
Select visible content and drag the selected layer using composition coordinates.
Fit vertical video to available Canvas height. The project-specific failed render
investigation is tracked separately in feat-616.

## Constraints

Preserve track/render order, old documents and source identity. No production project
mutations or direct deployments. Keep generated GraphQL outputs untouched unless SDL changes.

## Verification

Run contracts/composition/Manager focused tests, types and lint. Verify canvas drag,
undo/save/reopen, preview/export speed parity and baseline/candidate load measurements
with synthetic media. Record limits for the project-specific render investigation.

Evidence and runnable checks: `docs/validation/studio-editor-feedback/README.md`.
Items 2–6 are complete locally; feat-616 retains the unidentified render incident.
