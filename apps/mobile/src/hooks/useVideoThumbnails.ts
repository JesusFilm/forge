import { useEffect, useMemo, useState } from "react"
import { parse, print, type DocumentNode } from "graphql"
import type { TypedDocumentNode } from "@apollo/client"

import { currentAdminForms } from "../i18n/adminLanguage"
import { useLocaleEpoch } from "../i18n/useT"
import { getApolloClient } from "../lib/apolloClient"
import { pickThumbnailUrl } from "../lib/types"
import {
  videoThumbnailFragment,
  type AdminBlock,
  type VideoThumbnailData,
  type WatchExperience,
} from "../lib/queries"
import { pickVideoText, readTitle, videoTextVariables } from "../lib/videoText"

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
  return Array.from(ids).filter((id) => SAFE_ID_RE.test(id))
}

type VideoThumbnailsResult = Record<string, VideoThumbnailData | null>
type VideoThumbnailsVariables = Record<string, string>

// The typed fragment's definitions (it spreads the shared title rows).
const FRAGMENT_SOURCE = print(videoThumbnailFragment as DocumentNode)
const documentsByCount = new Map<
  number,
  TypedDocumentNode<VideoThumbnailsResult, VideoThumbnailsVariables>
>()

/** One aliased `video(id:)` per id in ONE request, each spreading the typed
 *  VideoThumbnail fragment. The ids travel as variables, never in the text. */
export function videoThumbnailsDocument(
  count: number,
): TypedDocumentNode<VideoThumbnailsResult, VideoThumbnailsVariables> {
  const cached = documentsByCount.get(count)
  if (cached) return cached
  const indexes = Array.from({ length: count }, (_, i) => i)
  const variables = [
    "$textSlug: String!",
    ...indexes.map((i) => `$id${i}: ID!`),
  ]
  const fields = indexes.map(
    (i) => `v${i}: video(id: $id${i}) { ...VideoThumbnail }`,
  )
  const document = parse(
    `query VideoThumbnails(${variables.join(", ")}) {\n  ${fields.join(
      "\n  ",
    )}\n}\n${FRAGMENT_SOURCE}`,
  ) as TypedDocumentNode<VideoThumbnailsResult, VideoThumbnailsVariables>
  documentsByCount.set(count, document)
  return document
}

/** The variables for {@link videoThumbnailsDocument}. */
export function videoThumbnailsVariables(
  videoIds: readonly string[],
  textSlug: string,
): VideoThumbnailsVariables {
  const variables: VideoThumbnailsVariables = { textSlug }
  videoIds.forEach((id, i) => {
    variables[`id${i}`] = id
  })
  return variables
}

/** The meta map from one batch answer, titles in the UI language else English. */
export function videoMetaFromResult(
  videoIds: readonly string[],
  data: VideoThumbnailsResult | null | undefined,
  forms: Parameters<typeof pickVideoText>[1],
): VideoMetaMap {
  const map: VideoMetaMap = new Map()
  if (!data) return map
  videoIds.forEach((_, i) => {
    const video = data[`v${i}`]
    if (!video?.documentId) return
    const thumbnail = video.images ? pickThumbnailUrl([...video.images]) : null
    const title = pickVideoText(video, forms, readTitle)?.text.trim() || null
    if (thumbnail || title) map.set(video.documentId, { thumbnail, title })
  })
  return map
}

type MetaState = { textSlug: string; map: VideoMetaMap }

export function useVideoThumbnails(
  experience: WatchExperience | null,
): VideoMetaMap {
  const videoIds = useMemo(() => collectVideoIds(experience), [experience])
  // The root Experience follows the UI language (KTD16), so the titles do too.
  useLocaleEpoch()
  const forms = currentAdminForms()
  const { textSlug } = videoTextVariables(forms)
  const [meta, setMeta] = useState<MetaState>({ textSlug, map: new Map() })

  useEffect(() => {
    if (videoIds.length === 0) {
      setMeta({ textSlug, map: new Map() })
      return
    }

    let cancelled = false
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    getApolloClient()
      .query({
        query: videoThumbnailsDocument(videoIds.length),
        variables: videoThumbnailsVariables(videoIds, textSlug),
        fetchPolicy: "cache-first",
        context: { fetchOptions: { signal: controller.signal } },
      })
      .then((result) => {
        if (cancelled) return
        setMeta({
          textSlug,
          map: videoMetaFromResult(videoIds, result.data, forms),
        })
      })
      .catch(() => {
        if (__DEV__) console.warn("[useVideoThumbnails] fetch failed")
      })
      .finally(() => clearTimeout(timer))

    return () => {
      cancelled = true
      controller.abort()
      clearTimeout(timer)
    }
    // The table returns one `forms` object per catalog, so it moves with the slug.
  }, [videoIds, textSlug, forms])

  // Titles from another language never show; the art does not depend on it.
  return useMemo(() => {
    if (meta.textSlug === textSlug) return meta.map
    const artOnly: VideoMetaMap = new Map()
    for (const [id, entry] of meta.map) {
      if (entry.thumbnail)
        artOnly.set(id, { thumbnail: entry.thumbnail, title: null })
    }
    return artOnly
  }, [meta, textSlug])
}
