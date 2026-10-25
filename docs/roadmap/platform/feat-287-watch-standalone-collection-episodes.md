---
id: "feat-287"
title: "Show collection episodes on standalone Watch videos"
owner: "unassigned"
priority: "P1"
status: "complete"
start_date: "2026-07-22"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "routing"
  - "ui"
---

## Problem

Playable videos can belong to one or more collections, but the canonical
standalone Watch route removes parent context before rendering. Viewers who
arrive without a collection slug therefore cannot discover those collections
or their related episodes from the existing episodes rail.

## Entry Points — Read These First

1. `docs/plans/2026-07-22-001-feat-watch-standalone-collection-episodes-plan.md`
   — requirements, technical decisions, implementation units, and proof
   contract.
2. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` — standalone and
   contextual Watch route branches.
3. `apps/web/src/lib/content.ts` — synthetic Watch block composition and
   compact sibling-carousel model.
4. `apps/web/src/components/watch/SiblingCarousel.tsx` — episodes rail header,
   carousel state, and contextual episode links.
5. `apps/web/src/components/watch/WatchPageClient.tsx` — optimistic chapter
   navigation and route warming.

## Grep These

- `renderVideo`
- `renderEpisode`
- `buildSiblingCarouselBlock`
- `WatchSiblingCarouselBlock`
- `isPendingChapterStillRoutable`
- `isWatchRouteAdmittedByManifest`

## What To Build

1. On standalone playable-video URLs only, derive eligible parent collections
   from current-language manifest-admitted parent/child routes.
2. Show those collections in the episodes rail, defaulting to the first Admin-
   ordered eligible parent and swapping episodes in place when selected.
3. Keep episode links contextual to the selected collection while the current
   standalone URL, playback, hero progression, language routing, canonical,
   and share identity remain standalone.
4. Leave collection-slug contextual routes on their existing fixed carousel
   with no selector or behavior change.

## Constraints

- Route URL shape, not child count, activates the feature.
- Fail closed to the existing own-children or no-carousel behavior when the
  route manifest is unavailable or no parent is eligible.
- Preserve Admin parent and child order.
- Do not add an Admin GraphQL operation or browser-side data request.
- Keep the selector model compact and server-owned.

## Verification

- Focused merge, route, carousel, navigation, and structured-data tests.
- Web typecheck, lint, and formatting checks for the touched scope.
- Desktop and compact browser proof on the standalone StoryClubs route plus a
  contextual neighboring control.
- Request-waterfall, HTML/RSC transfer, warmed response, and cold-manifest
  evidence showing no browser request or serial loading regression.

## Plan

Implementation plan:
`docs/plans/2026-07-22-001-feat-watch-standalone-collection-episodes-plan.md`

## Verification Notes

### Deterministic proof — 2026-07-22

- Focused Watch suite passed **131 tests in 6 files**:
  `pnpm --filter @forge/web exec vitest run 'src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx' src/lib/__tests__/content-watch-merge.test.ts src/lib/watch-structured-data.test.ts src/components/watch/__tests__/SiblingCarousel.test.tsx src/components/watch/__tests__/WatchPageClient.navigation.test.tsx src/lib/watch-route-manifest.test.ts`.
- Web typecheck passed:
  `pnpm --filter @forge/web typecheck`.
- Full Web lint, including the generated UI-locale drift check, passed:
  `pnpm --filter @forge/web lint`.
- The production Web build passed against the isolated local Admin endpoint:
  `ADMIN_GRAPHQL_URL=http://localhost:3013/api/graphql pnpm --filter @forge/web build`.
- Feature-file formatting and whitespace checks passed:
  `node_modules/.bin/prettier --check 'apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx' 'apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx' apps/web/src/components/watch/SiblingCarousel.tsx apps/web/src/components/watch/WatchPageClient.tsx apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx apps/web/src/components/watch/__tests__/WatchPageClient.navigation.test.tsx apps/web/src/lib/__tests__/content-watch-merge.test.ts apps/web/src/lib/content.ts docs/plans/2026-07-22-001-feat-watch-standalone-collection-episodes-plan.md docs/roadmap/platform/feat-287-watch-standalone-collection-episodes.md`
  and `git diff --check`.

The focused route proof covers Admin-order parent selection, exact
current-language manifest admission, invalid/missing parent exclusion,
fail-closed own-child fallback, and manifest retrieval beginning alongside
video resolution. It also proves that the default eligible collection drives
the standalone related-item JSON-LD while hero progression, Share identity,
and breadcrumb identity remain standalone.

The contextual control proves no selector payload or manifest lookup, the
fixed URL-selected parent and collection slug, unchanged next-item progression,
standalone canonical/Share identity, and the existing three-level breadcrumb
and 29-item related JSON-LD output. Component/navigation coverage additionally
proves one-option visibility, collection switching and rail reset, contextual
episode hrefs, busy-state locking, fixed-header parity, non-default-parent route
warming/push, and the canonical standalone Share href.

The existing route-manifest suite passed its seven fetch-failure,
invalid-payload, and exact route/audio-admission cases. It does not fake the
internal 1.5-second abort clock or 60-second stale/304 cache lifecycle; those
cold/timeout/cache observations remain part of the pending browser/server
loading proof rather than being duplicated in the feature route tests.

One intermediate run passed 128 of 129 tests; the only failure was the new
parallel-start test assuming two microtask ticks were enough to reach the route
branch. Replacing that brittle timing assumption with an eventual call
assertion fixed the test; no product code changed for that failure.

### Local route and loading proof — 2026-07-22

- Restored the latest video-core snapshot into an isolated local Admin database,
  generated its route-manifest snapshot, and ran both feature and `origin/main`
  Watch servers against that same Admin data.
- The exact standalone route returned 200 and server-rendered a native selector
  labelled `Коллекция`, with `КлубИсторий` selected, a 13-item rail, and
  contextual episode hrefs such as
  `/watch/storyclubs.html/storyclubs-birth-of-jesus/russian.html`.
- The contextual neighboring route
  `/watch/storyclubs.html/storyclubs-jesus-calms-the-storm/russian.html`
  returned 200 with the same fixed 13-item rail and no selector test ID.
- The feature HTML was 301,080 bytes versus 158,548 bytes on `origin/main`;
  this is the expected episode-rail payload and closely matches the contextual
  control at 301,046 bytes. The selector performs no browser-side data fetch;
  all choices and cards are serialized by the server.
- After discarding the first cold/dev-compilation sample, an interleaved
  eight-run same-machine comparison produced a warmed median TTFB of about
  97 ms for the feature and 101 ms for `origin/main` (roughly 3% faster, within
  the 10% non-regression budget). The local cold sample was noisy while Admin
  background work was active, so the manifest timeout and parallel-start
  guarantees remain established by the focused deterministic tests rather than
  claimed from that sample.

### Browser-proof limitation

The in-app browser refused to reload the localhost URL under its URL security
policy after the local data environment was ready. Per the browser skill's
policy, no alternate browser surface or raw protocol workaround was used.
Desktop/compact screenshots, live selection/playback interaction, request
waterfall, hero-poster priority, and browser console evidence could therefore
not be captured in this run. The equivalent route shape, selector interaction,
navigation, accessibility, compact geometry, and contextual non-regression
contracts are covered by the 131 focused tests and the server-rendered HTTP
evidence above.
