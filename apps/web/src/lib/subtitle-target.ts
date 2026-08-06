import "server-only"

import { adminGraphql, type AdminResultOf } from "@forge/admin-graphql"

import client from "@/lib/admin-client"

export const getWatchSubtitleTargetOperation = adminGraphql(`
  query GetWatchSubtitleTarget($variantId: ID!) {
    videoDub(id: $variantId) {
      documentId: id
      published
      videoId
      videoEdition {
        subtitles {
          documentId: id
          vttSrc
          video {
            documentId: id
          }
        }
      }
    }
  }
`)

type WatchSubtitleTargetData = AdminResultOf<
  typeof getWatchSubtitleTargetOperation
>

type WatchSubtitleTargetInput = {
  subtitleId: string | null
  variantId: string | null
}

export type WatchSubtitleTargetResult =
  | { ok: true; target: string }
  | { ok: false; reason: "missing-params" | "not-found" | "unavailable" }

export async function resolveWatchSubtitleTarget({
  subtitleId,
  variantId,
}: WatchSubtitleTargetInput): Promise<WatchSubtitleTargetResult> {
  if (!subtitleId || !variantId) {
    return { ok: false, reason: "missing-params" }
  }

  let result: { data?: WatchSubtitleTargetData | null }
  try {
    result = await client.query<WatchSubtitleTargetData>({
      query: getWatchSubtitleTargetOperation,
      variables: { variantId },
      fetchPolicy: "no-cache",
    })
  } catch (err) {
    console.error("[watch-subtitle-target] admin lookup failed", {
      err: err instanceof Error ? err.message : String(err),
      subtitleId,
      variantId,
    })
    return { ok: false, reason: "unavailable" }
  }

  const variant = result.data?.videoDub
  if (
    variant?.documentId !== variantId ||
    variant.published !== true ||
    typeof variant.videoId !== "string" ||
    variant.videoId.length === 0
  ) {
    return { ok: false, reason: "not-found" }
  }

  const subtitle = (variant.videoEdition?.subtitles ?? []).find((candidate) => {
    return (
      candidate?.documentId === subtitleId &&
      (candidate.video == null ||
        candidate.video.documentId === variant.videoId)
    )
  })
  if (!subtitle) return { ok: false, reason: "not-found" }

  if (typeof subtitle.vttSrc !== "string" || subtitle.vttSrc.length === 0) {
    console.error("[watch-subtitle-target] resolved empty subtitle url", {
      subtitleId,
      variantId,
    })
    return { ok: false, reason: "unavailable" }
  }

  return { ok: true, target: subtitle.vttSrc }
}
