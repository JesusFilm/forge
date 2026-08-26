---
id: "feat-425"
title: "Watch single collection parent link"
owner: "codex"
priority: "P2"
status: "complete"
start_date: "2026-08-26"
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

The Watch chapter rail's single-parent header renders the parent collection as
plain text and separates it from the clip-position label with expanding flex
space. Viewers cannot use the collection context to navigate back to the parent,
and the related labels read as disconnected columns.

## Entry Points — Read These First

1. `apps/web/src/components/watch/SiblingCarousel.tsx` — single-parent header
   rendering and the existing localized parent URL.
2. `apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx` — focused
   one-parent, multi-parent, and contextual-header contracts.
3. `docs/roadmap/platform/feat-411-watch-single-collection-header.md` — the
   superseded non-interactive single-parent behavior.

## Grep These

- `selectableParents.length === 1`
- `sibling-carousel-parent-title`
- `sibling-carousel-label`
- `parentHref`

## What To Build

1. Render a routable single selectable parent's title as a link to the
   localized parent collection route.
2. Keep the parent title and clip-position label in one inline phrase with only
   normal text separation, rather than flex expansion or layout gap.
3. Use a white left-arrow icon and bold, high-contrast collection title, align
   the complete header on one center line, and place a small circle separator
   before the clip position.
4. Apply the same linked-title presentation to the contextual
   no-selectable-parent header used by resolved episode routes.
5. Fall back to non-interactive title text when the parent route cannot be
   constructed.

## Constraints

- Do not change selectable-parent state, collection switching, carousel
  geometry, chapter routing, GraphQL, effects, or client initialization.
- Preserve mobile overflow containment and visible keyboard focus for the new
  parent link.
- Add no requests, media, dependencies, or generated artifacts.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/watch/__tests__/SiblingCarousel.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web exec eslint src/components/watch/SiblingCarousel.tsx src/components/watch/__tests__/SiblingCarousel.test.tsx`
- `pnpm exec prettier --check apps/web/src/components/watch/SiblingCarousel.tsx apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx docs/roadmap/platform/feat-425-watch-single-collection-parent-link.md`
- `git diff --check`

## Resolution

- The single-selectable-parent title now uses the existing localized parent
  collection URL and renders as a keyboard-focusable high-contrast link with a
  compact white left-arrow icon when routable.
- The bold title and clip position now share one center-aligned row with a
  4 px, 60%-opacity filled-circle separator and 8 px spacing on both sides; the
  expanding flex column no longer applies to this branch.
- Resolved contextual episode routes use the same center-aligned link row,
  white left-arrow icon, bold high-contrast title, circle separator, and
  balanced spacing.
- Multi-parent selection remains unchanged.

## Verified Outcomes

- Focused SiblingCarousel suite: 33 of 33 tests pass.
- Web TypeScript, changed-file ESLint, Prettier, and `git diff --check` pass.
- The exact staging-backed local route returns 200 and renders the
  bold `text-stone-50` link, white `lucide-arrow-left` SVG, circle separator,
  center alignment, and non-wrapping clip label.
- The change adds no effects, requests, dependencies, media, or client
  initialization, so page-load behavior is unchanged.
