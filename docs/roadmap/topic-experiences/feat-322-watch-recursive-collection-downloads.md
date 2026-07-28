---
id: "feat-322"
title: "Watch recursive collection downloads"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-28"
duration: 2
depends_on:
  - "feat-251"
blocks: []
tags:
  - "web"
  - "admin"
  - "watch"
  - "download"
  - "ux"
---

## Problem

The collection download modal only discovers direct child videos. Collections
such as Shine Films contain series containers, so the visible control opens a
zero-download batch even though its nested episodes have downloadable media.

## Entry Points

1. `docs/plans/2026-07-28-002-fix-watch-recursive-collection-downloads-plan.md`
2. `apps/admin/src/services/video.service.ts`
3. `apps/admin/src/graphql/types/video.ts`
4. `apps/web/src/lib/watch-collection-download-actions.ts`
5. `apps/web/src/components/watch/CollectionDownloadModal.tsx`

## Delivery

Expand the existing lazy collection download lookup to ordered, safe,
cycle-aware leaf descendants. Preserve exact language, visibility, opaque
download URL, one-at-a-time queue, and direct-collection behavior.

## Verification

- Focused Admin recursive traversal and GraphQL contract tests.
- Focused Web server-action, option-builder, modal, and series-page tests.
- Admin schema/client regeneration, Web typecheck, lint, and nested browser
  smoke.
