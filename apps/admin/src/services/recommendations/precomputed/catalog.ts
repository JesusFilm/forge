import { createHash } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
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
  } satisfies Prisma.VideoSelect
}

type CatalogVideo = Prisma.VideoGetPayload<{
  select: ReturnType<typeof videoSelect>
}>

type TranscriptSelection = {
  policy: "english-per-edition-with-complete-fallback-v1"
  availableTranscriptCount: number
  incompleteTranscriptCount: number
  skippedEditionCount: number
  selected: {
    transcriptId: string
    videoEditionId: string
    language: string
    totalChunks: number
  }[]
}

const emptyTranscriptSelection = (): TranscriptSelection => ({
  policy: "english-per-edition-with-complete-fallback-v1",
  availableTranscriptCount: 0,
  incompleteTranscriptCount: 0,
  skippedEditionCount: 0,
  selected: [],
})

/** Select whole transcripts per edition, not a sample of their passages. */
async function transcriptSelections(
  tx: Prisma.TransactionClient,
  videoIds: string[],
): Promise<Map<string, TranscriptSelection>> {
  if (videoIds.length === 0) return new Map()
  // Aggregate inside PostgreSQL: translated films have thousands of transcript
  // rows, which need not all be hydrated and copied into every model prompt.
  const rows = await tx.$queryRaw<
    Array<Omit<TranscriptSelection, "policy"> & { videoId: string }>
  >`
    WITH candidates AS (
      SELECT t.id, t.video_id, t.video_edition_id, t.language, t.total_chunks,
             count(c.id)::int AS actual_chunks
      FROM video_transcript t
      LEFT JOIN video_transcript_chunk c ON c.transcript_id = t.id
      WHERE t.video_id IN (${Prisma.join(videoIds)})
      GROUP BY t.id
    ), ranked AS (
      SELECT *, row_number() OVER (
        PARTITION BY video_id, video_edition_id
        ORDER BY (language = 'en') DESC, language COLLATE "C", id COLLATE "C"
      ) AS preference
      FROM candidates
      WHERE actual_chunks > 0 AND actual_chunks = total_chunks
    ), summary AS (
      SELECT video_id, count(*)::int AS available,
             count(*) FILTER (WHERE actual_chunks = 0 OR actual_chunks <> total_chunks)::int AS incomplete,
             count(DISTINCT video_edition_id)::int AS editions
      FROM candidates GROUP BY video_id
    )
    SELECT s.video_id AS "videoId", s.available AS "availableTranscriptCount",
           s.incomplete AS "incompleteTranscriptCount",
           (s.editions - count(r.id))::int AS "skippedEditionCount",
           COALESCE(jsonb_agg(jsonb_build_object(
             'transcriptId', r.id, 'videoEditionId', r.video_edition_id,
             'language', r.language, 'totalChunks', r.total_chunks
           ) ORDER BY r.id COLLATE "C") FILTER (WHERE r.id IS NOT NULL), '[]'::jsonb) AS selected
    FROM summary s LEFT JOIN ranked r ON r.video_id = s.video_id AND r.preference = 1
    GROUP BY s.video_id, s.available, s.incomplete, s.editions`
  return new Map(
    rows.map(({ videoId, ...selection }) => [
      videoId,
      { policy: "english-per-edition-with-complete-fallback-v1", ...selection },
    ]),
  )
}

function compactVideo(video: CatalogVideo, selection: TranscriptSelection) {
  const locale =
    video.locales.find((row) => row.locale === "en" && row.title) ??
    video.locales.find((row) => row.title) ??
    video.locales[0]
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
      ...new Set(selection.selected.map((item) => item.language)),
    ].sort(),
    transcriptSelection: selection,
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
  tx: Pick<Prisma.TransactionClient, "video">,
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

/** Reconstruct the producer's complete Watch-eligible source identity from
 * Admin-owned rows at the build cutoff. A self-declared two-video manifest
 * cannot certify coverage of a larger catalog. Changed current rows fail
 * closed because overwritten historic values cannot be reconstructed. */
export async function loadPrecomputedFullCatalogSourceSet(
  db: Pick<Prisma.TransactionClient, "video">,
  cutoff: Date,
): Promise<{ sourceCount: number; sourceSetDigest: string }> {
  if (!Number.isFinite(cutoff.getTime()))
    throw new PrecomputedCatalogError("invalid", "Invalid catalog cutoff")
  const ids: string[] = []
  let afterVideoId: string | null = null
  for (;;) {
    const page: Array<{
      id: string
      deletedAt: Date | null
      restrictViewPlatforms: string[]
      dubs: Array<{ id: string }>
      locales: Array<{ title: string | null }>
    }> = await db.video.findMany({
      where: {
        createdAt: { lte: cutoff },
        ...(afterVideoId ? { id: { gt: afterVideoId } } : {}),
      },
      select: {
        id: true,
        deletedAt: true,
        restrictViewPlatforms: true,
        dubs: { where: playableDub, select: { id: true }, take: 1 },
        locales: { where: publishedLocale, select: { title: true } },
      },
      orderBy: { id: "asc" },
      take: 200,
    })
    if (page.length === 0) break
    await assertPrecomputedObservedVersion(
      db,
      page.map((video) => video.id),
      cutoff,
    )
    for (const video of page) if (isWatchable(video)) ids.push(video.id)
    if (ids.length > 20_000)
      throw new PrecomputedCatalogError(
        "oversized",
        "Catalog exceeds producer manifest limit",
      )
    afterVideoId = page.at(-1)!.id
    if (page.length < 200) break
  }
  return {
    sourceCount: ids.length,
    sourceSetDigest: createHash("sha256")
      .update(JSON.stringify(ids.sort()))
      .digest("hex"),
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
        const selection = (await transcriptSelections(tx, [video.id])).get(
          video.id,
        )
        const rows = await tx.videoTranscriptChunk.findMany({
          where: {
            transcriptId: {
              in: selection?.selected.map((item) => item.transcriptId) ?? [],
            },
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
        // Real catalog chunks reach 8,035 characters. Keep them intact while
        // retaining a bounded page; the producer reads 20 chunks per request.
        if (chunks.some((chunk) => chunk.text.length > 8_192)) {
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
        const selection = (await transcriptSelections(tx, [video.id])).get(
          video.id,
        )
        return {
          action: "video" as const,
          video: compactVideo(video, selection ?? emptyTranscriptSelection()),
        }
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
      const selections = await transcriptSelections(
        tx,
        page.map((video) => video.id),
      )
      return {
        action: "catalog" as const,
        videos: page
          .filter(isWatchable)
          .map((video) =>
            compactVideo(
              video,
              selections.get(video.id) ?? emptyTranscriptSelection(),
            ),
          ),
        nextCursor: hasMore ? page.at(-1)!.id : null,
      }
    },
    { isolationLevel: "RepeatableRead" },
  )
}
