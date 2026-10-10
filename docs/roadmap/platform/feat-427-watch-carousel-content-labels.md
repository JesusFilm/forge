---
id: "feat-427"
title: "Watch carousel content labels"
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
  - "i18n"
  - "ui"
---

## Problem

The Watch hero renders each video's Admin-authored content label, but the
sibling carousel hard-codes every card and navigation affordance as a Chapter
and describes the active position as a Clip. Episode collections therefore
show contradictory labels such as `EPISODE`, `Clip 1 of 9`, and `CHAPTER` for
the same item.

## Entry Points — Read These First

1. `apps/web/src/components/watch/SiblingCarousel.tsx` — carousel header,
   card eyebrows, and accessible navigation labels.
2. `apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx` —
   focused contextual, parent-mode, and navigation-label coverage.
3. `apps/web/src/lib/video-labels.ts` — Admin label normalization into localized
   `VideoLabels` message keys.
4. `apps/web/messages/*.json` — existing localized video labels, positions,
   and episode/chapter counts composed by the carousel.

## Grep These

- `position`
- `episodeCount`
- `chapterCount`
- `t("chapter")`
- `previousChapter`
- `nextChapter`
- `videoLabelMessageKey`

## What To Build

1. Classify a carousel as an episode rail only when every child has the
   Admin-authored Episode label, using the shared video-label normalization;
   retain the existing Chapter terminology for other or unlabeled rails.
2. Replace `Clip N of M` with the active item's localized type, such as
   `Episode 1 of 9` or `Chapter 30 of 49`.
3. Render every card with the rail's localized type rather than a fixed Chapter
   eyebrow.
4. Make parent-mode counts and carousel aria labels distinguish episode rails
   from chapter rails.
5. Preserve carousel routing, geometry, images, loading, pending navigation,
   and active-item behavior.

## Constraints

- Do not change Admin data, GraphQL operations, route shapes, or generated
  GraphQL artifacts.
- Keep all user-visible terminology localized.
- Preserve Chapter as the fallback for legacy unlabeled carousel children.
- Do not add requests, resources, effects, or client initialization.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/watch/__tests__/SiblingCarousel.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web exec eslint src/components/watch/SiblingCarousel.tsx src/components/watch/__tests__/SiblingCarousel.test.tsx`
- `pnpm --filter @forge/web check:ui-locales`
- `pnpm exec prettier --check apps/web/src/components/watch/SiblingCarousel.tsx apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx docs/roadmap/platform/feat-427-watch-carousel-content-labels.md`
- `git diff --check`

## Resolution

- Episode collections now render `Episode N of M` in the desktop header and
  `Episode` on every carousel card, matching the hero's authored Episode label.
- Parent collection pages use the existing localized episode-count messages,
  while established film/segment rails retain Chapter terminology.
- The visible and accessible position labels no longer use Clip. A rail with
  any non-Episode or unlabeled child deliberately falls back to Chapter so one
  carousel never mixes competing type names.
- Routing, carousel geometry, pending navigation, images, effects, requests,
  and resource loading are unchanged.

## Verified Outcomes

- Focused carousel suite: 36 of 36 tests pass, including contextual episode
  terminology, episode parent counts, chapter preservation, and unlabeled-child
  fallback.
- Changed-file ESLint, Prettier, generated UI-locale parity, and
  `git diff --check` pass.
- The full Web typecheck could not produce a valid branch result in this
  dependency-less worktree: the available dependencies are symlinked from an
  older checkout and report unrelated missing `zod`, stale
  `@forge/admin-graphql` exports, and existing dynamic-collection unknown-type
  errors. The changed component is compiled and exercised by the passing
  Vitest suite.
- The change adds no network request, media resource, effect, or client
  initialization. Runtime work is one bounded scan of the already-rendered
  carousel children plus localized string selection, so page-loading behavior
  is unchanged.
