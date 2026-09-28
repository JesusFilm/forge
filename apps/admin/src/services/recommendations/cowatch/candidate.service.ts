import { Prisma, type PrismaClient } from "@prisma/client"
import { buildSemanticCandidateMuxThumbnailUrl } from "../delivery-retriever"
import {
  boundedScore,
  type CandidateNomination,
  type CandidatePresentation,
} from "../candidate"
import type {
  ShadowGenerator,
  ShadowGeneratorContext,
} from "../shadow-evaluation/service"
import {
  loadCowatchInspection,
  loadValidatedCowatchProfileInterests,
} from "./inspection.service"
import { COWATCH_FEATURE_VERSION, COWATCH_SHADOW_GENERATOR_KEY } from "./graph"

export { COWATCH_SHADOW_GENERATOR_KEY } from "./graph"

export type CowatchPlayableRow = Readonly<{
  videoId: string
  videoCoreId: string | null
  videoSlug: string
  videoTitle: string
  playbackId: string
  durationSeconds: number | null
  imageUrl: string | null
}>

/** Shadow-only adapter. It never participates in live delivery. */
export function createDatabaseCowatchShadowGenerator(
  prisma: PrismaClient,
  now: () => Date = () => new Date(),
): ShadowGenerator {
  return async (context) => {
    const evaluatedAt = now()
    const profileInterests = await loadValidatedCowatchProfileInterests(
      prisma,
      context.contextProjection.ref,
      evaluatedAt,
    )
    const inspection = await loadCowatchInspection(prisma, {
      now: evaluatedAt,
      sourceMediaId: context.seedMediaId,
      additionalAnchors: profileInterests.map((interest) => ({
        mediaId: interest.mediaId,
        kind: interest.kind,
        interestOrdinal: interest.interestOrdinal,
        weight: interest.weight,
      })),
    })
    const fallback = liveBaselineNominations(context)
    if (inspection.state !== "current" || inspection.candidates.length === 0) {
      return {
        nominations: fallback,
        projectionCapturedAt: inspection.publishedAt,
        cohortQuality: null,
        sourceFailureReason:
          inspection.state !== "current"
            ? "cowatch_generation_unavailable_or_stale"
            : "cowatch_supported_edges_sparse",
      }
    }
    const selected = inspection.candidates
      .map((edge) => {
        const anchor = inspection.anchors.find(
          (candidate) => candidate.mediaId === edge.sourceMediaId,
        )
        return {
          edge,
          anchor,
          score: boundedScore(
            edge.confidence *
              Math.min(2, edge.popularityCorrectedLift) *
              edge.recencyWeight *
              edge.qualityWeight *
              (anchor?.weight ?? 1),
          ),
        }
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.edge.targetMediaId.localeCompare(b.edge.targetMediaId) ||
          a.edge.sourceMediaId.localeCompare(b.edge.sourceMediaId),
      )
      .filter(
        (entry, index, entries) =>
          entries.findIndex(
            (other) => other.edge.targetMediaId === entry.edge.targetMediaId,
          ) === index,
      )
      .slice(0, 12)
    const playable = await loadCowatchPlayableRows(
      prisma,
      selected.map(({ edge }) => edge.targetMediaId),
      context,
    )
    const byId = new Map(playable.map((row) => [row.videoId, row]))
    const nominations: CandidateNomination[] = selected.flatMap(
      ({ edge, anchor, score }, index) => {
        const row = byId.get(edge.targetMediaId)
        if (!row) return []
        const presentation: CandidatePresentation = {
          videoSlug: row.videoSlug.slice(0, 191),
          videoTitle: row.videoTitle.slice(0, 512),
          imageUrl:
            row.imageUrl ||
            buildSemanticCandidateMuxThumbnailUrl(row.playbackId, 0),
          sceneIndex: 0,
          description: "",
          startSeconds: 0,
          endSeconds: null,
          durationSeconds: row.durationSeconds,
          themes: [],
          demographics: [],
          spiritualContext: [],
          playbackId: row.playbackId,
          locale: context.locale,
          audioLanguageSlug: context.audioLanguageSlug,
          watchPlayable: true,
          localePublished: true,
        }
        return [
          {
            nominationKey:
              `cowatch:${index + 1}:${edge.sourceMediaId}:${edge.targetMediaId}`.slice(
                0,
                191,
              ),
            targetMediaId: edge.targetMediaId,
            canonicalIdentity: {
              videoId: edge.targetMediaId,
              videoCoreId: row.videoCoreId,
              videoTitle: row.videoTitle,
              embeddingText: null,
            },
            presentation,
            action: { kind: "scene_start" as const, startSeconds: 0 },
            source: {
              generator: "directional-cowatch",
              generatorVersion: COWATCH_SHADOW_GENERATOR_KEY,
              rank: index + 1,
              score,
              evidence: {
                featureVersion: COWATCH_FEATURE_VERSION,
                generation: edge.generation,
                support: edge.distinctViewerSupport,
                confidence: edge.confidence,
                lift: edge.popularityCorrectedLift,
                recencyWeight: edge.recencyWeight,
                qualityWeight: edge.qualityWeight,
                contamination: edge.contamination,
                anchorMediaId: edge.sourceMediaId,
                anchorKind: anchor?.kind ?? "seed",
                anchorWeight: anchor?.weight ?? 1,
                interestOrdinal: anchor?.interestOrdinal ?? null,
              },
              rejectionReason: null,
            },
          },
        ]
      },
    )
    return {
      nominations: [...fallback, ...nominations],
      projectionCapturedAt: inspection.publishedAt,
      cohortQuality: boundedScore(
        nominations.length / Math.max(1, inspection.candidates.length),
      ),
      sourceFailureReason:
        nominations.length === 0 ? "cowatch_unplayable" : null,
    }
  }
}

export async function loadCowatchPlayableRows(
  prisma: Pick<PrismaClient, "$queryRaw">,
  targetMediaIds: readonly string[],
  context: Pick<ShadowGeneratorContext, "locale" | "audioLanguageSlug">,
): Promise<CowatchPlayableRow[]> {
  if (targetMediaIds.length === 0) return []
  return prisma.$queryRaw<CowatchPlayableRow[]>(Prisma.sql`
    SELECT video.id AS "videoId",
      video.core_id AS "videoCoreId",
      video.slug AS "videoSlug",
      display.title AS "videoTitle",
      playable.playback_id AS "playbackId",
      playable.duration_seconds AS "durationSeconds",
      image.image_url AS "imageUrl"
    FROM video
    JOIN LATERAL (
      SELECT locale.title
      FROM video_locale locale
      WHERE locale.video_id = video.id
        AND locale.locale = ${context.locale}
        AND locale.status = 'published'
        AND locale.deleted_at IS NULL
      ORDER BY CASE WHEN locale.language_slug = ${context.audioLanguageSlug} THEN 0 ELSE 1 END,
        locale.id
      LIMIT 1
    ) display ON true
    JOIN LATERAL (
      SELECT mux.playback_id,
        COALESCE(ROUND(dub.length_in_milliseconds / 1000.0)::int, dub.duration) AS duration_seconds
      FROM video_dub dub
      JOIN language ON language.id = dub.language_id
        AND language.slug = ${context.audioLanguageSlug}
      JOIN mux_video mux ON mux.id = dub.mux_video_id
        AND mux.playback_id IS NOT NULL
      WHERE dub.video_id = video.id
        AND dub.deleted_at IS NULL
      ORDER BY dub.published DESC NULLS LAST, dub.updated_at DESC, dub.id
      LIMIT 1
    ) playable ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(image.mobile_cinematic_high, ''),
        NULLIF(image.video_still, ''), NULLIF(image.thumbnail, ''),
        NULLIF(image.url, '')) AS image_url
      FROM video_image image
      WHERE image.video_id = video.id AND image.deleted_at IS NULL
      ORDER BY image.created_at, image.id
      LIMIT 1
    ) image ON true
    WHERE video.id IN (${Prisma.join(targetMediaIds)})
      AND video.deleted_at IS NULL
      AND NOT ('watch' = ANY(video.restrict_view_platforms))
    ORDER BY array_position(ARRAY[${Prisma.join(targetMediaIds)}]::text[], video.id)
    LIMIT 12
  `)
}

function liveBaselineNominations(
  context: ShadowGeneratorContext,
): CandidateNomination[] {
  return context.liveItems.map((item, index) => ({
    nominationKey: `cowatch-live:${index + 1}:${item.targetMediaId}`.slice(
      0,
      191,
    ),
    targetMediaId: item.targetMediaId,
    canonicalIdentity: {
      videoId: item.targetMediaId,
      videoCoreId: null,
      videoTitle: item.presentation.videoTitle,
      embeddingText: null,
    },
    presentation: item.presentation,
    action: {
      kind: "scene_start" as const,
      startSeconds: item.presentation.startSeconds,
    },
    source: {
      generator: "live-baseline",
      generatorVersion: "observed-live-request-v1",
      rank: index + 1,
      score: boundedScore(1 - index / Math.max(1, context.liveItems.length)),
      evidence: {
        livePosition: item.position,
        liveManifestId: context.manifestId,
      },
      rejectionReason: null,
    },
  }))
}
