---
id: "feat-344"
title: "Default standalone Watch episodes to the feature film collection"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-10"
duration: 1
depends_on:
  - "feat-287"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "routing"
  - "ui"
---

## Problem

Standalone Watch video URLs can expose several eligible parent collections in
the episodes dropdown, but the initial selection currently follows raw Admin
relation order. For a clip from a feature film, that can select an auxiliary
collection such as `JFM Collection` instead of the related feature film such as
`JESUS`, making the first episode rail less relevant to the clip.

## Entry Points — Read These First

1. `docs/plans/2026-08-10-002-fix-watch-feature-film-parent-default-plan.md` —
   implementation and verification contract.
2. `docs/roadmap/platform/feat-287-watch-standalone-collection-episodes.md` —
   original standalone selector contract.
3. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` — eligible parent
   filtering for standalone and contextual route branches.
4. `apps/web/src/lib/content.ts` — normalized `Video.label` metadata and the
   sibling-carousel block model.
5. `apps/web/src/components/watch/SiblingCarousel.tsx` — dropdown default and
   local selection behavior.
6. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
   — route-level selector and fallback coverage.

## What To Build

- Keep every eligible selectable parent and its admitted current-language
  episodes in the dropdown.
- For standalone video URLs without a parent collection slug, prefer the first
  eligible parent whose normalized Admin label is `featureFilm` as the initial
  selection.
- Preserve the relative Admin order of all other eligible parents.
- Fall back to the existing first-eligible-parent behavior when no eligible
  feature-film parent exists.
- Keep contextual URLs with an explicit parent collection slug fixed to that
  URL-selected collection.
- Keep the current video URL, playback, hero progression, language behavior,
  and contextual episode links unchanged.

## Constraints

- Use Admin's normalized `Video.label`; do not infer feature films from titles
  or hardcode `JESUS` or any collection slug.
- Do not add a GraphQL operation, client-side request, URL parameter, or new
  message key.
- Preserve manifest admission, minimum-child eligibility, and fail-open/fail-
  closed behavior already established by feat-287 and feat-343.

## Verification

- Route coverage proves a later Admin-ordered `featureFilm` parent becomes the
  default while every eligible parent remains selectable.
- Route coverage proves Admin order remains unchanged when no eligible feature-
  film parent exists.
- Existing contextual-route coverage proves explicit collection URLs remain
  fixed and selector-free.
- Run focused page-routing and sibling-carousel tests plus Web typecheck,
  formatting, and lint checks for the touched scope.

## Completion Evidence

- The focused Watch suite passes with 181 tests across route rendering,
  carousel behavior, content merging, URL handling, and video-label
  normalization.
- Web typecheck, lint, Prettier, and `git diff --check` pass.
- Route coverage includes uppercase and camelCase feature-film labels, multiple
  eligible feature-film parents, an ineligible feature-film parent, and the
  no-feature-film fallback while preserving Admin order.
- Existing catalog documentation identifies `jesus` (`1_jf-0-0`) as a
  `FEATURE_FILM` with chapter children, and the public contextual route for
  `jesus-calms-the-storm` confirms the reported clip belongs to the JESUS film.
- The implementation derives the default from the existing server payload, so
  it adds no request, client-side label scan, or hydration work.
- Interactive browser automation was unavailable in the execution session;
  behavior is verified through server-route and component DOM tests instead.
