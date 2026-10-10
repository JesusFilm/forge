---
title: "feat: Experience Embedding Pipeline"
type: feat
status: completed
date: 2026-04-14
origin: docs/roadmap/content-discovery/feat-095-experience-embedding-pipeline.md
---

# feat: Experience Embedding Pipeline

## Overview

Add an embedding pipeline for the Experience content type so experiences become searchable via semantic similarity. This mirrors the scene-embedding pipeline (feat-041) but for a different content type: experiences are localized entities with dynamic-zone content blocks instead of video scenes.

Delivers: `experience_embeddings` table with HNSW + GIN indexes, a text-flattening service that extracts embeddable text from experience metadata and content blocks, an indexer that upserts embeddings via OpenRouter, and lifecycle hooks that trigger embedding on publish/update/delete.

## Problem Frame

Experiences (the `easter` landing page, `christmas`, topic hubs) are invisible to semantic search because no embeddings exist for them. Before feat-086 can wire experiences into search results, and before feat-096 can backfill existing content, this pipeline must exist: storage, indexer, and lifecycle automation.

(see origin: `docs/roadmap/content-discovery/feat-095-experience-embedding-pipeline.md`)

## Requirements Trace

- R1. **experience_embeddings table** — idempotent creation with HNSW index for ANN queries, B-tree for lookups, GIN FTS index on `experiences` for keyword search
- R2. **Text flattener** — extracts title, meta fields, and content block text (headings, paragraphs, descriptions, Q&A, bible quotes) while stripping HTML markup, asset URLs, and non-textual fields
- R3. **Indexer service** — `indexExperience(strapi, experienceId, locale)` upserts embeddings idempotently; `deleteExperienceEmbedding()` removes on unpublish/delete
- R4. **Lifecycle hooks** — afterUpdate/afterCreate trigger embedding on publish; beforeDelete removes embeddings. Hooks must never block writes — fire-and-forget with error logging
- R5. **Same embedding model** — `text-embedding-3-small` (1536-dim) via OpenRouter, matching scene_embeddings for cross-type comparability
- R6. **Shared embedText helper** — alias/re-export of `embedQuery` for semantic clarity in indexing contexts

## Scope Boundaries

- **No backfill script** — that's feat-096, which calls `indexExperience()` in a loop
- **No search integration** — that's feat-086, which queries the `experience_embeddings` table
- **No GraphQL surface** for experience embeddings
- **No cross-type similarity** queries

## Context & Research

### Relevant Code and Patterns

- `apps/cms/src/bootstrap/ensure-pgvector.ts` — idempotent table/index creation with `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`. Experience table follows the same pattern alongside `scene_embeddings` and `transcript_embeddings`.
- `apps/cms/src/api/scene-embedding/services/indexer.ts` — scene-embedding indexer with `toPgArray()`, batch upsert via `knex.raw()`, typed error classes. Experience indexer is simpler (single-row upsert, no batch).
- `apps/cms/src/lib/openrouter.ts` — `embedQuery()` using `openai/text-embedding-3-small`. Reusable for indexing with a semantic alias.
- `apps/cms/src/api/experience/content-types/experience/lifecycles.js` — existing lifecycle hooks with `beforeCreate`/`beforeUpdate` for validation. Embedding hooks are `afterCreate`/`afterUpdate` (post-save, fire-and-forget).
- `apps/cms/src/api/experience/content-types/experience/schema.json` — Experience schema with `blocks` dynamic zone (16 component types), i18n-localized fields: `title`, `slug`, `metaDescription`, `ogTitle`, `ogDescription`, `pathSegment`.
- `apps/cms/src/api/search/services/search.ts` — search orchestrator. The `toPgvectorText()` helper there converts `number[]` to pgvector text format — reusable pattern.

### Component Text Extraction Map

Content blocks in the `blocks` dynamic zone that carry embeddable text:

| Component                        | Text fields                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `sections.text`                  | `heading`, `subtitle`, `contentParagraphs` (JSON array of strings)                  |
| `sections.promo-banner`          | `intro`, `heading`, `description`                                                   |
| `sections.info-blocks`           | `intro`, `heading`, `description` + nested `blocks[].title`, `blocks[].description` |
| `sections.card`                  | `title`, `description`                                                              |
| `sections.cta`                   | `heading`, `body` (richtext — strip HTML)                                           |
| `sections.related-questions`     | `heading` + `questions[].question`, `questions[].answer` (richtext — strip HTML)    |
| `sections.bible-quotes-carousel` | `heading` + `quotes[].reference`, `quotes[].text`                                   |

Wrapper components with nested dynamic zones (recurse into):

| Component            | Nesting path                                                   |
| -------------------- | -------------------------------------------------------------- |
| `sections.section`   | `content` dynamic zone (same component types)                  |
| `sections.container` | `slots[].content` dynamic zone (via `sections.container-slot`) |

Non-text components (skip): `sections.video`, `sections.video-hero`, `sections.video-carousel`, `sections.media-collection`, `sections.navigation-carousel`, `sections.easter-dates`, `sections.advent-countdown`

### Institutional Learnings

- `docs/solutions/best-practices/pgvector-embedding-indexing-strapi-v5.md` — batch insert pattern with `toPgArray()` for text arrays, idempotent bootstrap, HNSW index creation.
- Strapi v5 raw SQL: field names are snake_cased in DB (`meta_description`, not `metaDescription`; `published_at`, not `publishedAt`; `og_title`, not `ogTitle`).
- PostgreSQL 18 on Railway: `?::jsonb::text[]` cast not supported — use PG array literal format.

## Key Technical Decisions

- **Use Strapi document service for reading experiences with blocks**: Dynamic zones require deep population across component tables and join tables. Raw SQL would be extremely complex. `strapi.documents('api::experience.experience').findOne({ documentId, locale, populate: { blocks: { populate: ... } } })` handles this automatically. The indexer reads via Strapi's API, writes via raw SQL to the custom `experience_embeddings` table.

- **Recursive text extraction with `__component` discriminator**: The `flattenContentBlocks()` function walks the blocks array, switches on `__component` to extract text fields, and recurses into `section.content` and `container.slots[].content`. This handles arbitrary nesting depth without hardcoding a fixed depth.

- **HTML stripping for richtext fields**: CTA `body` and related-question `answer` fields are richtext. Use a simple regex strip (`/<[^>]*>/g`) rather than adding a dependency. These are small content blocks, not full pages.

- **Lifecycle hooks in the existing JS file**: The current `lifecycles.js` is CommonJS (`module.exports`). Rather than converting to TypeScript (which would require changing the entire file and its tests), add `afterCreate`/`afterUpdate`/`beforeDelete` to the existing exports. The embedding logic itself lives in a separate TypeScript service file; the lifecycle hooks are thin callers.

- **Fire-and-forget with error logging**: Lifecycle hooks call `indexExperience()` / `deleteExperienceEmbedding()` inside a `.catch()` that logs via `strapi.log.error()`. The save/publish operation always succeeds regardless of embedding status. Failed embeddings are picked up by the backfill (feat-096).

- **experience_id references the locale-specific integer id**: In Strapi v5 with i18n, each locale version of an experience has its own integer `id` in the `experiences` table. The `experience_embeddings.experience_id` FK references this row-level id. Combined with the `locale` column (for efficient query filtering in feat-086), the `UNIQUE(experience_id, locale)` constraint is effectively `UNIQUE(experience_id)` since each id already implies a locale — but keeping locale explicit makes the downstream search query simpler.

## Open Questions

### Resolved During Planning

- **Dynamic zone column name**: The schema shows `blocks` (not `experiences_cmps` as referenced in the roadmap ticket's pseudocode). The roadmap's `experience.experiences_cmps` reference was incorrect — the actual attribute name is `blocks`. The text flattener should process `experience.blocks`.

- **GIN FTS index target**: The roadmap ticket specifies a GIN index on `experiences` for keyword search (feat-086). The expression should be `to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(meta_description, ''))` — matching the `videos_fulltext_search_idx` pattern. DB column names: `title` and `meta_description` (snake_cased).

### Deferred to Implementation

- **Exact Strapi document service populate syntax for deep blocks**: The nesting depth (experience.blocks → section.content, container.slots[].content) may require explicit nested populate config. Test during implementation to determine if `populate: '*'` is sufficient or if explicit nesting is needed.

- **`contentParagraphs` JSON parsing**: The `sections.text` component stores `contentParagraphs` as a JSON field (array of strings). The existing `normalizeTextParagraphsValue()` in lifecycles.js handles multiple formats (string, JSON array, JSON string). The flattener should handle whatever format Strapi's document service returns — likely already-parsed array.

## Implementation Units

- [x] **Unit 1: Bootstrap — experience_embeddings table + indexes**

  **Goal:** Create the `experience_embeddings` table and all required indexes in the idempotent bootstrap.

  **Requirements:** R1

  **Dependencies:** None

  **Files:**
  - Modify: `apps/cms/src/bootstrap/ensure-pgvector.ts`

  **Approach:**
  - Add `experience_embeddings` table creation after the `scene_embeddings` block, following the same idempotent pattern
  - Table schema: `id SERIAL PRIMARY KEY`, `experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE`, `locale TEXT NOT NULL`, `slug TEXT NOT NULL`, `source_text TEXT NOT NULL`, `embedding vector(1536) NOT NULL`, `model TEXT NOT NULL DEFAULT 'text-embedding-3-small'`, `created_at TIMESTAMPTZ DEFAULT NOW()`, `updated_at TIMESTAMPTZ DEFAULT NOW()`, `UNIQUE(experience_id, locale)`
  - HNSW index: `experience_embeddings_hnsw ON experience_embeddings USING hnsw (embedding vector_cosine_ops)`
  - B-tree index: `experience_embeddings_experience_locale ON experience_embeddings(experience_id, locale)`
  - GIN FTS index on `experiences` table: `experiences_fulltext_search_idx ON experiences USING gin (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(meta_description, '')))` — this mirrors `videos_fulltext_search_idx` and is needed by feat-086
  - Add success log: `[pgvector] experience_embeddings table ready`

  **Patterns to follow:**
  - `apps/cms/src/bootstrap/ensure-pgvector.ts` lines 31-103 — the existing `transcript_embeddings` and `scene_embeddings` creation pattern

  **Test scenarios:**
  - Bootstrap runs cleanly on fresh DB (no table exists)
  - Bootstrap is idempotent (re-run doesn't error)
  - All indexes are created

  **Verification:**
  - `pnpm --filter @forge/cms dev` boots; logs show `[pgvector] experience_embeddings table ready`
  - `\d experience_embeddings` shows table with all columns and constraints
  - `\di` shows all three indexes on `experience_embeddings` plus the GIN index on `experiences`

- [x] **Unit 2: Shared embedText helper**

  **Goal:** Add an `embedText` alias for `embedQuery` so indexing code reads semantically.

  **Requirements:** R5, R6

  **Dependencies:** None

  **Files:**
  - Modify: `apps/cms/src/lib/openrouter.ts`

  **Approach:**
  - Add `export { embedQuery as embedText }` or a named re-export
  - Keep `embedQuery` unchanged for backward compatibility (used in `search.ts`)

  **Patterns to follow:**
  - Existing `embedQuery` function in `apps/cms/src/lib/openrouter.ts`

  **Test scenarios:**
  - `embedText` is callable and returns the same result as `embedQuery`
  - `embedQuery` still works (no breakage)

  **Verification:**
  - TypeScript compiles cleanly
  - Existing search code continues to import `embedQuery` without changes

- [x] **Unit 3: Experience embedder service — text flattener + indexer**

  **Goal:** Create the core embedding service with text flattening, embedding generation, and idempotent upsert/delete.

  **Requirements:** R2, R3, R5

  **Dependencies:** Unit 1 (table exists), Unit 2 (embedText available)

  **Files:**
  - Create: `apps/cms/src/api/experience/services/experience-embedder.ts`
  - Test: `apps/cms/src/api/experience/services/experience-embedder.test.ts`

  **Approach:**

  _Text flattener — `buildExperienceText(experience, locale)`_:
  - Concatenate in priority order: title, metaDescription, ogTitle (if different from title), ogDescription (if different from metaDescription), then flattened content blocks
  - Join parts with `\n\n`, filter nulls/empty
  - Return a single string for embedding

  _Content block flattener — `flattenContentBlocks(blocks)`_:
  - Walk the `blocks` array, switch on `__component`
  - Extract text fields per component type (see Component Text Extraction Map above)
  - Recurse into `sections.section` → `content` and `sections.container` → `slots[].content`
  - Strip HTML from richtext fields (CTA body, related-question answers)
  - Skip non-text components (video, video-hero, etc.)
  - Return string array (one entry per text segment)

  _Read experience — `readExperience(strapi, experienceId, locale)`_:
  - Query experience by integer id using `strapi.db.query` or `strapi.documents` with block population
  - Return null if not found or not published

  _Indexer — `indexExperience(strapi, experienceId, locale)`_:
  - Read experience; if null or unpublished, call `deleteExperienceEmbedding` and return
  - Build source text via `buildExperienceText`
  - Generate embedding via `embedText(sourceText)`
  - Convert to pgvector format: `[${embedding.join(",")}]`
  - Upsert via `INSERT ... ON CONFLICT (experience_id, locale) DO UPDATE SET slug, source_text, embedding, updated_at`
  - Log success via `strapi.log.info`

  _Delete — `deleteExperienceEmbedding(strapi, experienceId, locale)`_:
  - `DELETE FROM experience_embeddings WHERE experience_id = ? AND locale = ?`

  **Patterns to follow:**
  - `apps/cms/src/api/scene-embedding/services/indexer.ts` — raw SQL upsert pattern, toPgvectorText conversion, typed KnexInstance
  - `apps/cms/src/api/search/services/search.ts` — `toPgvectorText()` helper

  **Test scenarios:**
  - `buildExperienceText` correctly concatenates title + meta + content blocks in priority order
  - `buildExperienceText` deduplicates ogTitle when it matches title
  - `buildExperienceText` deduplicates ogDescription when it matches metaDescription
  - `flattenContentBlocks` extracts text from each component type (text heading/subtitle/paragraphs, promo-banner, info-blocks with children, card, CTA with HTML body, related-questions with HTML answers, bible-quotes)
  - `flattenContentBlocks` recurses into section.content and container.slots[].content
  - `flattenContentBlocks` skips non-text components (video, video-hero, etc.)
  - `flattenContentBlocks` strips HTML tags from richtext fields
  - `flattenContentBlocks` handles empty/null blocks gracefully
  - `indexExperience` inserts new embedding row
  - `indexExperience` updates existing row on same (experience_id, locale) — idempotent upsert
  - `indexExperience` deletes embedding when experience is unpublished (published_at null)
  - `deleteExperienceEmbedding` removes the row

  **Verification:**
  - Unit tests pass
  - TypeScript compiles cleanly
  - Function signature matches what feat-096 backfill expects: `indexExperience(strapi, experienceId, locale)`

- [x] **Unit 4: Lifecycle hooks**

  **Goal:** Wire embedding generation into experience create/update/delete lifecycle so newly published or modified experiences are automatically embedded.

  **Requirements:** R4

  **Dependencies:** Unit 3 (embedder service)

  **Files:**
  - Modify: `apps/cms/src/api/experience/content-types/experience/lifecycles.js`
  - Modify: `apps/cms/src/api/experience/content-types/experience/lifecycles.test.ts`

  **Approach:**
  - Add `afterCreate(event)`: if the created experience has `published_at` set, call `indexExperience()` in a fire-and-forget `.catch()` with error logging
  - Add `afterUpdate(event)`: if `published_at` transitioned to non-null OR content-bearing fields changed on a published experience, call `indexExperience()`. Fire-and-forget with `.catch()`
  - Add `beforeDelete(event)`: call `deleteExperienceEmbedding()`. This can be synchronous (delete is fast) or fire-and-forget
  - The embedding service is TypeScript; import it via `require()` to match the existing CommonJS pattern in lifecycles.js
  - **Critical**: hooks must never block. If OpenRouter is down, the save succeeds and `strapi.log.error` captures the failure. The backfill (feat-096) handles recovery.

  **Patterns to follow:**
  - Existing `beforeCreate`/`beforeUpdate` hooks in `lifecycles.js` — event structure, error handling, strapi global access

  **Test scenarios:**
  - `afterCreate` calls indexExperience when experience is published
  - `afterCreate` does not call indexExperience when experience is draft (no published_at)
  - `afterUpdate` calls indexExperience when published_at transitions to non-null
  - `afterUpdate` calls indexExperience when content fields change on already-published experience
  - `beforeDelete` calls deleteExperienceEmbedding
  - Embedding failure does not propagate — save/update still succeeds
  - Embedding failure is logged via strapi.log.error

  **Verification:**
  - Existing lifecycle tests still pass (no regression)
  - New lifecycle tests pass
  - Manual test: publish experience → embedding row appears in `experience_embeddings`
  - Manual test: update title on published experience → `source_text` and `embedding` update, `updated_at` advances
  - Manual test: unpublish/delete experience → embedding row removed
  - Manual test: unset OPENROUTER_API_KEY → save succeeds, error logged, no embedding row

## System-Wide Impact

- **Interaction graph:** Lifecycle hooks add async side effects to experience create/update/delete. These are fire-and-forget — no cascading failures possible. The `experience_embeddings` table is write-only from this pipeline; reads come from feat-086 (search integration).
- **Error propagation:** Embedding failures are caught and logged, never propagated to the Strapi save operation. This is by design — content operations must never fail due to external API (OpenRouter) unavailability.
- **State lifecycle risks:** If an experience is updated rapidly, multiple `indexExperience()` calls may race. The `ON CONFLICT ... DO UPDATE` upsert ensures the last write wins with correct data. No partial-write concern since it's a single INSERT/UPDATE statement.
- **API surface parity:** No API changes. The `experience_embeddings` table is internal infrastructure consumed by feat-086 and feat-096.
- **Integration coverage:** End-to-end verification requires Strapi running with pgvector extension and OpenRouter API key. Unit tests should mock the DB and OpenRouter calls.

## Risks & Dependencies

- **OpenRouter availability**: If the OpenRouter API is down or rate-limited, lifecycle embedding silently fails. Mitigation: fire-and-forget pattern with backfill recovery (feat-096).
- **Strapi document service population depth**: Deep dynamic zone nesting (experience → section → content → text) may require explicit nested populate config. Mitigation: test during implementation and adjust populate options as needed.
- **DB column name verification**: The plan assumes `meta_description`, `og_title`, `og_description` as DB column names (Strapi v5 snake_case convention). Verify with `\d experiences` against the dev DB before writing raw SQL for the GIN FTS index.

## Sources & References

- **Origin document:** [docs/roadmap/content-discovery/feat-095-experience-embedding-pipeline.md](docs/roadmap/content-discovery/feat-095-experience-embedding-pipeline.md)
- Downstream: [docs/roadmap/content-discovery/feat-096-experience-embeddings-backfill.md](docs/roadmap/content-discovery/feat-096-experience-embeddings-backfill.md)
- Downstream: [docs/roadmap/content-discovery/feat-086-experience-search-integration.md](docs/roadmap/content-discovery/feat-086-experience-search-integration.md)
- Pattern: `apps/cms/src/bootstrap/ensure-pgvector.ts`
- Pattern: `apps/cms/src/api/scene-embedding/services/indexer.ts`
- Pattern: `apps/cms/src/lib/openrouter.ts`
- Learning: `docs/solutions/best-practices/pgvector-embedding-indexing-strapi-v5.md`
- Learning: `docs/solutions/best-practices/hybrid-semantic-search-api-strapi-v5-pgvector.md`
