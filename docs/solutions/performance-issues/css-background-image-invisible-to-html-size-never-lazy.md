---
title: "A CSS background-image is invisible to HTML-size inspection and is never lazy-loaded"
date: "2026-09-12"
category: "performance-issues"
module: "apps/web Watch language inventory"
problem_type: "performance_issue"
component: "frontend_stimulus"
symptoms:
  - "The whole-catalog /watch/<lang>.html/videos route transferred 29.0 MB, of which 27.1 MB was decorative per-collection backdrops no HTML-size measurement could see"
  - "A source comment claimed the page ships ~7MB because the team had measured the DOM document, never the network transfer"
  - "Each of the 111 collection groups that has authored artwork downloaded a 1.3-1.5 MB Cloudflare Images PNG at w=1280,h=600,q=95 for an element rendered at most ~440 CSS px wide"
  - "content-visibility: auto did not defer the background downloads (27.52 MB with it vs 27.53 MB without)"
  - "The backdrop downloads starved the LCP hero image: LCP 8,796 ms and load 28,030 ms on Fast 4G with 4x CPU throttle"
root_cause: "logic_error"
resolution_type: "code_fix"
severity: "high"
framework_version: "next 16.2.4"
related_components:
  - "apps/web/src/lib/url.ts"
  - "apps/web/src/components/watch-language-inventory/LanguageInventoryPage.tsx"
  - "apps/web/src/components/watch/watch-section-styles.ts"
  - "apps/web/src/lib/watch-language-inventory.ts"
tags:
  - "watch"
  - "language-inventory"
  - "page-weight"
  - "css-background-image"
  - "cloudflare-images"
  - "lcp"
  - "image-sizing"
  - "content-visibility"
---

# A CSS background-image is invisible to HTML-size inspection and is never lazy-loaded

## Problem

`/watch/<lang>.html/videos` paints one blurred decorative backdrop per collection
group as a CSS `background-image`, and a CSS background is fetched eagerly for
every element in the document regardless of how far below the fold it sits. At
the authored Cloudflare Images transform (`w=1280,h=600,q=95`, a 1.3-1.5 MB PNG
apiece) that was **27.1 MB of a 29.0 MB page** — and none of it was visible to
any of the tools the team had been using to measure this page's weight.

## Symptoms

- The English inventory page transferred ~31.4 MB on a cold load
  (DevTools "Fast 4G" + 4x CPU throttle, cache disabled), of which 27.5 MB was
  images. Load event at ~28 s.
- LCP was ~8.8 s on that profile, on a hero that is small, early in the document
  and had already been optimized. Nothing in the hero's own code explained it.
- The document itself measured 9.44 MB, and every document-level inspection
  agreed with that number — `curl` of the HTML,
  `document.documentElement.outerHTML.length`, and view-source all report
  9.44 MB and _cannot see_ the 27 MB. The gap between "the page is 9.4 MB" and
  "the page is 29 MB" was the whole bug.
- Not language-specific. This session counted 111 collection groups on English,
  75 on French, 56 on Russian, 50 on Hindi — the page renders the entire catalog
  in one document (`WATCH_LANGUAGE_INVENTORY_LIMIT = 1_000`,
  `apps/web/src/lib/watch-language-inventory.ts:19`), so the group count scales
  with the library, not with the viewport. The backdrop is gated on the group
  having artwork, so the number of backdrop _requests_ trails the group count
  slightly (measurements below were taken at ~110 requests against 111 groups);
  the distinction does not affect the magnitude.

Entry points: route
`apps/web/src/app/[locale]/[htmlLang]/videos/[languageSlug]/page.tsx` ->
`apps/web/src/components/watch-language-inventory/LanguageInventoryPage.tsx`
(the backdrop element carries `WATCH_IMMERSIVE_BACKDROP_CLASS` from
`apps/web/src/components/watch/watch-section-styles.ts:32`). `basePath` is
`/watch` (`apps/web/next.config.mjs:68`), so the public URL nests the segment
twice.

## What Didn't Work

**Measuring the DOCUMENT instead of the TRANSFER.** This is the framing error
that hid the bug for the whole preceding round of work. A source comment still in
the tree records it: `inventoryFacetAttributes` in `LanguageInventoryPage.tsx`
justifies emitting only the filter attributes a filter actually reads with "this
page ships ~7MB of HTML, and an unread attribute across ~990 items is pure
weight." That reasoning is correct and the optimization was real — but "ships
~7MB" is a claim about the document, and the document was never where the weight
was. Every tool that returns a single number for "page size" from the markup —
`curl | wc -c`, `outerHTML.length`, view-source, an SSR byte-count test — is
structurally blind to a CSS background, because the URL is in a style attribute
and the bytes are a separate request the document never states a size for.
**A document-size measurement cannot falsify a transfer-size claim, and the two
differed here by 3x.**

**Assuming `content-visibility: auto` would defer the fetch.** The compact rows
already carry `[content-visibility:auto]`, so extending it to the group panels
looked like the obvious no-cost fix. Measured 2026-09-12: **27.52 MB with it,
27.53 MB without** — no effect at all. `content-visibility: auto` skips _layout
and paint_ of off-screen subtrees. It does not gate resource fetching, and the
CSS background of a skipped subtree is still requested during the initial load.
It is a main-thread optimization wearing a bandwidth optimization's clothes.

**Reaching for `loading="lazy"`.** There is no CSS-background equivalent. The
attribute exists on `<img>` and `<iframe>` only. Any plan that reads "just lazy
the backdrops" has no mechanism behind it.

**Treating the `srcset` bloat as the main problem.** It was a genuine finding — a
`sizes` string with no `vw` unit defeats next/image's candidate narrowing, and
that was 15 candidates per row and 2.81 MB of attribute strings across 1,000
rows. But 2.81 MB of a 29 MB page is an order of magnitude smaller than the thing
sitting next to it. It read as _the_ answer only because it was the largest thing
visible in the document, which is exactly the blind spot above: the search was
bounded to the surface the measurement could see.

## Solution

Shrink the _source_ behind the blur, at the URL. `resolveBlurredBackdropUrl()` in
`apps/web/src/lib/url.ts` rewrites a Cloudflare Images transform to `w=128`
(`BLURRED_BACKDROP_MAX_WIDTH`) at `q=50`, preserving the aspect ratio so the crop
cannot shift.

Before:

```tsx
style={{ backgroundImage: `url("${groupImageUrl}")` }}
// https://imagedelivery.net/<acct>/<id>/f=jpg,w=1280,h=600,q=95  -> 1,555,710 B
```

After:

```tsx
style={{ backgroundImage: `url("${resolveBlurredBackdropUrl(groupImageUrl)}")` }}
// https://imagedelivery.net/<acct>/<id>/f=jpg,w=128,h=60,q=50    ->     5,378 B
```

Three guard rails are load-bearing, all pinned in `apps/web/src/lib/url.test.ts`:

- **Mux frame URLs pass through untouched.** They are already the pre-generated
  448x252 derivative (~13 KB), and a bespoke width there is a cold on-demand
  render — the repo's existing Mux derivative-recipe rule. The test uses the real
  `resolveMuxFrameThumbnailUrl()` output, because a Mux frame is the _other_
  source this backdrop is handed in production, not a hypothetical.
- **Unknown hosts pass through unchanged** rather than being guessed at. A wrong
  guess is a broken image; the no-op is merely the status quo.
- **Never upscale**: a source already at or below the cap is returned as-is.

Measured result (live English page, 390x844x3, Fast 4G + 4x CPU, cache disabled):

|             | before       | after                 |
| ----------- | ------------ | --------------------- |
| transferred | 31.45 MB     | 4.54 MB (-85.6%)      |
| images      | 27.52 MB     | 0.70 MB (-97.5%)      |
| FCP         | 2,192 ms     | 1,888 ms              |
| **LCP**     | **8,796 ms** | **2,624 ms (-70.2%)** |
| load        | 28,030 ms    | 3,327 ms              |

The in-tree comment in `url.ts` records a sibling run of the same comparison at
8592 ms -> 2648 ms and 31.4 MB -> 4.7 MB. Same conclusion, different run; neither
is a claim of millisecond precision.

**Rendered-panel screenshot diff at 390 px and 1280 px: 0 differing pixels, max
channel delta 0.** A `blur(40px)` destroys all detail above roughly its own
radius, so the 1.5 MB carried literally nothing the 5 KB did not.

Shipped in [#2274](https://github.com/JesusFilm/forge/pull/2274), the same
change this document travels with — so `resolveBlurredBackdropUrl` is reachable
wherever this file is.

## Why This Works

The root cause is a mismatch between what the element _requests_ and what it can
possibly _display_. The backdrop renders at most ~440 CSS px wide under
`blur-2xl` (`blur(40px)`) plus `brightness-50` and `saturate-75`
(`watch-section-styles.ts:29-32`). Under a 40 px blur radius, spatial detail
finer than about that radius is gone by construction — so above roughly
`element_width / blur_radius` source pixels, every additional byte is discarded
by the compositor before anything is painted. A 128 px source already carries
strictly more information than survives the filter. The pixel-identical diff is
not luck; it is what the math predicts.

The multiplier is the page shape. One oversized decorative background is a
rounding error. The same background on a whole-catalog page — 111 groups on
English, and the count grows with the library — is the page. Any per-item cost on
this route is a per-item cost times ~1,000 (rows) or ~111 (groups), and that is
the number that has to be reasoned about, not the per-item one.

The LCP collapse is the second-order lesson and the more transferable one:
**off-screen decorative bytes compete with the LCP element for bandwidth.** The
change touches no hero code, adds no priority hint, and reorders nothing — it
only stops 27 MB of images the user will never look at from queueing ahead of,
and sharing a connection with, the one image that defines the user's perception
of load. A page-weight problem and an LCP problem were the same problem.

**Caveat that must not be dropped:** all of this was measured in emulated Chrome
on a desktop GPU, not on a real device. Byte counts and main-thread timings
transfer; frame counts from this setup are a no-regression check only, never a
device-performance claim.

## Prevention

**Measure transfer, not document.** Any page-weight claim needs a transfer number
from the network layer — DevTools' network panel total with cache disabled and
throttling on, `performance.getEntriesByType("resource")` summed over
`transferSize`, or a Lighthouse total-byte-weight audit. Treat
`outerHTML.length` and `curl | wc -c` as measuring one _component_ of page weight
and say so in the comment that cites them. A number sourced from the markup can
never see a CSS background, a `@font-face`, a `background-image` in a stylesheet,
a JS-injected `new Image()`, or a preloaded media segment.

**Rule for sizing a blurred source.** A source behind a blur needs at most
`element_css_width_px x dpr_cap / (blur_radius_px / 2)` pixels of width, and in
practice a flat cap in the low hundreds is safe for any radius >= 20 px. State
the cap as a named constant next to the radius it is derived from
(`BLURRED_BACKDROP_MAX_WIDTH` beside `blur-2xl`), so a later change to the blur
radius lands next to the assumption it invalidates. Verify with a screenshot diff
of the rendered panel at the narrowest and widest breakpoints — if the diff is
not 0 pixels the cap is too low, and if it is 0 you have direct evidence the old
bytes were unused.

**A test-shaped assertion exists for the part that regresses.** The two halves
that a well-meaning edit would undo are each pinned:

- In `apps/web/src/lib/url.test.ts`, the _production_ transformation string is
  the primary fixture — the exact `f=jpg,w=1280,h=600,q=95` shape admin's
  authored artwork arrives with, the one that produced the 27.1 MB — not a
  synthetic URL. Aspect-ratio preservation, the Mux no-op, the unknown-host no-op
  and the no-upscale rule each get their own case.
- In `LanguageInventoryPage.weight.test.tsx`, the backdrop case asserts slot
  identity in both directions: the backdrop gets the 128 px derivative _and_ the
  sharp panel thumbnail beside it keeps the full-resolution source. Shrinking
  both is the easy wrong edit, and without the second assertion it would stay
  green.

**A new CSS `background-image` on a list-shaped surface is a review trigger.**
Ask three questions before it merges: how many of these render in one document;
what is the largest CSS size the element occupies; and what filters sit on top of
it. If the answers are "one per item", "small", and "a heavy blur", the source is
oversized by default — Cloudflare Images and Mux both hand out whatever transform
the URL asks for, and the authored transform is sized for the surface the artwork
was authored for, never for this one.

**The blur radius this cap is derived from is not shared as one symbol.** The
brightness, saturation, and base-colour constants for this treatment are shared
across the surfaces that use it, but the blur class itself is a literal repeated
per surface — and the copies already differ. That means a future change to the
radius on one surface will not move `BLURRED_BACKDROP_MAX_WIDTH`, which is
derived from it. Treat the radius and the cap as a pair, and prefer importing the
shared class over re-typing the literal.

**`next/image` discipline does not reach this class of weight.** `apps/web`
requires `next/image` over raw `<img>`, and the repo's LCP/preload rulebook in
[web-watch-route-lighthouse-perf-campaign-lcp-bundle-fonts-20260527.md](web-watch-route-lighthouse-perf-campaign-lcp-bundle-fonts-20260527.md)
is written entirely in next/image terms. Neither reaches a CSS background, which
is precisely why 27 MB survived a review culture that is otherwise careful about
images.

## Related Issues

- [docs/solutions/conventions/frontend-change-page-load-performance-verification.md](../conventions/frontend-change-page-load-performance-verification.md)
  — the governing verification convention this finding tests and partly outruns.
  It prescribes comparing transferred bytes but never names the
  document-vs-transfer trap; the `~7MB of HTML` comment on this very page is
  evidence the prescription did not land.
- [docs/solutions/best-practices/missing-artwork-frame-fallback-derivative-recipe-and-authored-first-20260826.md](../best-practices/missing-artwork-frame-fallback-derivative-recipe-and-authored-first-20260826.md)
  — closest neighbour, same page and same file. Its rule ("derive dimensions from
  the pre-generated recipe, not from the box the layout wants") reads
  provider-agnostic but rests on three Mux-only preconditions: a fixed derivative
  recipe set, a per-exact-URL cache, and a paired LQIP. Cloudflare Images is the
  opposite case — an arbitrary on-the-fly transform provider, where sizing to the
  need is correct. The two rules do not conflict; the provider decides which
  applies.
- [watch-infinite-feed-bounds-server-and-dom-work.md](watch-infinite-feed-bounds-server-and-dom-work.md)
  — sibling in the "per-item cost x catalog size" family, different axis.
- [watch-language-inventory-candidate-first-sql-20260713.md](watch-language-inventory-candidate-first-sql-20260713.md)
  — same route, the other layer that was too expensive.
- [watch-cold-path-performance-follow-up-20260610.md](watch-cold-path-performance-follow-up-20260610.md)
  — prior art on a Cloudflare Images sizing mismatch.
- [docs/solutions/ui-bugs/watch-language-inventory-portrait-thumbnail-marker.md](../ui-bugs/watch-language-inventory-portrait-thumbnail-marker.md)
  — documents the pixel-only `sizes` string that #2274 replaced; factually
  drifted as of this date.
- Sibling learnings from the same arc, not folded in here: the per-item
  `backdrop-filter` scroll regression fixed in
  [#2271](https://github.com/JesusFilm/forge/pull/2271) (merged), and the
  `sizes`-without-`vw` srcset finding. Each warrants its own write-up.
- No GitHub issue tracks this; `gh issue list` across eight keyword searches
  returned nothing relevant.
