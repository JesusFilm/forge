// Deterministic on-demand usage scanning for media assets.
//
// This covers the transition period where experience metadata and blocks may
// contain either canonical asset-id fields or legacy URL/object-key strings.

import type { PrismaClient } from "@prisma/client"

export type MediaAssetUsageTarget = {
  assetId: string
  urls?: readonly string[]
  objectKeys?: readonly string[]
}

export type MediaAssetUsageRow = {
  resourceType: "EXPERIENCE_LOCALE" | "VIDEO_LOCALE"
  resourceId: string
  resourceLocaleId: string
  locale: string
  title: string | null
  editUrl: string
  recoverable: boolean
  location: "metadata" | "blocks" | "search-social"
  fieldPath: string
  fieldName: string
  value: string
  match: "asset-id" | "url" | "object-key"
}

type ExperienceLocaleUsageSource = {
  id: string
  experienceId: string
  locale: string
  title: string | null
  ogImageUrl: string | null
  blocks: unknown
}

type VideoLocaleUsageSource = {
  id: string
  videoId: string
  locale: string | null
  title: string | null
  socialImageAssetId: string | null
  deletedAt: Date | null
  video: { slug: string; deletedAt: Date | null }
}

const URL_FIELD_PATTERN =
  /(^|_)(image|media|backgroundImage|thumbnail|poster|ogImage)(Url|Src)$/i
const ASSET_ID_FIELD_PATTERN =
  /(^|_)(image|media|backgroundImage|thumbnail|poster|ogImage)(AssetId)$/i

export async function scanMediaAssetUsage(
  prisma: PrismaClient,
  target: MediaAssetUsageTarget,
): Promise<MediaAssetUsageRow[]> {
  const [experienceLocales, videoLocales] = await Promise.all([
    prisma.experienceLocale.findMany({
      select: {
        id: true,
        experienceId: true,
        locale: true,
        title: true,
        ogImageUrl: true,
        blocks: true,
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.videoLocale.findMany({
      where: { socialImageAssetId: target.assetId },
      select: {
        id: true,
        videoId: true,
        locale: true,
        title: true,
        socialImageAssetId: true,
        deletedAt: true,
        video: { select: { slug: true, deletedAt: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
  ])

  return [
    ...findMediaAssetUsages(target, experienceLocales),
    ...findVideoLocaleMediaAssetUsages(target, videoLocales),
  ]
}

export function findVideoLocaleMediaAssetUsages(
  target: MediaAssetUsageTarget,
  rows: readonly VideoLocaleUsageSource[],
): MediaAssetUsageRow[] {
  return rows
    .filter((row) => row.socialImageAssetId === target.assetId)
    .map((row) => ({
      resourceType: "VIDEO_LOCALE" as const,
      resourceId: row.videoId,
      resourceLocaleId: row.id,
      locale: row.locale ?? "und",
      title: row.title,
      editUrl: `/dashboard/videos?video=${encodeURIComponent(row.video.slug)}&locale=${encodeURIComponent(row.id)}`,
      recoverable: row.deletedAt != null || row.video.deletedAt != null,
      location: "search-social" as const,
      fieldPath: "$.socialImageAssetId",
      fieldName: "socialImageAssetId",
      value: target.assetId,
      match: "asset-id" as const,
    }))
}

export function findMediaAssetUsages(
  target: MediaAssetUsageTarget,
  rows: readonly ExperienceLocaleUsageSource[],
): MediaAssetUsageRow[] {
  const matches: MediaAssetUsageRow[] = []
  const urls = new Set((target.urls ?? []).filter(Boolean))
  const objectKeys = new Set((target.objectKeys ?? []).filter(Boolean))

  for (const row of rows) {
    addMatchForField({
      matches,
      row,
      location: "metadata",
      fieldPath: "$.ogImageUrl",
      fieldName: "ogImageUrl",
      value: row.ogImageUrl,
      target,
      urls,
      objectKeys,
    })

    walkBlockValue(row.blocks, "$.blocks", (fieldPath, fieldName, value) => {
      addMatchForField({
        matches,
        row,
        location: "blocks",
        fieldPath,
        fieldName,
        value,
        target,
        urls,
        objectKeys,
      })
    })
  }

  return matches
}

function addMatchForField({
  matches,
  row,
  location,
  fieldPath,
  fieldName,
  value,
  target,
  urls,
  objectKeys,
}: {
  matches: MediaAssetUsageRow[]
  row: ExperienceLocaleUsageSource
  location: "metadata" | "blocks"
  fieldPath: string
  fieldName: string
  value: unknown
  target: MediaAssetUsageTarget
  urls: Set<string>
  objectKeys: Set<string>
}) {
  if (typeof value !== "string" || value.length === 0) return

  const match = matchFieldValue({
    fieldName,
    value,
    assetId: target.assetId,
    urls,
    objectKeys,
  })
  if (!match) return

  matches.push({
    resourceType: "EXPERIENCE_LOCALE",
    resourceId: row.experienceId,
    resourceLocaleId: row.id,
    locale: row.locale,
    title: row.title,
    editUrl: `/dashboard/experiences/${encodeURIComponent(row.experienceId)}?locale=${encodeURIComponent(row.locale)}`,
    recoverable: false,
    location,
    fieldPath,
    fieldName,
    value,
    match,
  })
}

function matchFieldValue({
  fieldName,
  value,
  assetId,
  urls,
  objectKeys,
}: {
  fieldName: string
  value: string
  assetId: string
  urls: Set<string>
  objectKeys: Set<string>
}): MediaAssetUsageRow["match"] | null {
  if (ASSET_ID_FIELD_PATTERN.test(fieldName) && value === assetId) {
    return "asset-id"
  }

  if (URL_FIELD_PATTERN.test(fieldName) && urls.has(value)) {
    return "url"
  }

  if (URL_FIELD_PATTERN.test(fieldName) && objectKeys.has(value)) {
    return "object-key"
  }

  return null
}

function walkBlockValue(
  value: unknown,
  path: string,
  visit: (fieldPath: string, fieldName: string, value: unknown) => void,
) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walkBlockValue(item, `${path}[${index}]`, visit)
    })
    return
  }

  if (typeof value !== "object" || value === null) return

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`
    visit(childPath, key, child)
    walkBlockValue(child, childPath, visit)
  }
}
