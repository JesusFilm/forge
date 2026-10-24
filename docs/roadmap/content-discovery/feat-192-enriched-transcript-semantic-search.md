---
id: "feat-192"
title: "Enriched Transcript Semantic Search Realignment"
owner: "nisal"
priority: "P0"
status: "implemented"
start_date: "2026-06-17"
duration: 5
depends_on: []
blocks:
  - "feat-193"
  - "feat-198"
tags:
  - "admin"
  - "mastra"
  - "manager"
  - "search"
  - "embeddings"
  - "content-discovery"
---

## Scope

Implement the enriched transcript semantic search plan from:

- `docs/plans/2026-06-17-001-feat-enriched-transcript-semantic-search-plan.md`

Execution starts with subtitle-first transcript source resolution, enriched
transcript source contracts, structured transcript chunk metadata, and removal
of scene evidence consumption from the existing `semantic-video` retriever
after enriched transcript rows can be produced.

Implemented in this branch by keeping the public `semantic-video` and
`sceneRecommendations` API shapes stable while moving their vector evidence to
enriched transcript chunks. Scene ingestion/backfill code remains present for a
later deletion pass after eval.

## Key Constraints

- Keep `semantic-video` as the public retrieval family.
- Stop consuming scene retrieval before deleting scene code.
- Prefer Admin/Core subtitles, then Manager transcript artifacts.
- Report missing timed text or Manager fallback gaps without auto-triggering
  Manager enrichment in v1.
- Preserve language identity beyond BCP-47 wherever Admin can provide it.
- Keep scene tables and historical rows intact.
