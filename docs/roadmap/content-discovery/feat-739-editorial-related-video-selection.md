---
id: "feat-739"
title: "Choose six editorial recommendations per catalogue video"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-19"
duration: 2
depends_on: []
blocks:
  - "feat-741"
tags:
  - "recommendations"
  - "editorial"
  - "admin"
---

## Problem

The user wants six editorially chosen related videos for each of the roughly
1,000 catalogue videos, reusing existing content evidence without repeated
full-library transcript generation.

## Entry Points — Read These First

1. `docs/plans/2026-10-19-editorial-related-video-selection.md`
2. Production Admin `recommendation_precomputed_content_profile`, generation
   `production-astra-catalog-20261013-v6` (1,031 ready profiles).
3. Production Admin `video` and English `video_locale` metadata.

## Grep These

- `production-astra-catalog-20261013-v6`
- `summaryEnglish|themes|people|citations`

## What To Build

- Export source profiles and metadata using a read-only database connection
  resolved through the Railway CLI.
- Read the catalogue and make six ordered editorial selections per source.
- Save source and target IDs, brief connection reasons, and provenance locally.
- Preserve explicit incomplete status if any source cannot be assessed.

## Constraints

- No production writes, publication, deployments, or new model API runs.
- No database URLs, credentials, or personal viewer data in saved artifacts.
- Select real distinct catalogue video IDs; exclude self-recommendations.
- Do not describe automated similarity rankings as editorial review.

## Verification

- Every exported source has exactly six distinct existing target IDs.
- No target equals its source; every choice has an editorial reason.
- Report actual coverage and unreviewed sources.
- Format changed Markdown with Prettier.

## Outcome

Committed `docs/recommendations/editorial-2026-10-19/recommendations.json`, matching CSV, and
`review.html`: 1,031 sources and 6,186 links. There are 262 source-specific slates
and 769 sources using shared editorial decisions across 82 thematic groups.
Selections use catalogue descriptions and existing profiles; full videos were
not viewed. This is a local editorial draft, not published recommendations.

Independent validation confirmed complete source coverage, six distinct canonical
and core target IDs per source, no self-links, correct titles, and at least one
published playable dub per target in the availability snapshot. Serving-time
language and visibility checks remain necessary. No production writes or new
model API calls were made. Five evidence mismatches are flagged in the artifact;
follow-up: `feat-740`.

The PR also includes the playback snapshot, review page, README, and an offline
validator. Validation command:
`python3 docs/recommendations/editorial-2026-10-19/validate.py`.
