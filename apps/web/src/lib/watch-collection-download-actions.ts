"use server"

import { type AdminResultOf } from "@forge/admin-graphql"
import { headers } from "next/headers"

import client from "@/lib/admin-client"
import { verifyAuthSession } from "@/lib/auth-session"
import {
  isWatchDownloadAccountGateEnabled,
  watchDownloadAccountGateFlagContext,
} from "@/lib/feature-flags"
import { getWatchCollectionDownloadDubsBySlugOperation } from "@/lib/fragments/watch-video"
import { tryAsContentSlug, tryAsLocaleSlug } from "@/lib/routes"
import { createWatchDownloadCapability } from "@/lib/watch-download-capability"

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
    capability: string
  }>
}

export type WatchCollectionDownloadResult =
  | { ok: true; dubs: WatchCollectionDownloadDub[] }
  | {
      ok: false
      reason: "auth-required" | "invalid-input" | "unavailable"
    }

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
    const accountGateEnabled = await isWatchDownloadAccountGateEnabled(
      watchDownloadAccountGateFlagContext,
    )
    let subject: string | undefined
    if (accountGateEnabled) {
      const session = await verifyAuthSession(await headers())
      if (!session.authenticated) {
        return { ok: false, reason: "auth-required" }
      }
      subject = session.userId
    }

    const result = await client.query({
      query: getWatchCollectionDownloadDubsBySlugOperation,
      variables: { videoSlug: collectionSlug, languageSlug },
      fetchPolicy: "no-cache",
    })
    const data = result.data as CollectionDownloadData | undefined
    const dubs = data?.videoBySlug?.downloadableChildDubs ?? []
    const downloadableDubs = dubs.flatMap((dub) => {
      const variantId = dub?.documentId
      const videoId = dub?.videoId
      if (!variantId || !videoId) return []
      const videoSlug = tryAsContentSlug(dub.slug?.split("/", 1)[0] ?? "")
      if (!videoSlug) return []
      return [
        {
          downloads: dub.downloads ?? [],
          languageId: dub.language?.documentId ?? null,
          variantId,
          videoId,
          videoSlug,
        },
      ]
    })
    return {
      ok: true,
      dubs: await Promise.all(
        downloadableDubs.map(
          async ({
            downloads: rawDownloads,
            languageId,
            variantId,
            videoId,
            videoSlug,
          }): Promise<WatchCollectionDownloadDub> => {
            const downloads = await Promise.all(
              rawDownloads.flatMap((download) => {
                const downloadId = download?.documentId
                const quality = download?.quality
                const target = download?.url
                if (!downloadId || !quality || !target) {
                  return []
                }
                const rawSize: unknown = download.size
                const parsedSize =
                  typeof rawSize === "string"
                    ? Number.parseFloat(rawSize)
                    : typeof rawSize === "number"
                      ? rawSize
                      : null
                return [
                  createWatchDownloadCapability({
                    downloadId,
                    variantId,
                    videoSlug,
                    target,
                    ...(subject ? { subject } : {}),
                    event: {
                      videoId,
                      videoDubId: variantId,
                      languageId,
                    },
                  }).then((capability) => ({
                    documentId: downloadId,
                    height: download.height ?? null,
                    quality,
                    size:
                      parsedSize != null && Number.isFinite(parsedSize)
                        ? parsedSize
                        : null,
                    capability,
                  })),
                ]
              }),
            )
            return {
              documentId: variantId,
              videoId,
              downloads,
            }
          },
        ),
      ),
    }
  } catch {
    console.error("[watch-collection-download] lookup failed", {
      collectionSlug,
      languageSlug,
    })
    return { ok: false, reason: "unavailable" }
  }
}
