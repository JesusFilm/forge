import { useEffect, useMemo, useState } from "react"
import { resolveVideoDisplayTitle } from "@forge/content-display"
import { getApolloClient } from "../lib/apolloClient"
import { pickThumbnailUrl, type VideoImage } from "../lib/types"
import {
  GET_WATCH_VIDEOS_BY_IDS,
  type AdminBlock,
  type WatchExperience,
} from "../lib/queries"

// videoId → its resolvable card thumbnail and localized title. Both nullable:
// a video may resolve one without the other (missing images or empty locale).
export type VideoMeta = { thumbnail: string | null; title: string | null }
export type VideoMetaMap = Map<string, VideoMeta>

const FETCH_TIMEOUT_MS = 15_000
const MAX_BATCH_SIZE = 200

function collectVideoIds(experience: WatchExperience | null): string[] {
  if (!experience?.blocks) return []
  const ids = new Set<string>()

  function scanBlock(block: AdminBlock) {
    const s = block as Record<string, unknown>
    if (typeof s.videoId === "string" && s.videoId) ids.add(s.videoId)

    if (
      block.__typename === "SectionBlock" &&
      "sectionContent" in block &&
      Array.isArray(block.sectionContent)
    ) {
      for (const child of block.sectionContent as AdminBlock[]) scanBlock(child)
    }
    if (
      block.__typename === "ContainerBlock" &&
      "content" in block &&
      Array.isArray(block.content)
    ) {
      for (const child of block.content as AdminBlock[]) {
        if (child.__typename !== "ContainerSlotBlock") scanBlock(child)
      }
    }
    if ("items" in block && Array.isArray(block.items)) {
      for (const item of block.items as Record<string, unknown>[]) {
        if (typeof item.videoId === "string" && item.videoId)
          ids.add(item.videoId)
      }
    }
  }

  for (const block of experience.blocks) {
    if (block) scanBlock(block as AdminBlock)
  }
  return Array.from(ids)
}

export function useVideoThumbnails(
  experience: WatchExperience | null,
): VideoMetaMap {
  const videoIds = useMemo(() => collectVideoIds(experience), [experience])
  const [meta, setMeta] = useState<VideoMetaMap>(new Map())

  useEffect(() => {
    if (videoIds.length === 0) {
      setMeta(new Map())
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    async function fetchThumbnails() {
      try {
        const batches = Array.from(
          { length: Math.ceil(videoIds.length / MAX_BATCH_SIZE) },
          (_, index) =>
            videoIds.slice(
              index * MAX_BATCH_SIZE,
              (index + 1) * MAX_BATCH_SIZE,
            ),
        )
        const results = await Promise.all(
          batches.map((ids) =>
            getApolloClient().query({
              query: GET_WATCH_VIDEOS_BY_IDS,
              variables: { ids },
              fetchPolicy: "no-cache",
              context: { fetchOptions: { signal: controller.signal } },
            }),
          ),
        )
        if (controller.signal.aborted) return

        const map: VideoMetaMap = new Map()
        for (const videoData of results.flatMap(
          (result) => result.data?.watchVideosByIds ?? [],
        )) {
          if (!videoData?.documentId) continue
          const thumb = videoData.images
            ? pickThumbnailUrl([...videoData.images] as VideoImage[])
            : null
          const title =
            resolveVideoDisplayTitle({
              requestedTitles: videoData.locales?.map((locale) => locale.title),
              englishTitles: videoData.englishLanguageTitleLocales?.map(
                (locale) => locale.title,
              ),
              slug: videoData.slug,
            }) ?? null
          if (thumb || title) {
            map.set(videoData.documentId, { thumbnail: thumb ?? null, title })
          }
        }
        if (!controller.signal.aborted) setMeta(map)
      } catch {
        if (__DEV__) console.warn("[useVideoThumbnails] fetch failed")
      } finally {
        clearTimeout(timer)
      }
    }

    fetchThumbnails()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [videoIds])

  return meta
}
