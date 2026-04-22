---
title: "Admin scene-embeddings indexer: reuse manager's S3 analysis artifact, regenerate vectors, cross-DB coreId mapping"
last_updated: 2026-04-19
problem_type: best_practice
component: service_object
root_cause: cross_database_migration
resolution_type: pattern
severity: medium
module: apps/admin
tags:
  - pgvector
  - prisma
  - embeddings
  - useworkflow
  - scene-embedding
  - multimodal
  - migration
related_features:
  - feat-009
  - feat-041
  - feat-042
related:
  - "docs/solutions/best-practices/pgvector-embedding-indexing-strapi-v5.md"
  - "docs/solutions/best-practices/vector-embedding-storage-scope-sequencing-2026-04-11.md"
  - "docs/solutions/performance-issues/pgvector-hnsw-index-bypass-with-where-filter-20260415.md"
  - "docs/solutions/platform/backfill-worker-pattern-manager-20260407.md"
  - "docs/solutions/cms/admin-app-data-model-decisions.md"
date_learned: 2026-04-19
---

## Problem

`apps/admin` needs the same scene-embedding search capability as
`apps/cms`, but the two apps run on separate Postgres databases with
incompatible schemas (cms: integer SERIAL ids + denormalized
`scene_embeddings` table; admin: `cuid()` text ids + per-locale row
pattern). Straight table copy is impossible.

At the same time, regenerating embeddings from scratch feels wasteful —
`text-embedding-3-small` is deterministic for identical text, so the
same descriptions re-embedded in admin produce vectors essentially
indistinguishable from cms's existing ones.

## Solution

Don't copy vectors. Re-index from the upstream artifact.

The scene-analysis _metadata_ (descriptions, themes, bible verses, etc.)
lives in S3 as `{assetId}/scene-analysis.json` — written by
`apps/manager`'s multimodal pipeline once per (video, subtitle-language)
pair. cms's indexer reads this artifact, embeds the descriptions on the
fly, and pushes to cms. admin can do the same: read the artifact,
regenerate embeddings using admin's provider, persist into admin's
schema. Same model, same text, vectors drift is imperceptible, cost is
<$0.01 for the full catalog.

This decouples admin from cms entirely — no cross-DB live reads, no FDW
setup, no pg_dump contortions. The only cross-DB touch is a one-shot
snapshot of `core_id → cms_video_id` so admin's indexer knows which S3
key to request.

### Three concrete decisions worth preserving

1. **coreId → cmsVideoId mapping as a static dump, not a live lookup.**
   A one-shot script (`pnpm --filter @forge/cms dump:core-id-mapping`)
   emits a JSON file `[{ coreId, cmsVideoId }]`. admin's loader reads it
   into a Map at backfill start. Re-dump only when new videos have been
   added to cms between backfills; Strapi SERIAL ids never change, so
   existing entries stay valid. Avoids live cross-DB coupling and avoids
   bringing Strapi dependencies into admin.

2. **Scene attachment point is `VideoEdition`, not `Video`.** Scene
   timecodes follow the edition's cut (different cuts = different scene
   boundaries). Same rule admin's `VideoSubtitle` already uses.
   Per-locale descriptions + embeddings live on a separate
   `VideoSceneLocale` row so the embedding column is alongside the text
   it was generated from, and re-embedding on model upgrades only
   touches locale rows.

3. **Regenerate, don't copy.** Even though both databases run pgvector
   and the canonical model is identical, avoid the cross-DB copy
   machinery. Regeneration cost is negligible; the operational
   simplicity win (admin owns its vectors end-to-end) is large. Log the
   `model`, `dimensions`, and `source_text` alongside each embedding so
   a future model upgrade can re-embed without re-reading S3.

### Pitfalls worth repeating

- **Prisma `$executeRaw` + `::vector` cast must run inside a
  `$transaction`** when other writes depend on the id just inserted.
  The pgvector column isn't a Prisma-modelable scalar, so the update
  has to be raw. Wrap the upsert + vector write in one `$transaction`
  so a provider failure after the text write rolls back cleanly.
- **Per-locale partial HNSW index + a global NULL-excluded fallback.**
  pgvector's planner bypasses a global HNSW index when a `WHERE
locale = ?` predicate is present — well-documented in the
  `pgvector-hnsw-index-bypass-with-where-filter` learning. Create
  `video_scene_locale_embedding_hnsw_en` etc. for the Phase 1
  languages; keep a global index for unknown locales. Both partial,
  both `WHERE embedding IS NOT NULL`.
- **Prisma client extension already strips `embedding`** in admin's
  `db/client.ts`. New tables with `embedding` columns get this for
  free — no per-model wiring required. The Pothos type list must
  still omit the field explicitly; `schema.test.ts` asserts no
  `embed|vector|similarit` field leaks across the full SDL.
- **Backfill job is idempotent upserts, not delete-then-insert.** cms's
  indexer did `DELETE WHERE video_id = ?` then bulk-INSERT. In admin
  we upsert on `(edition_id, scene_index)` and `(scene_id, locale)`;
  same idempotency guarantee without the momentary empty state that
  would blank a locale mid-run if the transaction failed.

## Verification

- `SELECT COUNT(*) FROM video_scene_locale WHERE embedding IS NOT NULL`
  grows to match the number of `(edition, locale)` pairs successfully
  indexed. Re-running the backfill keeps the count stable.
- `EXPLAIN (ANALYZE) SELECT ... ORDER BY embedding <=> ?::vector LIMIT
10 WHERE locale = 'en'` should hit
  `video_scene_locale_embedding_hnsw_en` — not a sequential scan.
- `pnpm --filter @forge/admin test` covers:
  - Artifact reader (Zod validation, typed errors for missing / malformed).
  - Mapping loader (Zod validation, typed errors for missing / malformed).
  - Scene indexer (ABAC gate, idempotent upsert, empty scenes, duplicate
    scene index, empty description, transaction-scoped raw SQL).
  - Backfill workflow (target enumeration, coreId filter, artifact_missing
    → skip, provider failure → failed but continue, aggregate report).

## Related

- `apps/cms/src/api/scene-embedding/services/indexer.ts` — the cms
  indexer this pattern ports. Useful to diff semantic parity.
- `apps/manager/src/services/sceneAnalysis.ts` — upstream producer of
  `scene-analysis.json`. Stable format; Zod parser in admin's reader
  mirrors manager's `normalizeSceneAnalysis`.
- `docs/brainstorms/2026-04-19-admin-migration-playbook-requirements.md`
  — R1 origin doc.
- `docs/plans/2026-04-19-001-feat-admin-scene-embeddings-infra-plan.md`
  — implementation plan.
