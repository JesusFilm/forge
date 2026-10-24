---
id: "feat-238"
title: "Admin Image Picker Scroll Frame"
owner: "codex"
priority: "P2"
status: "complete"
start_date: "2026-07-08"
duration: 1
depends_on:
  - "feat-237"
blocks: []
tags:
  - "platform"
  - "admin"
  - "ui"
  - "experience"
---

## Problem

The admin experience editor image picker is now clipped to the modal, but the
image result list still does not scroll because the drop-target wrapper lets the
result grid define its own height.

## Entry Points - Read These First

1. `apps/admin/AGENTS.md`
2. `apps/admin/CLAUDE.md`
3. `apps/admin/src/app/dashboard/experiences/experience-editor/image-picker-browser.tsx`
4. `apps/admin/src/app/dashboard/media/media-asset-drop-target.tsx`

## Grep These

- `MediaAssetDropTarget` in `apps/admin/src/app/dashboard/experiences/experience-editor/image-picker-browser.tsx`
- `contentClassName` in `apps/admin/src/app/dashboard/media/media-asset-drop-target.tsx`

## What To Build

1. Keep the picker result area clipped inside the modal.
2. Ensure the drop-target content wrapper receives a real height.
3. Preserve the full media library page's existing drop-target sizing.

## Constraints

- Keep scope inside admin UI layout.
- Do not change media upload behavior or media asset contracts.
- Do not hand-edit generated outputs.

## Verification

- `pnpm --filter @forge/admin test -- src/app/dashboard/experiences/experience-editor.test.tsx`
- Browser smoke: open an experience editor with many image assets and confirm
  the picker result pane scrolls inside the modal.
