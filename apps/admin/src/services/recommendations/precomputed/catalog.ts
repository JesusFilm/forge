import type { Prisma, PrismaClient } from "@prisma/client"
import { z } from "zod"
import { isValidMastraRecommendationIngestBearer } from "@/auth/mastra-ingest-bearer"

const id = z.string().trim().min(1).max(191)
const request = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("video"),
    videoId: id,
    cutoff: z.string().datetime(),
  }),
  z.object({
    action: z.literal("catalog"),
    cutoff: z.string().datetime(),
    afterVideoId: id.optional(),
    limit: z.number().int().min(1).max(100).default(40),
  }),
  z.object({
    action: z.literal("chunks"),
    videoId: id,
    cutoff: z.string().datetime(),
    afterChunkId: id.optional(),
    limit: z.number().int().min(1).max(50).default(20),
  }),
])

export class PrecomputedCatalogError extends Error {
  constructor(
    readonly code:
      | "unauthorized"
      | "invalid"
      | "not_found"
      | "oversized"
      | "stale_cutoff",
    message: string,
  ) {
    super(message)
  }
}

const publishedLocale = {
  status: "PUBLISHED" as const,
  deletedAt: null,
}
const MAX_DESCRIPTION_CHARACTERS = 5_000
const MAX_ROUTE_DUBS = 4_096
const MAX_ROUTE_PARENTS = 256
const playableDub = {
  deletedAt: null,
  published: true,
  muxVideo: { deletedAt: null, playbackId: { not: null } },
} satisfies Prisma.VideoDubWhereInput

function videoSelect() {
  return {
    id: true,
    coreId: true,
    slug: true,
    deletedAt: true,
    restrictViewPlatforms: true,
    dubs: {
      where: playableDub,
      orderBy: { id: "asc" as const },
      select: { id: true, language: { select: { id: true, slug: true } } },
      take: MAX_ROUTE_DUBS + 1,
    },
    locales: {
      where: publishedLocale,
      orderBy: [{ locale: "asc" as const }, { id: "asc" as const }],
      select: { locale: true, title: true, description: true, snippet: true },
    },
    keywords: {
      where: { keyword: { deletedAt: null } },
      orderBy: { keywordId: "asc" as const },
      take: 21,
      select: { keyword: { select: { value: true } } },
    },
    bibleCitations: {
      where: { deletedAt: null },
      orderBy: { id: "asc" as const },
      take: 21,
      select: { osisId: true },
    },
    parents: {
      orderBy: { parentId: "asc" as const },
      select: {
        parentId: true,
        parent: { select: { slug: true, deletedAt: true } },
      },
    },
    children: {
      orderBy: { childId: "asc" as const },
      select: { childId: true },
    },
    transcripts: {
      orderBy: { id: "asc" as const },
      select: { language: true },
    },
  } satisfies Prisma.VideoSelect
}

type CatalogVideo = Prisma.VideoGetPayload<{
  select: ReturnType<typeof videoSelect>
}>

function compactVideo(video: CatalogVideo) {
  const locale =
    video.locales.find((row) => row.locale === "en") ?? video.locales[0]
  const description = locale?.description ?? locale?.snippet ?? ""
  return {
    id: video.id,
    coreId: video.coreId,
    slug: video.slug,
    locale: locale?.locale ?? null,
    title: locale?.title ?? "",
    description: description.slice(0, MAX_DESCRIPTION_CHARACTERS),
    descriptionTruncated: description.length > MAX_DESCRIPTION_CHARACTERS,
    keywords: video.keywords.slice(0, 20).map((item) => item.keyword.value),
    keywordsTruncated: video.keywords.length > 20,
    bibleCitations: video.bibleCitations
      .slice(0, 20)
      .flatMap((item) => (item.osisId ? [item.osisId] : [])),
    bibleCitationsTruncated: video.bibleCitations.length > 20,
    parentVideoIds: video.parents.map((item) => item.parentId),
    childVideoIds: video.children.map((item) => item.childId),
    transcriptLanguages: [
      ...new Set(video.transcripts.map((item) => item.language)),
    ].sort(),
    watchRouteIdentity: {
      basis: "current_catalog_cutoff_fenced" as const,
      parentSlugs: [
        ...new Set(
          video.parents
            .filter((item) => item.parent.deletedAt === null)
            .map((item) => item.parent.slug),
        ),
      ]
        .sort()
        .slice(0, MAX_ROUTE_PARENTS),
      playableAudioLanguageSlugs: [
        ...new Set(
          video.dubs
            .map((item) => item.language?.slug)
            .filter(
              (slug): slug is string =>
                typeof slug === "string" && /^[a-z0-9-]+$/.test(slug),
            ),
        ),
      ].sort(),
      truncated:
        video.parents.length > MAX_ROUTE_PARENTS ||
        video.dubs.length > MAX_ROUTE_DUBS,
    },
  }
}

function isWatchable(video: {
  deletedAt: Date | null
  restrictViewPlatforms: string[]
  dubs: readonly unknown[]
  locales: ReadonlyArray<{ title: string | null }>
}): boolean {
  return (
    video.deletedAt === null &&
    !video.restrictViewPlatforms.includes("watch") &&
    video.dubs.length > 0 &&
    video.locales.some((locale) => Boolean(locale.title?.trim()))
  )
}

async function assertWatchRouteIdentityVersions(
  tx: Prisma.TransactionClient,
  videos: CatalogVideo[],
  cutoff: Date,
): Promise<void> {
  const parentIds = [
    ...new Set(
      videos.flatMap((video) => video.parents.map((item) => item.parentId)),
    ),
  ]
  const languageIds = [
    ...new Set(
      videos.flatMap((video) =>
        video.dubs.flatMap((dub) => (dub.language ? [dub.language.id] : [])),
      ),
    ),
  ]
  const later = { gt: cutoff }
  const [staleParent, staleLanguage] = await Promise.all([
    parentIds.length
      ? tx.video.findFirst({
          where: {
            id: { in: parentIds },
            OR: [
              { createdAt: later },
              { updatedAt: later },
              { deletedAt: later },
            ],
          },
          select: { id: true },
        })
      : null,
    languageIds.length
      ? tx.language.findFirst({
          where: {
            id: { in: languageIds },
            OR: [{ createdAt: later }, { updatedAt: later }],
          },
          select: { id: true },
        })
      : null,
  ])
  if (staleParent || staleLanguage) {
    throw new PrecomputedCatalogError(
      "stale_cutoff",
      "Observed Watch route identity changed after cutoff",
    )
  }
}

/**
 * Current-row reads are fenced by child timestamps. We cannot reconstruct
 * overwritten or hard-deleted historical versions; a changed observed row
 * fails the build instead of substituting its new content for the cutoff.
 */
export async function assertPrecomputedObservedVersion(
  tx: Prisma.TransactionClient,
  videoIds: string[],
  cutoff: Date,
): Promise<void> {
  if (videoIds.length === 0) return
  const later = { gt: cutoff }
  const stale = await tx.video.findFirst({
    where: {
      id: { in: videoIds },
      OR: [
        { createdAt: later },
        { updatedAt: later },
        { deletedAt: later },
        {
          locales: {
            some: {
              OR: [
                { createdAt: later },
                { updatedAt: later },
                { deletedAt: later },
              ],
            },
          },
        },
        {
          dubs: {
            some: {
              OR: [
                { createdAt: later },
                { updatedAt: later },
                { deletedAt: later },
                {
                  muxVideo: {
                    is: {
                      OR: [
                        { createdAt: later },
                        { updatedAt: later },
                        { deletedAt: later },
                      ],
                    },
                  },
                },
              ],
            },
          },
        },
        {
          keywords: {
            some: {
              OR: [
                { createdAt: later },
                {
                  keyword: {
                    OR: [
                      { createdAt: later },
                      { updatedAt: later },
                      { deletedAt: later },
                    ],
                  },
                },
              ],
            },
          },
        },
        {
          bibleCitations: {
            some: {
              OR: [
                { createdAt: later },
                { updatedAt: later },
                { deletedAt: later },
              ],
            },
          },
        },
        { parents: { some: { createdAt: later } } },
        { children: { some: { createdAt: later } } },
        {
          transcripts: {
            some: {
              OR: [
                { createdAt: later },
                { updatedAt: later },
                { generatedAt: later },
                {
                  chunks: {
                    some: { OR: [{ createdAt: later }, { updatedAt: later }] },
                  },
                },
              ],
            },
          },
        },
      ],
    },
    select: { id: true },
  })
  if (stale) {
    throw new PrecomputedCatalogError(
      "stale_cutoff",
      "Observed catalog version changed after cutoff",
    )
  }
}

/** Private producer catalog boundary. No recommendation/ranking tables are read. */
export async function readPrecomputedCatalog(
  prisma: PrismaClient,
  raw: unknown,
  authorizationHeader: string | null,
) {
  if (!isValidMastraRecommendationIngestBearer(authorizationHeader)) {
    throw new PrecomputedCatalogError("unauthorized", "Authorization required")
  }
  const parsed = request.safeParse(raw)
  if (!parsed.success) {
    throw new PrecomputedCatalogError("invalid", "Invalid catalog request")
  }
  const input = parsed.data
  const cutoff = new Date(input.cutoff)

  return prisma.$transaction(
    async (tx) => {
      if (input.action === "chunks") {
        const video = await tx.video.findFirst({
          where: { id: input.videoId, createdAt: { lte: cutoff } },
          select: {
            id: true,
            deletedAt: true,
            restrictViewPlatforms: true,
            dubs: {
              where: playableDub,
              select: { id: true },
              take: 1,
            },
            locales: {
              where: publishedLocale,
              select: { title: true },
            },
          },
        })
        if (!video)
          throw new PrecomputedCatalogError("not_found", "Video not found")
        await assertPrecomputedObservedVersion(tx, [video.id], cutoff)
        if (!isWatchable(video))
          throw new PrecomputedCatalogError("not_found", "Video not found")
        const rows = await tx.videoTranscriptChunk.findMany({
          where: {
            transcript: { videoId: input.videoId },
            ...(input.afterChunkId ? { id: { gt: input.afterChunkId } } : {}),
          },
          select: {
            id: true,
            language: true,
            rawSourceText: true,
            text: true,
            transcriptId: true,
            chunkIndex: true,
          },
          orderBy: { id: "asc" },
          take: input.limit + 1,
        })
        const hasMore = rows.length > input.limit
        const page = rows.slice(0, input.limit)
        const chunks = page.map((chunk) => ({
          id: chunk.id,
          language: chunk.language,
          transcriptId: chunk.transcriptId,
          chunkIndex: chunk.chunkIndex,
          text: chunk.rawSourceText ?? chunk.text,
        }))
        if (chunks.some((chunk) => chunk.text.length > 5_000)) {
          throw new PrecomputedCatalogError(
            "oversized",
            "Transcript chunk exceeds producer response bound",
          )
        }
        return {
          action: "chunks" as const,
          videoId: input.videoId,
          chunks,
          nextCursor: hasMore ? page.at(-1)!.id : null,
        }
      }

      if (input.action === "video") {
        const video = await tx.video.findFirst({
          where: { id: input.videoId, createdAt: { lte: cutoff } },
          select: videoSelect(),
        })
        if (!video)
          throw new PrecomputedCatalogError("not_found", "Video not found")
        await assertPrecomputedObservedVersion(tx, [video.id], cutoff)
        await assertWatchRouteIdentityVersions(tx, [video], cutoff)
        if (!isWatchable(video))
          throw new PrecomputedCatalogError("not_found", "Video not found")
        return { action: "video" as const, video: compactVideo(video) }
      }

      const rows = await tx.video.findMany({
        where: {
          createdAt: { lte: cutoff },
          ...(input.afterVideoId ? { id: { gt: input.afterVideoId } } : {}),
        },
        select: videoSelect(),
        orderBy: { id: "asc" },
        take: input.limit + 1,
      })
      const hasMore = rows.length > input.limit
      const page = rows.slice(0, input.limit)
      await assertPrecomputedObservedVersion(
        tx,
        page.map((video) => video.id),
        cutoff,
      )
      await assertWatchRouteIdentityVersions(tx, page, cutoff)
      return {
        action: "catalog" as const,
        videos: page.filter(isWatchable).map(compactVideo),
        nextCursor: hasMore ? page.at(-1)!.id : null,
      }
    },
    { isolationLevel: "RepeatableRead" },
  )
}
