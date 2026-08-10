---
title: "Frontend changes require page-load performance verification"
date: "2026-07-10"
category: "conventions"
module: "Frontend verification workflow"
problem_type: "convention"
component: "development_workflow"
severity: "medium"
applies_when:
  - "Changing rendering, hydration, routing, media, loading state, timers, observers, or client-side initialization"
  - "Adding or moving network requests, dynamic imports, preloads, prefetches, or resource hints"
  - "Changing above-the-fold UI, especially on mobile"
tags: [frontend, performance, page-load, verification, browser-smoke]
related_components: [apps/web, apps/chat, apps/mobile, apps/tv]
---

# Frontend changes require page-load performance verification

## Context

A Watch `HeroPlayer` mobile autoplay fix improved perceived video startup by
mounting the Mux preview on a short timer. The first version let that timer run
while `document.readyState` was still `loading`, which meant a behavior fix also
changed initial page-load work. The corrected version preserved muted autoplay,
but only after the document reached `complete`, so the poster and first page load
were not competing with video initialization.

Session history showed the same lesson from the verification side: visual proof
and playback proof were necessary, but not sufficient. The browser recordings
proved muted autoplay eventually worked; the performance-relevant proof was the
load-gate measurement showing no video existed at page load and that video work
started after load (session history).

## Guidance

Any frontend change must include verification that it did not degrade page-load
performance. This applies even when the change is not described as performance
work.

The proof should match the risk introduced by the change:

- If the change affects above-the-fold rendering, capture page-load timing or
  Web Vitals/Lighthouse evidence when available.
- If the change affects media, scripts, or heavy client-side work, verify when
  the expensive resource first appears relative to `DOMContentLoaded` and
  `load`.
- If the change affects preloads, prefetches, dynamic imports, or network calls,
  inspect the waterfall, resource timing, or request counts/bytes.
- If the change intentionally shifts work earlier or later, call out the tradeoff
  directly in the handoff.

Screenshots and videos are useful visual proof, but they are not performance
proof by themselves. Pair them with timing, trace, telemetry, resource, or
waterfall evidence when a frontend change could affect load.

## Why This Matters

Frontend fixes can improve one visible behavior while silently spending more of
the page-load budget. Media startup, hydration effects, dynamic imports, timers,
observers, preloads, fonts, image priority, and client-side network requests can
all move work onto the critical path.

In the `HeroPlayer` case, starting muted autoplay sooner was the right product
goal. The load-bearing constraint was preserving poster-first page load. Gating
the fast path until after `document.readyState === "complete"` kept the product
behavior while avoiding extra media work during initial load.

## When to Apply

- Component mount timing changes
- Media loading, playback, poster, or player changes
- Lazy/eager loading changes
- Timers, observers, effects, or client-side initialization changes
- Network request, prefetch, preload, or resource-hint changes
- Route rendering, Suspense, hydration, or dynamic import changes
- Above-the-fold UI changes, especially on mobile

## Examples

Acceptable proof for a media timing change:

```text
Runtime load-gate proof:
- videoCountAtLoad=0
- first video mounted about 1026ms after load
- final video state: muted=true paused=false readyState=4
```

Acceptable proof for a page-load or rendering change:

```text
Before/after browser trace:
- No new long tasks during initial load
- LCP remains stable within expected run-to-run variance
- Initial transferred JS/CSS/image bytes did not increase unexpectedly
```

Acceptable proof for a network/resource change:

```text
Resource timing or waterfall:
- New request starts after load or user intent
- No added render-blocking request
- Request count and transferred bytes are compared against the previous path
```

Insufficient by itself:

```text
Screenshot shows the hero looks correct.
```

Useful, but incomplete:

```text
Video capture shows autoplay works.
```

Better:

```text
Video capture shows autoplay works, and runtime proof confirms no video element
exists at document load.
```

## Measure the window where the risk lives

Matching the proof to the risk (above) has a failure mode worth naming: taking a
real measurement, on the wrong window, and reading it as clearance.

For a **lazily-mounted** surface — a player, a heavy editor, anything behind
`next/dynamic` — the risk is NOT the initial page load. It is the moment the
chunk resolves and the component swaps in, mid-session, under content the reader
is already looking at. An initial-load trace of a page that never mounts the
component measures neither half of that. feat-328's first CLS reading was
exactly this: a genuine 0.000, taken on a page with no video, offered as
evidence about a video mount.

Two measurements, not one:

1. **The static chunk graph** — prove the deferred chunk is absent from the
   initial request set. Reproducible without a browser: after `next build`,
   compare `build-manifest.json`'s `rootMainFiles` plus the script tags in the
   HTML that `next start` serves, against the chunk that actually contains the
   heavy dependency (find it with a grep for a marker symbol). This half is
   cheap and belongs in the PR body.
2. **CLS across the mount window** — install a `layout-shift` PerformanceObserver,
   trigger the interaction that mounts the component, and read the accumulated
   value. Reserve the box in the same change: a lazily-mounted element with no
   height reservation shifts everything below it when the chunk lands.

Report which window each number came from. "CLS 0.000" is not a claim until it
names the window it covers.

## Related

- `docs/solutions/best-practices/per-message-boundary-limits-for-media-surfaces.md`
  — the same lazily-mounted surface, from the containment side.
- `docs/solutions/performance-issues/watch-mobile-autoplay-delay-20260709.md` —
  the incident that surfaced the broader convention.
- `docs/solutions/performance-issues/watch-hero-poster-idle-autoplay-20260610.md`
  — poster-first Watch hero behavior and why Mux work must stay out of the
  initial load path.
- `docs/solutions/performance-issues/web-watch-route-lighthouse-perf-campaign-lcp-bundle-fonts-20260527.md`
  — Watch page-load performance campaign with Lighthouse, waterfall, and LCP
  evidence.
- `docs/solutions/developer-experience/measurement-driven-layout-iteration-chrome-mcp-20260505.md`
  — measurement-driven frontend verification pattern.
