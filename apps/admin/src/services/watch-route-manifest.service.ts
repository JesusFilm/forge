import { createHash } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import { z } from "zod"

const SlugRowSchema = z.object({ slug: z.string().min(1) })
const EpisodePairRowSchema = z.object({
  parentSlug: z.string().min(1),
  childSlug: z.string().min(1),
})
const ContentAudioLanguageRowSchema = z.object({
  contentSlug: z.string().min(1),
  audioLanguageSlug: z.string().min(1),
})
const EpisodeAudioLanguageRowSchema = EpisodePairRowSchema.extend({
  audioLanguageSlug: z.string().min(1),
})
const AudioLanguageIndexesByContentSchema = z.record(
  z.string().min(1),
  z.array(z.number().int().nonnegative()),
)
const AudioLanguageIndexesByEpisodeSchema = z.record(
  z.string().min(1),
  AudioLanguageIndexesByContentSchema,
)

export const WatchRouteManifestSchema = z.object({
  version: z.string().min(1),
  generatedAt: z.string().datetime(),
  contentSlugs: z.array(z.string().min(1)),
  oneSegmentSlugs: z.array(z.string().min(1)),
  // Optional for backward-compatible reads of snapshots written before the
  // localized-home admission corpus was added. New snapshots always emit it.
  homepageLocales: z.array(z.string().min(1)).optional(),
  episodePairsByParent: z.record(z.string().min(1), z.array(z.string().min(1))),
  audioLanguageSlugs: z.array(z.string().min(1)),
  audioLanguageIndexesByContent: AudioLanguageIndexesByContentSchema.default(
    {},
  ),
  audioLanguageIndexesByEpisode: AudioLanguageIndexesByEpisodeSchema.default(
    {},
  ),
})

export type WatchRouteManifest = z.infer<typeof WatchRouteManifestSchema>

export type WatchRouteManifestCounts = {
  contentSlugs: number
  oneSegmentSlugs: number
  homepageLocales: number
  parentSlugs: number
  parentChildPairs: number
  audioLanguageSlugs: number
  contentAudioLanguagePairs: number
  episodeAudioLanguagePairs: number
}

type QueryablePrisma = Pick<PrismaClient, "$queryRaw">

export class WatchRouteManifestService {
  constructor(
    private readonly prisma: QueryablePrisma,
    private readonly options: { now?: () => Date } = {},
  ) {}

  async generate(): Promise<WatchRouteManifest> {
    const startedAt = Date.now()
    const [
      contentSlugs,
      oneSegmentSlugs,
      homepageLocales,
      episodePairs,
      audioLanguageSlugs,
      audioLanguageSlugsByContent,
      audioLanguageSlugsByEpisode,
    ] = await Promise.all([
      this.loadContentSlugs(),
      this.loadOneSegmentSlugs(),
      this.loadHomepageLocales(),
      this.loadEpisodePairsByParent(),
      this.loadAudioLanguageSlugs(),
      this.loadAudioLanguageSlugsByContent(),
      this.loadAudioLanguageSlugsByEpisode(),
    ])
    const audioLanguageIndexesByContent = toAudioLanguageIndexMap(
      audioLanguageSlugsByContent,
      audioLanguageSlugs,
    )
    const audioLanguageIndexesByEpisode = toEpisodeAudioLanguageIndexMap(
      audioLanguageSlugsByEpisode,
      audioLanguageSlugs,
    )

    const generatedAt = (this.options.now?.() ?? new Date()).toISOString()
    const contentForVersion = {
      audioLanguageSlugs,
      audioLanguageIndexesByContent,
      audioLanguageIndexesByEpisode,
      contentSlugs,
      episodePairsByParent: episodePairs,
      homepageLocales,
      oneSegmentSlugs,
    }
    const version = createHash("sha256")
      .update(JSON.stringify(contentForVersion))
      .digest("hex")

    const manifest = WatchRouteManifestSchema.parse({
      version,
      generatedAt,
      contentSlugs,
      oneSegmentSlugs,
      homepageLocales,
      episodePairsByParent: episodePairs,
      audioLanguageSlugs,
      audioLanguageIndexesByContent,
      audioLanguageIndexesByEpisode,
    })

    const counts = summarizeWatchRouteManifest(manifest)
    console.log(
      JSON.stringify({
        event: "watch_route_manifest.generated",
        ...counts,
        durationMs: Date.now() - startedAt,
      }),
    )

    return manifest
  }

  private async loadContentSlugs(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<unknown[]>`
      WITH playable_video_slugs AS (
        SELECT DISTINCT v.slug
        FROM "video" v
        JOIN "video_locale" vl
          ON vl."video_id" = v.id
          AND vl.status = 'published'::"LocaleStatus"
          AND vl."deleted_at" IS NULL
        JOIN "video_dub" dub
          ON dub."video_id" = v.id
          AND dub."deleted_at" IS NULL
          AND dub.published = TRUE
          AND dub.hls IS NOT NULL
          AND dub.hls <> ''
        JOIN "language" lang
          ON lang.id = dub."language_id"
          AND lang."deleted_at" IS NULL
          AND lang.slug IS NOT NULL
          AND lang.slug <> ''
        WHERE v."deleted_at" IS NULL
          AND v.slug <> ''
      ),
      parent_video_slugs AS (
        SELECT DISTINCT parent.slug
        FROM "video" parent
        JOIN "video_locale" parent_locale
          ON parent_locale."video_id" = parent.id
          AND parent_locale.status = 'published'::"LocaleStatus"
          AND parent_locale."deleted_at" IS NULL
        JOIN "video_relation" relation
          ON relation."parent_id" = parent.id
        JOIN "video" child
          ON child.id = relation."child_id"
          AND child."deleted_at" IS NULL
          AND child.slug <> ''
        JOIN "video_locale" child_locale
          ON child_locale."video_id" = child.id
          AND child_locale.status = 'published'::"LocaleStatus"
          AND child_locale."deleted_at" IS NULL
        JOIN "video_dub" child_dub
          ON child_dub."video_id" = child.id
          AND child_dub."deleted_at" IS NULL
          AND child_dub.published = TRUE
          AND child_dub.hls IS NOT NULL
          AND child_dub.hls <> ''
        JOIN "language" child_lang
          ON child_lang.id = child_dub."language_id"
          AND child_lang."deleted_at" IS NULL
          AND child_lang.slug IS NOT NULL
          AND child_lang.slug <> ''
        WHERE parent."deleted_at" IS NULL
          AND parent.slug <> ''
      ),
      published_parent_slugs AS (
        SELECT DISTINCT parent.slug
        FROM "video" parent
        JOIN "video_locale" parent_locale
          ON parent_locale."video_id" = parent.id
          AND parent_locale.status = 'published'::"LocaleStatus"
          AND parent_locale."deleted_at" IS NULL
        JOIN "video_relation" relation
          ON relation."parent_id" = parent.id
        WHERE parent."deleted_at" IS NULL
          AND parent.slug <> ''
      ),
      experience_slugs AS (
        SELECT DISTINCT locale.slug
        FROM "experience_locale" locale
        JOIN "experience" experience
          ON experience.id = locale."experience_id"
        WHERE experience."archived_at" IS NULL
          AND experience."is_template" = FALSE
          AND locale.status = 'published'::"LocaleStatus"
          AND locale.slug <> ''
          AND locale."is_homepage" = FALSE
          AND (locale."path_segment" IS NULL OR locale."path_segment" = '')
      )
      SELECT slug FROM playable_video_slugs
      UNION
      SELECT slug FROM parent_video_slugs
      UNION
      SELECT slug FROM published_parent_slugs
      UNION
      SELECT slug FROM experience_slugs
      ORDER BY slug ASC
    `
    return SlugRowSchema.array()
      .parse(rows)
      .map((row) => row.slug)
  }

  private async loadOneSegmentSlugs(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<unknown[]>`
      SELECT DISTINCT locale.slug
      FROM "experience_locale" locale
      JOIN "experience" experience
        ON experience.id = locale."experience_id"
      WHERE experience."archived_at" IS NULL
        AND experience."is_template" = FALSE
        AND locale.status = 'published'::"LocaleStatus"
        AND locale.slug <> ''
        AND locale."is_homepage" = FALSE
        AND (locale."path_segment" IS NULL OR locale."path_segment" = '')
      ORDER BY locale.slug ASC
    `
    return SlugRowSchema.array()
      .parse(rows)
      .map((row) => row.slug)
  }

  private async loadHomepageLocales(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<unknown[]>`
      SELECT DISTINCT locale.locale AS slug
      FROM "experience_locale" locale
      JOIN "experience" experience
        ON experience.id = locale."experience_id"
      WHERE experience."archived_at" IS NULL
        AND experience."is_template" = FALSE
        AND locale.status = 'published'::"LocaleStatus"
        AND locale."is_homepage" = TRUE
        AND locale.locale <> ''
      ORDER BY locale.locale ASC
    `
    return SlugRowSchema.array()
      .parse(rows)
      .map((row) => row.slug)
  }

  private async loadEpisodePairsByParent(): Promise<Record<string, string[]>> {
    const rows = await this.prisma.$queryRaw<unknown[]>`
      SELECT DISTINCT
        parent.slug AS "parentSlug",
        child.slug AS "childSlug"
      FROM "video_relation" relation
      JOIN "video" parent
        ON parent.id = relation."parent_id"
        AND parent."deleted_at" IS NULL
        AND parent.slug <> ''
      JOIN "video_locale" parent_locale
        ON parent_locale."video_id" = parent.id
        AND parent_locale.status = 'published'::"LocaleStatus"
        AND parent_locale."deleted_at" IS NULL
      JOIN "video" child
        ON child.id = relation."child_id"
        AND child."deleted_at" IS NULL
        AND child.slug <> ''
      JOIN "video_locale" child_locale
        ON child_locale."video_id" = child.id
        AND child_locale.status = 'published'::"LocaleStatus"
        AND child_locale."deleted_at" IS NULL
      JOIN "video_dub" child_dub
        ON child_dub."video_id" = child.id
        AND child_dub."deleted_at" IS NULL
        AND child_dub.published = TRUE
        AND child_dub.hls IS NOT NULL
        AND child_dub.hls <> ''
      JOIN "language" child_lang
        ON child_lang.id = child_dub."language_id"
        AND child_lang."deleted_at" IS NULL
        AND child_lang.slug IS NOT NULL
        AND child_lang.slug <> ''
      ORDER BY parent.slug ASC, child.slug ASC
    `

    const pairs = EpisodePairRowSchema.array().parse(rows)
    const byParent = new Map<string, Set<string>>()
    for (const pair of pairs) {
      const children = byParent.get(pair.parentSlug) ?? new Set<string>()
      children.add(pair.childSlug)
      byParent.set(pair.parentSlug, children)
    }

    return Object.fromEntries(
      [...byParent.entries()].map(([parentSlug, childSlugs]) => [
        parentSlug,
        [...childSlugs].sort(),
      ]),
    )
  }

  private async loadAudioLanguageSlugs(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<unknown[]>`
      SELECT DISTINCT lang.slug
      FROM "language" lang
      JOIN "video_dub" dub
        ON dub."language_id" = lang.id
        AND dub."deleted_at" IS NULL
        AND dub.published = TRUE
        AND dub.hls IS NOT NULL
        AND dub.hls <> ''
      JOIN "video" video
        ON video.id = dub."video_id"
        AND video."deleted_at" IS NULL
      WHERE lang."deleted_at" IS NULL
        AND lang.slug IS NOT NULL
        AND lang.slug <> ''
      ORDER BY lang.slug ASC
    `
    return SlugRowSchema.array()
      .parse(rows)
      .map((row) => row.slug)
  }

  private async loadAudioLanguageSlugsByContent(): Promise<
    Record<string, string[]>
  > {
    const rows = await this.prisma.$queryRaw<unknown[]>`
      WITH playable_video_audio AS (
        SELECT DISTINCT
          v.slug AS "contentSlug",
          lang.slug AS "audioLanguageSlug"
        FROM "video" v
        JOIN "video_locale" vl
          ON vl."video_id" = v.id
          AND vl.status = 'published'::"LocaleStatus"
          AND vl."deleted_at" IS NULL
        JOIN "video_dub" dub
          ON dub."video_id" = v.id
          AND dub."deleted_at" IS NULL
          AND dub.published = TRUE
          AND dub.hls IS NOT NULL
          AND dub.hls <> ''
        JOIN "language" lang
          ON lang.id = dub."language_id"
          AND lang."deleted_at" IS NULL
          AND lang.slug IS NOT NULL
          AND lang.slug <> ''
        WHERE v."deleted_at" IS NULL
          AND v.slug <> ''
      ),
      parent_video_audio AS (
        SELECT DISTINCT
          parent.slug AS "contentSlug",
          child_lang.slug AS "audioLanguageSlug"
        FROM "video" parent
        JOIN "video_locale" parent_locale
          ON parent_locale."video_id" = parent.id
          AND parent_locale.status = 'published'::"LocaleStatus"
          AND parent_locale."deleted_at" IS NULL
        JOIN "video_relation" relation
          ON relation."parent_id" = parent.id
        JOIN "video" child
          ON child.id = relation."child_id"
          AND child."deleted_at" IS NULL
          AND child.slug <> ''
        JOIN "video_locale" child_locale
          ON child_locale."video_id" = child.id
          AND child_locale.status = 'published'::"LocaleStatus"
          AND child_locale."deleted_at" IS NULL
        JOIN "video_dub" child_dub
          ON child_dub."video_id" = child.id
          AND child_dub."deleted_at" IS NULL
          AND child_dub.published = TRUE
          AND child_dub.hls IS NOT NULL
          AND child_dub.hls <> ''
        JOIN "language" child_lang
          ON child_lang.id = child_dub."language_id"
          AND child_lang."deleted_at" IS NULL
          AND child_lang.slug IS NOT NULL
          AND child_lang.slug <> ''
        WHERE parent."deleted_at" IS NULL
          AND parent.slug <> ''
      )
      SELECT "contentSlug", "audioLanguageSlug" FROM playable_video_audio
      UNION
      SELECT "contentSlug", "audioLanguageSlug" FROM parent_video_audio
      ORDER BY "contentSlug" ASC, "audioLanguageSlug" ASC
    `

    return groupAudioLanguageRowsByContent(
      ContentAudioLanguageRowSchema.array().parse(rows),
    )
  }

  private async loadAudioLanguageSlugsByEpisode(): Promise<
    Record<string, Record<string, string[]>>
  > {
    const rows = await this.prisma.$queryRaw<unknown[]>`
      SELECT DISTINCT
        parent.slug AS "parentSlug",
        child.slug AS "childSlug",
        child_lang.slug AS "audioLanguageSlug"
      FROM "video_relation" relation
      JOIN "video" parent
        ON parent.id = relation."parent_id"
        AND parent."deleted_at" IS NULL
        AND parent.slug <> ''
      JOIN "video_locale" parent_locale
        ON parent_locale."video_id" = parent.id
        AND parent_locale.status = 'published'::"LocaleStatus"
        AND parent_locale."deleted_at" IS NULL
      JOIN "video" child
        ON child.id = relation."child_id"
        AND child."deleted_at" IS NULL
        AND child.slug <> ''
      JOIN "video_locale" child_locale
        ON child_locale."video_id" = child.id
        AND child_locale.status = 'published'::"LocaleStatus"
        AND child_locale."deleted_at" IS NULL
      JOIN "video_dub" child_dub
        ON child_dub."video_id" = child.id
        AND child_dub."deleted_at" IS NULL
        AND child_dub.published = TRUE
        AND child_dub.hls IS NOT NULL
        AND child_dub.hls <> ''
      JOIN "language" child_lang
        ON child_lang.id = child_dub."language_id"
        AND child_lang."deleted_at" IS NULL
        AND child_lang.slug IS NOT NULL
        AND child_lang.slug <> ''
      ORDER BY parent.slug ASC, child.slug ASC, child_lang.slug ASC
    `

    const byParent = new Map<string, Map<string, Set<string>>>()
    for (const row of EpisodeAudioLanguageRowSchema.array().parse(rows)) {
      const children = byParent.get(row.parentSlug) ?? new Map()
      const languages = children.get(row.childSlug) ?? new Set<string>()
      languages.add(row.audioLanguageSlug)
      children.set(row.childSlug, languages)
      byParent.set(row.parentSlug, children)
    }

    return Object.fromEntries(
      [...byParent.entries()].map(([parentSlug, children]) => [
        parentSlug,
        Object.fromEntries(
          [...children.entries()].map(([childSlug, audioLanguageSlugs]) => [
            childSlug,
            [...audioLanguageSlugs].sort(),
          ]),
        ),
      ]),
    )
  }
}

function groupAudioLanguageRowsByContent(
  rows: z.infer<typeof ContentAudioLanguageRowSchema>[],
): Record<string, string[]> {
  const byContent = new Map<string, Set<string>>()
  for (const row of rows) {
    const languages = byContent.get(row.contentSlug) ?? new Set<string>()
    languages.add(row.audioLanguageSlug)
    byContent.set(row.contentSlug, languages)
  }

  return Object.fromEntries(
    [...byContent.entries()].map(([contentSlug, audioLanguageSlugs]) => [
      contentSlug,
      [...audioLanguageSlugs].sort(),
    ]),
  )
}

function audioLanguageIndexBySlug(
  audioLanguageSlugs: readonly string[],
): ReadonlyMap<string, number> {
  return new Map(audioLanguageSlugs.map((slug, index) => [slug, index]))
}

function toAudioLanguageIndexMap(
  bySlug: Record<string, string[]>,
  audioLanguageSlugs: readonly string[],
): Record<string, number[]> {
  const indexBySlug = audioLanguageIndexBySlug(audioLanguageSlugs)
  return Object.fromEntries(
    Object.entries(bySlug).map(([contentSlug, slugs]) => [
      contentSlug,
      slugs
        .map((slug) => indexBySlug.get(slug))
        .filter((index): index is number => index !== undefined)
        .sort((a, b) => a - b),
    ]),
  )
}

function toEpisodeAudioLanguageIndexMap(
  bySlug: Record<string, Record<string, string[]>>,
  audioLanguageSlugs: readonly string[],
): Record<string, Record<string, number[]>> {
  return Object.fromEntries(
    Object.entries(bySlug).map(([parentSlug, children]) => [
      parentSlug,
      toAudioLanguageIndexMap(children, audioLanguageSlugs),
    ]),
  )
}

export function summarizeWatchRouteManifest(
  manifest: Pick<
    WatchRouteManifest,
    | "audioLanguageSlugs"
    | "audioLanguageIndexesByContent"
    | "audioLanguageIndexesByEpisode"
    | "contentSlugs"
    | "episodePairsByParent"
    | "homepageLocales"
    | "oneSegmentSlugs"
  >,
): WatchRouteManifestCounts {
  const parentEntries = Object.entries(manifest.episodePairsByParent)
  const episodeAudioEntries = Object.values(
    manifest.audioLanguageIndexesByEpisode,
  )
  return {
    contentSlugs: manifest.contentSlugs.length,
    oneSegmentSlugs: manifest.oneSegmentSlugs.length,
    homepageLocales: manifest.homepageLocales?.length ?? 0,
    parentSlugs: parentEntries.length,
    parentChildPairs: parentEntries.reduce(
      (sum, [, childSlugs]) => sum + childSlugs.length,
      0,
    ),
    audioLanguageSlugs: manifest.audioLanguageSlugs.length,
    contentAudioLanguagePairs: Object.values(
      manifest.audioLanguageIndexesByContent,
    ).reduce(
      (sum, audioLanguageIndexes) => sum + audioLanguageIndexes.length,
      0,
    ),
    episodeAudioLanguagePairs: episodeAudioEntries.reduce(
      (sum, children) =>
        sum +
        Object.values(children).reduce(
          (childSum, audioLanguageIndexes) =>
            childSum + audioLanguageIndexes.length,
          0,
        ),
      0,
    ),
  }
}
