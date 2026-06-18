---
id: "feat-193"
title: "Remove Legacy Scene Embedding Pipeline"
owner: "nisal"
priority: "P1"
status: "planned"
start_date: "2026-06-24"
duration: 3
depends_on:
  - "feat-192"
blocks: []
tags:
  - "admin"
  - "mastra"
  - "manager"
  - "search"
  - "embeddings"
  - "content-discovery"
  - "cleanup"
---

## Scope

After enriched transcript search has passed eval and production backfill
coverage is healthy, remove the legacy scene embedding pipeline that is no
longer consumed by semantic search or recommendation lists.

This is the deletion follow-up for feat-192. feat-192 stops scene embedding
consumption while leaving the old code in place; this ticket deletes the dead
scene-embedding path and cleans up naming/docs that still imply scene retrieval
is active.

## Cleanup Targets

- Delete Admin scene embedding backfill, ingest, Mastra scene client, and
  GraphQL mutation surfaces that only exist to populate `video_scene` /
  `video_scene_locale` embeddings.
- Delete or migrate Manager/Mastra scene embedding sync clients and tests that
  only serve Admin scene embedding ingestion.
- Remove legacy scene-table reads from content-discovery code and tests; any
  remaining `video_scene` references should be justified by non-search product
  behavior.
- Clean up compatibility wording such as "scene-similarity" and
  "scene-recommendations" where the runtime behavior is now transcript-backed.
- Decide whether public compatibility names like `sceneRecommendations` stay as
  aliases or get a separately planned API rename after frontend/mobile clients
  are ready.
- Keep historical scene tables/data until a separate data-retention migration is
  explicitly approved.

## Acceptance Criteria

- Enriched transcript semantic search eval has passed the agreed promotion gate.
- No production search or recommendation path calls scene embedding retrieval,
  scene embedding ingestion, or scene embedding backfill code.
- Dead scene embedding code and tests are removed, not merely bypassed.
- Remaining scene-analysis code has an owner and a non-search reason to exist,
  or is removed in the same cleanup.
- Operator docs, roadmap notes, and code comments describe transcript-backed
  search/recommendations without implying scene embeddings are still active.
