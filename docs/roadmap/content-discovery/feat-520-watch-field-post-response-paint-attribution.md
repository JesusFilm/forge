---
id: "feat-520"
title: "Attribute non-headless Watch paint delays after HTML response"
owner: "nisal"
priority: "P2"
status: "not-started"
start_date: "2026-09-18"
duration: 3
depends_on: []
blocks: []
tags: [web, watch, performance, observability]
---

## Problem

feat-515 identified the reproduced cold headless H1 delay as Chrome 153 toolbar
surface synchronization and separately explained a late VIDEO LCP as native
poster mounting. Neither mechanism establishes the cause of every field event.
Among 14 retained slow hero-heading events, two mobile visits had first byte at
2.53/5.10 seconds and FCP at 13.82/15.14 seconds. Thirteen of 14 had identical
FCP/LCP; most other events were dominated by first-byte time. These are selected
events, not user percentiles. Bot classification and missing LCP selectors limit
population inference.

## Entry points

- `docs/operations/watch-paint-surface-sync-2026-09-18.md`: proven browser cause,
  exact harness, controls and limits.
- `docs/roadmap/content-discovery/feat-515-watch-cold-paint-preview-verification.md`:
  field cohort and separate native-poster experiment.
- `docs/roadmap/platform/feat-496-watch-rollout-runtime-recovery.md`: ongoing
  Admin/response delays; coordinate first-byte investigations there.
- `apps/web/src/components/watch/HeroPlayer.tsx`,
  `apps/web/src/components/watch/WatchHeroOverlay.tsx` and
  `apps/web/src/lib/watch-font.ts`: render/media/font timing.
- Datadog RUM: group `view.first_byte`, `view.first_contentful_paint`,
  `view.largest_contentful_paint` and its target selector by browser version,
  device and route. Confirm actual available field names before querying.

## Work and verification

Separate identified automation from user populations, and keep missing-selector
events visible in denominators. Split first-byte-dominated cases from delay
after the response. Retain exact query, Web revision, device/browser, network
timing, all LCP candidates and visibility without publishing user identifiers.
Find a representative physical-device or field trace for post-response delay;
then reproduce its causal path before changing application code.

If a fix is justified, use matched conditions, appropriate hero/recorder tests,
page-load timing and production acceptance. Report HTTP failures, semantic
delivery fallbacks, selection acknowledgments and rendering separately. A
headless feature override or short healthy sample is insufficient for closure.

## Constraints

Preserve preview timing and telemetry unless a demonstrated cause warrants a
scoped change. No metric-only removal of native posters, suppressed errors,
longer request deadlines, account linking, content republishing or Mobile/TV UI
changes. Keep the authored English Homepage Recommendations Block removed and
`forge.watch.homepageRecommendations` default off. Use isolated owned worktrees
and normal PR/main deployment; restore temporary diagnostics.
