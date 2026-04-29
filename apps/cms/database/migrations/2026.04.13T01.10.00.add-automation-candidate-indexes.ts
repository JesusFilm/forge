/**
 * Add indexes for the automation candidate endpoint.
 *
 * The dry-run/live automation runner asks for a capped, title-ordered subset
 * of published non-container videos and suppresses already-running keys. These
 * indexes keep that path independent from the heavier dashboard coverage query.
 */

const INDEXES = [
  {
    table: "videos",
    name: "idx_videos_automation_candidates_title",
    sql: `CREATE INDEX IF NOT EXISTS idx_videos_automation_candidates_title
       ON "videos" ("title" ASC NULLS LAST, "document_id")
       INCLUDE ("id", "core_id", "ai_metadata")
       WHERE "published_at" IS NOT NULL
         AND "core_id" IS NOT NULL
         AND COALESCE("label", '') NOT IN ('collection', 'series')`,
  },
  {
    table: "videos",
    name: "idx_videos_automation_metadata_missing_title",
    sql: `CREATE INDEX IF NOT EXISTS idx_videos_automation_metadata_missing_title
       ON "videos" ("title" ASC NULLS LAST, "document_id")
       INCLUDE ("id", "core_id", "ai_metadata")
       WHERE "published_at" IS NOT NULL
         AND "core_id" IS NOT NULL
         AND COALESCE("label", '') NOT IN ('collection', 'series')
         AND "ai_metadata" IS NULL`,
  },
  {
    table: "videos",
    name: "idx_videos_automation_metadata_refresh_title",
    sql: `CREATE INDEX IF NOT EXISTS idx_videos_automation_metadata_refresh_title
       ON "videos" ("title" ASC NULLS LAST, "document_id")
       INCLUDE ("id", "core_id", "ai_metadata")
       WHERE "published_at" IS NOT NULL
         AND "core_id" IS NOT NULL
         AND COALESCE("label", '') NOT IN ('collection', 'series')
         AND "ai_metadata" IS DISTINCT FROM FALSE`,
  },
  {
    table: "video_subtitles",
    name: "idx_video_subtitles_automation_published",
    sql: `CREATE INDEX IF NOT EXISTS idx_video_subtitles_automation_published
       ON "video_subtitles" ("published_at", "id", "ai_generated")
       WHERE "published_at" IS NOT NULL`,
  },
] as const

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function up(knex: any): Promise<void> {
  for (const index of INDEXES) {
    const exists = await knex.schema.hasTable(index.table)
    if (!exists) continue
    await knex.raw(index.sql)
  }
}

export async function down(knex: any): Promise<void> {
  for (const index of INDEXES) {
    await knex.raw(`DROP INDEX IF EXISTS ${index.name}`)
  }
}
