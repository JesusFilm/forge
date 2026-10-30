---
status: pending
priority: p2
issue_id: "023"
title: SeriesHero poster has no missing-artwork fallback, so a frame-only series shows a black hero above a populated grid
labels:
  - web
  - watch
  - thumbnails
  - mux
created_at: 2026-08-26
---

# Problem

`apps/web/src/components/watch/SeriesEpisodeCard.tsx` and the language-inventory
surfaces now fall back to a Mux frame when a video carries no authored
`video_image` row (the production shape for the newer vertical series — see
`docs/solutions/best-practices/missing-artwork-frame-fallback-derivative-recipe-and-authored-first-20260826.md`).

`apps/web/src/components/watch/SeriesHero.tsx` did NOT get that treatment:

```ts
const posterUrl = resolvePosterUrl(series.images?.[0], null)
```

The second argument is hardcoded `null`, so the hero has no frame tier. On
`/watch/impulses-for-the-way-vertical.html` the episode grid now renders real
thumbnails while the hero above it stays black. The fix made the page better but
made the remaining gap more visible, which is why this is worth closing.

This is pre-existing behavior, not a regression introduced by that change.

# Why it is not a one-line fix

The obvious edit — pass `series.muxPlaybackId` — is probably inert. The parent of
a series typically has no dub of its own (verified locally: the seeded
`impulses-for-the-way-vertical` parent has no `video_dub` row, and admin's
inventory query returns `muxPlaybackId: null` for the `audio_collection`
bucket). So the hero would need to BORROW a child's frame, which is a product
decision about which child, not a null-coalesce.

Confirm the production shape before choosing: query admin for the parent's own
dubs before assuming they are absent.

# Options

1. **Borrow the first episode's frame** (matches what `CollectionGroupOverview`
   already does on the inventory page — `preferAuthoredImageUrl([collection, firstItem])`).
   Cheapest, visually consistent with the inventory surface.
2. **Use the hero recipe.** If the hero takes a frame, request admin's
   `WATCH_HERO_POSTER_RECIPE` (`thumbnail.webp?width=1280&time=2`) via
   `resolveMuxHeroPosterUrl`, NOT the 448 card recipe — the hero is full-bleed
   and above the fold. Note `resolveMuxHeroPosterUrl` currently emits
   `thumbnail.webp?time=2` with **no width**, which is itself off-recipe and
   should be reconciled in the same pass.
3. **Leave it black deliberately** and document why (the hero also hosts the
   player poster, so a frame may read as a false "ready to play" state).

# Grep these

- `resolvePosterUrl(series.images?.[0], null)` — the call site
- `resolveMuxHeroPosterUrl` — the hero-recipe builder and its off-recipe width
- `WATCH_HERO_POSTER_RECIPE` in `apps/admin/src/services/mux-image-derivative.service.ts`
- `preferAuthoredImageUrl` in `apps/web/src/components/watch-language-inventory/LanguageInventoryPage.tsx`
  — the two-pass authored-first rule any new scan must follow

# Verification

- `/watch/impulses-for-the-way-vertical.html` hero renders an image.
- Authored series artwork still wins over any frame (add a fixture where the
  parent HAS artwork and a child has a playback id).
- If a frame reaches the hero, confirm the URL matches a pre-generated recipe —
  a bespoke width is a cold on-demand Mux render (measured 2.2–2.9s TTFB) on a
  `priority` above-the-fold image.
