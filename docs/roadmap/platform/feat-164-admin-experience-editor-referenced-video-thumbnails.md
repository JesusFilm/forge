---
id: "feat-164"
title: "Admin Experience Editor Referenced Video Thumbnails"
owner: "ekkasit"
priority: "P1"
status: "complete"
start_date: "2026-05-11"
duration: 1
depends_on:
  - "feat-101"
blocks: []
tags:
  - "platform"
  - "admin"
  - "experience"
  - "media"
---

## Problem

Experience editor media collection items can reference videos outside the
initial recent-video library payload. When those item payloads do not store
their own `imageUrl` or `imageOverrideUrl`, the editor cannot resolve the
selected video's preview image and renders a blank thumbnail placeholder even
though the video has `VideoImage` rows.

## Entry Points

1. `apps/admin/src/app/dashboard/experiences/[id]/page.tsx`
2. `apps/admin/src/app/dashboard/live-data.ts`
3. `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`

## What Changed

1. Extract video IDs from the selected Experience locale blocks.
2. Ensure `loadVideoRows` merges those referenced videos with the recent-video
   library payload.
3. Keep the existing media item image fallback chain unchanged:
   item override, item image URL, then selected video preview image.
4. Add regression coverage for nested media collection references.

## Verification

- The `obey/en` editor route shows thumbnails for media collection items whose
  videos are older than the first recent-video page.
- Existing dashboard video-library consumers still receive the recent-video
  payload.
