import type { Core } from "@strapi/strapi"

/**
 * Enable pgvector and create embedding tables on startup.
 *
 * These tables use raw SQL because pgvector's vector columns are not
 * supported by Strapi's ORM. All statements are idempotent.
 *
 * Fails gracefully if pgvector is not available (e.g., local dev without
 * the extension installed) — Strapi will still boot, just without
 * embedding features.
 */
export async function ensurePgvector(strapi: Core.Strapi): Promise<void> {
  const knex = strapi.db.connection

  try {
    // 1. Enable pgvector extension
    await knex.raw("CREATE EXTENSION IF NOT EXISTS vector")
  } catch (err) {
    strapi.log.warn(
      `[pgvector] Extension not available, embedding features disabled: ${
        err instanceof Error ? err.message : err
      }`,
    )
    return
  }

  strapi.log.info("[pgvector] Extension enabled")

  try {
    // 2. transcript_embeddings — transcript chunk embeddings (feat-009)
    await knex.raw(`
      CREATE TABLE IF NOT EXISTS transcript_embeddings (
        id          SERIAL PRIMARY KEY,
        video_id    INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        chunk_text  TEXT NOT NULL,
        embedding   vector(1536) NOT NULL,
        model       VARCHAR(100) NOT NULL DEFAULT 'text-embedding-3-small',
        created_at  TIMESTAMP DEFAULT NOW(),
        UNIQUE(video_id, chunk_index)
      )
    `)

    await knex.raw(`
      CREATE INDEX IF NOT EXISTS transcript_embeddings_embedding_idx
        ON transcript_embeddings USING hnsw (embedding vector_cosine_ops)
    `)

    // 3. scene_embeddings — multimodal scene analysis embeddings (feat-041)
    await knex.raw(`
      CREATE TABLE IF NOT EXISTS scene_embeddings (
        id            SERIAL PRIMARY KEY,
        video_id      INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        core_id       TEXT,
        mux_asset_id  TEXT NOT NULL,
        playback_id   TEXT NOT NULL,
        scene_index   INTEGER NOT NULL,
        start_seconds FLOAT NOT NULL,
        end_seconds   FLOAT,
        description   TEXT NOT NULL,
        themes        TEXT[] DEFAULT '{}',
        bible_verses  TEXT[] DEFAULT '{}',
        demographics  TEXT[] DEFAULT '{}',
        spiritual_context TEXT[] DEFAULT '{}',
        chapter_title TEXT,
        embedding     vector(1536) NOT NULL,
        model         TEXT NOT NULL DEFAULT 'text-embedding-3-small',
        language      TEXT NOT NULL DEFAULT 'en',
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(video_id, scene_index)
      )
    `)

    await knex.raw(`
      CREATE INDEX IF NOT EXISTS scene_embeddings_hnsw
        ON scene_embeddings USING hnsw (embedding vector_cosine_ops)
    `)

    await knex.raw(`
      CREATE INDEX IF NOT EXISTS scene_embeddings_video_id
        ON scene_embeddings(video_id)
    `)

    await knex.raw(`
      CREATE INDEX IF NOT EXISTS scene_embeddings_language
        ON scene_embeddings(language)
    `)

    // Migration: add spiritual_context column if missing (existing installs)
    await knex.raw(`
      ALTER TABLE scene_embeddings
        ADD COLUMN IF NOT EXISTS spiritual_context TEXT[] DEFAULT '{}'
    `)

    // GIN index for semantic search API keyword search (Unit 8)
    // Expression must match the tsvector in api/search/services/keyword-search.ts
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS videos_fulltext_search_idx
        ON videos USING gin (
          to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))
        )
    `)

    // 4. experience_embeddings — experience-level embeddings (feat-095)
    await knex.raw(`
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
    `)

    // Per-locale partial HNSW indexes for `experience_embeddings`.
    //
    // The naive index `CREATE INDEX ... USING hnsw (embedding ...)` works for
    // unfiltered nearest-neighbour queries, but `WHERE locale = ? ORDER BY
    // embedding <=> ?` defeats it: pgvector's planner cost model for
    // HNSW-with-WHERE is too pessimistic, so the planner picks `Seq Scan +
    // Top-N Sort` even when HNSW would be ~10× faster (verified locally on a
    // 10K-row synthetic table — 19.8ms seq scan vs 1.5ms HNSW).
    //
    // Partial indexes keyed on locale match the `WHERE locale = ?` predicate
    // exactly, so the planner picks them naturally. The `hnsw.iterative_scan`
    // GUC (set at connection time in `config/database.ts`) lets the index
    // continue searching past the default `ef_search` window when the LIMIT
    // requires more candidates.
    //
    // The non-partial index below is kept as a fallback for unknown locales
    // (queries with `WHERE locale = 'jp'` would still seq-scan, but the
    // global index covers any future unfiltered query that might appear).
    //
    // To support a new locale efficiently, add another partial index here.
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS experience_embeddings_hnsw
        ON experience_embeddings USING hnsw (embedding vector_cosine_ops)
    `)

    for (const locale of ["en", "es", "fr"] as const) {
      await knex.raw(
        `CREATE INDEX IF NOT EXISTS experience_embeddings_hnsw_${locale}
           ON experience_embeddings USING hnsw (embedding vector_cosine_ops)
           WHERE locale = '${locale}'`,
      )
    }

    // Note: UNIQUE(experience_id, locale) already creates a B-tree index.
    // No explicit index needed for that column pair.

    // GIN index for experience keyword search (feat-086)
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS experiences_fulltext_search_idx
        ON experiences USING gin (
          to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(meta_description, ''))
        )
    `)

    strapi.log.info("[pgvector] Tables and indexes ready")
  } catch (err) {
    strapi.log.warn(
      `[pgvector] Failed to create embedding tables (videos table may not exist yet): ${
        err instanceof Error ? err.message : err
      }`,
    )
  }
}
