---
title: "Keep Watch media collection authored copy above media"
date: "2026-07-21"
category: "ui-bugs"
module: "apps/web Watch Experience renderer"
problem_type: "ui_bug"
component: "frontend_stimulus"
symptoms:
  - "A category label suppressed the separately authored supporting title."
  - "The collection description rendered below thumbnails with footer copy."
  - "Carousel and grid collections lost the authored header-to-media reading order."
  - "The Watch CTA centered against the full copy stack instead of aligning with the title."
root_cause: "logic_error"
resolution_type: "code_fix"
severity: "medium"
related_components:
  - "Admin Experience editor"
  - "Media collection carousel and grid variants"
tags:
  - "watch-page"
  - "media-collection"
  - "experience-builder"
  - "authored-copy"
  - "content-order"
  - "responsive-layout"
---

# Keep Watch media collection authored copy above media

## Problem

The Watch `MediaCollection` renderer treated independently authored Experience
fields as fallbacks and placed the collection description with trailing footer
copy. When editors supplied both a category label and supporting title, only the
category label appeared, and the description rendered after the thumbnails.

## Symptoms

- `categoryLabel ?? subtitle` reduced two authored values to one eyebrow.
- `description` and `footerText` shared the post-media block even though they
  describe different parts of the collection.
- On the live Acts collection, the intended order of category, title,
  supporting title, description, media, and footer was visibly inverted.

## What Didn't Work

- Styling the post-media copy could not repair the semantic DOM order.
- Treating `categoryLabel` and `subtitle` as interchangeable continued to hide
  authored content because Admin and GraphQL expose them independently.
- Browser setup initially reused a stale local Admin schema, then a matching
  Admin process whose copied environment referenced a Docker-only database.
  These were verification-environment failures, not renderer failures. Fetching
  the worktree Web secrets and rendering the local branch against production
  Admin GraphQL supplied the exact live Experience content safely.

## Solution

Pass every authored field to the shared collection shell independently:

```tsx
<WatchHomeMediaCollection
  categoryLabel={categoryLabel}
  title={title}
  subtitle={subtitle}
  description={description}
  footerText={footerText}
/>
```

Render the supporting copy in the shared header before dispatching to either
the carousel or grid branch:

```tsx
{
  categoryLabel ? <p>{categoryLabel}</p> : null
}
{
  title ? <h2>{title}</h2> : null
}
{
  subtitle ? <p>{subtitle}</p> : null
}
{
  description ? <p>{description}</p> : null
}

{
  isRail ? <Carousel>{/* cards */}</Carousel> : <div>{/* grid */}</div>
}

{
  footerText ? <p>{footerText}</p> : null
}
```

The existing empty-items early return, CTA inference, links, cards, hover
previews, backdrops, progress, and carousel branch remain unchanged.

Place the title and CTA in a dedicated `flex` row with `items-start`, then keep
the supporting title and description below that row. This makes the CTA share
the title's top edge instead of centering against the entire header stack. Use
explicit `font-normal` styling for the description and footer, with the
description reduced to `text-sm xl:text-base`. When a collection has no title,
retain the prior copy-first compact order and trailing-edge desktop CTA layout.

## Why This Works

The shared header is structurally before both media variants, so carousel and
grid collections inherit the same authored reading order without duplicating
layout logic. Keeping `footerText` in the trailing block preserves the distinct
closing-copy role. Because the change adds only server-rendered markup and
passes existing data through existing component boundaries, it adds no request,
effect, dependency, observer, or client initialization path.

## Verification

- Focused `MediaCollection` coverage passed all 23 tests, including DOM-order
  assertions for carousel and grid branches, optional-field combinations, and
  the title-less CTA fallback.
- Web typecheck and lint passed.
- At 1440x900, the Acts title and CTA both began at `y=3292.86`; the description
  computed to `16px/400`, ended at `y=3531.36`, and the first media row began at
  `y=3555.36`.
- At 390x844, the title and CTA both began at `y=3280.15`; the description
  computed to `14px/400`, ended at `y=3705.40`, and the first card began at
  `y=3729.40`.
- Footer copy computed to weight `400`, remained after the media cards, and
  document scroll width equaled client width at both viewports.
- CTA focus and activation reached the Acts collection route; the first card
  reached its expected Watch route.
- Dragging a live carousel changed its transform from `0` to approximately
  `-584.55px`, proving the rail behavior survived.
- A clean reload reported no page errors or failed resources. One existing
  Next/Image positioning warning remained unrelated to this renderer change.
- The navigation document encoded 86,233 bytes in the local development run;
  the newly visible Acts supporting title and description account for 584
  UTF-8 text bytes. This is payload evidence, not a production performance
  benchmark.

## Prevention

- Preserve independently authored Experience fields as independent renderer
  props unless the contract explicitly defines fallback behavior.
- Put shared copy before variant dispatch when every variant must preserve the
  same semantic order.
- Pair jsdom visibility assertions with `compareDocumentPosition` checks for
  both carousel and grid branches.
- Browser-prove compact and wide geometry, overflow, real navigation, carousel
  movement, console health, and request behavior for shared Watch renderers.
- When a CTA belongs to a specific heading, put both in a dedicated alignment
  row rather than aligning the CTA against a variable-height copy stack.

## Related Issues

- [Implementation plan](../../plans/2026-07-21-002-fix-media-collection-copy-order-plan.md)
- [Roadmap ticket](../../roadmap/platform/feat-277-watch-media-collection-header-copy-order.md)
- [Residual category-label assertion coverage](https://github.com/JesusFilm/forge/issues/1647)
- [Authored carousel structural contract](watch-authored-media-collection-responsive-card-density.md)
- [Media collection CTA inference](../design-patterns/watch-media-collection-default-cta-parent-inference-20260715.md)
- [Frontend page-load verification](../conventions/frontend-change-page-load-performance-verification.md)
