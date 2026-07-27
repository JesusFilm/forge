import { createHash } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import { z } from "zod"

const LanguageAlternateSchema = z.object({
  hreflang: z.string().min(2),
  languageSlug: z.string().min(1),
})

const VideoRouteGroupSchema = z.object({
  contentSlug: z.string().min(1),
  alternates: z.array(LanguageAlternateSchema),
})

const EpisodeRouteGroupSchema = z.object({
  parentSlug: z.string().min(1),
  childSlug: z.string().min(1),
  alternates: z.array(LanguageAlternateSchema),
})

const ContentLanguageRowSchema = z.object({
  contentSlug: z.string().min(1),
  languageSlug: z.string().min(1),
  bcp47: z.string().nullable(),
})

const EpisodeLanguageRowSchema = z.object({
  parentSlug: z.string().min(1),
  childSlug: z.string().min(1),
  languageSlug: z.string().min(1),
  bcp47: z.string().nullable(),
})

export const WatchSeoManifestSchema = z.object({
  version: z.string().min(1),
  generatedAt: z.string().datetime(),
  videoRouteGroups: z.array(VideoRouteGroupSchema),
  episodeRouteGroups: z.array(EpisodeRouteGroupSchema),
  skippedHreflangValues: z.record(z.string().min(1), z.number().int().min(1)),
})

export type WatchSeoManifest = z.infer<typeof WatchSeoManifestSchema>
export type WatchSeoManifestCounts = {
  videoRouteGroups: number
  episodeRouteGroups: number
  alternateLinks: number
  skippedHreflangValues: number
}

export class WatchSeoManifestCoverageError extends Error {
  constructor(
    readonly childSlug: string,
    readonly languageSlug: string,
  ) {
    super(
      `Watch SEO manifest canonical coverage missing for child "${childSlug}" and language "${languageSlug}"`,
    )
    this.name = "WatchSeoManifestCoverageError"
  }
}

type QueryablePrisma = Pick<PrismaClient, "$queryRaw">
type ContentLanguageRow = z.infer<typeof ContentLanguageRowSchema>
type EpisodeLanguageRow = z.infer<typeof EpisodeLanguageRowSchema>
type LanguageAlternate = z.infer<typeof LanguageAlternateSchema>

export class WatchSeoManifestService {
  constructor(
    private readonly prisma: QueryablePrisma,
    private readonly options: { now?: () => Date } = {},
  ) {}

  async generate(): Promise<WatchSeoManifest> {
    const startedAt = Date.now()
    const [contentRows, episodeRows] = await Promise.all([
      this.loadContentLanguageRows(),
      this.loadEpisodeLanguageRows(),
    ])
    const skippedHreflangValues: Record<string, number> = {}
    const videoRouteGroups = toVideoRouteGroups(
      contentRows,
      skippedHreflangValues,
    )
    const episodeRouteGroups = toEpisodeRouteGroups(
      episodeRows,
      skippedHreflangValues,
    )
    assertEpisodeCanonicalCoverage(videoRouteGroups, episodeRouteGroups)
    const generatedAt = (this.options.now?.() ?? new Date()).toISOString()
    const contentForVersion = {
      episodeRouteGroups,
      skippedHreflangValues,
      videoRouteGroups,
    }
    const version = createHash("sha256")
      .update(JSON.stringify(contentForVersion))
      .digest("hex")

    const manifest = WatchSeoManifestSchema.parse({
      version,
      generatedAt,
      videoRouteGroups,
      episodeRouteGroups,
      skippedHreflangValues,
    })

    const counts = summarizeWatchSeoManifest(manifest)
    console.log(
      JSON.stringify({
        event: "watch_seo_manifest.generated",
        ...counts,
        durationMs: Date.now() - startedAt,
      }),
    )

    return manifest
  }

  private async loadContentLanguageRows(): Promise<ContentLanguageRow[]> {
    const rows = await this.prisma.$queryRaw<unknown[]>`
      WITH playable_video_audio AS (
        SELECT DISTINCT
          v.slug AS "contentSlug",
          lang.slug AS "languageSlug",
          lang.bcp47 AS "bcp47"
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
          child_lang.slug AS "languageSlug",
          child_lang.bcp47 AS "bcp47"
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
      SELECT "contentSlug", "languageSlug", "bcp47" FROM playable_video_audio
      UNION
      SELECT "contentSlug", "languageSlug", "bcp47" FROM parent_video_audio
      ORDER BY "contentSlug" ASC, "bcp47" ASC NULLS LAST, "languageSlug" ASC
    `

    return ContentLanguageRowSchema.array().parse(rows)
  }

  private async loadEpisodeLanguageRows(): Promise<EpisodeLanguageRow[]> {
    const rows = await this.prisma.$queryRaw<unknown[]>`
      SELECT DISTINCT
        parent.slug AS "parentSlug",
        child.slug AS "childSlug",
        child_lang.slug AS "languageSlug",
        child_lang.bcp47 AS "bcp47"
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
      ORDER BY parent.slug ASC, child.slug ASC, child_lang.bcp47 ASC NULLS LAST, child_lang.slug ASC
    `

    return EpisodeLanguageRowSchema.array().parse(rows)
  }
}

function assertEpisodeCanonicalCoverage(
  videoRouteGroups: WatchSeoManifest["videoRouteGroups"],
  episodeRouteGroups: WatchSeoManifest["episodeRouteGroups"],
): void {
  const canonicalPairs = new Set(
    videoRouteGroups.flatMap((group) =>
      group.alternates.map(
        (alternate) => `${group.contentSlug}\u0000${alternate.languageSlug}`,
      ),
    ),
  )

  for (const group of episodeRouteGroups) {
    for (const alternate of group.alternates) {
      if (
        !canonicalPairs.has(`${group.childSlug}\u0000${alternate.languageSlug}`)
      ) {
        throw new WatchSeoManifestCoverageError(
          group.childSlug,
          alternate.languageSlug,
        )
      }
    }
  }
}

function incrementSkipped(
  skippedHreflangValues: Record<string, number>,
  key: string,
): void {
  skippedHreflangValues[key] = (skippedHreflangValues[key] ?? 0) + 1
}

export function normalizeGoogleHreflang(value: string | null): string | null {
  if (!value) return null
  const parts = value.trim().replace(/_/g, "-").split("-")
  if (parts.length !== 1 && parts.length !== 2) return null

  const language = parts[0]?.toLowerCase()
  if (!language || !/^[a-z]{2}$/.test(language)) return null
  if (parts.length === 1) return language

  const region = parts[1]?.toUpperCase()
  if (!region || !/^[A-Z]{2}$/.test(region)) return null
  return `${language}-${region}`
}

function toAlternates(
  rows: Array<{ bcp47: string | null; languageSlug: string }>,
  skippedHreflangValues: Record<string, number>,
): LanguageAlternate[] {
  const byHreflang = new Map<string, LanguageAlternate>()
  for (const row of rows) {
    const hreflang = normalizeGoogleHreflang(row.bcp47)
    if (!hreflang) {
      incrementSkipped(skippedHreflangValues, row.bcp47 ?? "missing_bcp47")
      continue
    }
    if (byHreflang.has(hreflang)) {
      incrementSkipped(skippedHreflangValues, `duplicate:${hreflang}`)
      continue
    }
    byHreflang.set(hreflang, {
      hreflang,
      languageSlug: row.languageSlug,
    })
  }
  return [...byHreflang.values()].sort(
    (a, b) =>
      a.hreflang.localeCompare(b.hreflang) ||
      a.languageSlug.localeCompare(b.languageSlug),
  )
}

function toVideoRouteGroups(
  rows: ContentLanguageRow[],
  skippedHreflangValues: Record<string, number>,
): WatchSeoManifest["videoRouteGroups"] {
  const byContent = new Map<string, ContentLanguageRow[]>()
  for (const row of rows) {
    const contentRows = byContent.get(row.contentSlug) ?? []
    contentRows.push(row)
    byContent.set(row.contentSlug, contentRows)
  }

  return [...byContent.entries()]
    .map(([contentSlug, contentRows]) => ({
      contentSlug,
      alternates: toAlternates(contentRows, skippedHreflangValues),
    }))
    .filter((group) => group.alternates.length > 0)
    .sort((a, b) => a.contentSlug.localeCompare(b.contentSlug))
}

function toEpisodeRouteGroups(
  rows: EpisodeLanguageRow[],
  skippedHreflangValues: Record<string, number>,
): WatchSeoManifest["episodeRouteGroups"] {
  const byEpisode = new Map<string, EpisodeLanguageRow[]>()
  for (const row of rows) {
    const key = `${row.parentSlug}\u0000${row.childSlug}`
    const episodeRows = byEpisode.get(key) ?? []
    episodeRows.push(row)
    byEpisode.set(key, episodeRows)
  }

  return [...byEpisode.entries()]
    .map(([key, episodeRows]) => {
      const [parentSlug = "", childSlug = ""] = key.split("\u0000")
      return {
        parentSlug,
        childSlug,
        alternates: toAlternates(episodeRows, skippedHreflangValues),
      }
    })
    .filter((group) => group.alternates.length > 0)
    .sort(
      (a, b) =>
        a.parentSlug.localeCompare(b.parentSlug) ||
        a.childSlug.localeCompare(b.childSlug),
    )
}

export function summarizeWatchSeoManifest(
  manifest: Pick<
    WatchSeoManifest,
    "episodeRouteGroups" | "skippedHreflangValues" | "videoRouteGroups"
  >,
): WatchSeoManifestCounts {
  return {
    videoRouteGroups: manifest.videoRouteGroups.length,
    episodeRouteGroups: manifest.episodeRouteGroups.length,
    alternateLinks:
      manifest.videoRouteGroups.reduce(
        (sum, group) => sum + group.alternates.length,
        0,
      ) +
      manifest.episodeRouteGroups.reduce(
        (sum, group) => sum + group.alternates.length,
        0,
      ),
    skippedHreflangValues: Object.values(manifest.skippedHreflangValues).reduce(
      (sum, count) => sum + count,
      0,
    ),
  }
}
