---
id: "feat-426"
title: "Watch homepage browse-by-category rail"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-08-25"
duration: 1
depends_on: []
blocks:
  - "feat-437"
tags:
  - "watch"
  - "web"
  - "search"
  - "i18n"
---

## Problem

The Watch homepage has no top-level map of what the library contains. A visitor
sees the hero, then authored rails, then an infinite collection feed that pages
in three collections at a time; reaching a category as ordinary as Easter or
Family means scrolling through unrelated rails. The catalog itself is much
larger than the homepage admits: 111 English collections and 1,168 English
items, 35 of those collections already feeding the dynamic homepage feed.

The obvious alternative — category cards that submit a search — does not work
for the axis users ask for first. Production search on 2026-08-25 returned 8
results for `animated`, 1 for `short films`, and 0 for `feature films`, because
Watch has no label-filtered browse destination for those queries to land on.

## Entry Points - Read These First

1. `apps/web/src/lib/watch-home-categories.ts` - the category set, its slugs, and why format categories are excluded.
2. `apps/web/src/components/home/WatchHomeCategoryRail.tsx` - the rail, its icon contract, and its geometry.
3. `apps/web/src/components/home/WatchHomeExperiencePage.tsx` - placement directly beneath the hero on both hero paths.
4. `apps/web/src/lib/search-categories.ts` - the older browse-modal topic cards, which stay search-backed and separate.
5. `apps/web/scripts/ui-translation-policy.json` - the pending-translation escape hatch used by the new copy.

## Grep These

- `WATCH_HOME_CATEGORIES|CATEGORY_ICON_BY_ID`
- `watch-home-category-rail|watch-home-category-card-`
- `WatchHomeCategories`
- `pendingTranslationPaths`

## What To Build

1. A carousel of category cards under the Watch hero, one card per category the
   library actually has, each linking to the collection page that already
   renders that category's videos.
2. A static, dependency-free category config: no homepage data fetch, no new
   admin query, no images, so the rail cannot slow the homepage or break when
   collection data changes. Evergreen categories lead; seasonal Easter and
   Christmas sit at the end so the opening cards stay useful year-round.
3. A compile-time icon contract keyed by category id, mirroring
   `CATEGORY_ICON_BY_SEARCH_TERM`, so a new category without an icon fails the
   build rather than rendering blank.
4. Rail geometry borrowed from `MediaCollection`: content-width column, heading
   padding repeated as the slide list's left padding, and a real trailing
   spacer slide because embla trims trailing CSS padding.
5. A "See all video collections" pill on the right of the heading row, linking
   to the localized `/{lang}.html/videos` inventory — the one page that already
   lists every collection (111 in English) grouped for browsing.
6. Film grain on each tile, reusing the `/watch/images/overlay.svg` noise the
   media-collection sections already load on this page, so the texture costs no
   extra request. The layer is `pointer-events-none` and sits under the card's
   own title.

## Constraints

- Do not add format categories (feature films, series) until a label-filtered
  browse destination exists; search cannot serve them. `short-videos` is the
  single format-named card and it is still a collection link — it points at
  Conversation Starters, the largest short-film collection (21 English short
  films), which is why that collection has no separate card of its own.
- Do not fetch homepage data for this rail. The homepage is `force-static` with
  hourly revalidation and its critical path is already image-heavy.
- Do not reuse `search-categories.ts`. Those six cards submit a query into the
  search overlay; these cards navigate to collection pages, and merging the two
  taxonomies would make one of the two behaviours a lie.
- New UI copy ships English-first through `pendingTranslationPaths`; it is not
  hand-translated into the 223 machine-translated catalogs.

## Verification

- All 13 destinations return HTTP 200 on production (checked 2026-08-25).
- `WatchHomeCategoryRail` renders one card per configured category, with
  language-less English hrefs and language-suffixed hrefs for other audio
  languages.
- The rail renders exactly once, directly after the hero, on both the authored
  `WatchHomeHeroBlock` path and the fallback hero-carousel path.
- Category title keys and the en.json `categories` block match exactly in both
  directions, so an orphan key on either side fails.
- The heading CTA resolves to `/english.html/videos` and to the audio-language
  inventory for other languages; card order is pinned at both ends.
- Every tile carries a `pointer-events-none` grain layer, and the grain test id
  does not collide with the `watch-home-category-card-` prefix the card-count
  assertion selects on.
- `pnpm --filter @forge/web test`, `lint`, `typecheck`,
  `check:ui-locales`, and `check:provisional-ui-catalogs` pass.
- Headless-browser render at 1440px and 390px shows correct alignment and no
  component console errors.

## Follow-ups

1. Run `pnpm --filter @forge/web translate:ui-catalogs` for the
   `WatchHomeCategories` namespace and drop its 17 entries from
   `pendingTranslationPaths`.
2. Decide whether format categories deserve a real destination — a
   label-filtered view over `watchLanguageInventory`, which already returns
   `label`, `durationSeconds`, and `childCount` per row — and only then add
   Feature films / Series cards to this rail and repoint `short-videos` at a
   real format destination instead of Conversation Starters.
3. Revisit the category set when the collection catalog changes; the rail is a
   hand-picked subset of collection parents, not a live projection of them.
