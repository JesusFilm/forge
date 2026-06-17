import type { YouTubeRawItem, YouTubeVideo } from "./types"

// Field caps mirror the artifact schema bounds so a parsed video always passes
// validation before it is persisted or submitted.
const MAX_TITLE = 256
const MAX_DESCRIPTION = 1024
const MAX_HASHTAGS = 30
const MAX_HASHTAG_LEN = 128

const HASHTAG_PATTERN = /#[\p{L}\p{N}_]+/gu

function cap(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

function resolveVideoId(item: YouTubeRawItem): string | null {
  // playlistItems.list exposes the id under contentDetails / snippet.resourceId;
  // search.list exposes it under id.videoId. Prefer the explicit content id.
  const fromContent = item.contentDetails?.videoId
  if (fromContent) return fromContent
  const fromResource = item.snippet?.resourceId?.videoId
  if (fromResource) return fromResource
  if (item.id && typeof item.id === "object" && item.id.videoId) {
    return item.id.videoId
  }
  return null
}

type ThumbnailMap = Record<string, { url?: string | null } | null> | null

function pickThumbnail(thumbnails: ThumbnailMap): string | null {
  if (!thumbnails) return null
  for (const key of ["maxres", "standard", "high", "medium", "default"]) {
    const url = thumbnails[key]?.url
    if (url) return url
  }
  return null
}

function extractHashtags(text: string): string[] {
  const matches = text.match(HASHTAG_PATTERN) ?? []
  const seen = new Set<string>()
  for (const raw of matches) {
    const tag = cap(raw.toLowerCase(), MAX_HASHTAG_LEN)
    if (!seen.has(tag)) seen.add(tag)
    if (seen.size >= MAX_HASHTAGS) break
  }
  return [...seen]
}

/**
 * Normalize a YouTube Data API item (from `search.list` or `playlistItems.list`)
 * into a `YouTubeVideo`. Returns null when no video id can be resolved. The
 * `matchedAi`/`matchedChristian` arrays are left empty here and filled by the
 * classifier downstream.
 */
export function parseYouTubeVideo(item: YouTubeRawItem): YouTubeVideo | null {
  const videoId = resolveVideoId(item)
  if (!videoId) return null

  const snippet = item.snippet ?? {}
  const title = cap((snippet.title ?? "").trim(), MAX_TITLE)
  const description = cap((snippet.description ?? "").trim(), MAX_DESCRIPTION)
  const channelId = snippet.channelId ?? null
  const channelTitle = snippet.channelTitle ?? null

  return {
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title,
    description,
    channelId,
    channelTitle,
    authorUrl: channelId
      ? `https://www.youtube.com/channel/${channelId}`
      : null,
    publishedAt: snippet.publishedAt ?? null,
    thumbnailUrl: pickThumbnail(snippet.thumbnails ?? null),
    hashtags: extractHashtags(description),
    matchedAi: [],
    matchedChristian: [],
  }
}

export const _internals = { resolveVideoId, extractHashtags }
