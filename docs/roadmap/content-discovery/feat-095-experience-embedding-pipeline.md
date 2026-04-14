---
id: "feat-095"
title: "Experience Embedding Pipeline"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: "2026-04-16"
duration: 5
depends_on:
  - "feat-010"
blocks:
  - "feat-086"
  - "feat-096"
tags:
  - "cms"
  - "pgvector"
  - "ai-pipeline"
  - "experiences"
---

## Problem

Experiences (the `easter` landing page, `christmas`, topic hubs) are currently invisible to semantic search because we have no embeddings for them. Before feat-086 can wire experiences into search results, we need the underlying pipeline: a `experience_embeddings` table, a text-flattening indexer that embeds the right parts of an experience, and lifecycle hooks so newly created/updated experiences automatically get embedded.

This mirrors the scene-embedding pipeline (feat-041) — storage + indexer + lifecycle — but for a different content type.

## Entry Points — Read These First

1. `apps/cms/src/bootstrap/ensure-pgvector.ts` — where `scene_embeddings` + HNSW + GIN indexes are declared idempotently. Add `experience_embeddings` here.
2. `apps/cms/src/api/scene-embedding/services/indexer.ts` — existing scene-embedding indexer. The experience indexer follows the same idempotent upsert pattern but with different source text.
3. `apps/cms/src/api/experience/content-types/experience/schema.json` — the Experience content type. Note the localized `title`, `metaDescription`, `ogTitle`, `ogDescription`, `pathSegment`, and the `experiences_cmps` dynamic zone with content blocks.
4. `apps/cms/src/api/experience/content-types/experience/lifecycles.js` — where to hook embedding regeneration on publish/update.
5. `apps/cms/src/lib/openrouter.ts` — `embedQuery()` client for `openai/text-embedding-3-small` (1536-dim). Lift or rename to a shared `embedText()` if it helps clarity.
6. `docs/solutions/best-practices/hybrid-semantic-search-api-strapi-v5-pgvector.md` — the architectural pattern this pipeline feeds into.
7. `docs/solutions/best-practices/pgvector-embedding-indexing-strapi-v5.md` — existing pattern for pgvector columns in Strapi v5.

## Grep These

- `scene_embeddings` in `apps/cms/src/` — pattern for pgvector-backed tables.
- `experiences_cmps` in `apps/cms/src/` — dynamic content blocks join table. Understand structure to extract embeddable text.
- `lifecycle` in `apps/cms/src/api/experience/` — publish/update hooks on the Experience content type.
- `ensurePgvector` in `apps/cms/src/bootstrap/` — idempotent table creation pattern.

## What To Build

### 1. `experience_embeddings` table (bootstrap)

Add to `apps/cms/src/bootstrap/ensure-pgvector.ts` alongside `scene_embeddings`:

```sql
CREATE TABLE IF NOT EXISTS experience_embeddings (
  id                SERIAL PRIMARY KEY,
  experience_id     INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  locale            TEXT NOT NULL,
  slug              TEXT NOT NULL,
  source_text       TEXT NOT NULL,
  embedding         vector(1536) NOT NULL,
  model             TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(experience_id, locale)
)
```

Plus:

- HNSW index on `(embedding vector_cosine_ops)` for fast ANN queries
- B-tree index on `(experience_id, locale)` for lookup
- GIN index on `to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(meta_description, ''))` over the `experiences` table — **mirrors** the `videos_fulltext_search_idx` pattern from feat-010 so keyword search reuses the same approach

All statements idempotent (`IF NOT EXISTS`).

### 2. Embeddable-text flattener

`apps/cms/src/api/experience/services/experience-embedder.ts`:

```ts
export function buildExperienceText(experience, locale: string): string {
  // Concatenate in priority order so OpenRouter weighting gives us
  // what matters most. Strip HTML, skip asset URLs and raw markup.
  const parts = [
    experience.title,
    experience.metaDescription,
    experience.ogTitle !== experience.title ? experience.ogTitle : null,
    experience.ogDescription !== experience.metaDescription
      ? experience.ogDescription
      : null,
    ...flattenContentBlocks(experience.experiences_cmps ?? []),
  ]
  return parts.filter(Boolean).join("\n\n")
}
```

`flattenContentBlocks` pulls section headers, paragraph text, captions — **NOT** HTML markup, not asset URLs, not button link targets. One line per block.

### 3. Indexer service

```ts
export async function indexExperience(
  strapi: Core.Strapi,
  experienceId: number,
  locale: string,
): Promise<void> {
  const experience = await readExperience(strapi, experienceId, locale)
  if (!experience || experience.published_at == null) {
    // Unpublished → remove any existing embedding
    await deleteExperienceEmbedding(strapi, experienceId, locale)
    return
  }

  const sourceText = buildExperienceText(experience, locale)
  const embedding = await embedText(sourceText)
  const embeddingVector = toPgvectorText(embedding)

  await knex.raw(
    `INSERT INTO experience_embeddings
       (experience_id, locale, slug, source_text, embedding)
     VALUES (?, ?, ?, ?, ?::vector)
     ON CONFLICT (experience_id, locale) DO UPDATE
       SET slug = EXCLUDED.slug,
           source_text = EXCLUDED.source_text,
           embedding = EXCLUDED.embedding,
           updated_at = NOW()`,
    [experienceId, locale, experience.slug, sourceText, embeddingVector],
  )
}

export async function deleteExperienceEmbedding(
  strapi: Core.Strapi,
  experienceId: number,
  locale: string,
): Promise<void>
```

### 4. Lifecycle hooks

Modify `apps/cms/src/api/experience/content-types/experience/lifecycles.js` (or `.ts` if the file is converted):

- `afterUpdate`: if `published_at` transitioned non-null OR content-bearing fields changed, enqueue `indexExperience()` for the experience's locale. Fire-and-forget with `strapi.log.error()` on failure.
- `afterCreate` (with publication): same as afterUpdate.
- `beforeDelete` / `afterUnpublish`: call `deleteExperienceEmbedding()`.

**Critical:** lifecycle hooks must not block the save. If `embedText()` throws (OpenRouter down), log the error and continue. The save succeeds; backfill (feat-096) will pick up anything that failed.

### 5. Shared `embedText` helper (if not already extracted)

`apps/cms/src/lib/openrouter.ts` currently exports `embedQuery(text)`. Rename or alias to `embedText(text)` since it's now used for indexing too, not just search queries. Keep `embedQuery` as a re-export for backward compatibility.

### 6. Tests

- `experience-embedder.test.ts`:
  - `buildExperienceText()` correctly flattens title + meta + content blocks
  - Skips unpublished-only fields, HTML markup, and empty optional fields
  - Handles locale-specific fields correctly
- `indexer.test.ts`:
  - Upsert behavior: inserts new, updates existing on same `(experience_id, locale)`
  - Delete on unpublish
  - Lifecycle hook fires on update but doesn't block on embedding failure

## Constraints

- **Same model as scene_embeddings** (`openai/text-embedding-3-small`, 1536-dim). Vectors must be comparable in the same embedding space if we ever add cross-type semantic similarity later.
- **No new external dependencies** — reuse `apps/cms/src/lib/openrouter.ts`.
- **Lifecycle hooks must never block writes.** Experience save/publish must always succeed even if embedding fails. Log and continue.
- **Strapi v5 raw SQL conventions:** column names are snake_cased (`published_at`, not `publishedAt`). The bootstrap file uses raw SQL; reuse `knex.raw()` via `strapi.db.connection`.
- **Locale differs from videos.** Videos are joined to `video_variants.language` through link tables. Experiences are themselves localized — one row per locale with a `locale` column directly on the entity. Simpler join chain.
- **Does NOT add experiences to search results.** That's feat-086. This ticket only builds the pipeline; the resulting embeddings just sit in the table until feat-086 queries them.

## Verification

- `pnpm --filter @forge/cms dev` boots cleanly; logs show `[pgvector] experience_embeddings table ready`.
- `psql $DATABASE_URL -c "\d experience_embeddings"` shows the table + all indexes.
- Publish an experience in the Strapi admin → `SELECT count(*) FROM experience_embeddings` increments.
- Update an experience's title → `SELECT source_text FROM experience_embeddings WHERE experience_id = X` reflects the change after `updated_at` advances.
- Unpublish an experience → its row is deleted.
- Kill OpenRouter (unset API key) → saving an experience still succeeds, `strapi.log.error` logs the embedding failure, row is not created.
- Unit tests pass; typecheck + lint clean.

## Out of Scope

- **Backfill** of existing experiences (that's feat-096).
- **Search integration** — wiring experiences into `/api/search` results (that's feat-086, now rescoped).
- **Dynamic re-embedding** when the embedding model version changes — one-shot backfill in feat-096 handles model upgrades.
- **Cross-type similarity** (experience → videos recommendation) — separate future work.
