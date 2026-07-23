import { useEffect, useMemo, useState } from "react"
import { getGraphQLUrl } from "../lib/config"
import { pickThumbnailUrl, type VideoImage } from "../lib/types"
import type { AdminBlock, WatchExperience } from "../lib/queries"

// videoId → its resolvable card thumbnail and localized title. Both nullable:
// a video may resolve one without the other (missing images or empty locale).
export type VideoMeta = { thumbnail: string | null; title: string | null }
export type VideoMetaMap = Map<string, VideoMeta>

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
  // Hardcoded en locale (app-wide convention); flat MediaCollection items carry
  // no title, so the card resolves it from the linked video's localized title.
  const fields = safeIds
    .map(
      (id, i) =>
        `v${i}: video(id: "${id}") { id images { mobileCinematicHigh mobileCinematicLow videoStill thumbnail url } locales(locale: "en") { title } }`,
    )
    .join("\n    ")
  return `{\n    ${fields}\n  }`
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
        const response = await fetch(getGraphQLUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: buildBatchQuery(videoIds) }),
          signal: controller.signal,
        })

        if (controller.signal.aborted) return
        const json = await response.json()
        if (controller.signal.aborted || !json.data) return

        const map: VideoMetaMap = new Map()
        for (let i = 0; i < videoIds.length; i++) {
          const videoData = json.data[`v${i}`] as {
            id?: string
            images?: VideoImage[]
            locales?: { title?: string | null }[] | null
          } | null
          if (!videoData?.id) continue
          const thumb = videoData.images
            ? pickThumbnailUrl(videoData.images)
            : null
          const title = videoData.locales?.[0]?.title?.trim() || null
          if (thumb || title) {
            map.set(videoData.id, { thumbnail: thumb ?? null, title })
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
