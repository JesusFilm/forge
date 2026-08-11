---
title: Admin Watch search comparison cards missing thumbnails
date: 2026-08-11
category: ui-bugs
module: admin-watch-search-comparison
problem_type: ui_bug
component: service_object
symptoms:
  - Private Admin Watch search comparison result cards displayed metadata but no video thumbnails.
  - Text-only cards made current and candidate video results difficult to compare visually.
root_cause: logic_error
resolution_type: code_fix
severity: low
related_components:
  - frontend
tags:
  - watch-search
  - comparison-page
  - video-thumbnails
  - privacy-projection
  - mux
---

# Admin Watch search comparison cards missing thumbnails

## Problem

The private Admin Watch search comparison page rendered result metadata but no
video thumbnails. Search results already carried a nullable curated `imageUrl`
(`apps/admin/src/services/watch-search.service.ts:164`), but the page receives a
bounded comparison projection that had discarded that field.

## Symptoms

- Current and Candidate cards were text-only even when the underlying result had
  artwork.
- The issue was confined to the private comparison page; public Watch search and
  ranking were unchanged.

## What Didn't Work

- Adding image markup only in the client could not restore the curated image URL
  because it had already been removed at the projection boundary.
- Changing Typesense retrieval or indexing targeted the wrong layer because
  `WatchSearchResult` already included the image URL.
- Passing blur-data fields through the endpoint was unnecessary for this private
  diagnostic surface.

## Solution

Add only `imageUrl` to the bounded comparison result projection alongside the
already-projected playback fields
(`apps/admin/src/services/search-trace-privacy.ts:320`). Keep the existing
50-result cap, query redaction, and diagnostic serialization unchanged.

The result card then chooses a thumbnail in this order
(`apps/admin/src/app/dashboard/search/compare/watch-search-comparison.tsx:20`):

1. Use the curated `imageUrl`.
2. For a video with a playback ID, derive a Mux thumbnail URL and include the
   start time when available.
3. Otherwise, show a deterministic title-initial placeholder.

The image uses lazy loading and asynchronous decoding
(`apps/admin/src/app/dashboard/search/compare/watch-search-comparison.tsx:157`).

## Why This Works

The fix restores one field that already exists instead of adding another fetch
or changing the search pipeline. Curated artwork remains authoritative, the Mux
fallback uses playback data already present in the response, and the placeholder
keeps incomplete results readable. Browser-side lazy image requests do not add
work to Typesense retrieval or the server-side search latency path.

## Prevention

- Treat privacy projections as explicit API contracts: update and test the
  projection whenever a diagnostic UI needs another existing result field.
- Keep result-card tests for curated-image priority, Mux fallback, missing-image
  behavior, and lazy image markup.
- Verify frontend media changes against the page-load performance convention,
  not only with a visual smoke test.

## Related Issues

- [Semantic search video-card display metadata hydration](../integration-issues/semantic-search-video-card-display-metadata-hydration.md)
  covers the similar public-search presentation contract, but its missing data
  occurs after hybrid-search fusion rather than at this private projection.
- [Canonical language boundaries and lexicographic search ranking](../logic-errors/canonical-language-boundaries-and-lexicographic-search-ranking.md)
  documents why evaluator controls remain isolated to the private comparison
  page.
- [Typesense Watch search payload projection latency](../performance-issues/typesense-watch-search-payload-projection-latency.md)
  covers keeping retrieval payloads bounded.
- [Frontend change page-load performance verification](../conventions/frontend-change-page-load-performance-verification.md)
  defines the media-loading verification expectation.
