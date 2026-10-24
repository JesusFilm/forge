---
title: "A third Watch header control overflows the mobile trailing grid column and clips the language globe"
date: 2026-08-26
problem_type: ui_bug
module: apps/web
component: floating_header
severity: medium
tags:
  - watch
  - floating-header
  - css-grid
  - responsive
  - mobile
  - overflow-clip
  - browser-verification
applies_when:
  - "Adding a control to the Watch floating header's trailing group (language globe / account slot)"
  - "Adding anything to a fixed grid header whose columns are sized with `minmax(<px>,1fr)`"
  - "Reviewing a header change whose only evidence is jsdom unit tests"
---

# A third Watch header control overflows the mobile trailing grid column

## Context

feat: "watch all videos in this language" header link (2026-08-26). The Watch
floating header (`apps/web/src/components/FloatingSearchProvider.tsx`) lays out
three grid columns from `FLOATING_HEADER_LAYOUT_CLASS`
(`apps/web/src/lib/content-width.ts`):

```
grid-cols-[minmax(80px,1fr)_minmax(0,800px)_minmax(80px,1fr)]        // mobile
sm:grid-cols-[minmax(112px,1fr)_...]  md:grid-cols-[minmax(139px,1fr)_...]
```

The third column holds the trailing group: the language globe (44px, or ~68px
once the language-code chip renders) plus `AccountControl`. Adding one more
44px icon control makes that group ~116px wide.

## What happened

`1fr` is a share of _free_ space, not a content-driven maximum, so the column
does **not** grow to fit its content — the group overflows to the right. At a
375px viewport, measured against `next start`:

```
before: trailing group 287 → 355   (header right edge = 355, viewport = 375)
after:  trailing group 275 → 391   (globe right edge 391 — 16px past the viewport)
```

`html`/`body` carry `overflow-x-clip`, so `documentElement.scrollWidth -
clientWidth` still reported **0**: there is no scrollbar and no layout-shift
signal. The globe and its language code are simply cut off. Every unit test
stayed green — jsdom does not compute grid tracks or media queries, so no
component test can see this class of regression.

## Guidance

1. **Any addition to a fixed grid header needs a real-browser geometry
   measurement at the narrowest supported width**, not just unit tests. Compare
   `getBoundingClientRect()` for each header child before and after the change.
   Element rects are the proof; a screenshot is optional and `overflowX === 0`
   is _not_ proof when an ancestor clips overflow.
2. **Do not trust `scrollWidth - clientWidth` on a surface with
   `overflow-x-clip`.** Assert that each control's `right` is `<=` the header's
   own `right`.
3. When the narrow layout genuinely has no room, gate the new control at the
   breakpoint whose column min fits it (`hidden md:inline-flex` for a 44px
   control: 44 + 8 gap + 68 = 120px < the 139px `md` column min; the 112px `sm`
   column is still too narrow). Widening the shared column template is a
   header-wide layout change — it shrinks the mobile search field (measured:
   151px → 107px at 375px) on every Watch page and deserves its own design
   decision rather than riding along in a feature PR.
4. Pin the breakpoint gate with a **class-token assertion** in the component
   test and say why in a comment — jsdom cannot evaluate the media query, so the
   tokens (`hidden`, `md:inline-flex`) are the only honest unit-level pin. Keep
   the measured numbers in that comment so the next reader knows the gate is
   empirical, not taste.

5. **A breakpoint-gated control needs a counterpart on the hidden side, and
   the derivation must be shared, not duplicated.** The shipped split is: the
   header control renders only in the non-search chrome at `md`+, and the
   search overlay renders its own full-width row above the category tiles at
   every width while the modal is open — so exactly one entry point exists in
   each state. The href is derived once in `FloatingSearchProvider` and threaded
   through the floating-search context, so the two surfaces can never disagree
   about which language "all videos" means. Duplicating
   `resolveHeaderLanguageSlug` in the overlay would have been the drift bug.
6. **Promoting an accessible name to visible text changes the copy bar.** The
   header icon's `aria-label` interpolates a title-cased English slug
   ("See all videos in Spanish Castilian") — tolerable when only screen readers
   hear it. As visible text in a translated UI it reads as mixed copy
   ("Посмотреть все видео (Russian)"), so the visible row reuses the
   destination page's own already-translated name instead
   (`VideosPage.title` → "Все видео").

7. **Measure the trailing group with `AccountControl` PRESENT.** It renders
   `null` in three states — session still loading, session fetch failed, and
   signed-out-with-the-download-account-gate-off — and a local `next start`
   with no auth backend hits the failure path, so every local measurement
   silently omits a 44/48px control. Measured at `md`, where the trailing track
   resolves to a fixed **139px**: globe (76) + gap (8) + new control (48) =
   132px fits, but adding the account button (+8+48) = **188px, i.e. 49px past
   the header's right rail**. Production today sends
   `accountGateEnabled: false` to anonymous visitors, so the icon is absent —
   but a signed-in user gets it. Inject a clone of the real button box and
   re-measure rather than trusting the local DOM.
8. **The search-open (modal) header has different overflow behaviour from the
   normal header.** `FLOATING_MODAL_HEADER_TRAILING_GROUP_CLASS` is a
   content-sized flex row at `md` (`md:flex md:justify-self-end`), not a
   `minmax()` grid track, so a third control there costs 0px of overflow —
   measured 996→1184 for link/globe/close at 1280px with the search field still
   710px wide. Don't generalise one header state's headroom to the other. That
   headroom exists but is deliberately unused: the shipped design keeps the
   modal header at two controls and puts the entry point in the overlay body,
   where a labelled row beats a third unlabelled icon.

## Why This Matters

The clipped element was the _pre-existing_ language globe, not the new control:
a purely additive feature silently broke an established mobile affordance, on
the surface where most Watch traffic lives, with a fully green test suite and no
overflow signal in the DOM.

## Related

- `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`
  — the same change also needs load evidence; here the browser pass produced
  both (bundle delta +214 B gzipped, 0 new requests, geometry unchanged on
  mobile).
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
  — another instance of "the substrate the tests run on cannot express the
  failure mode".
