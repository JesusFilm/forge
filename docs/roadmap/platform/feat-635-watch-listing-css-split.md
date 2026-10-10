---
id: "feat-635"
title: "Split What's New CSS out of the shared Watch stylesheet"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "performance"
---

## Problem

Linear FGE-206. Every Watch route (home, collection, series, video, language
inventory) links one render-blocking stylesheet built from
`apps/web/src/app/globals.css`. In production that file is
`/watch/_next/static/chunks/11pthx3q9qb_b.css`: 302,900 B raw, 44,365 B on the
wire as gzip. RUM cases in
`docs/operations/watch-browser-investigations-2026-09-24.md` show this sheet on
the critical path of slow first paints.

Investigation (2026-10-08) found:

- There is no separate player, language-picker or pin-board stylesheet. No
  component imports CSS; `@forge/video-player`, Mux and video.js ship none.
  Player and picker styling is Tailwind utilities, and both surfaces also
  render on listings (`SeriesHero` uses `HeroPlayer`; `FloatingSearchProvider`
  lazy-loads `GlobalLanguagePickerModal` on every route), so they cannot be
  split out.
- Tailwind utilities (~231 KB raw) are generated once for the whole app and
  cannot be split per component without duplicating base utilities that would
  then override shared component classes out of order.
- The listing home (`[locale]/[htmlLang]/page.tsx`) and every collection,
  series and video page share one catch-all route
  (`[locale]/[htmlLang]/[...rest]/page.tsx`) under one locale layout, so a
  listing-vs-player route split is not possible without route restructuring.
- The one proven small split: ~19 KB of hand-written, What's New-only rules
  (scroll choreography, assistant phone, audience quiz, stickers, bokeh,
  grain, ambient glow, pin board `.watch-corkroom` / `.watch-note*`, tint
  band) that only `/watch/whats-new` renders.
- Cloudflare: Brotli is active for HTML, but CSS/JS reach Chrome as the
  origin's gzip (Next `compress: true` is gzip-only; Cloudflare passes a
  cached origin encoding through). `Accept-Encoding: br` alone gets Brotli
  (41,480 B). Local Brotli q11 would be 33,324 B (~25% under today's gzip).
  No Cloudflare config lives in this repo; the connected Cloudflare account
  cannot see the `jesusfilm.org` zone.

## Entry Points — Read These First

1. `apps/web/src/app/globals.css` — shared sheet for every Watch route.
2. `apps/web/src/components/whats-new/whats-new.css` — What's New-only rules,
   moved verbatim and in original order.
3. `apps/web/src/app/[locale]/[htmlLang]/whats-new/layout.tsx` — the only
   importer of `whats-new.css`.
4. `apps/web/src/app/globals.test.ts` — reads both sheets in cascade order and
   guards the split (`describe("What's New stylesheet split")`).
5. `apps/web/next.config.mjs` — `compress: true` (origin gzip).
6. `docs/operations/watch-browser-investigations-2026-09-24.md` — RUM context.

## Grep These

- `git grep -nE '\.(watch-(scroll|chat|quiz|sticker|audience|bokeh|grain|ambient|corkroom|note|fan)|whats-new-)' -- apps/web/src/app/globals.css` → must be empty.
- `git grep -n 'whats-new.css' -- apps/web/src` → layout import + test only.
- `git grep -n 'import ".*\.css"' -- apps/web/src` → the three `globals.css`
  layouts plus the What's New layout.

## What To Build

Done in this change:

- Move What's New-only rules out of `globals.css` into
  `src/components/whats-new/whats-new.css` byte-for-byte, keeping their
  relative order. The What's New subset of the `prefers-reduced-motion:
reduce` block moves into its own `@media` block after its base rules; the
  `.watch-home-*` reduced-motion rules stay global.
- Keep shared tokens (`--watch-grain-image*`, `--watch-sticker-*`, theme
  variables) in `globals.css` `:root`.
- Import the new sheet from the What's New layout only. Next links it after
  the root layout's globals, so the unlayered rules keep cascading after
  Tailwind exactly as before.

Measured on a local `next build` (Next 16.3.8, Turbopack), gzip -9 / brotli
q11:

| Sheet                      | Raw     | Gzip   | Brotli |
| -------------------------- | ------- | ------ | ------ |
| Before: shared (all pages) | 302,900 | 43,653 | 33,324 |
| After: shared (all pages)  | 283,371 | 39,777 | 29,902 |
| After: What's New only     | 19,218  | 4,372  | 3,840  |

Every route except `/watch/whats-new` saves ~3.9 KB gzip (~9%) of
render-blocking CSS. `/watch/whats-new` gains one request and ~0.5 KB total.

Operator-only follow-up (not code): add a Cloudflare Compression Rule
(zone `jesusfilm.org`, phase `http_response_compression`) that prefers Brotli
for `text/css` and JavaScript on `/watch/_next/static/*`, then verify with
`curl -s -o /dev/null -D - -H 'Accept-Encoding: gzip, deflate, br, zstd'` that
`content-encoding: br` is returned. Confirm on the zone whether a rule
overrides pass-through of the cached origin gzip; if not, the in-repo lever is
origin encoding (`compress: false` so Cloudflare compresses, or Brotli at the
origin), which needs its own ticket and measurement.

## Constraints

- Do not restructure the shared `[locale]/[htmlLang]` layout or the catch-all
  route for CSS.
- Do not add Tailwind directives (`@import`, `@theme`, `@apply`, `@source`) to
  `whats-new.css`; a second Tailwind entry would re-emit base utilities after
  the shared ones and change the cascade.
- Do not move rules that listings render (`.watch-home-*`,
  `.watch-hero-cover-*`, `.watch-body-backdrop`, `:root` tokens).
- Cloudflare zone settings are production controls; change them only through
  an operator with zone access, never from a worktree.

## Verification

- `pnpm --filter @forge/web exec vitest run src/app/globals.test.ts src/components/whats-new`
- `set -a; . apps/web/.env.ci; set +a; pnpm --filter @forge/web build`, then
  read `entryCSSFiles` in
  `apps/web/.next/server/app/[locale]/[htmlLang]/**/page_client-reference-manifest.js`:
  only `whats-new` lists the third chunk.
- `next start`, then `curl` `/watch` and `/watch/whats-new`: listings link two
  stylesheets; What's New links the shared sheet first, then its own.
- Visual check of `/watch/whats-new` with and without reduced motion at
  48rem and 64rem widths; smoke home, series and video pages.
