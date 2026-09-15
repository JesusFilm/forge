import { Prisma, PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { z } from "zod"
import {
  activeTranscriptContentEmbeddingWhere,
  resolveActiveContentEmbeddingContract,
} from "@/services/content-embedding-contract"

export const RecommendationCoverageInput = z.object({
  seedMediaId: z.string().trim().min(1).max(191),
  locale: z.string().trim().min(2).max(32),
  audioLanguageSlug: z.string().regex(/^[a-z0-9-]{1,64}$/),
})

export type RecommendationCoverageInput = z.infer<
  typeof RecommendationCoverageInput
>

export type RecommendationCoverageInventory = {
  observedAt: string
  seedExists: boolean
  seedTranscripts: number
  seedCompatibleTranscripts: number
  seedEmbeddedTranscripts: number
  candidateTranscripts: number
  candidateCompatibleTranscripts: number
  candidateEmbeddedVideos: number
  watchableVideos: number
  publishedLocaleVideos: number
  exactAudioVideos: number
  eligibleInventoryVideos: number
  publishedLocalesOnExactAudioVideos: { locale: string; videos: number }[]
}

/** Inventory only: this does not execute ANN retrieval or issue a delivery. */
export function recommendationCoverageQuery(
  input: RecommendationCoverageInput,
) {
  const { seedMediaId, locale, audioLanguageSlug } =
    RecommendationCoverageInput.parse(input)
  return Prisma.sql`
    WITH source_transcripts AS MATERIALIZED (
      SELECT vt.id, vt.video_id, vt.video_edition_id, vt.embedding_provider,
        vt.model, vt.dimensions, vt.embedding_native_dimensions,
        vt.embedding_transform_version
      FROM video_transcript vt
      WHERE vt.language = ${locale}
    ), compatible_transcripts AS MATERIALIZED (
      SELECT vt.* FROM source_transcripts vt
      WHERE true ${activeTranscriptContentEmbeddingWhere({ transcriptAlias: "vt" })}
    ), embedded_transcripts AS MATERIALIZED (
      SELECT vt.* FROM compatible_transcripts vt
      WHERE EXISTS (
        SELECT 1 FROM video_transcript_chunk chunk
        WHERE chunk.transcript_id = vt.id AND chunk.language = ${locale}
          AND chunk.embedding IS NOT NULL
          ${activeTranscriptContentEmbeddingWhere({ transcriptAlias: "vt", chunkAlias: "chunk" })}
      )
    ), excluded AS MATERIALIZED (
      SELECT ${seedMediaId}::text AS video_id
      UNION SELECT parent_id FROM video_relation WHERE child_id = ${seedMediaId}
      UNION SELECT child_id FROM video_relation WHERE parent_id = ${seedMediaId}
    ), candidates AS MATERIALIZED (
      SELECT vt.* FROM embedded_transcripts vt
      WHERE NOT EXISTS (SELECT 1 FROM excluded e WHERE e.video_id = vt.video_id)
    ), watchable AS MATERIALIZED (
      SELECT c.* FROM candidates c JOIN video v ON v.id = c.video_id
      WHERE v.deleted_at IS NULL AND NOT ('watch' = ANY(v.restrict_view_platforms))
    ), published AS MATERIALIZED (
      SELECT w.* FROM watchable w WHERE EXISTS (
        SELECT 1 FROM video_locale vl WHERE vl.video_id = w.video_id
          AND vl.locale = ${locale} AND vl.status = 'published'
          AND vl.deleted_at IS NULL
      )
    ), exact_audio AS MATERIALIZED (
      SELECT w.* FROM watchable w WHERE EXISTS (
        SELECT 1 FROM video_dub vd JOIN language lg ON lg.id = vd.language_id
        JOIN mux_video mv ON mv.id = vd.mux_video_id
        WHERE vd.video_edition_id = w.video_edition_id
          AND lg.slug = ${audioLanguageSlug} AND vd.deleted_at IS NULL
          AND mv.playback_id IS NOT NULL
      )
    ), available_locales AS (
      SELECT vl.locale, count(DISTINCT a.video_id)::int AS videos
      FROM exact_audio a JOIN video_locale vl ON vl.video_id = a.video_id
      WHERE vl.locale IS NOT NULL AND vl.status = 'published'
        AND vl.deleted_at IS NULL
      GROUP BY vl.locale
    )
    SELECT jsonb_build_object(
      'observedAt', statement_timestamp(),
      'seedExists', EXISTS (SELECT 1 FROM video WHERE id = ${seedMediaId}),
      'seedTranscripts', (SELECT count(*) FROM source_transcripts WHERE video_id = ${seedMediaId}),
      'seedCompatibleTranscripts', (SELECT count(*) FROM compatible_transcripts WHERE video_id = ${seedMediaId}),
      'seedEmbeddedTranscripts', (SELECT count(*) FROM embedded_transcripts WHERE video_id = ${seedMediaId}),
      'candidateTranscripts', (SELECT count(*) FROM source_transcripts s WHERE NOT EXISTS (SELECT 1 FROM excluded e WHERE e.video_id = s.video_id)),
      'candidateCompatibleTranscripts', (SELECT count(*) FROM compatible_transcripts s WHERE NOT EXISTS (SELECT 1 FROM excluded e WHERE e.video_id = s.video_id)),
      'candidateEmbeddedVideos', (SELECT count(DISTINCT video_id) FROM candidates),
      'watchableVideos', (SELECT count(DISTINCT video_id) FROM watchable),
      'publishedLocaleVideos', (SELECT count(DISTINCT video_id) FROM published),
      'exactAudioVideos', (SELECT count(DISTINCT video_id) FROM exact_audio),
      'eligibleInventoryVideos', (SELECT count(DISTINCT p.video_id) FROM published p JOIN exact_audio a ON a.id = p.id),
      'publishedLocalesOnExactAudioVideos', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.locale) FROM available_locales l), '[]'::jsonb)
    ) AS inventory
  `
}

export function coverageBlockers(inventory: RecommendationCoverageInventory) {
  const blockers: string[] = []
  if (!inventory.seedExists) blockers.push("seed_media_missing")
  else if (!inventory.seedTranscripts) blockers.push("seed_transcript_missing")
  else if (!inventory.seedCompatibleTranscripts)
    blockers.push("seed_contract_incompatible")
  else if (!inventory.seedEmbeddedTranscripts)
    blockers.push("seed_chunks_unavailable")

  if (!inventory.candidateTranscripts)
    blockers.push("candidate_transcripts_missing")
  else if (!inventory.candidateCompatibleTranscripts)
    blockers.push("candidate_contract_incompatible")
  else if (!inventory.candidateEmbeddedVideos)
    blockers.push("candidate_chunks_unavailable")
  else if (!inventory.watchableVideos) blockers.push("no_watchable_candidates")
  else {
    if (!inventory.publishedLocaleVideos)
      blockers.push("published_metadata_missing")
    if (!inventory.exactAudioVideos) blockers.push("exact_audio_unavailable")
    if (
      inventory.publishedLocaleVideos &&
      inventory.exactAudioVideos &&
      !inventory.eligibleInventoryVideos
    ) {
      blockers.push("publication_audio_no_overlap")
    }
  }
  return blockers
}

export const COVERAGE_CONNECTION_OPTIONS = {
  connectionTimeoutMillis: 10_000,
  query_timeout: 7_000,
  statement_timeout: 5_000,
  lock_timeout: 1_000,
  application_name: "forge_recommendation_coverage",
  options: "-c default_transaction_read_only=on",
} as const

/** A single-connection pool and a repeatable, read-only snapshot. */
export async function diagnoseRecommendationCoverage(
  connectionString: string,
  rawInput: RecommendationCoverageInput,
) {
  const input = RecommendationCoverageInput.parse(rawInput)
  const url = new URL(connectionString)
  // URL-level settings must not override this diagnostic's bounded read-only
  // session. The remaining connection parameters retain their normal meaning.
  for (const key of [
    "options",
    "query_timeout",
    "connectionTimeoutMillis",
    "statement_timeout",
    "lock_timeout",
    "application_name",
    "schema",
    "connection_limit",
    "pool_timeout",
    "pgbouncer",
  ]) {
    url.searchParams.delete(key)
  }
  const client = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: url.toString(),
      ...COVERAGE_CONNECTION_OPTIONS,
      max: 1,
    }),
  })
  try {
    return await client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`
        const contract = await resolveActiveContentEmbeddingContract(tx)
        const [row] = await tx.$queryRaw<
          { inventory: RecommendationCoverageInventory }[]
        >(recommendationCoverageQuery(input))
        const inventory = row!.inventory
        return {
          input,
          contract,
          inventory,
          blockers: coverageBlockers(inventory),
          interpretation:
            "Current inventory, not historical input reconstruction, ANN recall, or a guaranteed delivery. Audio is the explicit audit input.",
        }
      },
      { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 15_000 },
    )
  } finally {
    await client.$disconnect()
  }
}
