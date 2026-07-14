"use server"

import { type AdminResultOf } from "@forge/admin-graphql"

import client from "@/lib/admin-client"
import { getWatchCollectionDownloadDubsBySlugOperation } from "@/lib/fragments/watch-video"
import { tryAsContentSlug, tryAsLocaleSlug } from "@/lib/routes"

type CollectionDownloadData = AdminResultOf<
  typeof getWatchCollectionDownloadDubsBySlugOperation
>

export type WatchCollectionDownloadDub = {
  documentId: string
  videoId: string
  downloads: Array<{
    documentId: string
    height: number | null
    quality: string
    size: number | null
  }>
}

export type WatchCollectionDownloadResult =
  | { ok: true; dubs: WatchCollectionDownloadDub[] }
  | { ok: false; reason: "invalid-input" | "unavailable" }

export async function loadWatchCollectionDownloads(input: {
  collectionSlug: string
  languageSlug: string
}): Promise<WatchCollectionDownloadResult> {
  const collectionSlug = tryAsContentSlug(input.collectionSlug.trim())
  const languageSlug = tryAsLocaleSlug(input.languageSlug.trim())
  if (!collectionSlug || !languageSlug) {
    return { ok: false, reason: "invalid-input" }
  }

  try {
    const result = await client.query({
      query: getWatchCollectionDownloadDubsBySlugOperation,
      variables: { videoSlug: collectionSlug, languageSlug },
      fetchPolicy: "no-cache",
    })
    const data = result.data as CollectionDownloadData | undefined
    const dubs = data?.videoBySlug?.downloadableChildDubs ?? []
    return {
      ok: true,
      dubs: dubs.flatMap((dub) => {
        if (!dub?.documentId || !dub.videoId) return []
        const downloads = (dub.downloads ?? []).flatMap((download) => {
          if (!download?.documentId || !download.quality) return []
          const rawSize: unknown = download.size
          const parsedSize =
            typeof rawSize === "string"
              ? Number.parseFloat(rawSize)
              : typeof rawSize === "number"
                ? rawSize
                : null
          return [
            {
              documentId: download.documentId,
              height: download.height ?? null,
              quality: download.quality,
              size:
                parsedSize != null && Number.isFinite(parsedSize)
                  ? parsedSize
                  : null,
            },
          ]
        })
        return [{ documentId: dub.documentId, videoId: dub.videoId, downloads }]
      }),
    }
  } catch (error) {
    console.error("[watch-collection-download] lookup failed", {
      collectionSlug,
      languageSlug,
      error: error instanceof Error ? error.message : String(error),
    })
    return { ok: false, reason: "unavailable" }
  }
}
