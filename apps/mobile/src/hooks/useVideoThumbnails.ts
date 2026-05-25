import { useEffect, useMemo, useState } from "react"
import { getGraphQLUrl } from "../lib/config"
import { pickThumbnailUrl, type VideoImage } from "../lib/types"
import type { AdminBlock, WatchExperience } from "../lib/queries"

export type ThumbnailMap = Map<string, string>

const FETCH_TIMEOUT_MS = 15_000
const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/

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

function buildBatchQuery(videoIds: string[]): string {
  const safeIds = videoIds.filter((id) => SAFE_ID_RE.test(id))
  const fields = safeIds
    .map(
      (id, i) =>
        `v${i}: video(id: "${id}") { id images { mobileCinematicHigh videoStill url } }`,
    )
    .join("\n    ")
  return `{\n    ${fields}\n  }`
}

export function useVideoThumbnails(
  experience: WatchExperience | null,
): ThumbnailMap {
  const videoIds = useMemo(() => collectVideoIds(experience), [experience])
  const [thumbnails, setThumbnails] = useState<ThumbnailMap>(new Map())

  useEffect(() => {
    if (videoIds.length === 0) {
      setThumbnails(new Map())
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    async function fetchThumbnails() {
      try {
        const response = await fetch(getGraphQLUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: buildBatchQuery(videoIds) }),
          signal: controller.signal,
        })

        if (controller.signal.aborted) return
        const json = await response.json()
        if (controller.signal.aborted || !json.data) return

        const map = new Map<string, string>()
        for (let i = 0; i < videoIds.length; i++) {
          const videoData = json.data[`v${i}`] as {
            id?: string
            images?: VideoImage[]
          } | null
          if (!videoData?.images) continue
          const thumb = pickThumbnailUrl(videoData.images)
          if (thumb && videoData.id) map.set(videoData.id, thumb)
        }
        if (!controller.signal.aborted) setThumbnails(map)
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

  return thumbnails
}
