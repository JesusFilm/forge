---
id: "feat-443"
title: "Improve Watch mobile LCP"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-08-28"
duration: 7
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "performance"
  - "seo"
---

## Problem

Search Console reports 10,222 poor mobile URLs and says 92% of property pages
load slowly for LCP. The Watch contribution and dominant LCP elements must be
isolated before changing the media-heavy rendering path. Linear: FGE-117.

## Entry Points — Read These First

1. `apps/web/src/components/watch/HeroPlayer.tsx` — poster/player activation.
2. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` — server render dependencies.
3. `apps/web/next.config.mjs` — image, font, and bundle configuration.
4. `docs/solutions/performance-issues/web-watch-route-lighthouse-perf-campaign-lcp-bundle-fonts-20260527.md` — prior campaign.

## Grep These

- `LargestContentfulPaint`
- `priority`
- `fetchPriority`
- `preload`
- `MuxVideo`

## Implementation Progress

- Added a closed Watch URL path-shape classifier and Datadog `beforeSend`
  enrichment using each event's `view.url`. It adds only
  `context.watch.path_shape`; view names and non-Watch events remain unchanged.
- Made the below-the-fold Bible promo explicitly lazy in empty and populated
  citation states.
- Added an opt-in complete-HTML URL-probe contract for representative JESUS,
  Spanish JESUS, and standalone Lumo routes: exactly one high-priority image
  preload, matching the hero poster's responsive candidates.
- Added unit coverage for route-shape cardinality, RUM context merging, promo
  loading intent, and probe parsing/classification.

Search Console URL groups, current Datadog field distributions, five-run
mobile traces, post-deploy facet creation, and follow-up Search Console
validation remain operational evidence. Do not attribute the property-wide
10,222 poor URLs to Watch without that evidence. Keep FGE-117 open until the
field baseline and post-release safety window are recorded.

## Constraints

- Visual smoke is insufficient; provide before/after performance evidence.
- Do not trade LCP improvements for delayed playback or unstable layout.
- Keep production-equivalent cache and network conditions explicit.

## Verification

- Field/lab evidence identifies representative Watch LCP elements.
- Lighthouse/WebPageTest or equivalent captures before/after metrics.
- Bundle/resource timing and player-readiness regressions are checked.
- Search Console validation is monitored after deployment.
