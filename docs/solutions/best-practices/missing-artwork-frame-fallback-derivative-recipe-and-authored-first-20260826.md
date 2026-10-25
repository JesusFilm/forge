---
title: A missing-artwork frame fallback must be derived from the pre-generated derivative recipe, not from the layout's ideal width
date: 2026-08-26
problem_type: best_practice
category: best-practices
component: apps_web
root_cause: fallback_tier_added_without_deriving_upstream_contract
resolution_type: code_fix
severity: medium
tags:
  - thumbnails
  - mux
  - next-image
  - fallback-chain
  - vertical-video
  - watch
---

# Problem

The newer vertical Watch series (`impulses-for-the-way-vertical`, 33 episodes)
rendered an entire grid of empty gradient tiles on both
`/watch/{lang}.html/videos` and `/watch/{parent}.html`. The episodes are
playable and carry Mux playback ids, but they ship with **no `video_image` row
at all**, so every surface fell through to its placeholder.

The instinctive read of the screenshot is "vertical videos are being cropped
wrong". It was not a CSS/aspect problem — there was no image in the data at
all. Confirming that first (the rendered HTML contained the literal fallback
gradient, not an `<img>`) is what kept the fix out of the CSS layer.

# Three rules this produced

## 1. Derive the fallback's dimensions from the pre-generated recipe, not from `sizes`

The intuitive move is to size each frame request to the box it fills: 448 for a
card, 640 for a mid panel, 1280 for a full-bleed hero. That is wrong here.

Admin pre-generates exactly TWO Mux derivatives
(`apps/admin/src/services/mux-image-derivative.service.ts`):

- `WATCH_CHAPTER_CAROUSEL_RECIPE` — `thumbnail.jpg?width=448&height=252&fit_mode=smartcrop&time=2` (+ a 24x14 LQIP)
- `WATCH_HERO_POSTER_RECIPE` — `thumbnail.webp?width=1280&time=2` (no height, no fit_mode) (+ LQIP)

Mux caches derivatives **per exact URL**. A bespoke `width=640&height=360`
is a cold on-demand render — measured 2.2–2.9s TTFB — and it also orphans the
matching LQIP that admin already exposes as `muxThumbnailBlurDataUrl`. On a
`priority` above-the-fold hero that converts a missing-image bug into an LCP
bug.

So: request the recipe, and let the layout absorb the mismatch. Here the page
hero takes a softer upscale of the 448 source because it renders at
`opacity-35` behind two stacked gradients, where sharpness is not load-bearing.
Collapsing every surface to one width also made the diff smaller (a whole
`width` parameter and its tests disappeared).

**Corollary:** pin the URL byte-for-byte in a test naming the upstream recipe
constant. A silent width drift moves every card onto a cold render and drops
the LQIP, and nothing else in the system complains.

## 2. `fit_mode=smartcrop` is load-bearing for vertical sources — verify at the provider

Mux's default `fit_mode=preserve` **pads** the frame into the requested box.
Measured against a real 2160x3840 (9:16) source:

| request                                   | result                          |
| ----------------------------------------- | ------------------------------- |
| `width=448&height=252&fit_mode=smartcrop` | 448x252 — filled landscape crop |
| `width=448&height=252&fit_mode=preserve`  | **142x252** — a narrow strip    |

Under `object-cover` in a 16:9 box, that 142x252 strip is exactly the
"letterboxed sliver" failure the fallback was meant to prevent. This is a
provider-behavior claim, so it was verified by fetching all three variants and
reading their real dimensions — not from the docs, and not from the rendered
page (where the scrim hides it).

## 3. Authored-first across candidates is a TWO-PASS rule, not a `??` chain

Once _every_ candidate can synthesize an image, `a ?? b` silently changes
meaning. `collection?.imageUrl ?? firstItem?.imageUrl` is authored-first; but
`cardImageUrl(collection) ?? cardImageUrl(firstItem)` lets the collection's
**frame** preempt the child's **authored artwork**, because the first call now
always returns something.

Every "prefer the real thing, fall back to the synthesized thing" scan over a
LIST must be two passes over the whole list:

```ts
present.find((item) => item.imageUrl)?.imageUrl ??
  present.map((item) => frameUrl(item.muxPlaybackId)).find((url) => url != null)
```

This bit two heroes in one diff — the page hero got it right and the
collection-group hero got it wrong, in the same file, because they were written
minutes apart. Extracting one `preferAuthoredImageUrl(candidates)` helper is
what makes them agree.

**Testing note:** once every surface requests the same URL, a hero assertion can
no longer be scoped by URL. Scope it by ELEMENT (`container.querySelector("section img")`).
The first attempt asserted the frame-only card's playback id appeared _nowhere_
on the page, which is wrong for a reason unrelated to the hero: that card
legitimately renders its own frame in its own row.

# Empty string is a distinct shape from null in an image fallback chain

Admin's `VideoImage` resolver passes stored column values through raw, and
admin's own inventory SQL defends against blanks with `NULLIF(BTRIM(...), '')`.
So a present-but-blank `mobileCinematicHigh` is a real production shape. Under
`??` an empty string is a HIT: the card renders `src=""` **and** suppresses the
Mux tier below it — reproducing the exact empty tile the new tier exists to
remove. Gate every tier on truthiness, and test the blank case, not just null.

# Verification that mattered

- **Real DB.** The new inventory SQL ran against a real Postgres with seeded
  dubs. Mocked SQL-shape tests prove the clause shape; only the real run proves
  the joins resolve. It also caught that the language preference works: a
  longer-duration Spanish dub did NOT win over the requested English one.
- **Mutation testing on the SQL.** Three independent mutations (invert the
  bucket `CASE`, drop the `playable_audio` join, drop the projection) each had
  to turn the admin suite red. Before the guards were added, all three left it
  green.
- **Above-the-fold delta, measured not assumed.** Counting cards in the initial
  viewport on the live page (layout unchanged by the diff) showed 0 new
  above-the-fold requests at 1280x800 and +1 (~11.8 KB WebP) at 390x844.

# Performance-shape note

Reusing the two already-`MATERIALIZED`, already-`DISTINCT ON` CTEs
(`playable_audio`, `usable_subtitle_video`) to carry the playback id forward is
deliberate. The first implementation used a per-row `LEFT JOIN LATERAL` over
`video_dub`; a production video can have hundreds of dubs, and the inventory
query returns up to 3000 rows under a 10s statement timeout. The CTE reuse adds
no new per-row work AND guarantees the playback id belongs to the very dub whose
duration the row already reports.

# Related

- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
  — the mocked-vs-real META home; the SQL mutation-testing above is an instance.
- `docs/solutions/best-practices/shared-predicate-partial-rollout-gap-20260810.md`
  — sibling shape: one new helper applied to some call sites but not all.
- `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`
  — the page-load evidence obligation this change had to satisfy.
