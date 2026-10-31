---
id: "feat-916"
title: "Fall back from blank language-inventory artwork"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: ""
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "media"
---

## Problem

FGE-178 / W-016 originated in the collective September 13 Watch listing audit;
the named human reporter is unknown. `cardImageUrl` uses nullish coalescing,
while `imageUrl: item.imageUrl ?? null` preserves empty strings in the content
projection. Both card render sites guard on truthiness, so a blank authored URL
suppresses the existing Mux frame and leaves the gradient placeholder. This
source path and component fixtures establish the bug without claiming a fresh
production catalog occurrence.

## Entry Points — Read These First

1. `apps/web/src/components/watch-language-inventory/LanguageInventoryPage.tsx`
   — `cardImageUrl`, `InventoryCard`, `CompactVideoRow`, authored-first heroes.
2. `apps/web/src/components/watch-language-inventory/__tests__/LanguageInventoryPage.thumbnails.test.tsx`
   — unique-href card-scoped blank/null/authored/no-playback controls.
3. `apps/web/src/lib/watch-language-inventory.ts` — raw image projection.
4. `docs/plans/2026-10-30-watch-language-card-image-fallback.md` — integration
   scope, acceptance boundary and compound lesson.

## Grep These

- `cardImageUrl`
- `imageUrl: item.imageUrl ?? null`
- `resolveMuxFrameThumbnailUrl`
- `image fallback`

## What To Build

Use `item.imageUrl || resolveMuxFrameThumbnailUrl(item.muxPlaybackId)`.
Exercise subtitle-only `InventoryCard` and audio `CompactVideoRow` through
unique hrefs, requiring each card's actual `img` and the literal admin
`WATCH_CHAPTER_CAROUSEL_RECIPE` URL:
`thumbnail.jpg?width=448&height=252&fit_mode=smartcrop&time=2`.

## Constraints

Preserve current-main inventory, layout, filters, ordering, links, localization,
hero scans, portrait policy and authored-first behavior. No whitespace/invalid
URL cleanup, schema, generated types, new dependencies or SeriesHero/todo023
work. The old feat-637 identity collides with queued PR2617; feat-916 was reserved
after an all-author open-head, local-ref/worktree/index and reservation audit.
Dependencies and blocks remain empty.

## Verification

- Prove the incoming page-wide assertion passes on unchanged nullish main;
  then require the new per-card tests to fail only for blank artwork with
  playback on both surfaces before applying the operator repair.
- Run focused inventory/component and URL suites with at most two workers,
  Web typecheck, touched ESLint, Prettier, owned whitespace and roadmap identity,
  dependency and hidden-lane checks.
- Treat implementation completion separately from independent review,
  publication, current-head CI and target visual/loading acceptance.
- On the target, compare matched fixtures at 390px and 1280px: actual card image,
  exact recipe, authored-first heroes, links/keyboard, portrait geometry, cold
  request/transfer costs and layout/CLS. A formerly blank card now requests a
  useful frame; null/authored cases must retain their request graph and geometry.
  Component mocks and one public image HTTP sample do not certify page loading.

## Tracking

- Linear: [FGE-178](https://linear.app/jesus-film-project/issue/FGE-178)
- PR: [2643](https://github.com/JesusFilm/forge/pull/2643)

Implementation checks on October 30: 128 focused inventory/component tests and
8 URL tests passed; Web typecheck and touched ESLint passed. The 24 thumbnail
cases include 12 parameterized surface controls. Before repair, only the two
blank-with-playback controls failed; the incoming page-wide test passed on
nullish main. Target/CI acceptance remains pending as described above.
