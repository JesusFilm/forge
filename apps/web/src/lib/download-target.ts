import "server-only"

import { adminGraphql, type AdminResultOf } from "@forge/admin-graphql"

import client from "@/lib/admin-client"

export const getWatchDownloadTargetOperation = adminGraphql(`
  query GetWatchDownloadTarget($videoSlug: String!) {
    videoBySlug(slug: $videoSlug) {
      variants: dubs {
        documentId: id
        published
        downloads {
          documentId: id
          url
        }
      }
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
  | { ok: true; url: string }
  | { ok: false; reason: "missing-params" | "not-found" | "unavailable" }

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
      variables: { videoSlug },
      fetchPolicy: "no-cache",
    })
  } catch {
    return { ok: false, reason: "unavailable" }
  }

  const variants = result.data?.videoBySlug?.variants ?? []
  const variant = variants.find((candidate) => {
    return candidate?.documentId === variantId && candidate.published === true
  })
  if (!variant) return { ok: false, reason: "not-found" }

  const download = (variant.downloads ?? []).find((candidate) => {
    return candidate?.documentId === downloadId
  })
  if (!download) return { ok: false, reason: "not-found" }

  return typeof download.url === "string" && download.url.length > 0
    ? { ok: true, url: download.url }
    : { ok: false, reason: "unavailable" }
}
