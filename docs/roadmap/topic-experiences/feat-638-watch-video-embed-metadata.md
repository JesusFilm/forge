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

Watch video pages expose an HLS stream as their only video URL, omit a playable
embed URL, and publish generic website Open Graph metadata for playable videos.

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

## Verification

Cover movie/episode metadata, missing Mux playback, VideoObject embed sanitizing,
and social-card fallbacks. Run focused Web tests, typecheck, lint, and a Web build.
