---
title: "Watch home standalone media wrappers own their vertical spacing"
date: "2026-07-22"
category: "ui-bugs"
module: "apps/web Watch homepage"
problem_type: "ui_bug"
component: "frontend_stimulus"
symptoms:
  - "Top-level VideoCarouselBlock copy began directly against the preceding Watch section boundary."
  - "The New Believer Course block had the correct horizontal rail but computed to zero pixels of top padding."
root_cause: "logic_error"
resolution_type: "code_fix"
severity: "low"
related_components:
  - "apps/web/src/components/home/WatchHomeExperiencePage.tsx"
  - "apps/web/src/components/home/WatchHomeExperiencePage.test.tsx"
tags:
  - "watch-page"
  - "experience-blocks"
  - "vertical-spacing"
  - "video-carousel"
  - "layout-ownership"
---

# Watch home standalone media wrappers own their vertical spacing

## Problem

The Watch homepage composition added a horizontal content-rail wrapper around
top-level `VideoCarouselBlock` and `VideoBlock` renderers, but the wrapper did
not also establish the vertical section rhythm. On compact screens, the New
Believer Course eyebrow started at the exact boundary of the preceding media
collection instead of aligning with neighboring blocks' top inset.

## Symptoms

- Live `/watch` inspection showed `padding-top: 0px` on the element marked by
  `data-watch-home-content-rail`.
- The preceding self-contained media collection used `py-16`, making the
  missing inset visible at the background transition.
- Horizontal alignment was already correct and was not part of this defect.

## What Didn't Work

- Changing `CarouselVideo` would affect every route and nested section that
  reuses the renderer, even though those parents already own their spacing.
- Adding vertical padding to `WATCH_PAGE_CONTENT_CLASSES` would couple a
  horizontal rail token to one homepage composition and shift unrelated Watch
  detail-page consumers.

## Solution

Keep the fix at the homepage composition boundary that introduced the wrapper:

```tsx
<div
  className={`${WATCH_PAGE_CONTENT_CLASSES} pt-16`}
  data-watch-home-content-rail
>
  {renderedBlock}
</div>
```

The focused composition test asserts that both eligible standalone media
wrappers include `pt-16`, while existing assertions continue proving that hero
and self-contained block types do not receive that wrapper.

## Why This Works

Top-level standalone media renderers are deliberately width- and
spacing-agnostic so they can be embedded inside several parent layouts. On the
Watch homepage, `WatchHomeExperiencePage` supplies their missing parent layout.
Keeping both horizontal containment and vertical rhythm at that same boundary
avoids double-padding nested sections and preserves generic Experience routes.

## Prevention

- When a composition wraps an otherwise layout-agnostic renderer, compare both
  horizontal containment and vertical rhythm against an adjacent known-good
  block.
- Assert wrapper-owned spacing in the composition test, not in the shared
  renderer's unit test.
- For visual proof, measure the child-to-wrapper offset with
  `getBoundingClientRect()` and confirm the computed padding; a class-name check
  alone does not prove the deployed CSS value.

## Related Issues

- `docs/roadmap/platform/feat-286-watch-home-standalone-media-containment.md`
- `docs/roadmap/platform/feat-287-watch-home-standalone-media-top-spacing.md`
- `docs/plans/2026-07-21-003-fix-watch-home-media-containment-plan.md`
