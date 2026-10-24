---
id: "feat-520"
title: "Attribute non-headless Watch paint delays after HTML response"
owner: "nisal"
priority: "P2"
status: "in-progress"
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
changes. Preserve the current owner-authorized homepage recommendation pilot
gating and published block state; do not remove, republish or widen targeting
as part of this investigation. Use isolated owned worktrees and normal PR/main
deployment; restore temporary diagnostics.

## September 21 field attribution

The two original mobile cases remain distinct from identified automation. The
September 17 01:25:58 UTC Spanish prayer visit used Chrome Mobile 152 at 360×678,
with first byte 2,530.7 ms and H1 FCP/LCP 13,816 ms. The 08:07:04 Tswana visit
used Chrome Mobile 150, first byte 5,098.4 ms and H1 FCP/LCP 15,140 ms. Both were
foreground from navigation. The reduced Android device label `K` does not
identify physical hardware or establish that either visitor was human.

The Spanish view has initial long animation frames of 4,964 and 7,127 ms. The
latter includes about 1,094 ms of React/Next startup and a 1,515 ms scheduler
callback, but the available mapping ends at the framework scheduler. A long
animation frame's duration is not all JavaScript execution, and these samples
do not identify a leaf component or implicate the playback recorder.

The same view's two render-blocking CSS requests complete about 4,169 ms after
navigation and its font completes about 5,282 ms, using their client-clock
timestamps. All three are HTTP 200; the font is reported non-blocking. Those
downloads alone therefore do not explain FCP at 13,816 ms. Datadog collector
timestamps differ from client timing; do not align these phases by intake time.

Two owned, headed Chromium 149 controls matched route, viewport, locale and
timezone, using native user agents and CPU rates 1×/6×. First byte/FCP were
822/1,140 ms and 274/688 ms; the largest observed long animation frames were
265/708 ms. CPU slowdown did not reproduce the field delay. Different response
and cache timings prevent treating these as a performance comparison.

A newer slow `/watch` sample on Web `4e31f822781f44df06e91c8194142a6c4b51646a`
identifies an Android emulator, with foreground beginning after six seconds;
keep it separate from the two original cases. No application fix is established.
Continue with a source-mapped field or physical-device reproduction of the
pre-paint work. [Release evidence](../../operations/watch-closeout-release-2026-09-21.md)
records the diagnostic boundaries.

## September 24 bounded field continuation

Two current-release, browser-named mobile views give new post-response paint
examples. The foreground Opera Mobile `/watch/jesus.html` view has 32.9 ms first
byte and 18.132 s FCP/LCP; one render-blocking stylesheet takes 13.903 s,
including 11.539 s downloading 303,200 bytes. A 16.273 s long animation frame
overlaps the pre-paint interval but lists only about 416 ms of scripts. A Chrome
Mobile `/watch` view has 3.540 s first byte and 13.896 s FCP; two blocking CSS
requests each take about 8.463 s. These cases do not establish why the
remaining time before paint elapsed or prove the original two field events
share a cause. Exact Web revision, queries, resource timing, compression
comparison and automation limits are in the
[September 24 browser record](../../operations/watch-browser-investigations-2026-09-24.md).

The next required artifact is one matched headed or physical-device renderer
capture with effective network conditions, stylesheet completion, all paint
candidates and pre-paint work, followed by a control before any Web change. An
owned headed-browser startup timed out before navigation in this continuation;
no application correction is justified yet.
