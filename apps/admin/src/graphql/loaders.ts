// Per-request DataLoader instances.
//
// DataLoader batches and dedupes calls within a single request tick. The
// Pothos Prisma plugin's `...query` passthrough already covers nested
// relation loads (verified in the Unit 3 spike). DataLoaders here are the
// escape hatch for service-owned fetches that don't go through Pothos —
// e.g., a service that returns IDs from raw SQL (vector search) and needs
// to hydrate by id, or a parity-test path that compares direct vs nested
// access.
//
// Loaders MUST be per-request — a fresh instance for every GraphQL
// operation. Caching across requests would leak data between principals.
// `createLoaders` is called by `createContext` (Unit 6c) once per request.
//
// Per Unit 6 of docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

import DataLoader from "dataloader"
import { Prisma, type PrismaClient } from "@prisma/client"

export type Loaders = ReturnType<typeof createLoaders>

export function createLoaders(prisma: PrismaClient) {
  return {
    /** Hydrate Experience rows by id. Used by search / parity test paths. */
    experienceById: new DataLoader<string, ExperienceRow | null>(
      async (ids) => {
        const rows = await prisma.experience.findMany({
          where: { id: { in: ids as string[] } },
        })
        return mapToInputOrder(ids, rows, (r) => r.id)
      },
    ),

    /** Hydrate ExperienceLocale rows by id. */
    experienceLocaleById: new DataLoader<string, ExperienceLocaleRow | null>(
      async (ids) => {
        const rows = await prisma.experienceLocale.findMany({
          where: { id: { in: ids as string[] } },
        })
        return mapToInputOrder(ids, rows, (r) => r.id)
      },
    ),

    /** Hydrate Video rows by id. */
    videoById: new DataLoader<string, VideoRow | null>(async (ids) => {
      const rows = await prisma.video.findMany({
        where: { id: { in: ids as string[] } },
      })
      return mapToInputOrder(ids, rows, (r) => r.id)
    }),

    /**
     * Hydrate Video rows by id while preserving Pothos Prisma's nested
     * selection query. `VideoRelation.parent/child` need this: plain
     * `videoById` batches well but discards nested selection preloading,
     * while direct `findUnique({ ...query })` preserves the selection but
     * creates one query per sibling. Grouping by the serialized query keeps
     * both properties.
     */
    videoByIdWithQuery: new DataLoader<
      VideoByIdWithQueryKey,
      VideoRow | null,
      string
    >(
      async (keys) => {
        const groups = new Map<string, VideoByIdWithQueryKey[]>()
        for (const key of keys) {
          const groupKey = serializeVideoByIdWithQuerySelection(key.query)
          groups.set(groupKey, [...(groups.get(groupKey) ?? []), key])
        }

        const rowsByLoaderKey = new Map<string, VideoRow | null>()
        await Promise.all(
          Array.from(groups.values()).map(async (group) => {
            const ids = unique(group.map((key) => key.id))
            const rows = await prisma.video.findMany({
              ...withVideoIdSelected(group[0]?.query ?? {}),
              where: { id: { in: ids } },
            })
            const rowsById = new Map(rows.map((row) => [row.id, row]))
            for (const key of group) {
              rowsByLoaderKey.set(
                serializeVideoByIdWithQueryKey(key),
                rowsById.get(key.id) ?? null,
              )
            }
          }),
        )

        return keys.map(
          (key) =>
            rowsByLoaderKey.get(serializeVideoByIdWithQueryKey(key)) ?? null,
        )
      },
      { cacheKeyFn: serializeVideoByIdWithQueryKey },
    ),

    /** Hydrate VideoRelation rows where the input Video is the child. */
    videoParentsByChildId: new DataLoader<
      VideoRelationVisibilityKey,
      VideoRelationRow[],
      string
    >(
      async (keys) =>
        loadVideoRelationsByVideoId({
          keys,
          idField: "childId",
          visibleRelationField: "parent",
          prisma,
        }),
      { cacheKeyFn: serializeVideoRelationVisibilityKey },
    ),

    /** Hydrate VideoRelation rows where the input Video is the parent. */
    videoChildrenByParentId: new DataLoader<
      VideoRelationVisibilityKey,
      VideoRelationRow[],
      string
    >(
      async (keys) =>
        loadVideoRelationsByVideoId({
          keys,
          idField: "parentId",
          visibleRelationField: "child",
          prisma,
        }),
      { cacheKeyFn: serializeVideoRelationVisibilityKey },
    ),

    /** Hydrate non-deleted VideoImage rows by Video id. */
    videoImagesByVideoId: new DataLoader<string, VideoImageRow[]>(async (ids) =>
      loadRowsByVideoId({
        ids,
        findMany: (videoIds) =>
          prisma.videoImage.findMany({
            where: { videoId: { in: videoIds }, deletedAt: null },
          }),
      }),
    ),

    /** Hydrate visible VideoLocale rows by Video id and locale/language args. */
    videoLocalesByVideoIdAndFilter: new DataLoader<
      VideoLocaleFilterKey,
      VideoLocaleRow[],
      string
    >(
      async (keys) =>
        loadVideoScopedRowsByFilter({
          keys,
          filterKey: serializeVideoLocaleFilter,
          findMany: (videoIds, key) =>
            prisma.videoLocale.findMany({
              where: {
                videoId: { in: videoIds },
                deletedAt: null,
                ...(key.locale != null ? { locale: key.locale } : {}),
                ...(key.languageSlug != null
                  ? { languageSlug: key.languageSlug }
                  : {}),
                ...(key.visibleOnly ? { status: "PUBLISHED" as const } : {}),
              },
              orderBy: [{ languageSlug: "asc" }, { id: "asc" }],
            }),
        }),
      { cacheKeyFn: serializeVideoLocaleFilterKey },
    ),

    /** Hydrate VideoStudyQuestion rows by Video id and locale/language args. */
    videoStudyQuestionsByVideoIdAndFilter: new DataLoader<
      VideoStudyQuestionFilterKey,
      VideoStudyQuestionRow[],
      string
    >(
      async (keys) =>
        loadVideoScopedRowsByFilter({
          keys,
          filterKey: serializeVideoStudyQuestionFilter,
          findMany: (videoIds, key) =>
            prisma.videoStudyQuestion.findMany({
              where: {
                videoId: { in: videoIds },
                deletedAt: null,
                ...(key.locale != null
                  ? { locale: key.locale }
                  : key.languageSlug == null
                    ? { primary: true }
                    : {}),
                ...(key.languageSlug != null
                  ? { languageSlug: key.languageSlug }
                  : {}),
              },
              orderBy: [
                { order: "asc" },
                { languageSlug: "asc" },
                { id: "asc" },
              ],
            }),
        }),
      { cacheKeyFn: serializeVideoStudyQuestionFilterKey },
    ),

    /** Hydrate non-deleted BibleCitation rows by Video id. */
    videoBibleCitationsByVideoId: new DataLoader<string, BibleCitationRow[]>(
      async (ids) =>
        loadRowsByVideoId({
          ids,
          findMany: (videoIds) =>
            prisma.bibleCitation.findMany({
              where: { videoId: { in: videoIds }, deletedAt: null },
            }),
        }),
    ),

    /** Hydrate Language rows by id. */
    languageById: new DataLoader<string, LanguageRow | null>(async (ids) => {
      const rows = await prisma.language.findMany({
        where: { id: { in: ids as string[] } },
      })
      return mapToInputOrder(ids, rows, (r) => r.id)
    }),

    /**
     * Primary-playable-dub duration (seconds) per Video id, for the
     * `Video.durationSeconds` field resolver. Batches across a single
     * request tick so a watch/series payload projecting
     * `children { child { durationSeconds } }` for a 61-chapter
     * collection resolves all of them in ONE query instead of 61.
     *
     * Semantics mirror `hydrateCardPillFields` in
     * `services/hybrid-search.service.ts`: prefer the primary-language
     * playable dub, else the longest-duration playable dub. Playable =
     * published + has HLS + not soft-deleted + duration > 0 (the last
     * excludes Core sync-glitch rows that report duration 0). Returns
     * null when no playable dub exists (e.g. a SERIES/COLLECTION whose
     * runtime lives on its children).
     */
    videoPrimaryDubDurationById: new DataLoader<string, number | null>(
      async (ids) => {
        const rows = await prisma.video.findMany({
          where: { id: { in: ids as string[] }, deletedAt: null },
          select: {
            id: true,
            primaryLanguageId: true,
            dubs: {
              where: {
                published: true,
                hls: { not: null },
                deletedAt: null,
                duration: { gt: 0 },
              },
              orderBy: [{ duration: "desc" }],
              take: PRIMARY_DUB_DURATION_SCAN_LIMIT,
              select: { languageId: true, duration: true },
            },
          },
        })
        const byId = new Map<string, number | null>()
        for (const row of rows) {
          const primaryDub = row.primaryLanguageId
            ? row.dubs.find((d) => d.languageId === row.primaryLanguageId)
            : undefined
          const dub = primaryDub ?? row.dubs[0] ?? null
          byId.set(row.id, dub?.duration ?? null)
        }
        return ids.map((id) => byId.get(id) ?? null)
      },
    ),

    /**
     * Best Mux playback id per Video id for Watch thumbnails. Prefer the
     * requested language slug when supplied, then fall back to the same
     * primary/longest playable-dub heuristic as Video.durationSeconds.
     *
     * This keeps watch carousels on a scalar field instead of projecting
     * every child VideoDub row.
     */
    videoMuxPlaybackIdByIdAndLanguageSlug: new DataLoader<
      VideoMuxPlaybackKey,
      string | null,
      string
    >(
      async (keys) => {
        const normalizedKeys = keys.map(normalizeVideoMuxPlaybackKey)
        const videoIds = unique(normalizedKeys.map((key) => key.videoId))
        const languageSlugs = unique(
          normalizedKeys
            .map((key) => key.languageSlug)
            .filter((slug): slug is string => slug != null),
        )

        const exactByKey = new Map<string, string>()
        if (languageSlugs.length > 0) {
          const exactDubs = await prisma.videoDub.findMany({
            where: {
              videoId: { in: videoIds },
              deletedAt: null,
              published: true,
              hls: { not: null },
              language: { slug: { in: languageSlugs }, deletedAt: null },
              muxVideo: { playbackId: { not: null }, deletedAt: null },
            },
            orderBy: [{ duration: "desc" }, { id: "asc" }],
            select: {
              videoId: true,
              language: { select: { slug: true } },
              muxVideo: { select: { playbackId: true } },
            },
          })

          for (const dub of exactDubs) {
            const slug = dub.language?.slug ?? null
            const playbackId = dub.muxVideo?.playbackId ?? null
            if (!slug || !playbackId) continue
            const key = serializeVideoMuxPlaybackKey({
              videoId: dub.videoId,
              languageSlug: slug,
            })
            if (!exactByKey.has(key)) exactByKey.set(key, playbackId)
          }
        }

        const fallbackRows = await prisma.video.findMany({
          where: { id: { in: videoIds }, deletedAt: null },
          select: {
            id: true,
            primaryLanguageId: true,
            dubs: {
              where: {
                published: true,
                hls: { not: null },
                deletedAt: null,
                muxVideo: { playbackId: { not: null }, deletedAt: null },
              },
              orderBy: [{ duration: "desc" }, { id: "asc" }],
              take: PRIMARY_DUB_PLAYBACK_SCAN_LIMIT,
              select: {
                languageId: true,
                muxVideo: { select: { playbackId: true } },
              },
            },
          },
        })
        const fallbackByVideoId = new Map<string, string | null>()
        for (const row of fallbackRows) {
          const primaryDub = row.primaryLanguageId
            ? row.dubs.find((dub) => dub.languageId === row.primaryLanguageId)
            : undefined
          const dub = primaryDub ?? row.dubs[0] ?? null
          fallbackByVideoId.set(row.id, dub?.muxVideo?.playbackId ?? null)
        }

        return normalizedKeys.map(
          (key) =>
            exactByKey.get(serializeVideoMuxPlaybackKey(key)) ??
            fallbackByVideoId.get(key.videoId) ??
            null,
        )
      },
      { cacheKeyFn: serializeVideoMuxPlaybackKey },
    ),
  }
}

// Bounds the per-video dubs scan in `videoPrimaryDubDurationById`. Matches
// `HYDRATION_DUBS_PER_VIDEO` in hybrid-search: order by duration desc and
// take the top N, then prefer the primary-language dub among them. On a
// heavily-dubbed video the primary may rank below N by duration — accept
// the longest-dub fallback rather than widen the scan.
const PRIMARY_DUB_DURATION_SCAN_LIMIT = 5
const PRIMARY_DUB_PLAYBACK_SCAN_LIMIT = 5

export type VideoMuxPlaybackKey = {
  videoId: string
  languageSlug: string | null
}

export type VideoByIdWithQueryKey = {
  id: string
  query: object
}

export type VideoRelationVisibilityKey = {
  videoId: string
  visibleOnly: boolean
}

export type VideoLocaleFilterKey = {
  videoId: string
  locale: string | null
  languageSlug: string | null
  visibleOnly: boolean
}

export type VideoStudyQuestionFilterKey = {
  videoId: string
  locale: string | null
  languageSlug: string | null
}

type VideoScopedRow = { videoId: string }

type VideoScopedFilterKey = { videoId: string }

async function loadRowsByVideoId<R extends VideoScopedRow>({
  ids,
  findMany,
}: {
  ids: readonly string[]
  findMany: (videoIds: string[]) => Promise<R[]>
}): Promise<R[][]> {
  const videoIds = unique(ids as string[])
  const rows = await findMany(videoIds)
  const rowsByVideoId = groupRowsByVideoId(rows)
  return ids.map((id) => rowsByVideoId.get(id) ?? [])
}

async function loadVideoScopedRowsByFilter<
  K extends VideoScopedFilterKey,
  R extends VideoScopedRow,
>({
  keys,
  filterKey,
  findMany,
}: {
  keys: readonly K[]
  filterKey: (key: K) => string
  findMany: (videoIds: string[], key: K) => Promise<R[]>
}): Promise<R[][]> {
  const groupedKeys = new Map<string, K[]>()
  for (const key of keys) {
    const groupKey = filterKey(key)
    groupedKeys.set(groupKey, [...(groupedKeys.get(groupKey) ?? []), key])
  }

  const rowsByLoaderKey = new Map<string, R[]>()
  await Promise.all(
    Array.from(groupedKeys.values()).map(async (group) => {
      const videoIds = unique(group.map((key) => key.videoId))
      const rows = await findMany(videoIds, group[0]!)
      const rowsByVideoId = groupRowsByVideoId(rows)
      for (const key of group) {
        rowsByLoaderKey.set(
          `${key.videoId}:${filterKey(key)}`,
          rowsByVideoId.get(key.videoId) ?? [],
        )
      }
    }),
  )

  return keys.map(
    (key) => rowsByLoaderKey.get(`${key.videoId}:${filterKey(key)}`) ?? [],
  )
}

function groupRowsByVideoId<R extends VideoScopedRow>(
  rows: R[],
): Map<string, R[]> {
  const rowsByVideoId = new Map<string, R[]>()
  for (const row of rows) {
    rowsByVideoId.set(row.videoId, [
      ...(rowsByVideoId.get(row.videoId) ?? []),
      row,
    ])
  }
  return rowsByVideoId
}

const videoRelationOrderBy = [
  { order: { sort: "asc" as const, nulls: "last" as const } },
  { createdAt: "asc" as const },
  { id: "asc" as const },
] satisfies Prisma.VideoRelationOrderByWithRelationInput[]

async function loadVideoRelationsByVideoId({
  keys,
  idField,
  visibleRelationField,
  prisma,
}: {
  keys: readonly VideoRelationVisibilityKey[]
  idField: "parentId" | "childId"
  visibleRelationField: "parent" | "child"
  prisma: PrismaClient
}): Promise<VideoRelationRow[][]> {
  const groupedKeys = new Map<boolean, VideoRelationVisibilityKey[]>()
  for (const key of keys) {
    groupedKeys.set(key.visibleOnly, [
      ...(groupedKeys.get(key.visibleOnly) ?? []),
      key,
    ])
  }

  const rowsByLoaderKey = new Map<string, VideoRelationRow[]>()
  await Promise.all(
    Array.from(groupedKeys.entries()).map(async ([visibleOnly, group]) => {
      const ids = unique(group.map((key) => key.videoId))
      const rows = await prisma.videoRelation.findMany({
        where: {
          [idField]: { in: ids },
          ...(visibleOnly
            ? {
                [visibleRelationField]: {
                  deletedAt: null,
                  locales: {
                    some: { status: "PUBLISHED" as const, deletedAt: null },
                  },
                },
              }
            : {}),
        },
        orderBy: videoRelationOrderBy,
      })

      const rowsByVideoId = new Map<string, VideoRelationRow[]>()
      for (const row of rows) {
        const videoId = row[idField]
        rowsByVideoId.set(videoId, [...(rowsByVideoId.get(videoId) ?? []), row])
      }

      for (const key of group) {
        rowsByLoaderKey.set(
          serializeVideoRelationVisibilityKey(key),
          rowsByVideoId.get(key.videoId) ?? [],
        )
      }
    }),
  )

  return keys.map(
    (key) =>
      rowsByLoaderKey.get(serializeVideoRelationVisibilityKey(key)) ?? [],
  )
}

function serializeVideoRelationVisibilityKey(
  key: VideoRelationVisibilityKey,
): string {
  return `${key.videoId}:${key.visibleOnly ? "public" : "all"}`
}

function normalizeNullableArg(value: string | null | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function serializeVideoLocaleFilter(key: VideoLocaleFilterKey): string {
  return [
    normalizeNullableArg(key.locale) ?? "",
    normalizeNullableArg(key.languageSlug) ?? "",
    key.visibleOnly ? "public" : "all",
  ].join(":")
}

function serializeVideoLocaleFilterKey(key: VideoLocaleFilterKey): string {
  return `${key.videoId}:${serializeVideoLocaleFilter(key)}`
}

function serializeVideoStudyQuestionFilter(
  key: VideoStudyQuestionFilterKey,
): string {
  return [
    normalizeNullableArg(key.locale) ?? "",
    normalizeNullableArg(key.languageSlug) ?? "",
  ].join(":")
}

function serializeVideoStudyQuestionFilterKey(
  key: VideoStudyQuestionFilterKey,
): string {
  return `${key.videoId}:${serializeVideoStudyQuestionFilter(key)}`
}

function serializeVideoByIdWithQuerySelection(query: object): string {
  return JSON.stringify(query)
}

function serializeVideoByIdWithQueryKey(key: VideoByIdWithQueryKey): string {
  return `${key.id}:${serializeVideoByIdWithQuerySelection(key.query)}`
}

function withVideoIdSelected(query: object): object {
  const prismaQuery = query as { select?: Record<string, unknown> }
  if (!prismaQuery.select) return query
  return {
    ...prismaQuery,
    select: {
      ...prismaQuery.select,
      id: true,
    },
  }
}

function normalizeVideoMuxPlaybackKey(
  key: VideoMuxPlaybackKey,
): VideoMuxPlaybackKey {
  const languageSlug =
    typeof key.languageSlug === "string" && key.languageSlug.length > 0
      ? key.languageSlug
      : null
  return { videoId: key.videoId, languageSlug }
}

function serializeVideoMuxPlaybackKey(key: VideoMuxPlaybackKey): string {
  const normalized = normalizeVideoMuxPlaybackKey(key)
  return `${normalized.videoId}:${normalized.languageSlug ?? ""}`
}

function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values))
}

// Inferring per-row shapes from prisma without importing each model
// type lets us avoid a hand-maintained type per loader. PrismaClient's
// findMany return type is the source of truth.
type ExperienceRow = Awaited<
  ReturnType<PrismaClient["experience"]["findMany"]>
>[number]
type ExperienceLocaleRow = Awaited<
  ReturnType<PrismaClient["experienceLocale"]["findMany"]>
>[number]
type VideoRow = Awaited<ReturnType<PrismaClient["video"]["findMany"]>>[number]
type VideoRelationRow = Awaited<
  ReturnType<PrismaClient["videoRelation"]["findMany"]>
>[number]
type VideoImageRow = Awaited<
  ReturnType<PrismaClient["videoImage"]["findMany"]>
>[number]
type VideoLocaleRow = Awaited<
  ReturnType<PrismaClient["videoLocale"]["findMany"]>
>[number]
type VideoStudyQuestionRow = Awaited<
  ReturnType<PrismaClient["videoStudyQuestion"]["findMany"]>
>[number]
type BibleCitationRow = Awaited<
  ReturnType<PrismaClient["bibleCitation"]["findMany"]>
>[number]
type LanguageRow = Awaited<
  ReturnType<PrismaClient["language"]["findMany"]>
>[number]

/**
 * DataLoader contract: the returned array must align with the input keys
 * and return null for keys with no matching row. `findMany` returns rows
 * in arbitrary order, so we build a map and project into the input order.
 */
function mapToInputOrder<K, R>(
  keys: readonly K[],
  rows: R[],
  rowKey: (r: R) => K,
): Array<R | null> {
  const byKey = new Map<K, R>()
  for (const row of rows) byKey.set(rowKey(row), row)
  return keys.map((k) => byKey.get(k) ?? null)
}
