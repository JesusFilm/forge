---
id: "feat-411"
title: "Watch single collection header"
owner: "codex"
priority: "P2"
status: "complete"
start_date: "2026-08-21"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "accessibility"
---

## Problem

The Watch episodes rail renders a native collection selector even when a
standalone video has only one eligible parent collection. The one-option
control implies that another choice is available and adds a focus target that
cannot change the displayed collection.

## Entry Points — Read These First

1. `apps/web/src/components/watch/SiblingCarousel.tsx` — selectable-parent
   header rendering and collection selection state.
2. `apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx` — focused
   one-parent, multi-parent, and contextual-header contracts.
3. `docs/plans/2026-08-21-1955-fix-single-collection-header-plan.md` — product,
   implementation, and verification contracts for the superseding behavior.

## Grep These

- `selectableParents`
- `sibling-carousel-parent-selector`
- `sibling-carousel-parent-title`
- `sibling-carousel-selection-announcement`

## What To Build

1. Keep the existing non-empty `selectableParents` model and selected-parent
   state unchanged.
2. When exactly one selectable parent exists, render its resolved title as
   bounded, non-interactive text beside the existing clip-position label.
3. Render the native collection select, its busy state, and its live
   announcement only when two or more selectable parents exist.
4. Preserve the no-selectable-parent contextual linked-title header and all
   carousel content, routing, active-item, and pending-navigation behavior.
5. Cover the one-parent fixed-text, multi-parent selector, and contextual-link
   paths in the focused component suite.

## Constraints

- Do not coerce a one-item `selectableParents` array to `null`; the null branch
  owns the distinct contextual linked-title behavior.
- The one-parent title must not be a select, link, button, control role, focus
  target, busy state, or live region.
- Do not change selectable-parent construction, routes, GraphQL, carousel
  geometry, resources, effects, dependencies, or client initialization.
- Preserve mobile overflow containment and the existing multi-parent selector
  styling and behavior.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/watch/__tests__/SiblingCarousel.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web exec eslint src/components/watch/SiblingCarousel.tsx src/components/watch/__tests__/SiblingCarousel.test.tsx`
- `pnpm exec prettier --check apps/web/src/components/watch/SiblingCarousel.tsx apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx docs/roadmap/platform/feat-411-watch-single-collection-header.md docs/plans/2026-08-21-1955-fix-single-collection-header-plan.md`
- `git diff --check`
- Browser smoke the single-parent header at desktop and compact widths, checking
  semantics, alignment, horizontal overflow, console output, request/resource
  counts, long tasks, and LCP/resource timing.

## Resolution

- A one-item `selectableParents` array now renders its resolved title in a
  bounded text span with no selector, focus target, busy state, or live region.
- Two or more selectable parents retain the existing native selector, switching
  behavior, pending state, and live announcement.
- The null selectable-parent path retains the contextual collection link.

## Verified Outcomes

- Focused component suite: 32 of 32 tests pass. The updated single-parent test
  first failed on the missing text span, then passed after the render branch was
  implemented.
- Web TypeScript, changed-file ESLint, locale-catalog generation check,
  Prettier, and `git diff --check` pass.
- The branch adds no imports, effects, requests, resources, or client
  initialization. The single-parent path removes the native select and its live
  announcement while preserving the existing bounded header and carousel
  geometry.
- Production reference baseline on the matching episode route recorded 139
  resources, 174,085 transferred bytes, zero long tasks, 286 ms
  `DOMContentLoaded`, and 695 ms load time. The deployed data used the existing
  contextual-link branch, so the focused component suite is the authoritative
  one-parent cardinality proof.
- Local browser execution was skipped for the affected content route after the
  app started successfully: the Admin route-manifest request returned 401 when
  run with non-secret smoke-test credentials. No production credential was
  available or introduced for this validation.
