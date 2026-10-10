# Watch Cold-Path Performance Follow-Up - 2026-06-10

## Context

The June 10 audit of
`https://watch.jesusfilm.org/watch/life-of-jesus-gospel-of-john.html/english.html`
showed that server-rendered SEO and accessibility metadata were already fixed,
but first-load performance still had three concrete risks:

- The deployed hero was using the MuxPlayer flag-off path. That path fetched a
  shadow-DOM poster URL that did not match the route-level
  `thumbnail.webp?width=1280` preload, so the browser could not reuse the
  preloaded LCP image.
- The MuxPlayer flag-off path did not receive the same HLS buffer caps already
  used by the MuxVideo flag-on path, leaving cold mobile loads exposed to large
  first-load HLS transfer.
- Open Graph and Twitter metadata pointed at a relevant editorial still, but
  that Cloudflare Images asset resolved to 640x300 while metadata advertised a
  large card.

## Fix

- `apps/web/src/components/watch/HeroPlayer.tsx` now builds one
  `heroPosterUrl` per playback id and passes it to both Mux backends. The URL
  is exactly `https://image.mux.com/{playbackId}/thumbnail.webp?width=1280`,
  matching the server preload in the route.
- The same `HERO_HLS_CONFIG` object now feeds both backends:
  `maxBufferLength: 10`, `maxBufferSize: 5_000_000`, `backBufferLength: 5`.
- `apps/web/src/lib/experience-metadata.ts` now prefers a selected Mux playback
  thumbnail for playable video social cards:
  `thumbnail.jpg?width=1200&height=630&fit_mode=smartcrop`.
- `packages/admin-graphql/src/index.ts` now imports its generated local
  `admin` source extensionlessly. That unblocks Next/Turbopack from resolving
  the source-only package during `apps/web` build and local smoke.

## Evidence

Fresh TTFB checks on 2026-06-10 still match the original cold-cache/topology
finding:

- Watch first request: TTFB `1.813198s`, total `1.919896s`, size `513817`.
- Watch repeat request: TTFB `0.329743s`, total `0.479653s`, size `513817`.
- Old `www` route request: TTFB `0.432420s`, total `0.434616s`, size `63403`.

This remains an origin/edge cache topology issue, not a canonical URL issue.
Canonical and `og:url` should continue using the production
`www.jesusfilm.org` origin for the dev watch host.

Social image dimension check:

- Current deployed editorial OG image:
  `https://imagedelivery.net/tMY86qEHFACTO8_0kAeRFA/2_GOJ-0-0.mobileCinematicHigh.jpg/f=jpg,w=1280,h=600,q=95`
  resolves to `640x300` and about `52K`.
- Candidate selected-Mux social image:
  `https://image.mux.com/01Pu01P7wIWwO2MV01HUtoRyO5sLHXBr54baMqEOq2e7kk/thumbnail.jpg?width=1200&height=630&fit_mode=smartcrop`
  resolves to `1200x630` and about `128K`.

Validation run:

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/HeroPlayer.test.tsx src/lib/experience-metadata.test.ts`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- `pnpm --filter @forge/admin-graphql typecheck`
- `ADMIN_GRAPHQL_URL=https://admin.jesusfilm.org/api/graphql pnpm --filter @forge/web build`

The web build required running outside the sandbox because Turbopack's CSS
processing binds a helper port. The same command passed outside the sandbox.

## Browser Smoke Note

The built `next start` smoke reached the local route, but page data could not
load with the available local env:

- Production admin URL plus the fetched dev `WEB_ADMIN_API_KEYS` returned
  `watch_route_manifest.fetch.failed` with status `401`.
- Reusing the fetched `INTERNAL_GRAPHQL_URL` as `ADMIN_GRAPHQL_URL` pointed at a
  local admin endpoint that was not running and failed with `ECONNREFUSED`.

That blocks local browser rendering proof in this worktree without either a
matching production bearer or a running local admin service. The code-level
behavior is covered by focused tests, and the production build now compiles.

## Deployment Follow-Up

- Set or confirm `NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO=true` in the target
  Railway environment when ready, then rebuild. This PR makes the flag-off path
  safe in the meantime.
- After deploy, rerun Lighthouse mobile against the watch dev URL and confirm:
  the LCP image request is `thumbnail.webp?width=1280`, the preload is reused,
  HLS segment transfer is bounded, and social metadata emits the 1200x630 Mux
  JPG.
- Investigate the first-request TTFB delta at the edge/origin layer. The repeat
  request is already fast, so focus on cold ISR/data-cache population and
  Cloudflare/Railway cache behavior rather than app-level canonical metadata.
