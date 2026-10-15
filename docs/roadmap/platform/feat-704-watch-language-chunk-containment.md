---
id: "feat-704"
title: "Contain video language picker component load failures"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-15"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch-page"
  - "language-picker"
  - "reliability"
---

## Problem

The video-owned globe enables its App Router dynamic language modal before the
component preload succeeds. A rejected component load can escape into the page
error boundary and poison the module-scoped React.lazy payload. M36 / QA-593
reports this failure class. Current production offline reproduction and complete
reconnect recovery remain unverified; this ticket owns source-level containment.

## Entry Points — Read These First

1. `apps/web/src/components/watch/WatchPageClient.tsx` — `openLanguage`, modal
   activation, language options, and competing modal intents.
2. `apps/web/src/components/watch/__tests__/WatchPageClient.download.test.tsx` —
   existing modal activation seam; ordinary dynamic mocks hide render failures.
3. `apps/web/src/lib/watch-interaction-loader.ts` — component preload cache and
   separate options loading.
4. `apps/web/src/components/FloatingSearchProvider.tsx` — established global
   success-before-mount and localized `SearchOverlay.connectionHint` behavior.
5. `docs/solutions/best-practices/per-message-boundary-limits-for-media-surfaces.md`
   — React.lazy and bundler rejection caches are separate mechanisms.
6. `apps/web/src/components/watch/WatchSectionRenderer.tsx`,
   `apps/web/src/components/watch/HeroPlayer.tsx`, and
   `apps/web/src/lib/watch-player-chrome-events.ts` — existing page-owner
   publication carries optional pending-language cancellation into Search.

## Grep These

- `openLanguage|enabledModalChunks.language|loadWatchInteraction`
- `languageOptionsPendingRef|currentLanguageSlug|closeModal`
- `app-dynamic|connectionHint|watch-page-client`

## What To Build

- Start component and options requests together on activation, but mount/open
  the language dialog only after its component preload succeeds.
- Keep rejected component loads local with existing translated connection
  guidance; leave the globe available for another activation.
- Deduplicate pending activation and invalidate stale completion on close,
  navigation, another modal intent, or unmount.
- Exercise rejection through the real App Router dynamic loader in the existing
  modal test seam, plus pending, retry, and stale-intent controls.

## Constraints

- Preserve the global picker, search/share/download loading policy, language
  availability, and public routes. Search opening may invalidate only the
  current page owner's pending language activation through its published
  callback; do not subscribe the page to changing header chrome state.
- No eager loading, cache-busting imports, runtime patches, reload policy, new
  dependencies, or locale-catalog changes.
- Do not claim QA-593/M36 resolved without a current cold offline browser probe.
  A controlled promise retry does not establish bundler/network retry behavior.

## Verification

- The real App Router rejection regression fails on the original activation path
  and passes after containment; page content and localized feedback survive.
- Existing video/provider/loader tests, web typecheck, scoped lint, formatting,
  and normal commit hooks pass.
- Preserve and falsify parallel component/options startup and no initial
  interaction loading in the controlled seam. Record changed-module
  minified/gzip deltas as a payload proxy, with browser/page-timing limits.

## Completion — 2026-10-15

- Component preload gates video-owned language/subtitle dialog mounting, while
  options begin loading in parallel. Rejections retain the page and show existing
  translated connection guidance.
- Current-owner cancellation covers Search and local subtitle controls, including
  single-audio videos; queued globe callbacks remain stable across older modal
  completion.
- Real App Router rejection and both review regressions failed before their fixes.
  Final validation passed 368 tests across six suites with one existing todo,
  full web typecheck, scoped lint, formatting, and diff checks.
- Controlled negative probes detect initial eager loading and serialized options
  startup. The five changed modules add 992 minified bytes / 383 gzip bytes in a
  standalone transform proxy; this is not a served Next bundle or Web Vitals.
- Current production cold offline/reconnect behavior and preview browser timing
  remain unverified. This completes source containment only, not QA-593/M36.
