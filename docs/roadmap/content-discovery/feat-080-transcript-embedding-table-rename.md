---
id: "feat-080"
title: "Transcript Embedding Table Rename"
owner: "nisal"
priority: "P2"
status: "complete"
start_date: "2026-04-10"
duration: 2
depends_on:
  - "feat-009"
blocks:
  - "feat-131"
tags:
  - "cms"
  - "pgvector"
  - "search"
---

## Problem

The CMS transcript chunk vector table is named `video_embeddings`, which is broader than the data it actually stores. That makes the storage model harder to reason about now that the system also has `scene_embeddings` and is likely to grow future video-level/profile vector stores.

## Entry Points — Read These First

1. `apps/cms/src/bootstrap/ensure-pgvector.ts` — creates pgvector tables and indexes on boot.
2. `apps/cms/src/api/embedding/services/indexer.ts` — transcript embedding read/write/stats queries.
3. `apps/cms/src/api/embedding/services/indexer.test.ts` — SQL assertions around transcript embedding flows.
4. `apps/cms/src/api/data-snapshot/services/snapshot-tables.ts` — snapshot export allowlist.
5. `apps/cms/src/scripts/data-import.ts` — local import pgvector table filtering.
6. `docs/plans/2026-04-10-refactor-rename-video-embeddings-to-transcript-embeddings-plan.md` — execution plan and scope guardrails.

## Grep These

- `video_embeddings` in `apps/cms/src/`
- `video_embeddings` in `docs/roadmap/`
- `video_embeddings` in `docs/solutions/`
- `embedding/index` in `apps/cms/src/`
- `SNAPSHOT_TABLES` in `apps/cms/src/`

## What To Build

1. Rename the transcript chunk pgvector table from `video_embeddings` to `transcript_embeddings` in CMS bootstrap SQL.
2. Rename the transcript embedding HNSW index to `transcript_embeddings_embedding_idx`.
3. Update transcript embedding indexer SQL to read/write/stats-query `transcript_embeddings`.
4. Update focused CMS tests to assert the renamed table.
5. Update snapshot/import helpers to use `transcript_embeddings`.
6. Update roadmap/plan/solution docs that still describe transcript chunks as `video_embeddings`.

## Constraints

- Keep this as a naming/model-clarity change. Do not redesign embedding storage.
- Do not combine transcript rows with `scene_embeddings`, `metadataEmbedding`, or future profile vectors.
- Do not rename API routes like `POST /api/embedding/index`.
- Do not change the manager artifact contract or `artifacts.embeddingSync`.
- Do not introduce a Strapi content type for pgvector tables.

## Verification

- `pnpm --filter @forge/cms test -- src/api/embedding/services/indexer.test.ts src/api/embedding/controllers/embedding.test.ts`
- `pnpm --filter @forge/cms typecheck`
- `rg -n "video_embeddings" apps/cms/src docs/roadmap docs/solutions docs/plans`
- `SELECT to_regclass('public.transcript_embeddings');`
- `\d transcript_embeddings`
