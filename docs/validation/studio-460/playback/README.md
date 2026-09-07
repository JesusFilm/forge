# Studio public playback — work in progress

These are local proofs, not a deployed Watch or Mux acceptance claim. No generation/provider writes or infrastructure operations were performed. The later, explicitly authorized public image compatibility sample is recorded below.

## Bounded request and database work

`playback-lifetime-red.log` reproduces three indefinite eight-slot stalls (initial authorization, final authorization, signing). `playback-lifetime-green2.log` passes ten gateway cases including late-result suppression, slot recovery, stalled body cancellation and caller cancellation. The gateway uses one 15-second deadline from slot admission through response preparation; this does not bound the caller's subsequent network consumption of the returned response.

Canonical authorization independently limits Prisma acquisition to 1 second, transaction lifetime to 5 seconds and PostgreSQL statement/lock waiting to 1 second. HTTP cancellation does not claim to cancel Prisma's underlying query. `playback-db-bound-green.log` includes a real two-connection ACCESS EXCLUSIVE lock against the owned port-55460 database: the blocked authorization stopped after 1.14 seconds and the next request recovered. All six canonical publication/database cases passed.

## Persistent optimizer reproduction

An isolated production-built Next 16.2.4 fixture on loopback port 42860 used the installed application Next runtime, a PNG origin route with `private, no-store`, an allowed-host redirect, and the actual Next image optimizer. This is a narrow framework proof, not the full Watch production build. The fixture's fixed build copied the exact `apps/web/src/lib/studio-playback.ts` detector and the production optimizer refusal branch into its small proxy. Type validation was disabled only for this disposable fixture; application typechecks remain required.

| Input                             | Baseline                                          | Fixed                                    |
| --------------------------------- | ------------------------------------------------- | ---------------------------------------- |
| Canonical Studio image            | 200 MISS then HIT; public max-age 14400           | 404 private/no-store; no optimizer cache |
| Trailing slash                    | Admin-style Next 308; optimizer 200 MISS then HIT | 404 private/no-store before fetch        |
| Percent-encoded static path       | Origin/optimizer 404 in this Next build           | Explicit 404 private/no-store            |
| Allowed origin redirect to Studio | 200 MISS then HIT                                 | 508, no image bytes/cache                |
| Direct ordinary image             | 200 MISS then HIT                                 | Same bytes/SHA, 200 MISS then HIT        |

Installed `next/dist/server/image-optimizer.js` validates `remotePatterns` for the initial URL, then `fetchExternalImage` recursively follows redirects without repeating that allowlist check. The exact source and package hashes must accompany final evidence. `images.maximumRedirects: 0` closes that route; the proxy refuses canonical/normalized Studio paths even before cache lookup. `optimizer-probe.mjs` records actual response headers/body hashes, with results in the two JSONL files.

The baseline image cache was moved aside inside the disposable fixture before fixed-build testing. This proves prevention of new persistent copies; it does not claim to purge already-created optimizer/CDN/browser copies. Studio must not be enabled before the fixed cache policy is effective. Only if the target environment actually contains previously cached Studio copies, identify those exact resource URLs/optimizer keys and their serving origins, then authorize targeted invalidation. This implementation has not been deployed to production; no production Studio copies are presumed, and no blanket unrelated purge is required.

## Core compatibility audit and remaining verification

The shared MediaImage component changes only canonical Studio resources to unoptimized requests. Ordinary Core URLs retain Next optimization. Watch hero uses canonical Studio HLS/poster even if stale route data contains its Mux identity. `watch-media-green.log`: 234 passed, one existing todo. `watch-core-images.log`: 108 passed across URL resolution, posters, search cards, related cards and series cards.

Core ingestion stores explicit `mobileCinematicHigh`, `mobileCinematicLow`, `thumbnail` and `videoStill` URLs. The existing Core derivative fetcher already rejects redirects (`video-image-blur-data-url.service.ts`; durable solution `admin-image-lqip-dominant-color-pipelines-20260709.md`). Known `jesusfilm.org/images/*` redirects to HTML are already resolved to local `/watch/images/*` by `media-image-url.ts`, with existing regression coverage. Direct image optimization preserved identical fixture bytes. This source audit does **not** establish current redirect behavior of every configured external/CDN/CMS host. Full compatibility acceptance, actual Watch build/browser playback and matched loading remain outstanding; a later bounded public image sample was explicitly authorized (below).

Deployment verification must inspect the exact public origin, Next proxy/basePath matching, CDN/cache rules, any service worker, and direct/poster/storyboard/subtitle/key/segment requests after unpublish. Previously delivered bytes cannot be recalled. A database visibility change does not erase previously cached client bytes.

## Authorized public compatibility sample

`core-image-public-probe.json` records ten HTTPS requests against five real URLs already present in `block-types.ts` and `whats-new-content.ts`: one Unsplash image, three WordPress upload paths and one Core Cloudflare Images variant. All HEAD requests returned 200, all bounded Range GETs returned 206, and no redirects occurred. Actual bodies read totaled 3,374 bytes; each body was cancelled after its first transport chunk. The probe ceiling was six URLs/24 requests, three hops and ten seconds per chain; requests used no credentials. Results retain source, host/path, status/type and actual byte count, not query strings or response bytes.

No additional-host or CMS hostname values were present in this worktree's Web env files. This sample supports compatibility of those specific current URLs only; it is not an exhaustive configured-production-host or complete Core catalog audit. Zero redirects preserves direct image delivery and the existing known-local normalization. Any later discovered supported redirect-dependent source requires canonicalization at its trusted metadata boundary or a validated fetch design before release; it must not restore unrestricted optimizer redirects.
