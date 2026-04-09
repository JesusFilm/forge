---
id: "feat-071"
title: "Recommendation Content Deduplication"
owner: "nisal"
priority: "P2"
status: "not-started"
start_date: "2026-06-15"
duration: 5
depends_on:
  - "feat-046"
blocks: []
tags:
  - "cms"
  - "graphql"
  - "pgvector"
---

## Problem

The recommendation engine returns duplicate content in results — different videos that contain the same or near-identical scenes. This happens in two ways:

1. **Ad-format variants**: The same video re-cut for different aspect ratios (e.g. "4. Good News About Jesus" vs "4. Good News About Jesus AD 1x1"). These share a `core_id` prefix.
2. **Cross-series duplicates**: The same scene filmed for different series (e.g. "Sermon on the Mount" appears in both the JESUS Film and Lumo series). Different `core_id`s, different parents, but semantically identical content with ~0.96 embedding similarity.

Currently 11 pairs of cross-series duplicates and 12+ ad-format variant groups exist among the 467 indexed videos. As more content is indexed, this will grow.

## Entry Points — Read These First

1. `apps/cms/src/api/scene-embedding/services/recommender.ts` — `deduplicateResults()` has a prototype implementation using core_id prefix, title match, and embedding similarity
2. `apps/cms/src/api/scene-embedding/services/recommender.ts` — `SIMILARITY_SQL` and `queryPerVideo()` for the two query paths that need dedup

## Grep These

- `deduplicateResults` in `apps/cms/src/` — current prototype dedup logic
- `cosineSimilarityFromText` in `apps/cms/src/` — JS-side embedding comparison
- `core_id` in `apps/cms/src/api/scene-embedding/` — core_id usage in recommendations
- `videos_children_lnk` in `apps/cms/src/` — existing parent-child exclusion

## What To Build

Evaluate and harden the current prototype dedup approach. Consider:

- **Pre-computed dedup groups**: Build a `video_dedup_groups` table that clusters videos covering the same content. Populate via batch embedding similarity analysis. Recommendations query only needs to check group membership instead of computing similarity at query time.
- **core_id normalization**: Formalize the prefix-stripping logic for ad-format variants. Consider adding a `canonical_video_id` field to videos that point to the "primary" version.
- **Embedding-based clustering**: For cross-series duplicates, run an offline job that computes pairwise scene similarity across all indexed videos and writes dedup edges. Threshold: 0.95+ cosine similarity on best-matching scene pair.
- **Query-time vs index-time tradeoff**: The current prototype does dedup at query time (JS loop with O(n²) comparisons). For >1000 indexed videos, consider moving dedup to index time or using the pre-computed groups table.

## Constraints

- Must not regress recommendation query latency (currently ~45ms for top-10)
- Must handle the multi-scene merge path (`queryPerVideo`) which bypasses SQL-level dedup
- Dedup should prefer the version with more metadata (longer description, more themes) or the version from the "primary" series
- Do not remove videos from the index — dedup is a presentation-layer concern

## Verification

- `sceneRecommendations(slug: "the-savior", locale: "en", limit: 10)` returns no duplicate titles
- `sceneRecommendations(slug: "fallingplates", locale: "en", limit: 10)` returns no ad-format variants of the same video
- Query latency remains <100ms for top-10 results
- All 10 result slots are filled with unique content (no wasted slots from dedup)
