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

## Constraints

- Do not weaken Cloudflare protections broadly.
- Do not regress responsive image sizing, CLS, or social previews.
- Do not treat Search Console recrawl latency as immediate proof of failure.

## Verification

- Googlebot-style thumbnail requests succeed repeatedly from the canonical host.
- Representative Watch pages preserve image quality and layout stability.
- Search Console validation and video-indexing counts are recorded after recrawl.
- The FGE-61 Datadog/load-test acceptance criteria remain satisfied.
