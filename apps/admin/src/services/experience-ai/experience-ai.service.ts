import { Prisma, VideoLabel, type PrismaClient } from "@prisma/client"

import { toPgVector } from "@/db/pgvector"
import { generateExperienceEmbedding } from "@/services/embeddings.service"

import type { VideoCandidate } from "@forge/experience-schema"
export {
  normalizeExperienceDraft,
  ExperienceAiNormalizationError,
  type ExperienceAiNormalizationErrorCode,
  type NormalizedExperienceDraft,
} from "./experience-ai-normalize"

const DEFAULT_CANDIDATE_LIMIT = 12
const CANDIDATE_FETCH_WINDOW = 80
const VECTOR_SEARCH_EF_SEARCH = 80
const CONTENT_EMBEDDING_PROVIDER = "jesus-film-ai-gateway"
const CONTENT_EMBEDDING_MODEL = "embeddings"
const CONTENT_EMBEDDING_DIMENSIONS = 1536

// Web's videoHero plays only the HLS streamingUrl baked into the block at
// authoring time (apps/web VideoHero hides the player when src is empty), so
// AI candidates must carry at least one playable dub — published with a
// non-empty HLS URL, mirroring web's isPlayableWatchVariant — and must not be
// container entries (collections/series have nothing to play).
export const PLAYABLE_CANDIDATE_VIDEO_WHERE = {
  deletedAt: null,
  OR: [
    { label: null },
    { label: { notIn: [VideoLabel.COLLECTION, VideoLabel.SERIES] } },
  ],
  dubs: {
    some: {
      deletedAt: null,
      published: true,
      AND: [{ hls: { not: null } }, { NOT: { hls: "" } }],
    },
  },
} satisfies Prisma.VideoWhereInput

// Raw-SQL twin of PLAYABLE_CANDIDATE_VIDEO_WHERE for the semantic candidate
// queries (alias `v` = video; enum literals are the lowercase DB values).
// Keep both predicates in sync.
const PLAYABLE_CANDIDATE_VIDEO_SQL = `
          AND (v.label IS NULL OR v.label NOT IN ('collection', 'series'))
          AND EXISTS (
            SELECT 1
            FROM video_dub pvd
            WHERE pvd.video_id = v.id
              AND pvd.deleted_at IS NULL
              AND pvd.published = TRUE
              AND pvd.hls IS NOT NULL
              AND pvd.hls <> ''
          )`

type RankedCandidate = VideoCandidate & {
  score: number
  updatedAt: Date
}

type VideoEmbeddingHit = {
  videoId: string
  distance: number
}

function normalizeText(value: string) {
  return value.trim().toLowerCase()
}

function tokenizePrompt(prompt: string) {
  return Array.from(
    new Set(
      normalizeText(prompt)
        .match(/[a-z0-9]+/g)
        ?.filter((token) => token.length >= 3) ?? [],
    ),
  )
}

function candidateText(candidate: {
  title: string
  description: string | null
  slug: string
  label: string | null
}) {
  return [
    candidate.title,
    candidate.description,
    candidate.slug,
    candidate.label,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

function scoreCandidate(
  candidate: {
    title: string
    description: string | null
    slug: string
    label: string | null
    previewImageUrl: string | null
    previewStreamUrl: string | null
    updatedAt: Date
  },
  tokens: readonly string[],
) {
  let score = 0
  if (candidate.previewImageUrl) score += 1
  if (candidate.previewStreamUrl) score += 2
  if (tokens.length === 0) {
    return score
  }

  const title = candidate.title.toLowerCase()
  const description = candidate.description?.toLowerCase() ?? ""
  const slug = candidate.slug.toLowerCase()
  const label = candidate.label?.toLowerCase() ?? ""
  const text = candidateText(candidate)

  for (const token of tokens) {
    if (title.includes(token)) score += 8
    if (description.includes(token)) score += 5
    if (slug.includes(token)) score += 4
    if (label.includes(token)) score += 2
    if (text.includes(token)) score += 1
  }

  return score
}

export async function loadExperienceAiVideoCandidates(
  prisma: PrismaClient,
  {
    locale,
    prompt,
    limit = DEFAULT_CANDIDATE_LIMIT,
  }: { locale: string; prompt: string; limit?: number },
): Promise<VideoCandidate[]> {
  const safeLimit = Math.max(1, Math.min(limit, DEFAULT_CANDIDATE_LIMIT))
  const fetchWindow = Math.min(
    Math.max(safeLimit * 4, 24),
    CANDIDATE_FETCH_WINDOW,
  )
  const tokens = tokenizePrompt(prompt)
  const semanticVideoIds = await loadSemanticVideoCandidateIds(prisma, {
    locale,
    prompt,
    limit: fetchWindow,
  })

  const videos = await prisma.video.findMany({
    where:
      semanticVideoIds.length > 0
        ? { id: { in: semanticVideoIds }, ...PLAYABLE_CANDIDATE_VIDEO_WHERE }
        : PLAYABLE_CANDIDATE_VIDEO_WHERE,
    select: {
      id: true,
      slug: true,
      label: true,
      updatedAt: true,
    },
    ...(semanticVideoIds.length > 0
      ? {}
      : { orderBy: { updatedAt: "desc" as const } }),
    take: fetchWindow,
  })

  if (videos.length === 0) {
    return []
  }

  const videoIds = videos.map((video) => video.id)
  const [videoLocales, videoDubs, videoImages] = await Promise.all([
    prisma.videoLocale.findMany({
      where: { videoId: { in: videoIds } },
      select: {
        videoId: true,
        locale: true,
        title: true,
        description: true,
        status: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.videoDub.findMany({
      where: { videoId: { in: videoIds }, deletedAt: null },
      select: {
        videoId: true,
        published: true,
        hls: true,
        dash: true,
        share: true,
        language: {
          select: {
            bcp47: true,
            iso3: true,
            slug: true,
          },
        },
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.videoImage.findMany({
      where: { videoId: { in: videoIds } },
      select: {
        videoId: true,
        url: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
  ])

  const localesByVideo = new Map<string, typeof videoLocales>()
  for (const row of videoLocales) {
    const current = localesByVideo.get(row.videoId) ?? []
    current.push(row)
    localesByVideo.set(row.videoId, current)
  }

  const dubsByVideo = new Map<string, typeof videoDubs>()
  for (const row of videoDubs) {
    const current = dubsByVideo.get(row.videoId) ?? []
    current.push(row)
    dubsByVideo.set(row.videoId, current)
  }

  const imagesByVideo = new Map<string, typeof videoImages>()
  for (const row of videoImages) {
    const current = imagesByVideo.get(row.videoId) ?? []
    current.push(row)
    imagesByVideo.set(row.videoId, current)
  }

  const semanticRank = new Map(
    semanticVideoIds.map((videoId, index) => [videoId, index]),
  )

  const ranked: RankedCandidate[] = videos.flatMap((video) => {
    const localeRows = localesByVideo.get(video.id) ?? []
    const preferredLocale =
      localeRows.find(
        (row) => row.locale === locale && row.status === "PUBLISHED",
      ) ?? null

    if (!preferredLocale) return []

    const previewImageUrl =
      imagesByVideo.get(video.id)?.find((row) => row.url)?.url ?? null
    const dubRows = dubsByVideo.get(video.id) ?? []
    const localeMatches = (row: (typeof dubRows)[number]) =>
      row.language?.bcp47 === locale ||
      row.language?.iso3 === locale ||
      row.language?.slug === locale
    // Prefer a playable (published + HLS) dub in the request locale, then any
    // locale-matched stream, then any playable dub — the last leg guarantees
    // a non-empty streamingUrl for every candidate that passed
    // PLAYABLE_CANDIDATE_VIDEO_WHERE, so generated videoHero blocks always
    // bake a URL web can play.
    const preferredDub =
      dubRows.find((row) => row.published && row.hls && localeMatches(row)) ??
      dubRows.find(
        (row) => (row.hls || row.dash || row.share) && localeMatches(row),
      ) ??
      dubRows.find((row) => row.published && row.hls) ??
      null

    const candidate = {
      ref: "",
      videoId: video.id,
      slug: video.slug,
      title: preferredLocale?.title?.trim() || video.slug,
      description: preferredLocale?.description?.trim() || null,
      previewImageUrl,
      previewStreamUrl:
        preferredDub?.hls ?? preferredDub?.dash ?? preferredDub?.share ?? null,
      label: video.label ? String(video.label) : null,
      score: 0,
      updatedAt: video.updatedAt,
    }

    return [
      {
        ...candidate,
        score: scoreCandidate(candidate, tokens),
      },
    ]
  })

  ranked.sort((left, right) => {
    const leftSemanticRank = semanticRank.get(left.videoId)
    const rightSemanticRank = semanticRank.get(right.videoId)
    if (leftSemanticRank !== undefined || rightSemanticRank !== undefined) {
      return (leftSemanticRank ?? Infinity) - (rightSemanticRank ?? Infinity)
    }
    if (right.score !== left.score) return right.score - left.score
    if (right.updatedAt.getTime() !== left.updatedAt.getTime()) {
      return right.updatedAt.getTime() - left.updatedAt.getTime()
    }
    return left.title.localeCompare(right.title)
  })

  const selected = ranked.slice(0, safeLimit)
  if (selected.length === 0) {
    return []
  }

  return selected.map((candidate, index) => ({
    ref: `v${String(index + 1).padStart(2, "0")}` as const,
    videoId: candidate.videoId,
    slug: candidate.slug,
    title: candidate.title,
    description: candidate.description,
    previewImageUrl: candidate.previewImageUrl,
    previewStreamUrl: candidate.previewStreamUrl,
    label: candidate.label,
  }))
}

async function loadSemanticVideoCandidateIds(
  prisma: PrismaClient,
  {
    locale,
    prompt,
    limit,
  }: {
    locale: string
    prompt: string
    limit: number
  },
): Promise<string[]> {
  let generated: Awaited<ReturnType<typeof generateExperienceEmbedding>>
  try {
    generated = await generateExperienceEmbedding(prompt)
  } catch (error) {
    console.warn(
      "[experience-ai] primary semantic video candidate search unavailable; falling back to catalog token ranking",
      error instanceof Error ? error.message : String(error),
    )
    return []
  }

  const pgVector = toPgVector(generated.embedding)
  const safeLimit = Math.max(1, Math.min(limit, CANDIDATE_FETCH_WINDOW))
  const transcriptProvenanceFilter = Prisma.sql`
          AND vt.embedding_provider = ${CONTENT_EMBEDDING_PROVIDER}
          AND vt.model = ${CONTENT_EMBEDDING_MODEL}
          AND vt.dimensions = ${CONTENT_EMBEDDING_DIMENSIONS}
          AND vt.embedding_native_dimensions = ${CONTENT_EMBEDDING_DIMENSIONS}
          AND vt.embedding_transform_version IS NULL
          AND vtc.model = ${CONTENT_EMBEDDING_MODEL}
          AND vtc.dimensions = ${CONTENT_EMBEDDING_DIMENSIONS}
        `

  const hits = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SET LOCAL hnsw.ef_search = ${VECTOR_SEARCH_EF_SEARCH}`,
    )
    return tx.$queryRaw<VideoEmbeddingHit[]>`
      WITH transcript_hits AS (
        SELECT
          vt.video_id AS "videoId",
          MIN(vtc.embedding <=> ${pgVector}::vector) AS distance
        FROM video_transcript_chunk vtc
        JOIN video_transcript vt ON vt.id = vtc.transcript_id
        JOIN video v ON v.id = vt.video_id
        WHERE vtc.embedding IS NOT NULL
          AND vtc.language = ${locale}
          ${transcriptProvenanceFilter}
          AND v.deleted_at IS NULL${Prisma.raw(PLAYABLE_CANDIDATE_VIDEO_SQL)}
        GROUP BY vt.video_id
      )
      SELECT
        "videoId",
        MIN(distance)::float AS distance
      FROM transcript_hits
      GROUP BY "videoId"
      ORDER BY distance ASC
      LIMIT ${safeLimit}
    `
  })

  return hits.map((hit) => hit.videoId)
}
