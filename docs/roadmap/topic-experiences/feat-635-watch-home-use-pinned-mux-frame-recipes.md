---
id: "feat-635"
title: "Use Pinned Mux Frame Recipes for Watch Home Posters and Thumbnails"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "media"
  - "performance"
---

## Problem

FGE-167 / W-013 records duplicate Watch home thumbnail builders that omit
admin's pinned derivative parameters. The model requests a bare JPG; the
carousel requests a custom 640x720 JPG without `time=2`. The original named
observer is unknown. The issue's historical warm/cold samples do not establish
current performance or provider savings.

## Entry Points - Read These First

1. `apps/web/src/lib/url.ts` - `resolveMuxFrameThumbnailUrl` emits the exact
   448x252 JPG smartcrop recipe at time 2; `resolveMuxHeroPosterUrlAtMaxWidth`
   emits WEBP with `time=2&width=1280`, without a height parameter.
2. `apps/admin/src/services/mux-image-derivative.service.ts` - primary
   `WATCH_CHAPTER_CAROUSEL_RECIPE` and `WATCH_HERO_POSTER_RECIPE` definitions.
3. `apps/web/src/lib/watch-home.ts` - card image fallback.
4. `apps/web/src/components/home/WatchHomeTvCarousel.tsx` - hero/timeline sources.
5. `apps/web/src/lib/__tests__/watch-home.test.ts` and
   `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx` - output tests.

## Scope and Constraints

- Delete only the two duplicate thumbnail builders and reuse the shared helpers.
- Preserve the hero helper's parameter order, authored-first small artwork,
  frame-first full-width hero, image metadata, eligibility, audience guards,
  language/subtitle mapping and current player/loading/priority behavior.
- Integrate the existing PR lineage with its declared #2629 parent; preserve
  parent tests and reconcile only this ticket's README row/count delta.
- Blank model artwork tiers and blank timeline/HLS fallback remain owned by
  #2618 (FGE-171/FGE-174). #2643 is a separate language-inventory card path.
  Recipe reuse does not fix those gaps. Deterministic opening remains #2638.
- Do not change global recipes, generated GraphQL outputs or runtime imports
  across app boundaries.

## Verification

- Demonstrate red model and converter output cases against the old builders,
  then run scoped Web home/model/helper tests with at most two workers.
- Pin literal upstream recipe bytes, trimmed/encoded and absent playback IDs,
  authored artwork preference and existing missing-image reporting.
- Run Web typecheck, touched ESLint/Prettier, whitespace and roadmap checks.
- Independently review the frozen staged candidate before publication. Candidate
  CI, actual-route requests/decoding, devices and paired loading/performance
  acceptance remain pending; historical CI does not cover the integration.

## Resolution and Durable Guidance

The staged implementation uses `resolveMuxFrameThumbnailUrl` for the model and
carousel thumbnail fallback and retains `resolveMuxHeroPosterUrlAtMaxWidth` for
the hero. Exact output tests replace helper-to-helper comparisons. No new media
work, preload, activation or player clock is introduced.

Follow
`docs/solutions/best-practices/missing-artwork-frame-fallback-derivative-recipe-and-authored-first-20260826.md`:
derive requests from upstream recipes rather than layout width, pin bytes at
consumer outputs, and distinguish blank artwork from missing artwork. Its older
hero URL prose is historical; the current Web helper's `time=2&width=1280` order
is preserved. Source tests do not demonstrate a warm provider cache, decoded
portrait/landscape output, or page-load non-degradation.
