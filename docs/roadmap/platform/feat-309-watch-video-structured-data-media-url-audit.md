---
id: "feat-309"
title: "Audit Watch video structured data media URLs"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-07-24"
duration: 1
depends_on:
  - "feat-308"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "seo"
  - "structured-data"
---

## Problem

Google Search Console reported that some jesusfilm.org video structured data
items are missing both `contentUrl` and `embedUrl`. The Watch JSON-LD serializer
intentionally emits `contentUrl` only for stable HTTPS `.m3u8` media URLs and
does not fake `embedUrl` with the public Watch page URL. We need to inspect the
actual Search Console sample URLs before changing media URL behavior.

## Entry Points - Read These First

1. `apps/web/src/lib/watch-structured-data.ts` - current media URL eligibility
   and `VideoObject` suppression.
2. `apps/web/src/lib/experience-metadata.ts` - metadata model fields used by
   structured data.
3. `apps/web/src/lib/fragments/watch-video.ts` - selected playback fields from
   Admin GraphQL.
4. `apps/web/src/lib/watch-url-probe.ts` - existing rendered structured-data
   probe contract.
5. Google Search Console video structured data report sample URLs.

## Grep These

- `contentUrl`
- `embedUrl`
- `isEligibleContentUrl`
- `watchVideoStructuredDataJson`
- `WatchUrlProbe`

## What To Build

1. Export or record the affected Search Console sample URLs.
2. For each sample, determine whether the rendered page emits no `VideoObject`,
   a complete `VideoObject`, or an incomplete `VideoObject`.
3. If incomplete JSON-LD exists, trace the source field that bypasses the
   current serializer guard.
4. If the page is playable but lacks an eligible `.m3u8` `contentUrl`, identify
   whether a real player URL exists and can honestly support `embedUrl`.
5. Add tests for whichever production shape is found.

## Constraints

- Do not use the public Watch page URL as `contentUrl` or `embedUrl`.
- Do not loosen signed/private media URL protections without a crawler-safe
  design.
- Do not change Admin schema unless the audit proves the current GraphQL surface
  cannot expose the real media/player URL needed.

## Verification

- Sample URLs are documented with before/after JSON-LD status.
- Focused tests cover any fixed incomplete-media shape.
- Search Console validation is requested after deployment.
