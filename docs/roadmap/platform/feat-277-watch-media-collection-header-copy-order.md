---
id: "feat-277"
title: "Watch media collection authored copy order"
owner: "unassigned"
priority: "P1"
status: "complete"
start_date: "2026-07-21"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "experiences"
  - "ui"
---

## Problem

Web media collections currently collapse the Experience `categoryLabel` and
`subtitle` fields into one eyebrow and render the collection `description`
below the thumbnails beside `footerText`. This hides the authored supporting
title when a category label exists and reverses the intended content hierarchy
on `/watch/english.html`.

## Entry Points — Read These First

1. `apps/web/src/components/sections/MediaCollection.tsx` — shared carousel and
   grid renderer containing the current field mapping and DOM order.
2. `apps/web/src/components/sections/MediaCollection.test.tsx` — focused
   renderer coverage.
3. `apps/admin/src/app/dashboard/experiences/experience-editor.tsx` — existing
   authoring labels for supporting title, description, and footer copy.
4. `docs/solutions/ui-bugs/watch-authored-media-collection-responsive-card-density.md`
   — structural testing and browser-proof precedent for this renderer.

## Grep These

- `categoryLabel ?? subtitle`
- `mediaDescription: description`
- `description || footerText`
- `media-collection-carousel`
- `media-collection-section`

## What To Build

1. Render category label, title, supporting title, and description as distinct
   authored values above the carousel or grid.
2. Keep footer copy below the thumbnails.
3. Align the CTA to the top of the title row and preserve cards, localized
   links, hover previews, backdrops, progress, and carousel interaction.
4. Render the collection description at a smaller regular weight and keep
   footer copy at regular weight.
5. Let the supporting title and description use the full content width, keep
   only the eyebrow/title header in the CTA grid, and render the supporting
   title at regular weight.
6. Add explicit DOM-order coverage for carousel and grid variants plus optional
   field combinations.
7. Verify compact and wide layouts with browser screenshots, keyboard/card
   interaction, overflow checks, console health, and proportionate page-load
   evidence.

## Constraints

- Do not change Admin fields, GraphQL, generated types, or production content.
- Do not change card content, order, links, image loading, or media behavior.
- Preserve the existing behavior that hides collections with no resolved media
  items.
- Add no dependency, request, client effect, timer, observer, or initialization
  path.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/sections/MediaCollection.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke at 390x844 and 1440x900 with screenshots and measured text/media
  order.
- Confirm the carousel still moves, CTA/card keyboard flow works, the document
  does not overflow horizontally, and no new browser request or client work is
  introduced.

## Completion Evidence

- Focused `MediaCollection` Vitest: 23 tests passed, including the title-less
  CTA fallback.
- `@forge/web` typecheck and lint passed.
- The live Acts collection rendered through the local branch at 1440x900 and
  390x844 with category label, title, supporting title, and description before
  the media cards; footer copy remained after the cards.
- DOM and geometry checks confirmed the supporting title and description end
  before the first card begins at both viewports, with no horizontal document
  overflow.
- CTA focus/activation and first-card navigation reached their expected local
  Watch routes. The carousel rail still moved horizontally from `translateX(0)`
  to approximately `translateX(-584.55px)` under browser drag input.
- A clean hydrated reload produced no page errors or failed resources. The diff
  adds no effect, request, dependency, or client initialization path; the newly
  visible Acts supporting copy contributes 584 UTF-8 text bytes.
- Browser proof:
  `output/playwright/watch-copy-order-acts-wide.png` and
  `output/playwright/watch-copy-order-acts-mobile.png`.
- Follow-up browser proof measured an exact `0px` top-edge delta between the
  Acts title and Watch CTA at both 1440x900 and 390x844. The description
  computed to `16px/400` wide and `14px/400` compact, while the footer computed
  to weight `400` at both sizes. Neither viewport overflowed horizontally.
- Follow-up screenshots:
  `output/playwright/watch-copy-alignment-acts-wide.png` and
  `output/playwright/watch-copy-alignment-acts-mobile.png`.
- The final copy-width follow-up measured the supporting title and description
  at the full available content width: `1233px` at 1440x900 and `335px` at
  390x844. The supporting title computed to weight `400`, the title/CTA top-edge
  delta remained `0px`, and neither viewport overflowed horizontally.
- Final copy-width screenshots:
  `output/playwright/watch-copy-full-width-acts-wide.png` and
  `output/playwright/watch-copy-full-width-acts-mobile.png`.
- Follow-up test hardening is tracked separately in
  [GitHub issue #1647](https://github.com/JesusFilm/forge/issues/1647).
