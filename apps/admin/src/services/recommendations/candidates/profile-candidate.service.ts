import { Prisma, type PrismaClient } from "@prisma/client"
import {
  boundedScore,
  boundedSeconds,
  type CandidateNomination,
  type CandidatePresentation,
} from "../candidate"
import { buildSemanticCandidateMuxThumbnailUrl } from "../delivery-retriever"
import {
  PROFILE_CLUSTERING_VERSION,
  PROFILE_PROJECTION_VERSION,
} from "../profiles/projection"
import type {
  ShadowGenerator,
  ShadowGeneratorContext,
} from "../shadow-evaluation/service"

export const MULTI_INTEREST_PROFILE_GENERATOR_VERSION =
  "multi-interest-profile-candidate-v1" as const
export const MULTI_INTEREST_PROFILE_MANIFEST_ID =
  "multi-interest-profile-shadow-v1" as const
export const MULTI_INTEREST_PROFILE_PROJECTION_VERSION =
  PROFILE_PROJECTION_VERSION
export const MULTI_INTEREST_PROFILE_CLUSTERING_VERSION =
  PROFILE_CLUSTERING_VERSION
export const PROFILE_CANDIDATES_PER_INTEREST = 8
const MAX_PROFILE_INTERESTS = 5

export type PublishedProfileProjection = Readonly<{
  id: string
  scope?: "durable" | "session"
  generation?: number
  projectionVersion: string
  inputDigest: string
  publishedAt: Date
  expiresAt: Date
  cohortQuality: number
  sessionIntentPresent?: boolean
  interests: ReadonlyArray<
    Readonly<{
      ordinal: number
      kind: "durable" | "session"
      vectorText: string
    }>
  >
}>

export type LiveProfileCandidateResult = Readonly<{
  projection: Omit<PublishedProfileProjection, "interests"> & {
    interestCount: number
  }
  nominations: CandidateNomination[]
}>

export type ProfileCandidateRow = Readonly<{
  interest_ordinal: number
  interest_kind: "durable" | "session"
  interest_rank: number
  source_rank: number
  video_id: string
  video_core_id: string | null
  video_slug: string
  video_title: string | null
  scene_index: number
  description: string
  start_seconds: number | string
  end_seconds: number | string | null
  duration_seconds: number | string | null
  themes: string[] | null
  demographics: string[] | null
  spiritual_context: string[] | null
  playback_id: string
  image_url: string | null
  similarity: number | string
}>

type ProfileGeneratorDependencies = Readonly<{
  loadProjection: (
    context: ShadowGeneratorContext,
  ) => Promise<PublishedProfileProjection | null>
  queryCandidates: (input: {
    projection: PublishedProfileProjection
    context: ShadowGeneratorContext
  }) => Promise<ProfileCandidateRow[]>
}>

export const PROFILE_SOURCE_ABSENCE_REASONS = [
  "profile_projection_unavailable",
  "profile_candidates_sparse",
] as const
export type ProfileSourceAbsenceReason =
  (typeof PROFILE_SOURCE_ABSENCE_REASONS)[number]

export function createProfileSourceNominationGenerator(
  dependencies: ProfileGeneratorDependencies,
): ShadowGenerator {
  return async (context) => {
    const projection = await dependencies.loadProjection(context)
    if (
      !projection ||
      projection.expiresAt <= new Date() ||
      projection.interests.length === 0
    ) {
      return sourceLocalAbsence("profile_projection_unavailable")
    }
    const rows = await dependencies.queryCandidates({ projection, context })
    const nominations = rows.slice(0, 64).map((row): CandidateNomination => {
      const presentation = toPresentation(row, context)
      return {
        nominationKey:
          `multi-interest:${row.interest_ordinal}:${row.source_rank}:${row.video_id}`.slice(
            0,
            191,
          ),
        targetMediaId: row.video_id,
        canonicalIdentity: {
          videoId: row.video_id,
          videoCoreId: row.video_core_id,
          videoTitle: row.video_title,
          embeddingText: null,
        },
        presentation,
        action: {
          kind: "scene_start",
          startSeconds: presentation.startSeconds,
        },
        source: {
          generator: "multi-interest-profile",
          generatorVersion: MULTI_INTEREST_PROFILE_GENERATOR_VERSION,
          rank: Math.max(1, Math.min(64, row.source_rank)),
          score: boundedScore(Number(row.similarity)),
          evidence: {
            interestOrdinal: row.interest_ordinal,
            interestKind: row.interest_kind,
            interestRank: row.interest_rank,
            projectionVersion: projection.projectionVersion,
            projectionDigest: projection.inputDigest.slice(0, 12),
            manifestId: context.manifestId,
          },
          rejectionReason: null,
        },
      }
    })
    if (nominations.length === 0) {
      return sourceLocalAbsence("profile_candidates_sparse")
    }
    return {
      nominations,
      projectionCapturedAt: projection.publishedAt,
      cohortQuality: boundedScore(projection.cohortQuality),
      sourceFailureReason: null,
    }
  }
}

export function createDatabaseProfileSourceNominationGenerator(
  prisma: Pick<PrismaClient, "$queryRaw">,
  now: () => Date = () => new Date(),
): ShadowGenerator {
  return createProfileSourceNominationGenerator({
    loadProjection: async (context) => {
      if (!context.contextProjection.ref) return null
      const rows = await prisma.$queryRaw<
        Array<{
          id: string
          projectionVersion: string
          inputDigest: string
          publishedAt: Date
          expiresAt: Date
          cohortQuality: number
          ordinal: number
          kind: "durable" | "session"
          vectorText: string
        }>
      >(Prisma.sql`
        SELECT
          generation.id,
          generation.projection_version AS "projectionVersion",
          generation.input_digest AS "inputDigest",
          generation.published_at AS "publishedAt",
          generation.expires_at AS "expiresAt",
          generation.cohort_quality AS "cohortQuality",
          interest.interest_ordinal AS ordinal,
          interest.kind,
          interest.embedding::text AS "vectorText"
        FROM recommendation_profile_projection_generation generation
        JOIN recommendation_profile_interest interest
          ON interest.generation_id = generation.id
        LEFT JOIN recommendation_profile profile
          ON profile.id = generation.profile_id
        WHERE generation.id = ${context.contextProjection.ref}
          AND generation.state = 'published'
          AND generation.expires_at > ${now()}
          AND interest.expires_at > ${now()}
          AND (
            generation.profile_id IS NULL
            OR (
              profile.state = 'active'
              AND profile.privacy_generation = generation.privacy_generation
              AND profile.expires_at > ${now()}
            )
          )
        ORDER BY
          CASE interest.kind WHEN 'session' THEN 0 ELSE 1 END,
          interest.interest_ordinal
        LIMIT ${MAX_PROFILE_INTERESTS}
      `)
      const first = rows[0]
      if (!first) return null
      return {
        id: first.id,
        projectionVersion: first.projectionVersion,
        inputDigest: first.inputDigest,
        publishedAt: first.publishedAt,
        expiresAt: first.expiresAt,
        cohortQuality: Number(first.cohortQuality),
        interests: rows.map((row) => ({
          ordinal: row.ordinal,
          kind: row.kind,
          vectorText: row.vectorText,
        })),
      }
    },
    queryCandidates: ({ projection, context }) =>
      queryProfileCandidates(prisma, { projection, context }),
  })
}

/**
 * Resolves only the atomic published projection for the current privacy scope.
 * Durable consent wins when the opaque digest names an active generation;
 * otherwise the request remains session-only. No raw identity is returned.
 */
export async function getLiveProfileCandidates(
  prisma: Pick<PrismaClient, "$queryRaw">,
  input: {
    sessionDigest: string
    profileTokenDigest: string | null
    context: Omit<ShadowGeneratorContext, "contextProjection" | "liveItems">
    now: Date
  },
): Promise<LiveProfileCandidateResult | null> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string
      scope: "durable" | "session"
      generation: number
      projectionVersion: string
      inputDigest: string
      publishedAt: Date
      expiresAt: Date
      cohortQuality: number
      sessionIntentPresent: boolean
      ordinal: number
      kind: "durable" | "session"
      vectorText: string
    }>
  >(Prisma.sql`
    WITH selected_generation AS MATERIALIZED (
      SELECT generation.id, 0 AS priority
      FROM recommendation_profile profile
      JOIN recommendation_profile_projection_pointer pointer
        ON pointer.profile_id = profile.id
        AND pointer.privacy_generation = profile.privacy_generation
        AND pointer.scope = 'durable'
      JOIN recommendation_profile_projection_generation generation
        ON generation.id = pointer.generation_id
      WHERE ${input.profileTokenDigest}::text IS NOT NULL
        AND profile.token_digest = ${input.profileTokenDigest}
        AND profile.state = 'active'
        AND profile.expires_at > ${input.now}
        AND generation.state = 'published'
        AND generation.manifest_id = ${MULTI_INTEREST_PROFILE_MANIFEST_ID}
        AND generation.projection_version = ${MULTI_INTEREST_PROFILE_PROJECTION_VERSION}
        AND generation.clustering_version = ${MULTI_INTEREST_PROFILE_CLUSTERING_VERSION}
        AND generation.profile_id = profile.id
        AND generation.privacy_generation = profile.privacy_generation
        AND generation.expires_at > ${input.now}
      UNION ALL
      SELECT generation.id, 1 AS priority
      FROM recommendation_profile_projection_pointer pointer
      JOIN recommendation_profile_projection_generation generation
        ON generation.id = pointer.generation_id
      WHERE pointer.scope = 'session'
        AND pointer.session_digest = ${input.sessionDigest}
        AND generation.state = 'published'
        AND generation.manifest_id = ${MULTI_INTEREST_PROFILE_MANIFEST_ID}
        AND generation.projection_version = ${MULTI_INTEREST_PROFILE_PROJECTION_VERSION}
        AND generation.clustering_version = ${MULTI_INTEREST_PROFILE_CLUSTERING_VERSION}
        AND generation.session_digest = ${input.sessionDigest}
        AND generation.expires_at > ${input.now}
      ORDER BY priority
      LIMIT 1
    )
    SELECT
      generation.id,
      generation.scope::text AS scope,
      generation.generation,
      generation.projection_version AS "projectionVersion",
      generation.input_digest AS "inputDigest",
      generation.published_at AS "publishedAt",
      generation.expires_at AS "expiresAt",
      generation.cohort_quality AS "cohortQuality",
      generation.session_intent_present AS "sessionIntentPresent",
      interest.interest_ordinal AS ordinal,
      interest.kind::text AS kind,
      interest.embedding::text AS "vectorText"
    FROM selected_generation selected
    JOIN recommendation_profile_projection_generation generation
      ON generation.id = selected.id
    JOIN recommendation_profile_interest interest
      ON interest.generation_id = generation.id
      AND interest.expires_at > ${input.now}
    ORDER BY
      CASE interest.kind WHEN 'session' THEN 0 ELSE 1 END,
      interest.interest_ordinal
    LIMIT ${MAX_PROFILE_INTERESTS}
  `)
  const first = rows[0]
  if (!first) return null
  const projection: PublishedProfileProjection = {
    id: first.id,
    scope: first.scope,
    generation: first.generation,
    projectionVersion: first.projectionVersion,
    inputDigest: first.inputDigest,
    publishedAt: first.publishedAt,
    expiresAt: first.expiresAt,
    cohortQuality: Number(first.cohortQuality),
    sessionIntentPresent: first.sessionIntentPresent,
    interests: rows.map((row) => ({
      ordinal: row.ordinal,
      kind: row.kind,
      vectorText: row.vectorText,
    })),
  }
  const context: ShadowGeneratorContext = {
    ...input.context,
    contextProjection: {
      ref: projection.id,
      version: projection.projectionVersion,
      digest: projection.inputDigest,
      privacyGeneration: null,
    },
    liveItems: [],
  }
  const generated = await createProfileSourceNominationGenerator({
    loadProjection: async () => projection,
    queryCandidates: ({ projection: selected, context: candidateContext }) =>
      queryProfileCandidates(prisma, {
        projection: selected,
        context: candidateContext,
      }),
  })(context)
  if (
    generated.nominations.length === 0 ||
    generated.nominations.some(
      (nomination) => nomination.source.generator !== "multi-interest-profile",
    )
  ) {
    return null
  }
  const { interests: privateInterests, ...publicProjection } = projection
  return {
    projection: {
      ...publicProjection,
      interestCount: privateInterests.length,
    },
    nominations: generated.nominations,
  }
}

export async function queryProfileCandidates(
  prisma: Pick<PrismaClient, "$queryRaw">,
  input: {
    projection: PublishedProfileProjection
    context: ShadowGeneratorContext
  },
): Promise<ProfileCandidateRow[]> {
  const interests = input.projection.interests.slice(0, MAX_PROFILE_INTERESTS)
  if (interests.length === 0) return []
  const values = Prisma.join(
    interests.map(
      (interest) =>
        Prisma.sql`(${interest.ordinal}::int, ${interest.kind}::text, ${interest.vectorText}::public.vector(1536))`,
    ),
  )
  return prisma.$queryRaw<ProfileCandidateRow[]>(Prisma.sql`
    WITH interest_vectors(interest_ordinal, interest_kind, embedding) AS (
      VALUES ${values}
    ),
    excluded_video_ids AS MATERIALIZED (
      SELECT ${input.context.seedMediaId}::text AS id
      UNION
      SELECT parent_id FROM video_relation WHERE child_id = ${input.context.seedMediaId}
      UNION
      SELECT child_id FROM video_relation WHERE parent_id = ${input.context.seedMediaId}
    ),
    nearest AS MATERIALIZED (
      SELECT
        interest.interest_ordinal,
        interest.interest_kind,
        candidate.id AS chunk_id,
        candidate.transcript_id,
        candidate.chunk_index,
        candidate.content_summary,
        candidate.raw_source_text,
        candidate.text,
        candidate.start_seconds,
        candidate.end_seconds,
        candidate.felt_needs,
        candidate.demographics,
        candidate.spiritual_context,
        1 - (
          candidate.embedding OPERATOR(public.<=>) interest.embedding
        ) AS similarity
      FROM interest_vectors interest
      CROSS JOIN LATERAL (
        SELECT candidate.*
        FROM video_transcript_chunk candidate
        JOIN video_transcript transcript ON transcript.id = candidate.transcript_id
        WHERE candidate.embedding IS NOT NULL
          AND candidate.language = ${input.context.locale}
          AND candidate.model = 'embeddings'
          AND candidate.dimensions = 1536
          AND transcript.language = ${input.context.locale}
          AND transcript.embedding_provider = 'jesus-film-ai-gateway'
          AND transcript.model = 'embeddings'
          AND transcript.dimensions = 1536
          AND transcript.embedding_native_dimensions = 1536
          AND transcript.embedding_transform_version IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM excluded_video_ids excluded
            WHERE excluded.id = transcript.video_id
          )
        ORDER BY
          candidate.embedding OPERATOR(public.<=>) interest.embedding,
          candidate.id
        LIMIT ${PROFILE_CANDIDATES_PER_INTEREST * 3}
      ) candidate
    ),
    hydrated AS MATERIALIZED (
      SELECT DISTINCT ON (nearest.interest_ordinal, transcript.video_id)
        nearest.interest_ordinal,
        nearest.interest_kind,
        transcript.video_id,
        video.core_id AS video_core_id,
        video.slug AS video_slug,
        display_locale.title AS video_title,
        nearest.chunk_index AS scene_index,
        COALESCE(NULLIF(nearest.content_summary, ''), NULLIF(nearest.raw_source_text, ''), nearest.text) AS description,
        COALESCE(nearest.start_seconds, 0) AS start_seconds,
        nearest.end_seconds,
        mux.duration_seconds,
        nearest.felt_needs AS themes,
        nearest.demographics,
        nearest.spiritual_context,
        mux.playback_id,
        nearest.similarity
      FROM nearest
      JOIN video_transcript transcript ON transcript.id = nearest.transcript_id
      JOIN video ON video.id = transcript.video_id
        AND video.deleted_at IS NULL
        AND NOT ('watch' = ANY(video.restrict_view_platforms))
      JOIN LATERAL (
        SELECT locale_display.title
        FROM video_locale locale_display
        WHERE locale_display.video_id = video.id
          AND locale_display.locale = ${input.context.locale}
          AND locale_display.status = 'published'
          AND locale_display.deleted_at IS NULL
        ORDER BY
          CASE
            WHEN locale_display.language_slug = ${input.context.audioLanguageSlug}
              THEN 0
            ELSE 1
          END,
          locale_display.language_core_id ASC NULLS LAST,
          locale_display.language_slug ASC NULLS LAST,
          locale_display.id ASC
        LIMIT 1
      ) display_locale ON true
      JOIN LATERAL (
        SELECT
          mux_video.playback_id,
          COALESCE(
            ROUND(dub.length_in_milliseconds / 1000.0)::int,
            dub.duration
          ) AS duration_seconds
        FROM video_dub dub
        JOIN language ON language.id = dub.language_id
          AND language.slug = ${input.context.audioLanguageSlug}
        JOIN mux_video ON mux_video.id = dub.mux_video_id
          AND mux_video.playback_id IS NOT NULL
        WHERE dub.video_edition_id = transcript.video_edition_id
          AND dub.deleted_at IS NULL
        ORDER BY dub.published DESC NULLS LAST, dub.updated_at DESC, dub.id
        LIMIT 1
      ) mux ON true
      WHERE EXISTS (
        SELECT 1
        FROM video_locale locale_visible
        WHERE locale_visible.video_id = video.id
          AND locale_visible.locale = ${input.context.locale}
          AND locale_visible.status = 'published'
          AND locale_visible.deleted_at IS NULL
      )
      ORDER BY nearest.interest_ordinal, transcript.video_id,
        nearest.similarity DESC, nearest.chunk_index, nearest.chunk_id
    ),
    per_interest_ranked AS MATERIALIZED (
      SELECT hydrated.*, row_number() OVER (
        PARTITION BY interest_ordinal
        ORDER BY similarity DESC, video_id, scene_index
      ) AS interest_rank
      FROM hydrated
    ),
    bounded_interests AS MATERIALIZED (
      SELECT *
      FROM per_interest_ranked
      WHERE interest_rank <= ${PROFILE_CANDIDATES_PER_INTEREST}
    ),
    globally_ranked AS MATERIALIZED (
      SELECT bounded_interests.*, row_number() OVER (
        ORDER BY
          interest_rank,
          CASE interest_kind WHEN 'session' THEN 0 ELSE 1 END,
          interest_ordinal,
          similarity DESC,
          video_id,
          scene_index
      ) AS source_rank
      FROM bounded_interests
    )
    SELECT
      globally_ranked.interest_ordinal,
      globally_ranked.interest_kind,
      globally_ranked.interest_rank::int,
      globally_ranked.source_rank::int,
      globally_ranked.video_id,
      globally_ranked.video_core_id,
      globally_ranked.video_slug,
      globally_ranked.video_title,
      globally_ranked.scene_index,
      globally_ranked.description,
      globally_ranked.start_seconds,
      globally_ranked.end_seconds,
      globally_ranked.duration_seconds,
      globally_ranked.themes,
      globally_ranked.demographics,
      globally_ranked.spiritual_context,
      globally_ranked.playback_id,
      selected_image.image_url,
      globally_ranked.similarity
    FROM globally_ranked
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        NULLIF(image.mobile_cinematic_high, ''), NULLIF(image.video_still, ''),
        NULLIF(image.thumbnail, ''), NULLIF(image.url, '')
      ) AS image_url
      FROM video_image image
      WHERE image.video_id = globally_ranked.video_id
        AND image.deleted_at IS NULL
      ORDER BY image.created_at, image.id
      LIMIT 1
    ) selected_image ON true
    ORDER BY globally_ranked.source_rank
    LIMIT 64
  `)
}

function sourceLocalAbsence(
  sourceFailureReason: ProfileSourceAbsenceReason,
): Awaited<ReturnType<ShadowGenerator>> {
  return {
    nominations: [],
    projectionCapturedAt: null,
    cohortQuality: null,
    sourceFailureReason,
  }
}

function toPresentation(
  row: ProfileCandidateRow,
  context: ShadowGeneratorContext,
): CandidatePresentation {
  const startSeconds = boundedSeconds(Number(row.start_seconds))
  return {
    videoSlug: row.video_slug.slice(0, 191),
    videoTitle: (row.video_title ?? "").slice(0, 512),
    imageUrl:
      row.image_url?.trim() ||
      buildSemanticCandidateMuxThumbnailUrl(row.playback_id, startSeconds),
    sceneIndex: Math.max(0, Math.trunc(row.scene_index)),
    description: row.description.slice(0, 1_000),
    startSeconds,
    endSeconds:
      row.end_seconds == null ? null : boundedSeconds(Number(row.end_seconds)),
    durationSeconds:
      row.duration_seconds == null
        ? null
        : boundedSeconds(Number(row.duration_seconds)),
    themes: (row.themes ?? []).slice(0, 16).map((value) => value.slice(0, 64)),
    demographics: (row.demographics ?? [])
      .slice(0, 16)
      .map((value) => value.slice(0, 64)),
    spiritualContext: (row.spiritual_context ?? [])
      .slice(0, 16)
      .map((value) => value.slice(0, 64)),
    playbackId: row.playback_id.slice(0, 512),
    locale: context.locale,
    audioLanguageSlug: context.audioLanguageSlug,
    watchPlayable: true,
    localePublished: true,
  }
}
