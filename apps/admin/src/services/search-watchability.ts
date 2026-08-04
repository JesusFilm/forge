import { Prisma, type PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { isEditorOrAdmin } from "@/auth/principal"

// Core's per-platform view restriction (`Video.restrictViewPlatforms`,
// synced read-only — see core-sync/phases/sync-videos.ts). Only the "watch"
// platform is checked: Forge's web/mobile/tv apps all consume the one
// `apps/admin` GraphQL schema (no per-forge-client granularity exists or is
// needed), so Core's single "watch" restriction correctly maps to "hide from
// all three." EDITOR/ADMIN callers always bypass this — the dashboard needs
// to keep showing restricted videos so editors can review/manage them.
export function isRestrictedFromWatch(
  restrictViewPlatforms: readonly string[],
): boolean {
  return restrictViewPlatforms.includes("watch")
}

export function notRestrictedFromWatchWhere(): Prisma.VideoWhereInput {
  return { NOT: { restrictViewPlatforms: { has: "watch" } } }
}

export function watchVisibilityWhere(
  user: Principal | null,
): Prisma.VideoWhereInput {
  return isEditorOrAdmin(user) ? {} : notRestrictedFromWatchWhere()
}

export type SearchWatchabilityKind =
  | "target_audio"
  | "target_subtitle"
  | "related_language"
  | "unavailable"

export type SearchWatchabilityCandidate = {
  videoId: string
  editionId?: string | null
}

export type SearchWatchability = {
  videoId: string
  kind: SearchWatchabilityKind
  languageSlug: string | null
  languageEnglishName: string | null
  audio: boolean
  subtitles: boolean
  playbackId: string | null
  videoDubId: string | null
  videoSubtitleId: string | null
  durationSeconds: number | null
  hrefLanguageSlug: string | null
}

type LanguageRow = {
  id: string
  slug: string | null
  name: unknown
}

type TargetDubRow = {
  id: string
  videoId: string
  duration: number | null
  language: LanguageRow | null
  muxVideo: { playbackId: string | null } | null
}

type SubtitleRow = {
  id: string
  videoId: string
  language: LanguageRow | null
}

type FallbackLanguageRow = {
  id: string
  priority: number
}

const EMPTY_WATCHABILITY: Omit<SearchWatchability, "videoId"> = {
  kind: "unavailable",
  languageSlug: null,
  languageEnglishName: null,
  audio: false,
  subtitles: false,
  playbackId: null,
  videoDubId: null,
  videoSubtitleId: null,
  durationSeconds: null,
  hrefLanguageSlug: null,
}

function englishNameFromLanguageName(value: unknown): string | null {
  if (value && typeof value === "object" && "en" in value) {
    const english = (value as { en?: unknown }).en
    return typeof english === "string" && english.trim() ? english : null
  }
  return null
}

function uniqueVideoIds(
  candidates: readonly SearchWatchabilityCandidate[],
): string[] {
  return [...new Set(candidates.map((candidate) => candidate.videoId))]
}

function playableDubWhere(videoIds: readonly string[]) {
  return {
    videoId: { in: [...videoIds] },
    deletedAt: null,
    published: true,
    AND: [{ hls: { not: null } }, { hls: { not: "" } }],
    video: {
      deletedAt: null,
      noIndex: false,
      locales: { some: { status: "PUBLISHED" as const, deletedAt: null } },
      ...notRestrictedFromWatchWhere(),
    },
    OR: [{ videoEditionId: null }, { videoEdition: { deletedAt: null } }],
  }
}

function firstByVideoId<T extends { videoId: string }>(rows: readonly T[]) {
  const byVideoId = new Map<string, T>()
  for (const row of rows) {
    if (!byVideoId.has(row.videoId)) byVideoId.set(row.videoId, row)
  }
  return byVideoId
}

function firstFallbackByVideoId(
  rows: readonly TargetDubRow[],
  priorityByLanguageId: ReadonlyMap<string, number>,
) {
  const byVideoId = new Map<string, TargetDubRow>()
  for (const row of rows) {
    const existing = byVideoId.get(row.videoId)
    if (!existing) {
      byVideoId.set(row.videoId, row)
      continue
    }

    const rowPriority = priorityByLanguageId.get(row.language?.id ?? "") ?? 100
    const existingPriority =
      priorityByLanguageId.get(existing.language?.id ?? "") ?? 100
    if (rowPriority < existingPriority) {
      byVideoId.set(row.videoId, row)
      continue
    }
    if (rowPriority > existingPriority) continue

    const rowDuration = row.duration ?? -1
    const existingDuration = existing.duration ?? -1
    if (rowDuration > existingDuration) {
      byVideoId.set(row.videoId, row)
      continue
    }
    if (rowDuration < existingDuration) continue

    if (row.id.localeCompare(existing.id) < 0) byVideoId.set(row.videoId, row)
  }
  return byVideoId
}

function watchabilityFromDub(
  row: TargetDubRow,
  kind: Extract<SearchWatchabilityKind, "target_audio" | "related_language">,
): SearchWatchability {
  const languageSlug = row.language?.slug ?? null
  return {
    videoId: row.videoId,
    kind,
    languageSlug,
    languageEnglishName: englishNameFromLanguageName(row.language?.name),
    audio: true,
    subtitles: false,
    playbackId: row.muxVideo?.playbackId ?? null,
    videoDubId: row.id,
    videoSubtitleId: null,
    durationSeconds: row.duration,
    hrefLanguageSlug: languageSlug,
  }
}

function watchabilityFromSubtitle(
  row: SubtitleRow,
  videoId: string,
): SearchWatchability {
  const languageSlug = row.language?.slug ?? null
  return {
    videoId,
    kind: "target_subtitle",
    languageSlug,
    languageEnglishName: englishNameFromLanguageName(row.language?.name),
    audio: false,
    subtitles: true,
    playbackId: null,
    videoDubId: null,
    videoSubtitleId: row.id,
    durationSeconds: null,
    hrefLanguageSlug: languageSlug,
  }
}

export class SearchWatchabilityService {
  constructor(private readonly prisma: PrismaClient) {}

  private async relatedFallbackLanguages(
    sourceLanguageId: string,
  ): Promise<FallbackLanguageRow[]> {
    return this.prisma.$queryRaw<FallbackLanguageRow[]>(Prisma.sql`
      SELECT
        fallback_language_id AS "id",
        priority
      FROM language_fallback
      WHERE source_language_id = ${sourceLanguageId}
        AND deleted_at IS NULL
      ORDER BY priority ASC, fallback_language_id ASC
      LIMIT 12
    `)
  }

  private async targetSubtitlesForVideos(
    videoIds: readonly string[],
    languageId: string,
  ): Promise<SubtitleRow[]> {
    if (videoIds.length === 0) return []

    return this.prisma.$queryRaw<SubtitleRow[]>(Prisma.sql`
      SELECT DISTINCT ON (COALESCE(vs.video_id, vd.video_id))
        vs.id,
        COALESCE(vs.video_id, vd.video_id) AS "videoId",
        jsonb_build_object(
          'id', l.id,
          'slug', l.slug,
          'name', l.name
        ) AS language
      FROM video_subtitle vs
      JOIN video_edition ve
        ON ve.id = vs.video_edition_id
       AND ve.deleted_at IS NULL
      JOIN video_dub vd
        ON vd.video_edition_id = vs.video_edition_id
       AND vd.deleted_at IS NULL
       AND vd.video_id IN (${Prisma.join(videoIds)})
      LEFT JOIN language l
        ON l.id = vs.language_id
       AND l.deleted_at IS NULL
       AND l.slug IS NOT NULL
      WHERE vs.deleted_at IS NULL
        AND vs.language_id = ${languageId}
        AND (vs.vtt_src IS NOT NULL OR vs.srt_src IS NOT NULL)
      ORDER BY COALESCE(vs.video_id, vd.video_id), vs.id ASC
    `)
  }

  async hydrate({
    candidates,
    targetLanguageSlug,
    includeOtherLanguageFallback = true,
  }: {
    candidates: readonly SearchWatchabilityCandidate[]
    targetLanguageSlug: string
    includeOtherLanguageFallback?: boolean
  }): Promise<Map<string, SearchWatchability>> {
    const videoIds = uniqueVideoIds(candidates)
    const result = new Map<string, SearchWatchability>(
      videoIds.map((videoId) => [videoId, { videoId, ...EMPTY_WATCHABILITY }]),
    )
    if (videoIds.length === 0) return result

    const targetLanguage = await this.prisma.language.findFirst({
      where: { slug: targetLanguageSlug, deletedAt: null },
      select: { id: true, slug: true, name: true },
    })
    if (!targetLanguage) return result

    const targetDubs = await this.prisma.videoDub.findMany({
      where: {
        ...playableDubWhere(videoIds),
        languageId: targetLanguage.id,
        language: { deletedAt: null, slug: { not: null } },
      },
      orderBy: [{ videoId: "asc" }, { duration: "desc" }, { id: "asc" }],
      select: {
        id: true,
        videoId: true,
        duration: true,
        language: { select: { id: true, slug: true, name: true } },
        muxVideo: { select: { playbackId: true } },
      },
    })

    for (const [videoId, row] of firstByVideoId(targetDubs as TargetDubRow[])) {
      result.set(videoId, watchabilityFromDub(row, "target_audio"))
    }

    const unresolvedAfterTargetAudio = videoIds.filter(
      (videoId) => result.get(videoId)?.kind === "unavailable",
    )
    const targetSubtitles = await this.targetSubtitlesForVideos(
      unresolvedAfterTargetAudio,
      targetLanguage.id,
    )

    for (const row of targetSubtitles) {
      const videoId = row.videoId
      const current = result.get(videoId)
      if (current?.kind === "target_audio") continue
      result.set(videoId, watchabilityFromSubtitle(row, videoId))
    }

    const unresolvedVideoIds = videoIds.filter(
      (videoId) => result.get(videoId)?.kind === "unavailable",
    )
    if (includeOtherLanguageFallback && unresolvedVideoIds.length > 0) {
      const fallbackLanguages = await this.relatedFallbackLanguages(
        targetLanguage.id,
      )
      const fallbackLanguageIds = fallbackLanguages.map((row) => row.id)
      if (fallbackLanguageIds.length > 0) {
        const priorityByLanguageId = new Map(
          fallbackLanguages.map((row) => [row.id, row.priority]),
        )
        const fallbackDubs = await this.prisma.videoDub.findMany({
          where: {
            ...playableDubWhere(unresolvedVideoIds),
            languageId: { in: fallbackLanguageIds },
            language: { deletedAt: null, slug: { not: null } },
          },
          orderBy: [{ videoId: "asc" }, { duration: "desc" }, { id: "asc" }],
          select: {
            id: true,
            videoId: true,
            duration: true,
            language: { select: { id: true, slug: true, name: true } },
            muxVideo: { select: { playbackId: true } },
          },
        })

        for (const [videoId, row] of firstFallbackByVideoId(
          fallbackDubs as TargetDubRow[],
          priorityByLanguageId,
        )) {
          result.set(videoId, watchabilityFromDub(row, "related_language"))
        }
      }
    }

    return result
  }
}
