---
id: "feat-441"
title: "Verify and clear Watch video structured-data failures"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-08-28"
duration: 4
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "seo"
  - "video"
---

## Problem

Search Console still reports 995 invalid Videos enhancement items after the
FGE-8 structured-data implementation shipped. The alert names missing
`uploadDate`, `description`, and `contentUrl` or `embedUrl`. Linear: FGE-114.

## Entry Points — Read These First

1. `apps/web/src/lib/structured-data.ts` — Watch JSON-LD serialization.
2. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` — metadata/JSON-LD assembly.
3. `docs/solutions/architecture-patterns/watch-video-search-social-metadata-overlay.md` — existing metadata pattern.
4. `docs/roadmap/topic-experiences/feat-440-watch-video-thumbnail-indexing.md` — separate crawlability work.

## Grep These

- `VideoObject`
- `uploadDate`
- `contentUrl`
- `embedUrl`
- `application/ld+json`

## What To Build

Determine which template/URL groups remain invalid versus stale in Search
Console, then produce a PR-ready correction and validation plan with fixtures
for film, episode, segment, collection, and localized pages.

## Constraints

- Do not duplicate the completed FGE-8 implementation without production evidence.
- Emit only truthful fields backed by current content data.
- Keep canonical URL policy consistent with route and sitemap helpers.

## Verification

- Representative server HTML passes Rich Results and schema validation.
- Contract tests cover required video fields and canonical URLs.
- Search Console validation dates and remaining invalid counts are recorded.
