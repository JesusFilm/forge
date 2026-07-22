---
title: "fix(web): Align Watch home standalone media top spacing"
type: "fix"
status: "completed"
date: "2026-07-22"
origin: "user screenshot and live /watch DOM inspection"
---

# fix(web): Align Watch home standalone media top spacing

## Problem Frame

At the reported compact viewport, the New Believer Course
`VideoCarouselBlock` begins at the exact boundary of the preceding media
collection. Live inspection confirmed that its homepage content-rail wrapper
has `padding-top: 0px`; the preceding self-contained Watch section uses
`py-16`. The homepage composition owns this wrapper, so it is the narrowest
place to restore the missing top rhythm without changing reusable media
renderers.

## Requirements

- **R1:** Top-level `VideoCarouselBlock` and `VideoBlock` wrappers on `/watch`
  receive a 64px top inset.
- **R2:** Existing horizontal rail alignment remains unchanged.
- **R3:** Hero and self-contained blocks receive no additional wrapper or
  padding.
- **R4:** The change adds only a layout class and focused regression coverage.

## Scope Boundaries

In scope are `WatchHomeExperiencePage`, its focused test, the roadmap follow-up,
and compact browser proof. Generic Experience routes, Watch detail routes,
shared content-width tokens, player behavior, CMS data, and authored block order
are out of scope.

## Implementation Unit U1 — Restore homepage media-block top rhythm

**Files:**

- `apps/web/src/components/home/WatchHomeExperiencePage.tsx`
- `apps/web/src/components/home/WatchHomeExperiencePage.test.tsx`
- `docs/roadmap/platform/feat-287-watch-home-standalone-media-top-spacing.md`

**Approach:** Add `pt-16` to the existing homepage-only standalone media rail.
Assert that both eligible block wrappers include it while existing selective
wrapping and order assertions continue to pass.

**Test scenarios:**

- A top-level `VideoCarouselBlock` wrapper contains `pt-16`.
- A top-level `VideoBlock` wrapper contains `pt-16`.
- `VideoHeroBlock`, `SectionBlock`, and `MediaCollectionBlock` remain outside
  the homepage content-rail wrapper.
- At the compact viewport, the course copy is 64px below its wrapper boundary
  with no horizontal overflow.

## Verification

- Run the focused `WatchHomeExperiencePage` test.
- Run Web typecheck and lint for the touched files.
- Inspect the local `/watch` DOM and capture a compact screenshot.
- Review the final diff for scope and mark the roadmap ticket complete.
