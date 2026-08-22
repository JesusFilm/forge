---
id: "feat-400"
title: "Reuse the Watch language globe on home and not-found pages"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-21"
duration: 1
depends_on:
  - "feat-399"
blocks: []
tags:
  - "web"
  - "watch"
  - "experiences"
  - "not-found"
  - "i18n"
---

## Problem

The animated Matthew 24:14 globe is isolated in a preview route. Watch needs a
reusable presentation layer that can pair the globe with authored-style copy
and recovery actions, then use that same visual on the homepage and the true
not-found page without duplicating its canvas renderer.

## Entry Points — Read These First

1. `apps/web/src/components/sections/LanguageGlobe.tsx` — optimized shared
   canvas primitive.
2. `apps/web/src/components/home/WatchHomeExperiencePage.tsx` — homepage
   Experience composition.
3. `apps/web/src/components/WatchNotFound.tsx` — localized, server-rendered
   ordinary 404 body.
4. `apps/web/src/components/sections/index.tsx` — canonical authored Experience
   block dispatch; this feature must not invent an Admin typename.
5. `apps/web/messages/en.json` — existing localized Watch language and
   not-found copy contracts.

## What To Build

1. Add a reusable server-rendered globe section that accepts an eyebrow,
   heading level, title, supporting content, and actions while delegating all
   animation to the existing client canvas.
2. Add a localized Watch homepage language section before the footer with a
   clear route to the language inventory.
3. Replace the not-found poster artwork with the shared globe composition while
   preserving one semantic `h1`, localized copy, recovery links, original URL,
   HTTP 404, and automatic `noindex` behavior.
4. Keep the standalone preview useful by showing the homepage composition and
   add an isolated `/watch/language-globe/not-found` variant for debugging the
   404 presentation without entering the production-routed locale tree.
5. Preserve adaptive rendering, reduced motion, offscreen pausing, and mobile
   overflow safety in both placements.

## Constraints

- Do not duplicate or fork the canvas renderer.
- Do not add a new Admin GraphQL block without an authored CMS contract.
- Do not add runtime data requests, remote media, or dependencies.
- Do not weaken fixed-sentinel 404 routing or route-manifest admission.
- Do not create a second page-level `h1` on the Watch homepage.

## Verification

- Focused tests cover section composition, homepage placement, and 404
  semantics/recovery links.
- `@forge/web` lint and typecheck pass for touched files.
- Browser QA covers the homepage and 404 compositions at desktop and
  `390 x 844`, reduced motion, console errors, and horizontal overflow. Focused
  tests cover the real localized 404 component while its fixed sentinel routing
  remains unchanged.
- A three-second animation sample on the 404 remains within the existing mobile
  and desktop main-thread budgets.

## Completion Notes

- Added one configurable `LanguageGlobeSection` around the existing adaptive
  canvas and reused it from the localized Watch home and not-found compositions.
- Added no-index Experience and 404 preview routes for isolated visual debugging.
- Removed the not-found poster request and deferred below-fold homepage canvas
  drawing until the globe enters the observer margin.
- Focused tests (22), lint, typecheck, formatting, responsive browser QA, reduced
  motion, and browser-console checks pass. The constrained-phone 404 sample used
  `0.0903s` of main-thread task time over three seconds with no layout or style
  recalculation.
- The full locale-tree 404 was not browser-rendered in this worktree because the
  local server lacks required production environment values. Its component and
  recovery semantics are covered by focused tests; routing code was not changed.
- Follow-up visual refinement merged the typography, promo copy, actions, and
  globe into one rounded surface. Embedded canvases no longer add a second frame;
  browser QA confirms one outer border and one continuous design on desktop and
  phone viewports.
