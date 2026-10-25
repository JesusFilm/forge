---
id: "feat-193"
title: "Remove Legacy Scene Embedding Pipeline"
owner: "nisal"
priority: "P1"
status: "complete"
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

After enriched transcript search has passed the transcript-only eval guardrail,
remove the legacy scene embedding pipeline that is no longer consumed by
semantic search or recommendation lists.

This is the deletion follow-up for feat-192. feat-192 stops scene embedding
consumption while leaving the old code in place; this ticket deletes the dead
scene-embedding path and cleans up naming/docs that still imply scene retrieval
is active. This is intentionally a code cleanup slice, not a database-retention
or embedding-backfill-operations slice; those stay in `feat-199`.

Release contract: this intentionally removes the
`triggerSceneEmbeddingBackfill` GraphQL mutation and generated
`@forge/admin-graphql` field rather than keeping a deprecated mutation. Legacy
HTTP entry points with external callers return stable `410` tombstones with
`reason: "legacy_scene_embedding_pipeline_removed"`. Coordinate release notes
and client audits around that breaking GraphQL removal, then revoke retired
scene-ingest secrets after deploy verification.

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

- Enriched transcript semantic search eval has passed the agreed promotion gate,
  using the completed transcript-only eval work as the guardrail.
- No production search or recommendation path calls scene embedding retrieval,
  scene embedding ingestion, or scene embedding backfill code.
- Dead scene embedding code and tests are removed, not merely bypassed.
- Remaining scene-analysis code has an owner and a non-search reason to exist,
  or is removed in the same cleanup.
- Operator docs, roadmap notes, and code comments describe transcript-backed
  search/recommendations without implying scene embeddings are still active.
- Historical `video_scene` / `video_scene_locale` rows remain in place unless a
  separately approved retention migration exists.
