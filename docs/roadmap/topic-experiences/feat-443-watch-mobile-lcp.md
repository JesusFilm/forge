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

## What To Build

Map Search Console URL groups to Watch templates, reproduce representative
mobile LCP, identify the dominant resource/work, and propose measured fixes
with server, bundle, media, CLS, INP, and player-readiness guardrails.

## Constraints

- Visual smoke is insufficient; provide before/after performance evidence.
- Do not trade LCP improvements for delayed playback or unstable layout.
- Keep production-equivalent cache and network conditions explicit.

## Verification

- Field/lab evidence identifies representative Watch LCP elements.
- Lighthouse/WebPageTest or equivalent captures before/after metrics.
- Bundle/resource timing and player-readiness regressions are checked.
- Search Console validation is monitored after deployment.
