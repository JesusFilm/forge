import {
  USER_PLAYLIST_BLOCK_LIMIT,
  USER_PLAYLIST_ITEM_LIMIT,
} from "./user-playlist-contract"

const MEDIA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/

export type PublicUserPlaylistBlock =
  | { kind: "text"; text: string }
  | { kind: "mediaCollection"; title: string; videoIds: string[] }
  | { kind: "videoCarousel"; title: string; videoIds: string[] }

export type PublicUserPlaylist = {
  title: string
  description: string
  locale: string
  countryCode: string | null
  reportIntent: string
  blocks: PublicUserPlaylistBlock[]
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function boundedString(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length <= max ? value : null
}

function mediaIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > USER_PLAYLIST_ITEM_LIMIT) {
    return null
  }
  const ids: string[] = []
  for (const candidate of value) {
    const item = record(candidate)
    if (
      !item ||
      typeof item.videoId !== "string" ||
      !MEDIA_ID_PATTERN.test(item.videoId)
    ) {
      return null
    }
    ids.push(item.videoId)
  }
  return ids
}

function adaptBlock(value: unknown): PublicUserPlaylistBlock | null {
  const block = record(value)
  if (!block || typeof block.__typename !== "string") return null

  if (block.__typename === "UserPlaylistTextBlock") {
    const text = boundedString(block.text, 2_000)
    return text == null ? null : { kind: "text", text }
  }

  if (
    block.__typename === "UserPlaylistMediaCollectionBlock" ||
    block.__typename === "UserPlaylistVideoCarouselBlock"
  ) {
    const title = block.title == null ? "" : boundedString(block.title, 120)
    const videoIds = mediaIds(block.items)
    if (title == null || videoIds == null) return null
    return block.__typename === "UserPlaylistMediaCollectionBlock"
      ? { kind: "mediaCollection", title, videoIds }
      : { kind: "videoCarousel", title, videoIds }
  }

  return null
}

/**
 * Convert Admin's anonymous playlist DTO into a closed Web-owned shape. Every
 * property is selected explicitly so future GraphQL fields cannot reach React
 * through object spreading. Text remains an inert string and is never parsed
 * as Markdown, HTML, or a URL.
 */
export function adaptPublicUserPlaylist(
  value: unknown,
): PublicUserPlaylist | null {
  const playlist = record(value)
  if (!playlist || !Array.isArray(playlist.blocks)) return null
  const title = boundedString(playlist.title, 120)
  const description = boundedString(playlist.description, 2_000)
  const locale = boundedString(playlist.locale, 35)
  const reportIntent = boundedString(playlist.reportIntent, 1_024)
  const countryCode: string | null | undefined =
    playlist.countryCode == null
      ? null
      : typeof playlist.countryCode === "string" &&
          /^[A-Z]{2}$/.test(playlist.countryCode)
        ? playlist.countryCode
        : undefined
  if (
    title == null ||
    description == null ||
    locale == null ||
    reportIntent == null ||
    reportIntent.length === 0 ||
    countryCode === undefined ||
    playlist.blocks.length > USER_PLAYLIST_BLOCK_LIMIT
  ) {
    return null
  }
  const blocks: PublicUserPlaylistBlock[] = []
  for (const candidate of playlist.blocks) {
    const block = adaptBlock(candidate)
    if (!block) return null
    blocks.push(block)
  }
  return {
    title,
    description,
    locale,
    countryCode,
    reportIntent,
    blocks,
  }
}

export const USER_PLAYLIST_REPORT_CATEGORIES = [
  "INAPPROPRIATE_CONTENT",
  "MISLEADING_OR_SPAM",
  "COPYRIGHT_OR_RIGHTS",
  "PRIVACY_OR_PERSONAL_DATA",
  "OTHER_SAFETY",
] as const

export type UserPlaylistReportCategory =
  (typeof USER_PLAYLIST_REPORT_CATEGORIES)[number]
