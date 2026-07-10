---
id: "feat-240"
title: "Watch Home Media Item Slug Hotfix"
owner: "codex"
priority: "P0"
status: "complete"
start_date: "2026-07-08"
duration: 1
depends_on:
  - "feat-239"
blocks: []
tags:
  - "platform"
  - "admin"
  - "web"
  - "media"
---

## Problem

The production Watch homepage renders Admin-authored `MediaCollectionItem`
cards with `videoId` and `muxPlaybackId`, but `videoSlug: null`. Web's
`MediaCollection` renderer intentionally renders slug-less items as non-link
cards, so the homepage cards are not clickable even though the linked Video row
has a canonical slug.

## Entry Points - Read These First

1. `apps/admin/AGENTS.md`
2. `apps/admin/CLAUDE.md`
3. `apps/admin/src/graphql/types/blocks.ts`
4. `apps/web/AGENTS.md`
5. `apps/web/src/components/sections/MediaCollection.tsx`

## What To Build

1. Resolve `MediaCollectionItem.videoSlug` from the linked Admin Video row when
   `videoId` is present.
2. Preserve stored `videoSlug` as a fallback for legacy payloads without
   `videoId`.
3. Keep `muxPlaybackId` hover-preview resolution unchanged.
4. Verify Web media collection cards link when Admin supplies the resolved slug.

## Verification

- `pnpm --filter @forge/admin test -- src/graphql/types/blocks.test.ts`
- `pnpm --filter @forge/admin schema:print`
- `pnpm --filter @forge/admin-graphql generate`
- `pnpm --filter @forge/web test -- src/components/sections/MediaCollection.test.tsx`
