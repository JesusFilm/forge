---
id: "feat-456"
title: "Standalone Studio video editor"
owner: "tataihono"
priority: "P1"
status: "not-started"
start_date: "2026-09-07"
duration: 5
depends_on:
  - "feat-453"
  - "feat-454"
  - "feat-455"
blocks:
  - "feat-457"
  - "feat-458"
  - "feat-460"
tags:
  - "ai-pipeline"
  - "manager"
---

## Problem

Lyuba needs to inspect and manually change the composition immediately instead of waiting for each MP4 render.

## Entry Points — Read These First

1. `docs/plans/2026-09-07-001-feat-studio-video-authoring-plan.md` — full contract, rollout and verification design.
2. `apps/manager/AGENTS.md`
3. `apps/manager/src/app/dashboard/shorts/`
4. `apps/manager/src/features/shorts/`
5. `apps/manager/src/features/shell/manager-shell.tsx`
6. `packages/shorts-compositions/src/`

Paths marked proposed do not exist yet. Frontmatter dates/durations are planning placeholders, not delivery commitments.

## Grep These

- `short-preview|next/dynamic|draftVersion|ShortComposition|SHORT_TEMPLATES`

## What To Build

1. Replace the Shorts product views with proposed src/features/video-studio/ project listing and NLE, retaining the existing route during cutover.
2. Implement tracks/canvas/inspector, text and card inspection, trimming, crop, audio controls, undo/history, source/pack pickers, and custom-component exposed controls.
3. Persist all manual edits through the revision-checked authoring module; recover saves, display conflicts, and preserve selection/playhead across updates.
4. Use client-only lazy Player/compiler loading, stable memoized props, scoped asset resolution, and HLS preview without MP4 preparation as a review prerequisite.
5. Allow standalone projects with no calendar date and flexible dimensions/arrangements; remove inherited fixed caption-template and 180-second assumptions.

## Constraints

- Reuse Manager colors; no new palette without an explicit design request.
- Do not expose Mastra Studio engineering UI as the product editor.
- No mandatory devotional card sequence or arbitrary React-to-editable-elements promise.

## Verification

- Browser test: create a standalone project, arrange multiple items, edit/trim/crop, undo, save, reopen and preview from real source media.
- Two-client stale-save test prevents last-write-wins loss.
- Production build plus cold/warm load, resource waterfall, usable-controls and seek measurements against a pre-change baseline.
