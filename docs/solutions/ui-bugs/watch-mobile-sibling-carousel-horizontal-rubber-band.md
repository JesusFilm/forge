---
title: "Contain Watch sibling-carousel overflow to prevent mobile page rubber-banding"
category: "ui-bugs"
module: "apps/web"
problem_type: "ui_bug"
tags:
  - "watch"
  - "mobile"
  - "embla"
  - "overflow"
  - "rubber-band"
date: "2026-07-16"
---

# Contain Watch sibling-carousel overflow to prevent mobile page rubber-banding

## Symptom

On mobile Watch chapter pages, a horizontal gesture outside the chapter rail
could pull the document content sideways before it snapped back. The fixed
header stayed anchored, making the body appear draggable even though the page
did not retain a horizontal scroll position.

## Root cause

`SiblingCarousel` passed
`viewportClassName="overflow-x-visible md:overflow-x-clip"` to the shared
`CarouselContent`. On mobile, Tailwind class merging replaced the primitive's
default `overflow-x-clip` with `overflow-x-visible`, so the full transformed
Embla track contributed to ancestor overflow.

At a 375 px document width, the production page's body measured 10,883 px of
horizontal content. Root `html` and `body` clipping hid the overflow bar but did
not remove the oversized descendant that mobile browsers could elastically pan.

## Fix

Remove the Watch-only viewport override and use the shared carousel default:
`overflow-x-clip overflow-y-visible`.

Keep the outer negative margin, inner leading padding, item bases, and trailing
spacer unchanged. Those values control the intentional edge-aligned visual
bleed; the Embla viewport should clip the off-screen track while Embla continues
to translate it during an in-rail swipe.

Do not start with global `touch-action` or `overscroll-behavior` suppression for
this symptom. Correct the descendant that produces page-level overflow first so
horizontal carousel interaction remains available.

## Verification

- The focused SiblingCarousel and shared CarouselContent suites pass 32 tests.
- The production Web build completes, including TypeScript validation.
- At a 390 px browser viewport with a 375 px layout viewport:
  - `document.documentElement.scrollWidth === 375`
  - `document.body.scrollWidth === 375`
  - a horizontal drag outside the rail keeps `scrollX === 0` and the page left
    edge at `0`
  - a drag inside the rail changes its transform by about 178 px while page
    `scrollX` remains `0`

The local Apple CoreSimulator service could not enumerate devices during this
run, so direct Mobile Safari interaction remained unavailable. The phone-width
browser proof still exercises the page and Embla pointer gesture separately;
repeat the same outside/inside gestures in Mobile Safari when simulator service
access is available.

## Regression guard

`apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx` requires the
rendered carousel viewport to contain `overflow-x-clip` and rejects
`overflow-x-visible`. The shared default remains covered in
`apps/web/src/components/ui/__tests__/carousel.test.tsx`.
