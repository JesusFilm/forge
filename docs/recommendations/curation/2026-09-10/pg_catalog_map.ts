/** Export raw local catalog facts before recommendation filtering. No mutations or network probes. */
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createWriteStream } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { once } from "node:events"
import { resolve } from "node:path"
import { parseArgs } from "node:util"
import { prisma } from "../../../../apps/admin/src/db/client"
import { env } from "../../../../apps/admin/src/config/env"

const tables = [
  "video",
  "language",
  "language_locale",
  "video_relation",
  "video_edition",
  "mux_video",
  "video_dub",
  "video_locale",
  "video_image",
  "keyword",
  "video_keyword",
  "video_origin",
  "video_subtitle",
  "video_transcript",
  "video_transcript_chunk",
] as const
const simpleTables = [
  "video",
  "language",
  "language_locale",
  "video_relation",
  "video_edition",
  "mux_video",
  "video_image",
  "keyword",
  "video_keyword",
  "video_origin",
  "video_subtitle",
] as const
const queries: Record<string, string> = Object.fromEntries(
  simpleTables.map((table) => [
    table,
    `SELECT to_jsonb(t) AS data FROM ${table} t`,
  ]),
)
queries.video_locale = `SELECT to_jsonb(t) - ARRAY['title_tsv', 'description_tsv'] AS data FROM video_locale t`
queries.video_dub = `SELECT to_jsonb(t) AS data FROM (
  SELECT d.id, d.core_id, d.source, d.slug, d.duration, d.length_in_milliseconds::text AS length_in_milliseconds,
    d.hls, d.dash, d.share, d.downloadable, d.published, d.version, d.brightcove_id, d.ai_generated,
    d.video_id, d.language_id, d.video_edition_id, d.mux_video_id, d.synced_at, d.deleted_at, d.created_at, d.updated_at,
    v.id AS joined_video_id, v.core_id AS video_core_id, v.slug AS video_slug, v.label AS video_label,
    v.deleted_at AS video_deleted_at, v.restrict_view_platforms,
    l.id AS joined_language_id, l.core_id AS language_core_id, l.slug AS language_slug, l.deleted_at AS language_deleted_at,
    e.id AS joined_edition_id, e.core_id AS edition_core_id, e.deleted_at AS edition_deleted_at,
    m.id AS joined_mux_id, m.playback_id AS mux_playback_id, m.deleted_at AS mux_deleted_at
  FROM video_dub d LEFT JOIN video v ON v.id = d.video_id
  LEFT JOIN language l ON l.id = d.language_id
  LEFT JOIN video_edition e ON e.id = d.video_edition_id
  LEFT JOIN mux_video m ON m.id = d.mux_video_id
) t`
queries.video_transcript = `SELECT to_jsonb(t) AS data FROM (
  SELECT id, video_id, video_edition_id, language, model, dimensions, embedding_provider,
    total_chunks, total_tokens, generated_at, source_kind, source_language_id, source_language_slug,
    source_format, source_provider, source_generation::text AS source_generation, generation_mode,
    created_at, updated_at FROM video_transcript
) t`
queries.transcript_chunk_counts = `SELECT to_jsonb(t) AS data FROM (
  SELECT transcript_id, language, count(*)::int AS chunks,
    count(*) FILTER (WHERE embedding IS NOT NULL)::int AS embedded_chunks,
    count(*) FILTER (WHERE cardinality(felt_needs) > 0)::int AS chunks_with_felt_needs,
    count(*) FILTER (WHERE cardinality(bible_verses) > 0)::int AS chunks_with_bible_verses
  FROM video_transcript_chunk GROUP BY transcript_id, language
) t`

async function main() {
  const { values } = parseArgs({ options: { "raw-dir": { type: "string" } } })
  assert(values["raw-dir"], "Provide --raw-dir outside /tmp")
  const target = new URL(env.DATABASE_URL)
  assert.equal(
    target.hostname,
    "127.0.0.1",
    "Only the isolated local catalog is in scope",
  )
  assert.equal(target.port, "55453")
  assert.equal(target.pathname, "/forge_feat477_20260910")
  const rawDir = resolve(values["raw-dir"])
  await mkdir(rawDir, { recursive: true })
  try {
    const manifest = await prisma.$transaction(
      async (db) => {
        await db.$executeRaw`SET TRANSACTION READ ONLY`
        // The local preview container has a small shared-memory allocation.
        // Keep this offline snapshot's aggregation from requesting parallel DSM.
        await db.$executeRaw`SET LOCAL max_parallel_workers_per_gather = 0`
        const [snapshot] = await db.$queryRaw<
          {
            database: string
            snapshotAt: string
            transactionSnapshot: string
          }[]
        >`
        SELECT current_database()::text AS database, transaction_timestamp()::text AS "snapshotAt", pg_current_snapshot()::text AS "transactionSnapshot"`
        assert.equal(snapshot.database, "forge_feat477_20260910")
        const independentCounts: Record<string, number> = {}
        for (const table of tables) {
          // Table names come exclusively from the static allowlist above.
          const [row] = await db.$queryRawUnsafe<{ count: number }[]>(
            `SELECT count(*)::int AS count FROM ${table}`,
          )
          independentCounts[table] = row.count
        }
        const [invariants] = await db.$queryRaw<Record<string, number>[]>`
        SELECT
          (SELECT count(DISTINCT video_id)::int FROM video_dub) AS "dubDistinctVideos",
          (SELECT count(DISTINCT language_id)::int FROM video_dub) AS "dubDistinctLanguages",
          (SELECT count(DISTINCT (video_id, language_id))::int FROM video_dub) AS "videoLanguagePairsIncludingNull",
          (SELECT count(*)::int FROM video_dub WHERE NULLIF(BTRIM(hls), '') IS NOT NULL) AS "dubRowsWithHls",
          (SELECT count(*)::int FROM video_dub d LEFT JOIN mux_video m ON m.id=d.mux_video_id WHERE NULLIF(BTRIM(m.playback_id), '') IS NOT NULL) AS "dubRowsWithMuxPlayback",
          (SELECT count(*)::int FROM video_dub d LEFT JOIN video v ON v.id=d.video_id WHERE v.id IS NULL) AS "orphanDubVideos",
          (SELECT count(*)::int FROM video_dub d LEFT JOIN language l ON l.id=d.language_id WHERE d.language_id IS NOT NULL AND l.id IS NULL) AS "orphanDubLanguages",
          (SELECT count(*)::int FROM video_dub d LEFT JOIN video_edition e ON e.id=d.video_edition_id WHERE d.video_edition_id IS NOT NULL AND e.id IS NULL) AS "orphanDubEditions",
          (SELECT count(*)::int FROM video_dub d LEFT JOIN mux_video m ON m.id=d.mux_video_id WHERE d.mux_video_id IS NOT NULL AND m.id IS NULL) AS "orphanDubMux",
          (SELECT count(*)::int FROM video_dub WHERE language_id IS NULL) AS "nullDubLanguage",
          (SELECT count(*)::int FROM video_dub WHERE mux_video_id IS NULL) AS "nullDubMux",
          (SELECT count(*)::int FROM video_relation r LEFT JOIN video p ON p.id=r.parent_id LEFT JOIN video c ON c.id=r.child_id WHERE p.id IS NULL OR c.id IS NULL) AS "orphanVideoRelations",
          (SELECT count(*)::int FROM video_locale x LEFT JOIN video v ON v.id=x.video_id WHERE v.id IS NULL) AS "orphanVideoLocales",
          (SELECT count(*)::int FROM video_locale x LEFT JOIN language l ON l.id=x.language_id WHERE x.language_id IS NOT NULL AND l.id IS NULL) AS "orphanDisplayLanguages",
          (SELECT count(*)::int FROM video_locale x JOIN language l ON l.id=x.language_id WHERE x.language_slug IS DISTINCT FROM l.slug OR x.language_core_id IS DISTINCT FROM l.core_id) AS "displayLanguageMirrorMismatches",
          (SELECT count(*)::int FROM video_keyword k LEFT JOIN video v ON v.id=k.video_id LEFT JOIN keyword t ON t.id=k.keyword_id WHERE v.id IS NULL OR t.id IS NULL) AS "orphanKeywordRelations",
          (SELECT count(*)::int FROM video_image i LEFT JOIN video v ON v.id=i.video_id WHERE v.id IS NULL) AS "orphanVideoImages",
          (SELECT count(*)::int FROM video_transcript t LEFT JOIN video v ON v.id=t.video_id LEFT JOIN video_edition e ON e.id=t.video_edition_id WHERE v.id IS NULL OR e.id IS NULL) AS "orphanTranscripts",
          (SELECT count(*)::int FROM video_transcript_chunk c LEFT JOIN video_transcript t ON t.id=c.transcript_id WHERE t.id IS NULL) AS "orphanTranscriptChunks"
      `
        const independentLanguageCounts = await db.$queryRaw<
          Record<string, unknown>[]
        >`
        SELECT l.id AS language_id, count(d.id)::int AS dub_rows, count(DISTINCT d.video_id)::int AS distinct_videos,
          count(DISTINCT d.video_id) FILTER (WHERE v.label IN ('featureFilm','shortFilm','episode','segment','trailer','behindTheScenes'))::int AS leaf_videos,
          count(DISTINCT d.video_id) FILTER (WHERE v.label='collection')::int AS collection_videos,
          count(DISTINCT d.video_id) FILTER (WHERE v.label='series')::int AS series_videos,
          count(DISTINCT d.video_id) FILTER (WHERE d.published AND d.deleted_at IS NULL AND v.deleted_at IS NULL AND l.deleted_at IS NULL AND (d.video_edition_id IS NULL OR e.deleted_at IS NULL)
            AND v.label IN ('featureFilm','shortFilm','episode','segment','trailer','behindTheScenes')
            AND (NULLIF(BTRIM(d.hls),'') IS NOT NULL OR (m.deleted_at IS NULL AND NULLIF(BTRIM(m.playback_id),'') IS NOT NULL)))::int AS published_leaf_declared_sources
        FROM language l LEFT JOIN video_dub d ON d.language_id=l.id LEFT JOIN video v ON v.id=d.video_id
        LEFT JOIN video_edition e ON e.id=d.video_edition_id LEFT JOIN mux_video m ON m.id=d.mux_video_id
        GROUP BY l.id ORDER BY l.id`
        const sources = await db.$queryRaw<Record<string, unknown>[]>`
        SELECT 'video' AS table_name, source::text, count(*)::int, min(synced_at)::text AS oldest_sync, max(synced_at)::text AS newest_sync FROM video GROUP BY source
        UNION ALL SELECT 'language', source::text, count(*)::int, min(synced_at)::text, max(synced_at)::text FROM language GROUP BY source
        UNION ALL SELECT 'video_dub', source::text, count(*)::int, min(synced_at)::text, max(synced_at)::text FROM video_dub GROUP BY source
        UNION ALL SELECT 'video_locale', source::text, count(*)::int, min(synced_at)::text, max(synced_at)::text FROM video_locale GROUP BY source`
        const files = []
        for (const [name, query] of Object.entries(queries)) {
          const rows =
            await db.$queryRawUnsafe<{ data: Record<string, unknown> }[]>(query)
          if (name in independentCounts)
            assert.equal(rows.length, independentCounts[name])
          const path = resolve(rawDir, `${name}.jsonl`)
          const stream = createWriteStream(path)
          const hash = createHash("sha256")
          let bytes = 0
          for (const row of rows) {
            const line = JSON.stringify(row.data) + "\n"
            hash.update(line)
            bytes += Buffer.byteLength(line)
            if (!stream.write(line)) await once(stream, "drain")
          }
          stream.end()
          await once(stream, "finish")
          files.push({
            table: name,
            rows: rows.length,
            bytes,
            sha256: hash.digest("hex"),
            path,
          })
          console.log(`Exported ${name}: ${rows.length} rows`)
        }
        return {
          schemaVersion: 1,
          source: "read-only restored local PG catalog; not production",
          ...snapshot,
          tablesInspected: tables,
          independentCounts,
          invariants,
          independentLanguageCounts,
          sourceTiers: sources,
          files,
          queries,
        }
      },
      { isolationLevel: "RepeatableRead", timeout: 600_000, maxWait: 10_000 },
    )
    await writeFile(
      resolve(rawDir, "pg-catalog-extraction-manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    )
    console.log(
      JSON.stringify({
        database: manifest.database,
        snapshotAt: manifest.snapshotAt,
        tableCounts: manifest.independentCounts,
        files: manifest.files.length,
      }),
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
