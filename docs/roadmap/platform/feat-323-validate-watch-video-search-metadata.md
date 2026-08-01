---
id: "feat-323"
title: "Validate Watch video search metadata in Google"
owner: "codex"
priority: "P1"
status: "not-started"
start_date: "2026-08-01"
duration: 14
depends_on:
  - "feat-322"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "seo"
  - "search-console"
---

## Problem

Forge can control the server-rendered title and description, but Google may rewrite either value in search results. The metadata implementation cannot claim better click-through rate until indexing, displayed copy, query mix, impressions, and clicks are observed after release.

## Entry Points — Read These First

1. `docs/roadmap/platform/feat-322-watch-video-search-social-metadata.md` — source metadata capability and approved JESUS copy.
2. Google Search Console URL Inspection for `https://www.jesusfilm.org/watch/jesus.html` — indexed HTML and recrawl state.
3. Google Search Console Performance report — query/page impressions, clicks, CTR, and average position.

## Grep These

- `searchTitle`
- `searchDescription`
- `Watch JESUS`
- `generateWatchVideoMetadata`

## What To Build

1. Request or confirm recrawl of the canonical English JESUS URL after `feat-322` is deployed.
2. Record whether Google displays the supplied title and description or rewrites them for the `jesus` query and adjacent high-impression queries.
3. Compare page/query impressions, clicks, CTR, and average position against a documented pre-release baseline and matched post-release window.
4. Separate metadata-copy effects from position and query-mix changes; do not attribute CTR movement to copy when rank or query composition materially changed.
5. Record follow-up copy recommendations and whether another controlled iteration is warranted.

## Constraints

- Do not promise that supplied metadata will be displayed verbatim.
- Do not use raw CTR alone without impressions, position, query, country, device, and date context.
- Do not change production metadata during the initial observation window unless a correctness defect is found.

## Verification

- URL Inspection shows the canonical page is indexed from the post-release HTML.
- A dated baseline and post-release comparison is saved with filters and window lengths.
- Displayed-title/snippet observations and any rewrites are documented for the target query set.
- Conclusions distinguish verified Search Console evidence from inference.
