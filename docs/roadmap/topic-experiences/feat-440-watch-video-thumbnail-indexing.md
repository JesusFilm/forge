---
id: "feat-440"
title: "Restore Watch video thumbnail indexing"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-08-28"
duration: 5
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "seo"
  - "performance"
---

## Problem

Google reported `Thumbnail could not be crawled due to hostload` and
`Thumbnail could not be reached` on 2026-07-27. The indexed canonical JESUS
film page has a valid Video item but no indexed video. Linear: FGE-61.

## Entry Points — Read These First

1. `apps/web/next.config.mjs` — remote image optimization and loader policy.
2. `apps/web/src/components/watch/HeroPlayer.tsx` — primary poster/video loading.
3. `apps/web/src/lib/watch-transcript.ts` — optional media work on the render path.
4. `docs/solutions/performance-issues/web-watch-route-lighthouse-perf-campaign-lcp-bundle-fonts-20260527.md` — prior performance evidence.

## Grep These

- `image.mux.com`
- `imagedelivery.net`
- `thumbnailUrl`
- `getInitialSubtitleTranscript`
- `unoptimized`

## What To Build

Produce a PR-ready fix plan that separates provider reachability, Cloudflare
controls, Forge image transformation, and Node hostload. Include the smallest
code/config changes and crawler-safe verification path.

## Bounded source integration — 2026-10-31

PR #2622 offers the image/VTT mitigation at
`43da266920645ff371802a681506b37da0775fb3`. The source-only integration with
main `c2e4bd3aec94198fc074ec7c37e546469d6001d1` is described in
`docs/plans/2026-10-31-feat-440-watch-media-integration.md`.

- `apps/web/src/lib/provider-image.ts` selects public Mux thumbnail URLs for
  responsive provider WebP widths while retaining crop, time, quality, and
  proportional dimensions. Admin's exact
  `thumbnail.jpg?width=448&height=252&fit_mode=smartcrop&time=2` recipe remains
  byte-for-byte unchanged and unoptimized, preserving its cache/blur identity.
  Signed, unknown-recipe, non-image, local, and other-provider sources retain
  their existing delivery path. Cloudflare Images remain on Next optimization
  for slot sizing; the broader Cloudflare offload criterion is still open.
- `apps/web/src/lib/watch-transcript.ts` adds a five-second optional SSR VTT
  abort budget with redacted reason/elapsed logging and the existing fallback.
  `SubtitleTranscript.tsx` allows one bounded collapsed retry after SSR failure.
  Expiry leaves pending state; explicit expansion starts a new request without
  the background timer. Collapse cancels that manual request without restarting
  background work. Retry ownership and cached cues remain source-qualified.
- Current-main modal cancellation, stale results, errors, download queue,
  analytics, transcript language/selection, and local search/URL ownership are
  retained. Existing test sources and focused integration adjustments are
  included but **not executed** in this phase. Only scoped qualified Prettier,
  whitespace, and static preservation checks are permitted.

Static HTML can still lack transcript text until revalidation after SSR
failure. Browser recovery does not establish crawler-visible text or Search
Console acceptance. Historical tests/checks on the published head are dated
provenance, not validation of the new staged integration.

## Remaining validation and operator evidence

Fresh independent review, focused tests, Web types, scoped lint, locale/roadmap
checks, normal hooks, build/current integrated CI, and browser/image/loading
comparisons remain pending. The integration plan specifies controls and evidence.
Keep this exact ticket in progress; its unrelated inherited feat-440 collisions
are not dependencies and are not renumbered here.

Cloudflare cache/rate-limit rules, replica CPU headroom, provider reachability,
monitors/synthetics, controlled 30-minute crawler load, 24-hour TCP observation,
and Search Console crawl/recrawl/indexing counts remain separate operator
acceptance under FGE-61. Root HTTP 200, historical recovery, or green published
CI do not establish current service health or whole-issue completion.

## Constraints

- Do not weaken Cloudflare protections broadly.
- Do not regress responsive image sizing, CLS, or social previews.
- Do not treat Search Console recrawl latency as immediate proof of failure.

## Verification

- Googlebot-style thumbnail requests succeed repeatedly from the canonical host.
- Representative Watch pages preserve image quality and layout stability.
- Search Console validation and video-indexing counts are recorded after recrawl.
- The FGE-61 Datadog/load-test acceptance criteria remain satisfied.
