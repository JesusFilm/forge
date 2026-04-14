---
title: "Experience Embedding Pipeline with pgvector and Strapi v5 Lifecycle Hooks"
problem_type: best_practice
component: database
root_cause: missing_tooling
resolution_type: tooling_addition
severity: high
date: "2026-04-14"
features:
  - "feat-095"
tags:
  - pgvector
  - embeddings
  - experiences
  - strapi
  - lifecycle-hooks
  - dynamic-zones
  - text-embedding
  - openrouter
  - idempotent-upsert
  - text-flattening
  - fire-and-forget
module: cms
key_files:
  - "apps/cms/src/api/experience/services/experience-embedder.ts"
  - "apps/cms/src/api/experience/services/experience-embedder.test.ts"
  - "apps/cms/src/api/experience/content-types/experience/lifecycles.js"
  - "apps/cms/src/bootstrap/ensure-pgvector.ts"
  - "apps/cms/src/lib/openrouter.ts"
related:
  - "docs/solutions/best-practices/pgvector-embedding-indexing-strapi-v5.md"
  - "docs/solutions/best-practices/vector-embedding-storage-scope-sequencing-2026-04-11.md"
  - "docs/solutions/best-practices/pgvector-recommendation-query-locale-graphql-strapi-v5.md"
  - "docs/solutions/best-practices/hybrid-semantic-search-api-strapi-v5-pgvector.md"
  - "docs/solutions/cms/strapi-v5-blurhash-generation-multi-path-pattern.md"
  - "docs/solutions/platform/multimodal-scene-analysis-pipeline.md"
---

## Problem

Experiences (Easter, Christmas landing pages) in JesusFilm's Strapi v5 CMS are invisible to semantic search because no embeddings exist. Before search integration (feat-086) can return experiences in results, and before the backfill script (feat-096) can populate existing content, the embedding pipeline infrastructure must be built: storage table, text flattener, indexer, and lifecycle automation.

This mirrors the scene-embedding pipeline (feat-041) but for a structurally different content type: experiences use localized i18n rows with deeply nested dynamic zone content blocks, unlike videos which have flat metadata plus scene-level embeddings.

## Symptoms

- Searching for "Easter" returns videos but not the dedicated Easter experience page
- `SELECT count(*) FROM experience_embeddings` returns 0 (table doesn't exist yet)
- No mechanism to generate or store experience embeddings on publish/update

## What Didn't Work

### 1. Shallow `populate: true` for reading experience blocks

```typescript
// WRONG — only populates one level of dynamic zone components
populate: {
  blocks: {
    populate: true
  }
}
```

Experiences nest components across multiple levels: `blocks` -> `sections.container` -> `slots` -> `content` -> `sections.text`. Shallow populate leaves nested content as `undefined`, causing `flattenContentBlocks` to silently return `[]` for inner blocks. Embeddings are produced but incomplete.

### 2. Relying on DDL DEFAULT for model column

```sql
-- DDL says one thing:
model TEXT NOT NULL DEFAULT 'text-embedding-3-small'
-- But the OpenRouter constant is:
EMBEDDING_MODEL = "openai/text-embedding-3-small"
```

The INSERT omitted the `model` column, relying on the DDL default. But the default didn't match the runtime constant (vendor prefix mismatch). Every row recorded the wrong model string.

### 3. Redundant B-tree index alongside UNIQUE constraint

```sql
UNIQUE(experience_id, locale)  -- Already creates a B-tree index

-- This is redundant and wastes disk + write overhead:
CREATE INDEX experience_embeddings_experience_locale
  ON experience_embeddings(experience_id, locale)
```

PostgreSQL automatically creates a B-tree index for every UNIQUE constraint. The explicit index was pure overhead.

### 4. beforeDelete hook alongside ON DELETE CASCADE

```javascript
// WRONG — races with CASCADE and is redundant
beforeDelete(event) {
  knex.raw("DELETE FROM experience_embeddings WHERE experience_id = ?", [id])
}
```

The `experience_embeddings` table has `REFERENCES experiences(id) ON DELETE CASCADE`. The manual DELETE in `beforeDelete` races with the cascade and adds complexity for zero benefit.

### 5. Missing env var guard in lifecycle hooks

Without checking for `OPENROUTER_API_KEY`, every experience save in dev/staging environments produced an error log from the failed embedding call. Noisy and misleading.

### 6. No text length limit before embedding API call

`text-embedding-3-small` has an 8191 token limit. Large experiences with many content blocks could exceed this, causing silent API failures in the fire-and-forget lifecycle hook.

### 7. Empty text path didn't delete stale embeddings

When a published experience was updated to clear all text fields, the code logged a warning and returned — leaving the old embedding row in place. Search would return the experience based on stale content.

## Solution

### 1. Bootstrap table with idempotent DDL

```sql
CREATE TABLE IF NOT EXISTS experience_embeddings (
  id              SERIAL PRIMARY KEY,
  experience_id   INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  locale          TEXT NOT NULL,
  slug            TEXT NOT NULL,
  source_text     TEXT NOT NULL,
  embedding       vector(1536) NOT NULL,
  model           TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(experience_id, locale)
)
```

Plus HNSW index for ANN queries and GIN FTS index on the `experiences` table for keyword search. No explicit B-tree index needed — the UNIQUE constraint provides it.

### 2. Recursive text flattener for dynamic zone blocks

The novel piece compared to scene/transcript embeddings. Experiences use Strapi's dynamic zone with 16 component types, some of which nest further dynamic zones.

```typescript
function extractBlockText(block: Block): string[] {
  switch (block.__component) {
    case "sections.text":
    // heading, subtitle, contentParagraphs (JSON array)
    case "sections.promo-banner":
    // intro, heading, description
    case "sections.info-blocks":
    // heading, description + nested blocks[].title, blocks[].description
    case "sections.cta":
    // heading, body (richtext — strip HTML)
    case "sections.related-questions":
    // heading + questions[].question, questions[].answer (strip HTML)
    case "sections.bible-quotes-carousel":
    // heading + quotes[].reference, quotes[].text

    // Wrapper components — recurse into nested dynamic zones
    case "sections.section":
      return flattenContentBlocks(block.content)
    case "sections.container":
      return block.slots.flatMap((slot) => flattenContentBlocks(slot?.content))

    default:
      return [] // video, video-hero, media-collection, etc.
  }
}
```

**Key pattern:** dispatch on `__component` discriminator, extract text from leaf components, recurse into wrapper components. Strip HTML from richtext fields with simple regex.

### 3. Explicit deep populate for nested dynamic zones

```typescript
populate: {
  blocks: {
    populate: {
      blocks: true,        // info-block items
      questions: true,     // related-question items
      quotes: true,        // bible-quote items
      content: {           // sections.section → content
        populate: { blocks: true, questions: true, quotes: true },
      },
      slots: {             // sections.container → slots
        populate: {
          content: {       // container-slot → content
            populate: { blocks: true, questions: true, quotes: true },
          },
        },
      },
    },
  },
},
```

Each nesting level requires explicit populate config. This is the critical difference from `populate: true`.

### 4. Model name normalization

```typescript
const STORAGE_MODEL = EMBEDDING_MODEL.replace(/^[^/]+\//, "")
// "openai/text-embedding-3-small" → "text-embedding-3-small"
```

Strip the OpenRouter vendor prefix before storage so all embedding tables (transcript, scene, experience) store the same canonical model name. Pass `STORAGE_MODEL` explicitly in both INSERT and ON CONFLICT UPDATE.

### 5. Text truncation before embedding

```typescript
const MAX_SOURCE_TEXT_CHARS = 30_000 // ~7,500 tokens at 4 chars/token

const truncatedText =
  sourceText.length > MAX_SOURCE_TEXT_CHARS
    ? sourceText.slice(0, MAX_SOURCE_TEXT_CHARS)
    : sourceText

const embedding = await embedText(truncatedText)
```

### 6. Fire-and-forget lifecycle hooks with guards

```javascript
const fireAndForgetIndex = (experienceId, locale) => {
  if (!process.env.OPENROUTER_API_KEY) return // Silent skip in dev

  import("../../services/experience-embedder")
    .then(({ indexExperience }) =>
      indexExperience(strapi, experienceId, locale),
    )
    .catch((err) => {
      strapi.log.error(`[experience-embedding] Failed to index: ${err.message}`)
    })
}
```

Dynamic `import()` bridges CJS lifecycle hooks to the TS embedder module. The `.catch()` ensures embedding failures never propagate to block the CMS save.

### 7. Delete stale embeddings on all invalid paths

```typescript
// Unpublished or not found → delete
if (!experience || experience.publishedAt == null) {
  await deleteExperienceEmbedding(strapi, experienceId, locale)
  return
}

// Empty text (all fields cleared) → delete stale embedding
if (sourceText.trim().length === 0) {
  await deleteExperienceEmbedding(strapi, experienceId, locale)
  return
}
```

## Why This Works

The pipeline follows the established pgvector pattern (see `pgvector-embedding-indexing-strapi-v5.md`) but adapts it for experiences:

- **Separate table per retrieval grain** (see `vector-embedding-storage-scope-sequencing`): experiences answer "what is this page about?" — different from scenes ("what happens at this timestamp?")
- **ON CONFLICT upsert** instead of delete-then-insert: one row per (experience_id, locale), so upsert is natural and avoids race conditions
- **Fire-and-forget hooks** (see `strapi-v5-blurhash-generation-multi-path-pattern`): embedding is an optional enrichment that must never block content operations
- **Recursive text flattening** is the novel piece: dynamic zones with nested wrappers require component-aware traversal, unlike flat video metadata

## Prevention

1. **Always check if a UNIQUE constraint already provides the index you need.** PostgreSQL creates a B-tree index for every UNIQUE constraint. Verify with `\di tablename` before adding explicit indexes.

2. **Always guard lifecycle hooks against missing env vars for optional features.** Fire-and-forget hooks for optional integrations should check for required API keys and silently skip, not log errors.

3. **Use explicit nested populate in Strapi v5 when data spans multiple dynamic zone levels.** Don't rely on `populate: true`; define the populate structure for each nesting level explicitly.

4. **Strip vendor prefixes from model identifiers before storage.** APIs return vendor-prefixed names (`openai/text-embedding-3-small`). Store the canonical name (`text-embedding-3-small`) for cross-table consistency.

5. **Truncate text before embedding API calls.** Check the model's token limit and truncate conservatively. ~4 chars/token with safety margin (30k chars for 8191 tokens).

6. **Delete stale data on ALL "no longer valid" code paths.** Unpublished experiences AND experiences with empty text both produce stale embeddings. Handle every path.

7. **ON DELETE CASCADE eliminates the need for beforeDelete cleanup hooks.** If the FK has CASCADE, don't add a manual DELETE hook — it's redundant and races with the cascade.

8. **Always pass the model identifier explicitly in upserts.** Don't rely on DDL DEFAULT values matching your runtime constants — they will drift.
