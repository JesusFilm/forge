---
id: "feat-535"
title: "Defer hls.js and mux-embed out of the Watch initial bundle"
owner: "vlad"
priority: "P0"
status: "complete"
start_date: "2026-09-22"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "performance"
---

## Problem

Linear FGE-138 (W-002), from the 2026-09-13 `/watch` listing audit.

`@forge/video-player/mux-video` pulls `@mux/mux-video-react`, which bundles
`hls.js` and `mux-embed`. Turbopack groups that into one 646,759 B chunk, and
that chunk is in the first-load graph of **both** Watch routes, served as a
plain `<script src>` in the initial document — about a fifth of the page's JS
for a video engine a listing page needs only once the hero actually plays.

The audit named the home carousel's static import as the cause. It is not the
whole cause. Measured against `origin/main` at `next build` (Turbopack,
next@16.2.4): removing that import **entirely** left the chunk in
`firstLoadChunkPaths` for both routes at full size. Three sibling static
importers remain — `components/sections/Video.tsx`, `VideoHero.tsx` and
`CarouselVideo.tsx` — and while each of those components is itself reached
through the `next/dynamic` table in `components/sections/index.tsx`, their own
static import keeps the engine in a shared chunk the route's client entry loads
regardless. Only once **every** importer is behind `next/dynamic` does Turbopack
split it into an async-only chunk.

`HeroPlayer.tsx:29` already deferred it, which is why one more deferral looked
sufficient and was not.

## Entry Points — Read These First

1. `apps/web/src/components/home/WatchHomeTvCarousel.tsx` — the hero carousel's
   `MuxVideo` mount (above the fold; also gets the load gate).
2. `apps/web/src/components/sections/{Video,VideoHero,CarouselVideo}.tsx` — the
   three sibling static importers the audit did not name.
3. `apps/web/src/components/watch/HeroPlayer.tsx:29` — the in-repo precedent for
   `next/dynamic(() => import("@forge/video-player/mux-video"), { ssr: false })`
   plus a `document.readyState === "complete"` activation gate.
4. `apps/web/src/lib/watch-interaction-loader.ts:321` — the repo's idiom for the
   load gate (`readyState === "complete"` else a one-shot `load` listener).
5. `apps/web/src/components/home/useWatchHomeTvCarousel.ts` — the buffering,
   poster-hold, and media-wait backstop machinery the gate must not strand.
6. `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`
   — the two required measurements for a lazily-mounted surface.

## Grep These

- `from "@forge/video-player/mux-video"` — every static importer.
- `disableTracking` — which consumers keep Mux Data on.
- `firstLoadChunkPaths` in `.next/diagnostics/route-bundle-stats.json`.
- `mp4-remuxer` / `litix` — marker symbols for hls.js and mux-embed.

## What To Build

Put **every** importer of `@forge/video-player/mux-video` behind the same seam —
all four, not just the carousel:

```ts
const MuxVideo = dynamic(() => import("@forge/video-player/mux-video"), {
  ssr: false,
}) as typeof MuxVideoType
```

The hero carousel additionally mounts behind a document-load gate
(`useSyncExternalStore` over `document.readyState`), so on the one route where
the player is above the fold the chunk is not even _fetched_ while the page is
still loading. Until the gate opens the frame renders what it already renders
before the video fades in: the poster visual layer.

The deferred element attaches in a later commit than the one that opens the
gate, so any effect reading `videoRef.current` needs an explicit dependency on
the element's arrival — otherwise muted-preview subtitles silently stop
attaching.

Hold the whole-tree shape with an invariant test
(`src/components/__tests__/mux-video-deferral.test.ts`): a single new static
importer anywhere puts the engine back on the critical path, and no behavioural
test would notice.

## Constraints

- Do **not** alias or stub `mux-embed`. The ticket's premise that
  `disableTracking` is unconditionally true is stale:
  `apps/web/src/components/watch/HeroPlayer.tsx` passes
  `disableTracking={false}` so the watch-page hero reports Mux Data. Stubbing
  the module would delete production analytics and violates
  `docs/analytics-and-recommendation-policy.md`.
- Do not add a userland retry around the dynamic `import()`. It is inert on
  Turbopack — see
  `docs/solutions/best-practices/per-message-boundary-limits-for-media-surfaces.md`.
- Keep the carousel's existing buffering, poster-hold, and media-wait backstop
  behaviour untouched; the gate must not become a new way for a slide to hang.
- No change to the `@forge/video-player` package surface.

## Verification

- `.next/diagnostics/route-bundle-stats.json` before/after: the chunk carrying
  `mp4-remuxer` / `litix` must leave `firstLoadChunkPaths` for
  `/[locale]/[htmlLang]` and `/[locale]/[htmlLang]/[...rest]`.
- The document `next start` serves at `/watch`: no `<script src>` for that chunk.
- Both page-load measurements the convention requires, taken against a real-data
  production build (`next build` + `next start`, Admin GraphQL reachable):
  1. static chunk graph — the chunk is absent from both routes' first-load set;
  2. mount window — a `layout-shift` PerformanceObserver installed before
     navigation, read after the deferred player has mounted and is playing.
- Runtime load-gate proof on the same run: zero `<video>` elements at document
  `load`, and the deferred chunk requested only after `loadEventEnd`.
- Playback and muted-subtitle re-attach confirmed on real hero slides.
- `pnpm --filter @forge/web test` (run under the CI Node version in `.nvmrc`).
