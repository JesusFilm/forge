---
id: "feat-735"
title: "Investigate Watch no-JavaScript streamed footer reachability"
owner: "vlad"
priority: "P2"
status: "not-started"
start_date: "2026-10-18"
duration: 2
depends_on: []
blocks: []
tags: [web, infrastructure]
---

## Problem

Genuine JS-disabled local QA exposed inaccessible home/video footer and Terms
links on both exact-main baseline and the B24 candidate. The anchors exist under
hidden React streamed containers (`S:3` home, `S:0` video), have zero rectangles,
and cannot be hit or activated at maximum scroll. This is pre-existing relative
to B24's notice/search increment, not evidence of banner occlusion. No source
repair for this issue is included in the B24 PR; full SSR recovery needs separate
investigation. Production reproduction and the underlying cause are unproven.

## Entry Points — Read These First

1. `apps/web/src/app/[locale]/[htmlLang]/layout.tsx`: locale root and page boundary.
2. `apps/web/src/app/[locale]/[htmlLang]/loading.tsx` and
   `apps/web/src/components/WatchRouteLoadingShell.tsx`: loading shells.
3. `apps/web/src/components/home/WatchHomePage.tsx` and
   `apps/web/src/components/home/WatchHomeExperiencePage.tsx`: home Suspense/content.
4. `apps/web/src/components/watch/WatchPageClient.tsx`: video page composition.
5. `apps/web/src/components/home/WatchHomeFooter.tsx`: legal links.
6. `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`.

## Grep These

`Suspense`, `WatchHomeFooter`, `WatchRouteLoadingShell`, `Terms`, `hidden`, `S:3`,
`S:0`. Inspect response streaming and the actual hidden ancestors, not just source
order or the presence of an anchor in HTML.

## Evidence and Reproduction Context

- Base: `90908a4326901232ec0ff7569744a0e6b7e89e25`.
- Exact-main baseline build `_PDsfntpYGR7vBOxQV73q`; B24 candidate build
  `hXNPPiDLVYI_-gG1rjZOy`. Both reproduced hidden home/video Terms.
- Anonymous isolated Chrome for Testing 149.0.7827.55, agent-browser 0.34.0,
  genuine scripting-disabled launch (`--blink-settings=scriptEnabled=false`),
  desktop 1280×800 and emulated mobile 390×844. No physical-device claim.
- Routes: `/watch` and `/watch/seed-demo-video.html`; compare JS-on/off at bottom.
- `/tmp/forge-b24-fullapp-browser-20261017/report.md`, `receipt.json`,
  `evidence.json`; specifically `baseline-off-home-390-bottom.json`,
  `baseline-off-video-1280-bottom.json` and matching candidate `off-*` captures.
- `/tmp/compound-engineering-1000/ce-code-review/20261017-round3-203551-b24/review.json`
  classifies this as pre-existing and separate from the notice placement defect.
- Arabic `/watch/arabic-modern-standard.html/languages` has no footer even with
  JS on, so its footer comparison is not applicable. Its hidden JS-off main
  content is a distinct observation. Baseline Arabic desktop unexpectedly
  retained candidate notice markup without route-level served-build proof;
  that notice comparison is inconclusive, not a footer conclusion.

## What To Build

First trace why the essential server-rendered home/video legal links remain
inside hidden streamed containers without React bootstrap. Establish a minimal
reproduction and the relevant route/loading/Suspense boundary before choosing
the repair. Preserve the site's JS-on rendering and document the SSR/streaming
and page-load tradeoff of any proposed solution. B24's first-body localized
explanation does not depend on this investigation, nor does it solve it.

## Constraints

Do not CSS-unhide React `S:*` internals, inject/cloned DOM as evidence, duplicate
the site for no-JS, invent a production cause, seed/repair QA content, or alter
analytics/recommendation policy. Retain failures and provenance. No dependencies
are declared: this follow-up and feat-734 are independently scoped. Keep the
roadmap index under the publisher's minimal row/count reconciliation.

## Verification

On independently identified matching baseline/candidate builds, repeat genuine
scripting-disabled home/video checks at desktop/mobile. Footer and Terms must
have nonzero exposed rectangles, appear in the accessible interactive snapshot,
and be hittable/activatable through the actual anchors at maximum scroll. Retain
JS-on controls, route/build/browser/cache identity and hidden-ancestor evidence.
Treat RTL footer absence separately. Add regression coverage at the boundary
the investigation establishes and measure any SSR/page-load change; DOM presence
alone and screenshots without timing are insufficient.
