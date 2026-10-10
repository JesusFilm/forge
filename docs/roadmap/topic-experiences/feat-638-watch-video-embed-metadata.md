---
id: "feat-638"
title: "Add Watch video embed metadata"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 2
depends_on: []
blocks: []
tags: [web, watch, seo]
---

## Problem

Watch video pages publish an HLS stream as `contentUrl` but omit a playable
embed URL, and publish generic website Open Graph metadata for playable videos.

Correction: HLS is not an indexing defect. Google's video structured-data
guidance (<https://developers.google.com/search/docs/appearance/video>) lists
M3U8 among supported formats for `contentUrl`. The real gap, confirmed on
production Watch root pages, is the missing `VideoObject.embedUrl` and
`og:video`, which crawlers and social scrapers use to reach a playable surface.

## Entry Points

1. `apps/web/src/lib/experience-metadata.ts`
2. `apps/web/src/lib/watch-structured-data.ts`
3. `apps/web/src/lib/experience-metadata.test.ts`
4. `apps/web/src/lib/watch-structured-data.test.ts`

## What To Build

Emit the public Mux player URL as VideoObject `embedUrl`, publish video movie or
episode Open Graph metadata and a Twitter player card, and include duration and
player dimensions where source values exist. Keep HLS as the known stream URL;
do not synthesize an MP4 URL without verified static-rendition availability.
The embed URL comes from the selected variant's own Mux playback id, so a
language route never advertises another language's player; when that id is
missing or blank, omit `embedUrl`, `og:video`, and the player card and keep the
HLS `contentUrl`.

## Verification

Cover movie/episode metadata, selected-language embed URLs, missing or blank Mux
playback ids, VideoObject embed sanitizing, the route-level JSON-LD contract in
`page-routing.test.tsx`, and social-card fallbacks. Run focused Web tests, typecheck, lint, and a Web build.
