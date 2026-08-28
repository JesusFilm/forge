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
  | "container"
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
  editionId: string
  videoDubId: string
  playbackId: string | null
  durationSeconds: number | null
  language: LanguageRow | null
  audioLanguage: LanguageRow | null
}

type FallbackLanguageRow = {
  id: string
  priority: number
}

/**
 * A Series-Shaped candidate resolved from a playable descendant rather than a
 * Dub of its own. `videoId` is the container; the language columns describe the
 * descendant Dub that made it browsable.
 */
type DescendantRow = {
  videoId: string
  language: LanguageRow | null
}

const PUBLIC_LANGUAGE_SLUG_PATTERN = /^[a-z0-9-]+$/

/**
 * Public Watch content-slug shape, matching web's `ContentSlug` pattern in
 * apps/web/src/lib/routes.ts. Lowercase is load-bearing: internal-style Core
 * slugs (`Nua_Know_God`) have no public Watch route at all, so a container
 * carrying one must stay unavailable rather than gain a link that bounces to
 * /watch.
 */
const PUBLIC_CONTENT_SLUG_SQL_PATTERN = "^[a-z0-9_-]+$"

/**
 * Series-Shaped labels, as stored (the VideoLabel enum's @map values). Per
 * CONCEPTS.md the test is label-only — children are deliberately not part of
 * it, because a feature film may carry Chapters while remaining one playable
 * item.
 */
const SERIES_SHAPED_LABELS = ["collection", "series"] as const

/**
 * How many `video_relation` levels the container tier walks. Two covers every
 * container in the catalog today, including the collection-of-series nests
 * (the-bibleproject-collection, life-of-jesus-series, days-with-jesus) whose
 * playability lives on grandchildren. The cap is explicit because
 * `video_relation` has no cycle constraint — an unbounded walk on a cyclic row
 * does not terminate.
 */
const CONTAINER_DESCENDANT_MAX_DEPTH = 2

/**
 * Public-Watch visibility for one node of the descendant walk, written once and
 * interpolated into both terms of the recursive CTE. It gates TRAVERSAL, not
 * just evaluation: a hidden intermediate must not carry a visible grandchild
 * into the result, or a collection whose only playable descendant sits behind a
 * watch-restricted series reads as browsable while its series page renders that
 * intermediate out and shows nothing.
 *
 * Mirrors `playableDubWhere()`'s nested `video` clause. Raw SQL cannot import
 * that Prisma helper; the db-suite cases are the enforcement point for parity.
 */
const VISIBLE_DESCENDANT_SQL = Prisma.sql`
           descendant_video.deleted_at IS NULL
       AND descendant_video.no_index = FALSE
       AND NOT ('watch' = ANY(descendant_video.restrict_view_platforms))
       AND EXISTS (
         SELECT 1
         FROM video_locale descendant_locale
         WHERE descendant_locale.video_id = descendant_video.id
           AND descendant_locale.deleted_at IS NULL
           AND descendant_locale.status = 'published'
       )`

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

function publicLanguageSlug(value: string | null | undefined): string | null {
  return value && PUBLIC_LANGUAGE_SLUG_PATTERN.test(value) ? value : null
}

function uniqueVideoIds(
  candidates: readonly SearchWatchabilityCandidate[],
): string[] {
  return [...new Set(candidates.map((candidate) => candidate.videoId))]
}

function uniqueCandidates(
  candidates: readonly SearchWatchabilityCandidate[],
): SearchWatchabilityCandidate[] {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = `${candidate.videoId}\u0000${candidate.editionId ?? ""}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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
    if (!publicLanguageSlug(row.language?.slug)) continue

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
  const languageSlug = publicLanguageSlug(row.language?.slug)
  if (!languageSlug) return { videoId: row.videoId, ...EMPTY_WATCHABILITY }

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

function watchabilityFromSubtitle(row: SubtitleRow): SearchWatchability {
  const languageSlug = publicLanguageSlug(row.language?.slug)
  const hrefLanguageSlug = publicLanguageSlug(row.audioLanguage?.slug)
  return {
    videoId: row.videoId,
    kind: "target_subtitle",
    languageSlug,
    languageEnglishName: englishNameFromLanguageName(row.language?.name),
    audio: false,
    subtitles: true,
    playbackId: row.playbackId,
    videoDubId: row.videoDubId,
    videoSubtitleId: row.id,
    durationSeconds: row.durationSeconds,
    hrefLanguageSlug,
  }
}

/**
 * Build the watchability record for a container resolved from a descendant.
 * There is no Dub of the container's own, so playback identity stays null and
 * only the browse language is carried.
 */
function watchabilityFromDescendant(row: DescendantRow): SearchWatchability {
  const languageSlug = publicLanguageSlug(row.language?.slug)
  if (!languageSlug) return { videoId: row.videoId, ...EMPTY_WATCHABILITY }

  return {
    videoId: row.videoId,
    kind: "container",
    languageSlug,
    languageEnglishName: englishNameFromLanguageName(row.language?.name),
    audio: false,
    subtitles: false,
    playbackId: null,
    videoDubId: null,
    videoSubtitleId: null,
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

  private async targetSubtitlesForCandidates(
    candidates: readonly SearchWatchabilityCandidate[],
    languageId: string,
  ): Promise<SubtitleRow[]> {
    const unique = uniqueCandidates(candidates)
    if (unique.length === 0) return []

    const candidateRows = Prisma.join(
      unique.map(
        (candidate) =>
          Prisma.sql`(${candidate.videoId}::text, ${candidate.editionId ?? null}::text)`,
      ),
    )

    return this.prisma.$queryRaw<SubtitleRow[]>(Prisma.sql`
      WITH candidate(video_id, video_edition_id) AS (
        VALUES ${candidateRows}
      )
      SELECT DISTINCT ON (candidate.video_id)
        vs.id,
        candidate.video_id AS "videoId",
        vs.video_edition_id AS "editionId",
        fallback_action.id AS "videoDubId",
        fallback_action.duration AS "durationSeconds",
        fallback_action.playback_id AS "playbackId",
        jsonb_build_object(
          'id', target_language.id,
          'slug', target_language.slug,
          'name', target_language.name
        ) AS language,
        fallback_action.language AS "audioLanguage"
      FROM candidate
      JOIN video video
        ON video.id = candidate.video_id
       AND video.deleted_at IS NULL
       AND video.no_index = FALSE
       AND EXISTS (
         SELECT 1
         FROM video_locale published_locale
         WHERE published_locale.video_id = video.id
           AND published_locale.deleted_at IS NULL
           AND published_locale.status = 'published'
       )
      JOIN video_subtitle vs
        ON (candidate.video_edition_id IS NULL
          OR vs.video_edition_id = candidate.video_edition_id)
       AND (vs.video_id IS NULL OR vs.video_id = candidate.video_id)
       AND vs.deleted_at IS NULL
       AND vs.language_id = ${languageId}
       AND NULLIF(BTRIM(vs.vtt_src), '') IS NOT NULL
      JOIN video_edition ve
        ON ve.id = vs.video_edition_id
       AND ve.deleted_at IS NULL
      JOIN language target_language
        ON target_language.id = vs.language_id
       AND target_language.deleted_at IS NULL
       AND target_language.slug IS NOT NULL
       AND target_language.slug ~ '^[a-z0-9-]+$'
      JOIN LATERAL (
        SELECT
          fallback_dub.id,
          fallback_dub.duration,
          mux_video.playback_id,
          CASE
            WHEN video.primary_language_id = fallback_language.id THEN 0
            WHEN fallback_language.slug = 'english' THEN 1
            ELSE 2
          END AS action_priority,
          fallback_language.slug AS language_slug,
          jsonb_build_object(
            'id', fallback_language.id,
            'slug', fallback_language.slug,
            'name', fallback_language.name
          ) AS language
        FROM video_dub fallback_dub
        JOIN language fallback_language
          ON fallback_language.id = fallback_dub.language_id
         AND fallback_language.deleted_at IS NULL
         AND fallback_language.slug IS NOT NULL
         AND fallback_language.slug ~ '^[a-z0-9-]+$'
        LEFT JOIN mux_video
          ON mux_video.id = fallback_dub.mux_video_id
         AND mux_video.deleted_at IS NULL
        WHERE fallback_dub.video_id = candidate.video_id
          AND fallback_dub.video_edition_id = vs.video_edition_id
          AND fallback_dub.deleted_at IS NULL
          AND fallback_dub.published = TRUE
          AND NULLIF(BTRIM(fallback_dub.hls), '') IS NOT NULL
        ORDER BY
          CASE
            WHEN video.primary_language_id = fallback_language.id THEN 0
            WHEN fallback_language.slug = 'english' THEN 1
            ELSE 2
          END ASC,
          fallback_dub.duration DESC NULLS LAST,
          fallback_language.slug ASC,
          fallback_dub.id ASC
        LIMIT 1
      ) fallback_action ON TRUE
      ORDER BY
        candidate.video_id,
        fallback_action.action_priority ASC,
        fallback_action.duration DESC NULLS LAST,
        fallback_action.language_slug ASC,
        fallback_action.id ASC,
        vs.video_edition_id ASC,
        CASE WHEN vs.video_id = candidate.video_id THEN 0 ELSE 1 END ASC,
        vs.id ASC
    `)
  }

  /**
   * Resolve Series-Shaped candidates from their playable descendants.
   *
   * The three preceding tiers all join through a Dub the candidate owns, which
   * is where they inherit `playableDubWhere()`'s visibility conditions — that
   * helper's nested `video` clause carries `notRestrictedFromWatchWhere()` for
   * the candidate itself. This tier has no such join, so the root's own
   * conditions are restated here: publication, no_index, a public slug, and the
   * `watch` platform restriction. Dropping any of them turns a hidden
   * collection into an available card.
   *
   * Descendant conditions mirror `playableDubWhere()` field for field. The
   * db-suite cases in search-watchability.db.test.ts are the enforcement point
   * for that parity — raw SQL cannot import the Prisma helper.
   */
  private async containersForCandidates(
    videoIds: readonly string[],
    targetLanguageId: string,
    fallbackLanguageIds: readonly string[],
  ): Promise<DescendantRow[]> {
    if (videoIds.length === 0) return []

    const acceptedLanguageIds = [targetLanguageId, ...fallbackLanguageIds]

    return this.prisma.$queryRaw<DescendantRow[]>(Prisma.sql`
      WITH RECURSIVE root AS (
        SELECT container.id
        FROM video container
        WHERE container.id IN (${Prisma.join([...videoIds])})
          AND container.deleted_at IS NULL
          AND container.no_index = FALSE
          AND container.label::text = ANY(${[...SERIES_SHAPED_LABELS]}::text[])
          AND container.slug ~ ${PUBLIC_CONTENT_SLUG_SQL_PATTERN}
          AND NOT ('watch' = ANY(container.restrict_view_platforms))
          AND EXISTS (
            SELECT 1
            FROM video_locale root_locale
            WHERE root_locale.video_id = container.id
              AND root_locale.deleted_at IS NULL
              AND root_locale.status = 'published'
          )
      ),
      descendant(root_id, video_id, depth) AS (
        SELECT root.id, descendant_video.id, 1
        FROM root
        JOIN video_relation relation ON relation.parent_id = root.id
        JOIN video descendant_video
          ON descendant_video.id = relation.child_id
         AND ${VISIBLE_DESCENDANT_SQL}
        UNION ALL
        SELECT descendant.root_id, descendant_video.id, descendant.depth + 1
        FROM descendant
        JOIN video_relation relation ON relation.parent_id = descendant.video_id
        JOIN video descendant_video
          ON descendant_video.id = relation.child_id
         AND ${VISIBLE_DESCENDANT_SQL}
        WHERE descendant.depth < ${CONTAINER_DESCENDANT_MAX_DEPTH}
      )
      SELECT DISTINCT ON (descendant.root_id)
        descendant.root_id AS "videoId",
        jsonb_build_object(
          'id', dub_language.id,
          'slug', dub_language.slug,
          'name', dub_language.name
        ) AS language
      FROM descendant
      JOIN video_dub child_dub
        ON child_dub.video_id = descendant.video_id
       AND child_dub.deleted_at IS NULL
       AND child_dub.published = TRUE
       AND NULLIF(BTRIM(child_dub.hls), '') IS NOT NULL
       AND child_dub.language_id = ANY(${[...acceptedLanguageIds]}::text[])
      LEFT JOIN video_edition child_edition
        ON child_edition.id = child_dub.video_edition_id
      JOIN language dub_language
        ON dub_language.id = child_dub.language_id
       AND dub_language.deleted_at IS NULL
       AND dub_language.slug IS NOT NULL
       AND dub_language.slug ~ '^[a-z0-9-]+$'
      WHERE (child_dub.video_edition_id IS NULL OR child_edition.deleted_at IS NULL)
      ORDER BY
        descendant.root_id,
        array_position(${[...acceptedLanguageIds]}::text[], child_dub.language_id) ASC,
        descendant.depth ASC,
        child_dub.duration DESC NULLS LAST,
        dub_language.slug ASC,
        child_dub.id ASC
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

    const publicTargetDubs = (targetDubs as TargetDubRow[]).filter((row) =>
      publicLanguageSlug(row.language?.slug),
    )
    for (const [videoId, row] of firstByVideoId(publicTargetDubs)) {
      result.set(videoId, watchabilityFromDub(row, "target_audio"))
    }

    const unresolvedAfterTargetAudio = candidates.filter(
      (candidate) => result.get(candidate.videoId)?.kind === "unavailable",
    )
    const targetSubtitles = await this.targetSubtitlesForCandidates(
      unresolvedAfterTargetAudio,
      targetLanguage.id,
    )

    for (const row of targetSubtitles) {
      const videoId = row.videoId
      const current = result.get(videoId)
      if (current?.kind === "target_audio") continue
      result.set(videoId, watchabilityFromSubtitle(row))
    }

    const unresolvedVideoIds = videoIds.filter(
      (videoId) => result.get(videoId)?.kind === "unavailable",
    )
    // Resolved once and shared with the container tier below, so a run that
    // needs both does not read language_fallback twice.
    const fallbackLanguages =
      includeOtherLanguageFallback && unresolvedVideoIds.length > 0
        ? await this.relatedFallbackLanguages(targetLanguage.id)
        : []
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

    // Container tier. Runs last and only over candidates no self-scoped tier
    // resolved, so a Series-Shaped Video carrying its own playable Dub keeps
    // the state that Dub earned it — descendants never override direct
    // playback — and a leaf-only result set issues no extra query.
    const unresolvedAfterFallback = videoIds.filter(
      (videoId) => result.get(videoId)?.kind === "unavailable",
    )
    if (unresolvedAfterFallback.length > 0) {
      const containers = await this.containersForCandidates(
        unresolvedAfterFallback,
        targetLanguage.id,
        fallbackLanguageIds,
      )
      for (const row of containers) {
        if (result.get(row.videoId)?.kind !== "unavailable") continue
        const watchability = watchabilityFromDescendant(row)
        if (watchability.kind !== "container") continue
        result.set(row.videoId, watchability)
      }
    }

    return result
  }
}
