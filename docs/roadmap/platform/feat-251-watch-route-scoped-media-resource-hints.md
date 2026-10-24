---
id: "feat-251"
title: "Scope Watch media resource hints to media routes"
owner: "unassigned"
priority: "P2"
status: "not-started"
start_date: "2026-07-20"
duration: 1
depends_on:
  - "feat-250"
blocks: []
tags:
  - "web"
  - "performance"
---

## Problem

The locale root layout emits preconnect hints for `image.mux.com` and
`stream.mux.com`, plus a DNS prefetch for `imagedelivery.net`, on every Watch
document. Routes that do not use remote media now include the custom not-found
page from feat-250, so those responses can perform avoidable third-party DNS or
connection setup even though the page uses one same-origin image.

The hints are valuable on media-heavy Watch routes and must not simply be
removed. They should move to the narrowest shared route or component boundary
that still emits them early enough to preserve valid-page LCP and video startup.

## Entry Points — Read These First

1. `apps/web/src/app/[locale]/[htmlLang]/layout.tsx` — currently emits all three
   hints for every locale-scoped route.
2. `apps/web/src/components/home/WatchHomeTvCarousel.tsx` — home hero Mux video
   and Mux poster consumers.
3. `apps/web/src/components/watch/HeroPlayer.tsx` — watch-page Mux video,
   poster, and storyboard consumer.
4. `apps/web/src/components/sections/VideoHero.tsx`, `Video.tsx`, and
   `CarouselVideo.tsx` — page-section Mux consumers.
5. `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`
   — required before/after waterfall and timing proof.

## Grep These

- `rel="preconnect"` and `rel="dns-prefetch"` — current resource hints.
- `image.mux.com`, `stream.mux.com`, and `imagedelivery.net` — consumers and
  tests that constrain placement.
- `ReactDOM.preconnect` and `ReactDOM.prefetchDNS` — component-scoped Next.js
  resource-hint APIs to evaluate.

## What To Build

1. Remove unconditional remote-media hints from the locale root layout.
2. Emit each hint only for routes or components that consume its origin, while
   preserving early discovery on the Watch home, video, episode, and inventory
   surfaces that need it.
3. Add focused coverage for hint presence on representative media routes and
   absence on the custom 404 route.
4. Compare production-mode before/after waterfalls and document timing for the
   Watch home and one canonical video route. The valid routes must not regress.

## Constraints

- Do not make the locale layout dynamic with `headers()` or `cookies()`.
- Do not weaken feat-250's proxy admission or fixed-sentinel behavior.
- Do not add a dependency or move remote media earlier in the critical path.
- Keep the change limited to Watch resource-hint ownership and proof.

## Verification

- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Run focused tests for each changed hint-owning route or component.
- Production waterfall: custom 404 performs no remote-media DNS/preconnect.
- Production before/after: Watch home and a canonical video route retain their
  expected hints with no document-timing, LCP, or media-startup regression.
