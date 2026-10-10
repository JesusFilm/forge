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

## Implementation Progress

- `apps/web/src/lib/provider-image.ts` identifies HTTPS Mux image URLs and
  generates responsive Mux WebP URLs at the width selected by the browser.
  Admin's exact pre-generated 448×252 card recipe stays byte-for-byte stable,
  preserving its existing Mux cache entry and blur placeholder.
  Cloudflare Images keep Next optimization because named editorial variants
  can be much larger than their card slots.
- `apps/web/src/lib/watch-transcript.ts` applies a five-second abort deadline
  to optional initial VTT fetches. A timeout follows the existing graceful
  fallback, logs a redacted reason, and triggers one bounded browser retry.
  The failed static response may still omit transcript text until page
  revalidation; the browser shows a pending state and users can expand to retry.
- Focused tests cover Mux host validation, responsive URL generation, timeout
  handling, and route rendering.

## Remaining production verification

Cloudflare cache/rate-limit configuration, replica CPU headroom, monitors,
synthetics, crawler load tests, 24-hour TCP error observation, and Search
Console recrawl/indexing evidence require production operator access. Record
those results in FGE-61 before closing the incident follow-up. Do not claim
Search Console recrawl latency alone as proof of failure.

## Constraints

- Do not weaken Cloudflare protections broadly.
- Do not regress responsive image sizing, CLS, or social previews.
- Do not treat Search Console recrawl latency as immediate proof of failure.

## Verification

- Googlebot-style thumbnail requests succeed repeatedly from the canonical host.
- Representative Watch pages preserve image quality and layout stability.
- Search Console validation and video-indexing counts are recorded after recrawl.
- The FGE-61 Datadog/load-test acceptance criteria remain satisfied.
