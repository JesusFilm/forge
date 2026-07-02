import "server-only"

import { adminGraphql, type AdminResultOf } from "@forge/admin-graphql"

import client from "@/lib/admin-client"

export const getWatchDownloadTargetOperation = adminGraphql(`
  query GetWatchDownloadTarget($variantId: ID!) {
    videoDub(id: $variantId) {
      documentId: id
      videoId
      downloadable
      language {
        documentId: id
      }
      downloads {
        documentId: id
        url
      }
      published
      slug
    }
  }
`)

type WatchDownloadTargetData = AdminResultOf<
  typeof getWatchDownloadTargetOperation
>

type WatchDownloadTargetInput = {
  downloadId: string | null
  variantId: string | null
  videoSlug: string | null
}

export type WatchDownloadTargetResult =
  | {
      ok: true
      url: string
      event: {
        videoId: string
        videoDubId: string
        languageId: string | null
      }
    }
  | { ok: false; reason: "missing-params" | "not-found" | "unavailable" }

function belongsToVideoSlug(
  dubSlug: string | null | undefined,
  videoSlug: string,
): boolean {
  if (typeof dubSlug !== "string") return false
  const normalizedDubSlug = dubSlug.replace(/^\/+|\/+$/g, "")
  const normalizedVideoSlug = videoSlug.replace(/^\/+|\/+$/g, "")
  return normalizedDubSlug.startsWith(`${normalizedVideoSlug}/`)
}

export async function resolveWatchDownloadTarget({
  downloadId,
  variantId,
  videoSlug,
}: WatchDownloadTargetInput): Promise<WatchDownloadTargetResult> {
  if (!downloadId || !variantId || !videoSlug) {
    return { ok: false, reason: "missing-params" }
  }

  let result: { data?: WatchDownloadTargetData | null }
  try {
    result = await client.query<WatchDownloadTargetData>({
      query: getWatchDownloadTargetOperation,
      variables: { variantId },
      fetchPolicy: "no-cache",
    })
  } catch (err) {
    console.error("[watch-download-target] admin lookup failed", {
      downloadId,
      err: err instanceof Error ? err.message : String(err),
      variantId,
      videoSlug,
    })
    return { ok: false, reason: "unavailable" }
  }

  const variant = result.data?.videoDub
  if (
    variant?.documentId !== variantId ||
    variant.published !== true ||
    variant.downloadable !== true ||
    typeof variant.videoId !== "string" ||
    variant.videoId.length === 0 ||
    !belongsToVideoSlug(variant.slug, videoSlug)
  ) {
    return { ok: false, reason: "not-found" }
  }

  const download = (variant.downloads ?? []).find((candidate) => {
    return candidate?.documentId === downloadId
  })
  if (!download) return { ok: false, reason: "not-found" }

  if (typeof download.url !== "string" || download.url.length === 0) {
    console.error("[watch-download-target] resolved empty download url", {
      downloadId,
      variantId,
      videoSlug,
    })
    return { ok: false, reason: "unavailable" }
  }

  return {
    ok: true,
    url: download.url,
    event: {
      videoId: variant.videoId,
      videoDubId: variant.documentId,
      languageId: variant.language?.documentId ?? null,
    },
  }
}
