"use server"

import { type AdminResultOf } from "@forge/admin-graphql"

import client from "@/lib/admin-client"
import { getWatchCollectionDownloadDubsBySlugOperation } from "@/lib/fragments/watch-video"
import { tryAsContentSlug, tryAsLocaleSlug } from "@/lib/routes"

type CollectionDownloadData = AdminResultOf<
  typeof getWatchCollectionDownloadDubsBySlugOperation
>

export type WatchCollectionDownloadLanguage = {
  slug: string
  name: string
  bcp47: string | null
}

export type WatchCollectionDownloadLeaf = {
  documentId: string
  slug: string
  title: string
  thumbnailUrl: string | null
  ordinal: number
  variantId: string
  downloads: Array<{
    documentId: string
    height: number | null
    quality: string
    size: number | null
  }>
}

export type WatchCollectionDownloadSkippedLeaf = Pick<
  WatchCollectionDownloadLeaf,
  "documentId" | "slug" | "title" | "thumbnailUrl"
>

export type WatchCollectionDownloadResult =
  | {
      ok: true
      languages: WatchCollectionDownloadLanguage[]
      eligibleLeaves: WatchCollectionDownloadLeaf[]
      skippedLeaves: WatchCollectionDownloadSkippedLeaf[]
    }
  | {
      ok: false
      reason: "invalid-input" | "unavailable" | "traversal-limit"
    }

function firstLanguageName(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return (
    Object.values(value as Record<string, unknown>).find(
      (name): name is string =>
        typeof name === "string" && name.trim().length > 0,
    ) ?? null
  )
}

function toFiniteSize(value: unknown): number | null {
  const parsed =
    typeof value === "string"
      ? Number.parseFloat(value)
      : typeof value === "number"
        ? value
        : null
  return parsed != null && Number.isFinite(parsed) ? parsed : null
}

export async function loadWatchCollectionDownloads(input: {
  collectionSlug: string
  languageSlug?: string | null
}): Promise<WatchCollectionDownloadResult> {
  const collectionSlug = tryAsContentSlug(input.collectionSlug.trim())
  const languageSlug = input.languageSlug
    ? tryAsLocaleSlug(input.languageSlug.trim())
    : null
  if (!collectionSlug || (input.languageSlug && !languageSlug)) {
    return { ok: false, reason: "invalid-input" }
  }

  try {
    const result = await client.query({
      query: getWatchCollectionDownloadDubsBySlugOperation,
      variables: { videoSlug: collectionSlug, languageSlug },
      fetchPolicy: "no-cache",
    })
    const data = result.data as CollectionDownloadData | undefined
    const descendants = data?.videoBySlug?.downloadableDescendants
    if (!descendants) return { ok: false, reason: "unavailable" }
    if (descendants.status === "TRAVERSAL_LIMIT") {
      return { ok: false, reason: "traversal-limit" }
    }

    const languages = (descendants.languages ?? []).flatMap((language) => {
      if (!language?.slug) return []
      return [
        {
          slug: language.slug,
          name: firstLanguageName(language.name) ?? language.slug,
          bcp47: language.bcp47 ?? null,
        },
      ]
    })
    const eligibleLeaves = (descendants.eligibleLeaves ?? []).flatMap(
      (leaf) => {
        if (!leaf?.documentId || !leaf.slug || !leaf.title || !leaf.variantId) {
          return []
        }
        return [
          {
            documentId: leaf.documentId,
            slug: leaf.slug,
            title: leaf.title,
            thumbnailUrl: leaf.thumbnailUrl ?? null,
            ordinal: leaf.ordinal ?? 0,
            variantId: leaf.variantId,
            downloads: (leaf.downloads ?? []).flatMap((download) =>
              download?.documentId && download.quality
                ? [
                    {
                      documentId: download.documentId,
                      height: download.height ?? null,
                      quality: download.quality,
                      size: toFiniteSize(download.size),
                    },
                  ]
                : [],
            ),
          },
        ]
      },
    )
    const skippedLeaves = (descendants.skippedLeaves ?? []).flatMap((leaf) =>
      leaf?.documentId && leaf.slug && leaf.title
        ? [
            {
              documentId: leaf.documentId,
              slug: leaf.slug,
              title: leaf.title,
              thumbnailUrl: leaf.thumbnailUrl ?? null,
            },
          ]
        : [],
    )
    return { ok: true, languages, eligibleLeaves, skippedLeaves }
  } catch (error) {
    console.error("[watch-collection-download] lookup failed", {
      collectionSlug,
      languageSlug,
      error: error instanceof Error ? error.message : String(error),
    })
    return { ok: false, reason: "unavailable" }
  }
}
