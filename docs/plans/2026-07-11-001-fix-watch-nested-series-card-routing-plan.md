---
title: "Fix Watch nested-series card routing"
type: fix
status: completed
date: 2026-07-11
---

# Fix Watch nested-series card routing

## Summary

Route a series or collection child from a Watch series grid to its standalone
page. Preserve contextual URLs for directly playable episode children.

## Problem Frame

The LUMO page emits a contextual episode URL for its Gospel of Matthew child.
That child is a collection rather than a playable video, so route admission
correctly rejects the link with an empty 404.

---

## Requirements

**Nested series navigation**

- R1. A child labeled `collection` or `series` must link to
  `/{child}.html/{audio-language}.html`.
- R2. Series-label matching must be case-insensitive. The server classifier
  retains its children fallback, while the lean card treats an unlabeled child
  as a contextual episode to preserve current behavior.

**Episode navigation**

- R3. A non-series child must keep the contextual
  `/{parent}.html/{child}/{audio-language}.html` URL.
- R4. Invalid child or language slugs must continue to render a non-link.

---

## Key Technical Decisions

- **Classify before building the card href:** `SeriesEpisodeCard` already has
  the child's `label` and selected public language slug, so it can choose the
  valid URL without expanding the Admin GraphQL projection.
- **Share a client-safe discriminator:** Extract the existing label-first
  series test from the server/data module into a dependency-free helper. Keep
  the existing `content.ts` export as a compatibility re-export.
- **Leave route admission unchanged:** The manifest and three-segment resolver
  intentionally admit playable contextual videos only. Correcting the source
  href fixes this card without weakening invalid-route rejection.

---

## Acceptance Examples

- AE1. Given a LUMO child with slug `lumo-the-gospel-of-matthew`, label
  `COLLECTION`, and language `russian`, its card links to
  `/lumo-the-gospel-of-matthew.html/russian.html`.
- AE2. Given a regular episode child with a valid parent and language, its
  card still links to the contextual three-segment route.
- AE3. Given a nested series child and a malformed parent slug, its standalone
  link remains valid because it has no parent-route dependency.

---

## Implementation Units

### U1. Share the series-record classifier across server and client code

- **Goal:** Make the existing label-first series/collection decision available
  to the client card without importing the server data resolver.
- **Requirements:** R2.
- **Dependencies:** None.
- **Files:** `apps/web/src/lib/watch-content-kind.ts` (new),
  `apps/web/src/lib/content.ts`,
  `apps/web/src/lib/__tests__/content-series.test.ts`.
- **Approach:** Move the case-insensitive `collection`/`series` classification
  and children fallback into a dependency-free helper. Re-export it from
  `content.ts` so existing server callers and tests retain their import path.
- **Patterns to follow:** The current `isSeriesRecord` behavior in
  `apps/web/src/lib/content.ts`.
- **Test scenarios:** Confirm lowercase and uppercase collection and series
  labels are series-shaped; confirm an unlabeled record with children is
  series-shaped; confirm a labeled episode remains non-series-shaped.
- **Verification:** The classifier unit test passes with the existing server
  import path and no client component imports `content.ts` at runtime.

### U2. Select standalone URLs for nested series cards

- **Goal:** Generate valid Watch hrefs for both collection children and
  playable episode children.
- **Requirements:** R1, R3, R4.
- **Dependencies:** U1.
- **Files:** `apps/web/src/components/watch/SeriesEpisodeCard.tsx`,
  `apps/web/src/components/watch/__tests__/SeriesEpisodeCard.test.tsx`.
- **Approach:** Use the client-safe classifier to select `watchVideoPath` for
  a nested series child. Retain `watchEpisodePath` for every other valid child
  because the card has no child-presence signal. Preserve the existing non-link
  behavior for malformed child or language slugs.
- **Patterns to follow:** `apps/web/src/lib/routes.ts` URL builders and the
  existing contextual card assertions.
- **Test scenarios:** Covers AE1. Assert the LUMO Russian collection card
  uses the standalone route. Assert an uppercase `SERIES` label uses the same
  route. Covers AE2. Retain the contextual episode assertion. Covers AE3.
  Assert a nested series still links when its parent slug is malformed. Assert
  an unlabeled child retains the contextual route.
- **Verification:** Focused card tests cover both URL shapes and the existing
  episode route remains unchanged.

---

## Scope Boundaries

- Do not add an Admin field, change generated GraphQL types, or alter the
  Watch route manifest.
- Do not make contextual routes accept non-playable collection nodes.
- Do not change card copy, imagery, hover behavior, or language selection.

---

## Risks & Dependencies

- This relies on the existing Admin `label` projection. An unlabeled child
  remains conservatively contextual, matching the current behavior.
- The client-safe helper must remain dependency-free because client component
  imports cannot traverse the server data layer.

---

## Sources & Research

- `docs/roadmap/platform/feat-179-watch-contextual-video-canonical.md` defines
  the three-segment route as contextual playable-video navigation.
- `apps/web/src/lib/watch-route-manifest.ts` and
  `apps/admin/src/services/watch-route-manifest.service.ts` admit contextual
  children only when they have a playable Dub.
- `docs/solutions/design-patterns/watch-chapter-optimistic-navigation-feedback.md`
  requires contextual hrefs to remain in place for ordinary chapter cards.
