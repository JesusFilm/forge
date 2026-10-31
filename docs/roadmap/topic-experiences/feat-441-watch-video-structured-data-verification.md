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

1. `apps/web/src/lib/watch-structured-data.ts` — Watch JSON-LD serialization.
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

1. Determine which template/URL groups remain invalid versus stale in Search
   Console before changing runtime structured-data output.
2. Extend the production URL probe to capture description, thumbnail, upload
   date, duration, and embed URL for diagnostics, and validate the complete
   project-required VideoObject field set plus stable HTTPS HLS contentUrl.
3. Cover localized playable output in initial server HTML while retaining the
   separate CollectionPage contract for series and curated collections.
4. Apply a runtime correction only after a current failing Search Console URL
   reproduces against production output.

## Constraints

- Do not duplicate the completed FGE-8 implementation without production evidence.
- Emit only truthful fields backed by current content data.
- Keep canonical URL policy consistent with route and sitemap helpers.

## Verification

- Representative server HTML passes Rich Results and schema validation.
- Contract tests cover required video fields and canonical URLs.
- Search Console validation dates and remaining invalid counts are recorded.

## Progress — 2026-10-08

- U2/U3 implementation is in the FGE-114 worktree and will be reviewed in a
  dedicated PR. The probe diagnoses missing/invalid name, description,
  uploadDate, duration, thumbnail URL, URL, and stable HTTPS HLS contentUrl;
  it does not treat a Watch page's embedUrl as media.
- The initial-HTML route suite now covers one complete localized Spanish
  VideoObject. Existing route fixtures cover canonical film/episode and
  collection identities.
- Search Console examples, their crawl dates, the current/stale classification,
  and post-validation counts still require an authorized property export.
  U4 remains conditional on a current affected URL reproducing the reported
  defect; no runtime metadata behavior changed in this PR.
- Focused probe tests, localized route test, targeted ESLint, Web typecheck,
  Prettier, and git diff check pass.
