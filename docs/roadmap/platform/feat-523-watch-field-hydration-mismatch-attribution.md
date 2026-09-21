---
id: "feat-523"
title: "Attribute remaining Watch field text and HTML hydration mismatches"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-09-21"
duration: 3
depends_on: []
blocks: []
tags: [web, watch, hydration, observability, reliability]
---

## Problem

The September 21 corpus review found 742 React #418 errors across approximately
733 distinct RUM views on Web `964c1e3cde7ecd2ea1f3253817770527213ac11f`, restricting
browser names to Chrome, Chrome Mobile, Safari and Mobile Safari. There were 706
text and 36 HTML mismatch events. The separate Googlebot cohort contains 435
errors across only five views; raw issue counts are not affected-view counts.
See `docs/operations/watch-recommendation-corpus-review-2026-09-21.md` for the fixed
window, population limits and release identities.

Platform feat-517 remains complete for the reproduced cached-autoplay-query
cause. This ticket does not infer that every remaining HTML event is that
regression, that all ordinary-browser events are human, or that the text and HTML
variants share a cause. No remaining field cause is established yet.

## Entry Points — Read These First

1. `docs/roadmap/platform/feat-517-watch-intermittent-hydration-error.md` and
   `docs/solutions/ui-bugs/watch-autoplay-query-cached-html-hydration.md` — scoped
   correction and its limits.
2. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` — route rendering.
3. `apps/web/src/components/watch/HeroPlayer.tsx` — cached/live player state.
4. `apps/web/src/components/recommendations/WatchSemanticRecommendations.tsx` —
   recommendation rendering; investigate only if source-mapped evidence points here.
5. `docs/roadmap/content-discovery/feat-520-watch-field-post-response-paint-attribution.md`
   and `feat-521-watch-selection-browser-commit-waits.md` — separate browser timing work.

## Grep These

`Minified React error #418|useSyncExternalStore|autoplay|suppressHydrationWarning|force-static`

## What To Build

- Group production text/HTML variants by exact deployed version, public route,
  browser and distinct view; report sampling and known-crawler exclusions.
- Obtain source-mapped component evidence and the server/client difference for
  a bounded representative route. `/watch` and `/watch/jesus.html` occur in the
  reviewed ordinary-browser cohort, but are starting points, not a proven cause.
- Reproduce with matched locale, cache, query, timezone and persisted browser
  state. Retain no cookies, IP addresses, identity values or capability payloads.
- Implement the smallest correction with a regression that fails before it.
  Keep separate variants open if the demonstrated correction explains only one.

## Constraints

Do not suppress hydration warnings, disable RUM or gate recommendation/analytics
collection on consent. Keep the authored English Homepage Recommendations Block
removed and `forge.watch.homepageRecommendations` default off. No Mobile/TV UI,
account linking or curation republishing. Do not increase recommendation deadlines
or weaken identity, authorization, attribution, integrity or rate limits.

## Verification

Run focused hydration regressions, Web tests, lint, types, formatting and a
production build. Verify actual navigation, selection acknowledgment and delivery
bodies separately from React errors. Compare page-loading performance under
matched conditions. Deploy only through the normal PR-to-main automation, verify
the exact running revision, and compare sustained distinct-view field incidence.
A healthy short browser run or a drop in raw crawler events is not closure.

## September 21 investigation

Fresh retained Safari `/watch` and Mobile Safari French-route events still have
the text variant; their stacks expose React framework frames without the
component or server/client difference. Six fresh Chromium contexts and six
WebKit 2311 contexts across homepage, Jesus, French prayer, Spanish sower and
autoplay routes did not reproduce a page error. Locale/timezone and a mobile
viewport were varied. WebKit libraries were extracted only in the owned
worktree; no shared host dependency was installed. This is not physical Safari
coverage or a matched reproduction of the field failure.

Keep this ticket in progress. Do not broaden the completed feat-517 claim or
patch speculative render paths. [Execution evidence and limits](../../operations/watch-ticket-execution-2026-09-21.md)
separate field errors, browser probes, delivery envelopes and selection rejections.

The later fixed September 20 22:42–September 21 00:50 UTC query still finds
18 errors across 18 distinct ordinary-browser-named views on Web
`4e31f822781f44df06e91c8194142a6c4b51646a`: eleven Mobile Safari, five Chrome,
one Chrome Mobile and one Safari. Six additional Googlebot errors belong to
only two views and remain separate. These are affected-view counts, not an
incidence rate or proof of human traffic. Existing framework-only stacks do
not expose the server/client text difference. No hydration correction is
justified by the healthy browser probes; source-mapped component evidence
remains the next requirement.
