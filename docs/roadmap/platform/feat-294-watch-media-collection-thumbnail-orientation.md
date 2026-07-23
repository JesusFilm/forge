---
id: "feat-294"
title: "Watch Media Collection Thumbnail Orientation"
owner: "codex"
priority: "P2"
status: "complete"
start_date: "2026-07-22"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "admin"
  - "web"
  - "watch"
  - "ui"
---

## Problem

Experience authors cannot choose a thumbnail shape independently from a media
collection's carousel, grid, collection, hero, or player layout. Thumbnail
orientation is currently inferred from the layout variant, so changing a card
from portrait to landscape also requires changing the collection layout.

## Entry Points

1. `apps/admin/src/domain/blocks.ts` - persisted Media Collection block contract.
2. `apps/admin/src/graphql/types/blocks.ts` - public Media Collection GraphQL fields.
3. `apps/admin/src/app/dashboard/experiences/experience-editor.tsx` - Media Items canvas controls.
4. `apps/admin/src/app/dashboard/experiences/experience-editor/block-helpers.ts` - new-block defaults.
5. `packages/admin-graphql/src/fragments/blocks/media-collection.ts` - shared Watch fragment.
6. `apps/web/src/components/sections/MediaCollection.tsx` - card orientation and responsive layout.

## Grep These

- `MediaCollectionBlockSchema`
- `showItemNumbers`
- `mediaCollectionVariant`
- `orientation="vertical"`
- `isVerticalGrid`

## What To Build

1. Add a block-level `thumbnailOrientation` contract with `vertical` and
   `horizontal` values.
2. Add an accessible switch beside the Media Items action in the Admin editor,
   with the current shape clearly labeled and persisted in the hidden blocks
   payload.
3. Default newly created Media Collection blocks to vertical thumbnails while
   preserving the existing variant-derived orientation for legacy blocks that
   do not yet carry the field.
4. Expose the field through Admin GraphQL and the shared Watch fragment.
5. Apply the authored orientation to carousel and grid cards, including card
   sizing and responsive column counts.

## Constraints

- Do not couple thumbnail orientation to the existing layout-variant control.
- Do not change item artwork, captions, links, hover previews, progress, or
  interaction frames.
- Keep legacy persisted blocks valid and visually unchanged until an author
  chooses an explicit orientation.
- Regenerate both the Admin SDL and `@forge/admin-graphql` introspection after
  the Pothos field is added.

## Verification

- `pnpm --filter @forge/admin exec vitest run src/domain/blocks.test.ts src/graphql/types/blocks.test.ts src/app/dashboard/experiences/experience-editor.test.tsx src/app/dashboard/experiences/experience-editor/block-helpers.test.ts`
- `pnpm --filter @forge/web exec vitest run src/components/sections/MediaCollection.test.tsx`
- `pnpm --filter @forge/admin schema:print`
- `pnpm --filter @forge/admin-graphql generate`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/web typecheck`
- `git diff --check`
- Browser proof that toggling the Admin switch updates the blocks payload and
  that Watch renders matching portrait and landscape cards without console
  errors or page-load regression.

## Completion Evidence

- Admin domain, GraphQL, block-helper, and editor suites: 205 tests passed.
- Web Media Collection suite: 35 tests passed, including horizontal carousel
  and vertical grid coverage.
- Admin and Web typechecks, scoped ESLint, scoped Prettier, and
  `git diff --check` passed.
- Admin SDL and `@forge/admin-graphql` introspection regenerated successfully.
- Browser QA confirmed the switch changes from Vertical to Horizontal,
  persists `thumbnailOrientation: "horizontal"`, and emits no console errors
  or warnings. The control only updates existing editor state; it introduces
  no new effects, requests, or client initialization work.
