---
id: "feat-237"
title: "Admin Image Library Picker Scroll"
owner: "codex"
priority: "P2"
status: "complete"
start_date: "2026-07-08"
duration: 1
depends_on:
  - "feat-107"
blocks: []
tags:
  - "platform"
  - "admin"
  - "ui"
  - "experience"
---

## Problem

The admin experience editor's image picker modal can receive enough media
assets that the image grid overflows past the modal instead of scrolling inside
the picker body.

## Entry Points - Read These First

1. `apps/admin/AGENTS.md`
2. `apps/admin/CLAUDE.md`
3. `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`
4. `apps/admin/src/app/dashboard/experiences/experience-editor.test.tsx`

## Grep These

- `image-library-title` in `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`
- `filteredImageLibrary` in `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`

## What To Build

1. Keep the image picker modal bounded to the viewport.
2. Make only the image results area scroll when the asset list is long.
3. Preserve search, empty-state, selection, and close behavior.

## Constraints

- Keep scope inside the admin experience editor.
- Do not change media asset data contracts or GraphQL schema.
- Do not hand-edit generated outputs.

## Verification

- `pnpm --filter @forge/admin test -- src/app/dashboard/experiences/experience-editor.test.tsx`
- Browser smoke: open an experience editor with many image assets and confirm
  the image grid scrolls inside the modal.
