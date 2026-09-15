---
title: "Per-visit randomness on a statically cached route belongs at mount, over a payload the server already shipped"
date: "2026-08-27"
category: "performance-issues"
module: "apps/web Watch homepage hero"
problem_type: "performance_issue"
component: "frontend_react"
symptoms:
  - "A product ask for 'a different video every visit' on a force-static, ISR-cached route"
  - "Naive fixes either force a full dynamic RSC render per request or randomize during render and break hydration"
  - "Play-tracking storage silently biased against whichever slide the server happened to render first"
root_cause: "logic_error"
resolution_type: "code_fix"
severity: "medium"
related_components:
  - "apps/web/src/components/home/useWatchHomeTvCarousel.ts"
  - "apps/web/src/lib/watch-home-carousel-sequence.ts"
tags: [performance, ssr, hydration, isr, randomness, watch, page-load]
---

# Per-visit randomness on a statically cached route

## Context

The Watch homepage (`/watch`) is `force-static` with `revalidate = 3600`, served
from the Redis-backed ISR cache and _not_ cached at Cloudflare
(`cf-cache-status: DYNAMIC`). Product asked for the hero to open on a random
video from the library, different on every visit.

## The three wrong shapes

1. **Draw on the server per request.** Requires `force-dynamic`, which converts
   a Redis blob read into a full RSC render of a very heavy page on every visit.
   The data itself is already cheap (`unstable_cache`, 60 s), so the whole cost
   is React render time paid per visitor for one random integer.
2. **Draw during render on the client.** Server HTML and first client render
   disagree, so hydration mismatches; worse, the "static" HTML is no longer a
   shared artifact even in principle.
3. **Draw at ISR revalidation.** Random per _hour_, not per visit. Looks correct
   in a smoke test and is wrong for the actual requirement.

## The shape that works

The candidate pool was **already in the RSC payload** (the homepage ships its
carousel pools so the client can build a lineup). So:

- Server render and the first client render both use a **deterministic**
  bootstrap index over that payload. The static HTML stays byte-identical for
  every visitor — pin this with a test that renders `renderToStaticMarkup` twice
  under two different `Math.random` stubs and asserts identical output. It goes
  red the moment anyone moves the draw into render.
- The random draw runs **once in a mount effect** and pins its result in state,
  guarded by a ref latch (no cleanup-side mutation, so a StrictMode remount is a
  no-op rather than a re-draw — see the StrictMode ref law).
- Injecting the random source (`randomSource?: () => number`) keeps the
  deterministic path intact and makes every draw assertion exact instead of
  statistical.

Cost accounting: zero added server work, zero added payload, one extra poster
image after hydration. It is the cheapest place the requirement can be met at
all, and it should be stated that way rather than as "the client is easier".

## Two traps found on the way

**A draw that skips already-seen items must not record the bootstrap slide.**
Play tracking marked whatever was active on mount as played. With a
deterministic bootstrap plus a random draw, that meant _every_ visitor recorded
the same bootstrap video every visit, permanently excluding exactly one video
from everyone's random pool. Suppress the write until the drawn item commits,
and compare against the id you _set_ rather than the slide it resolved to, so an
unresolvable id cannot wedge tracking off for the session.

**A "first unseen item" index recomputed during render is a feedback loop.**
The pre-existing index read `localStorage` on every render while a mount effect
wrote to it, so each re-render advanced the selection, which re-ran the effect,
which advanced it again. In production it happened to stop, because the sequence
began with a branded Mux insert that the writer deliberately skips — a data
accident, not a guard, and one that evaporated when the inserts themselves were
removed a day later. A fixture without that leading insert reproduces it as
`Maximum update depth exceeded`. Derived state that reads a store the component
also writes needs to be pinned in state, not recomputed per render.

## Orientation has no server-side signal — measure the decoder

A random draw over the whole library will eventually surface a portrait video,
and a wide hero renders it as a cropped centre strip. There is no server-side
field to filter on: admin's `MuxVideo` exposes only ids, and `VideoImage`
width/height/aspectRatio describes the POSTER, which is routinely portrait for
landscape films — filtering on it drops good videos rather than bad ones.

The only trustworthy signal is the decoded size at `loadedmetadata`, which means
the filter cannot be a pre-filter; it has to be a skip. Three properties make
that safe:

1. **Fail open.** Unknown or zero dimensions are allowed through, so the guard
   only ever acts on a confident measurement.
2. **Remember the answer.** Record the id (same monthly storage bucket as played
   ids, so a re-encode self-heals) and hard-exclude it from later draws — a
   _hard_ exclusion, unlike "already played", which deliberately falls back to
   the full set once everything has been seen.
3. **Bound the skip.** Cap consecutive skips at the slide count, or an
   all-portrait pool spins forever.

Dropping the slide from the queue is not sufficient on its own: the active id
stops resolving and the hero falls back to the FIRST slide, replaying something
the visitor already saw. The skip has to advance explicitly, and the test for it
needs a portrait video in the MIDDLE of the queue — with it first, "fall back to
index 0" and "advance to the next" produce the same answer and the test passes
either way.

Verifying this needs a real portrait stream, which the catalog may not have:
`ffmpeg -f lavfi -i testsrc=size=720x1280 ... -hls_time 2 index.m3u8` served from
the local stub gives the decoder something genuinely 9:16 to report.

## Measuring the page-load effect without a browser

No Admin GraphQL endpoint is reachable from a local worktree, so LCP could not
be captured. A jsdom probe over the real component tree with a production-shaped
fixture still produces real numbers, and is worth writing as a throwaway:

|                                               | before | after  |
| --------------------------------------------- | ------ | ------ |
| `<Image>` elements in the hero region at load | 9      | 1      |
| hero-region DOM nodes                         | 132    | 47     |
| SSR HTML bytes (fixture page)                 | 38,164 | 21,213 |
| SSR HTML gzipped                              | 6,093  | 5,181  |

Run it against `git checkout HEAD -- <files>` for the baseline, then restore.
Request counts, DOM node counts and SSR byte counts are all measurable this way;
say plainly which axis (LCP) is still unmeasured rather than implying coverage.
