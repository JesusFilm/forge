import { Prisma, type PrismaClient } from "@prisma/client"
import { CURATED_POOL_POINTER_ID } from "./curated-pools.types"

type RuntimePool = {
  id: string
  generationId: string
  locale: string
  audioLanguageSlug: string
  coreLanguageId: string
  poolKey: string
  videoIds: string[]
}
type RuntimeMembership = {
  videoId: string
  editorialRank: number
  themeKeys: string[]
}
type CuratedRuntimeSnapshot = {
  version: string
  pools: RuntimePool[]
  memberships: RuntimeMembership[]
}

/** Keep the pointer, pool identities and membership metadata in one snapshot.
 * Live video eligibility is still hydrated separately on every request.
 */
export async function readCuratedRuntimeSnapshot(
  db: Pick<PrismaClient, "$queryRaw">,
  input: {
    locale: string
    audioLanguageSlug: string
    interestVideoIds?: readonly string[]
  },
): Promise<CuratedRuntimeSnapshot | null> {
  const [snapshot] = await db.$queryRaw<CuratedRuntimeSnapshot[]>(Prisma.sql`
    WITH active AS MATERIALIZED (
      SELECT pointer.generation_id, generation.version
      FROM recommendation_curated_pointer pointer
      JOIN recommendation_curated_generation generation
        ON generation.id = pointer.generation_id
      WHERE pointer.id = ${CURATED_POOL_POINTER_ID}
    ), pools AS MATERIALIZED (
      SELECT pool.*
      FROM recommendation_curated_pool pool
      JOIN active ON active.generation_id = pool.generation_id
      WHERE pool.locale = ${input.locale}
        AND pool.audio_language_slug = ${input.audioLanguageSlug}
      ORDER BY pool.pool_key ASC
      LIMIT 9
    )
    SELECT active.version,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', id, 'generationId', generation_id,
          'locale', locale, 'audioLanguageSlug', audio_language_slug,
          'coreLanguageId', core_language_id, 'poolKey', pool_key,
          'videoIds', video_ids
        ) ORDER BY pool_key)
        FROM pools
      ), '[]'::jsonb) AS pools,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'videoId', member.video_id, 'editorialRank', member.editorial_rank,
          'themeKeys', member.theme_keys
        ) ORDER BY member.video_id)
        FROM recommendation_curated_membership member
        WHERE member.generation_id = active.generation_id
          AND (
            member.video_id = ANY(${[...(input.interestVideoIds ?? [])]}::text[])
            OR member.video_id IN (SELECT unnest(video_ids) FROM pools)
          )
      ), '[]'::jsonb) AS memberships
    FROM active
  `)
  return snapshot ?? null
}
