---
title: "A stable next/link href is necessary but not sufficient — read the residue against a control set"
date: "2026-09-22"
category: best-practices
module: apps/web
problem_type: best_practice
component: frontend_stimulus
severity: medium
applies_when:
  - "Stopping repeated RSC prefetches by making a next/link href stop changing"
  - "Reading a non-zero residual request count after a prefetch or network fix and deciding whether the fix is done"
  - "Measuring next/link prefetch behaviour at all, which only a production build shows"
  - "Mirroring a prop into a ref on a component the parent never re-keys"
tags:
  - next-link
  - prefetch
  - rsc
  - measurement
  - control-set
  - react-refs
  - apps-web
related:
  - "docs/solutions/best-practices/next-link-props-unobservable-three-vacuous-test-traps.md"
  - "docs/solutions/best-practices/nextjs-16-shallow-history-traverse-zero-rsc-requests.md"
  - "docs/solutions/best-practices/nextjs-hmr-reload-breaks-stateful-browser-verification.md"
  - "docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md"
  - "docs/solutions/logic-errors/react-strictmode-remount-safety-hook-lifetime-refs.md"
  - "docs/solutions/logic-errors/layout-effect-commit-lag-mini-player-shrink-flash.md"
---

# A stable href is necessary but not sufficient

Sibling of
[next-link-props-unobservable-three-vacuous-test-traps](next-link-props-unobservable-three-vacuous-test-traps.md),
which owns why a `prefetch` assertion passes vacuously in a unit test. This doc
is one layer up: how to read the numbers a production build actually gives you,
and when a partial win is indistinguishable from a finished fix.

Measured against `next@16.2.4` on `next build` + `next start`, not from docs.

## Context

The Watch home hero CTA rendered its destination with the muted preview's live
position baked in — `href={appendAutoplaySignal(slide.href, playbackTimeSeconds)}`.
`next/link` re-prefetches an in-viewport link whenever its `href` changes, and
the position advances once per playback second, so an idle `/watch` tab issued
about one uncacheable RSC round-trip per second to the origin for as long as it
stayed open (FGE-139 / W-003; the audit measured 33 fetches of one path in 35 s
at 26,218 B each).

The obvious fix was to make the href stop moving: render `autoplay=1` only, hold
the position in a ref, and append it at click time via `router.push`. That is the
right fix and it is not the whole fix.

## The measurement

One idle tab on `/watch`, production build, real content. The hero destination's
`_rsc=` fetch count, and — the part that matters — the same count for the
category tiles, which this change never touched.

|                                      | pre-fix                 | stable href only | stable href + `prefetch={false}` |
| ------------------------------------ | ----------------------- | ---------------- | -------------------------------- |
| window                               | 19.2 s                  | 48.0 s           | 40.0 s                           |
| hero destination `_rsc=` fetches     | **30** (1.56/s)         | **8** (0.17/s)   | **0**                            |
| distinct hero hrefs observed         | **19** (`t=4,5,6,7,8…`) | 1                | 1                                |
| control links (category tiles), each | 2 / 19 s                | 4 / 48 s         | 2 / 19 s                         |

## Guidance

### The residue is not proof the fix is incomplete, and not proof it is complete

Eight fetches in 48 s, after a fix that took 30 in 19 s, is genuinely ambiguous
on its own. It reads equally well as:

- the fix worked, and what is left belongs to something else; or
- the href is still moving in some case the 400 ms sampler missed.

Nothing in the hero's own numbers separates those. What separated them was the
**control set**: links on the same page, in the same viewport, in the same
window, that the change did not touch. The category tiles showed the same
per-link cadence throughout — so the residual 8 was `next/link`'s own viewport
refresh cycle, which no amount of href stability reaches, and the natural next
move (keep hunting the href) would have been wasted.

**Do:** before concluding anything from a residual count, record the same count
for an untouched sibling in the same window. A residue that matches the control
is the baseline cost of the mechanism; a residue that exceeds it is your bug.

**Do not** compare against a different window length and reason about rates
alone. Prefetch cadence is not uniform — it clusters on viewport entry and on
the refresh cycle — so 8-in-48 s and 2-in-19 s are only comparable when a
control measured in the same window says they are.

### Both halves of the fix, and why neither alone is enough

- **Stable href** is what makes the per-second storm impossible _by
  construction_. Reaching for `prefetch={false}` alone leaves a link whose href
  still changes once a second — one `prefetch` default away from the bug
  returning, and nothing in the code says why it must not.
- **`prefetch={false}`** is what clears the refresh-cycle residue. Reaching for
  href stability alone leaves a measurable, permanent per-link cost.

State which one you are relying on for which property. They are not
interchangeable and the ticket that asks for "zero repeated fetches" needs both.

### Scope the opt-out to the link you measured

`prefetch={false}` on one CTA is a different decision from the same posture
across a rail of tiles, and from bounding the fan-out globally via `staleTimes`.
Keeping the change to the one link kept the control set valid _and_ left the
adjacent tickets free. The control set is also how you prove you did not
broaden: the tiles' cadence is unchanged in the after column.

### The tradeoff is part of the evidence

`prefetch={false}` moves work from idle time to click time. Measure it and say
so — 609 ms and 849 ms click-to-commit in two runs here — rather than reporting
only the number that improved. Per
[frontend-change-page-load-performance-verification](../conventions/frontend-change-page-load-performance-verification.md),
a change that intentionally shifts work must call the shift out directly.

A second, quieter tradeoff: once `t=` leaves the rendered href, a cmd/ctrl/middle
click opens the new tab _without_ the resume position, because a modified click
never reaches the client router and so never reaches the handler that appends it.
That is unavoidable given a href that must hold still. Record it as accepted, or
someone diffing production resume behaviour later will file it as a regression.

## The ref that outlived its slide

The same change introduced a second hazard worth its own note, which three
independent reviewers found and no test could.

Holding the live position in a ref means mirroring a prop into that ref through
an effect. The component — the hero CTA — is never re-keyed by its parent, so
**one instance survives every slide change**, while the effect that refreshes the
ref runs _after_ the commit that swapped the slide. For that window the ref held
the outgoing slide's position while the href already pointed at the incoming one:
slide A's timestamp on slide B's URL, a resume position for a different video.

**Do:** when a ref mirrors a value that belongs to an identity, store the
identity _in_ the ref and compare it at read time.

```ts
const playbackTimeRef = useRef({
  slideId: slide.id,
  seconds: playbackTimeSeconds,
})
useEffect(() => {
  playbackTimeRef.current = { slideId: slide.id, seconds: playbackTimeSeconds }
}, [slide.id, playbackTimeSeconds])

// at read time
const tracked = playbackTimeRef.current
const seconds = tracked.slideId === slideId ? tracked.seconds : 0
```

A mismatch then drops the value instead of misattributing it — the window fails
safe whatever React's scheduling does, and you are not betting the fix on an
internal flush guarantee.

**Know that the mismatch branch is unreachable from tests.** `act()` flushes
passive effects before it dispatches a click, so no suite can hold the ref and
the prop apart. Label it in place as defensive, and pin the production-reachable
half instead — here, that the hook zeroes the position in the same commit that
swaps the slide, so a click right after a transition carries no `t=`.

This is a **boundary case** for
[react-strictmode-remount-safety-hook-lifetime-refs](../logic-errors/react-strictmode-remount-safety-hook-lifetime-refs.md),
not an instance of it: that law is about cleanup-side mutation, and this effect
has no cleanup, so a StrictMode render would not have caught it. It is closer in
shape to
[layout-effect-commit-lag-mini-player-shrink-flash](../logic-errors/layout-effect-commit-lag-mini-player-shrink-flash.md)
— an effect firing after the commit that already changed the thing it describes.

## Why This Matters

A per-second RSC fetch from every idle tab is the single largest amplifier of any
origin slowdown into a site-wide one. Getting it from 30 to 8 and stopping would
have left a permanent per-link cost in place while the PR reported the bug fixed
— and the only thing that made 8 legible was a number nobody asked for.

## When to Apply

- Any fix whose success criterion is "fewer network requests"
- Any `next/link` whose `href` is computed from changing state
- Any ref mirroring a prop on a component the parent does not re-key
