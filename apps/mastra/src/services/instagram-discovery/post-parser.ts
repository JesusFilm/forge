import type { InstagramMediaType, InstagramPost } from "./types"

type InstagramDiscoverySearchHit = {
  url: string
  title?: string | null
  description?: string | null
  markdown?: string | null
  metadata?: Record<string, unknown>
}

const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com"])
const MAX_CAPTION_LENGTH = 1024
const MAX_HASHTAGS = 30
// Field caps MUST stay <= the bounds enforced by InstagramPostSchema in
// artifacts.ts. The parser is the only producer of InstagramPost, so capping
// here guarantees every post serializes — otherwise one oversized field (a long
// Instagram CDN og:image URL is common) would fail the whole report write.
const MAX_HANDLE_OR_NAME_LENGTH = 256
const MAX_HASHTAG_LENGTH = 128
const MAX_URL_LENGTH = 512
const PUBLISHED_AT_METADATA_KEYS = [
  "article:published_time",
  "og:published_time",
  "publishedTime",
  "datePublished",
] as const
const THUMBNAIL_METADATA_KEYS = ["og:image", "ogImage", "image"] as const
export const INSTAGRAM_DISCOVERY_METADATA_KEYS = [
  ...THUMBNAIL_METADATA_KEYS,
  ...PUBLISHED_AT_METADATA_KEYS,
] as const

// Matches both /<type>/<shortcode> and /<handle>/<type>/<shortcode> forms.
// The shortcode is length-bounded (real Instagram shortcodes are ~11 chars);
// the bound also keeps the canonical url comfortably under MAX_URL_LENGTH.
const POST_PATH = /^\/(?:([^/]+)\/)?(p|reel|tv)\/([A-Za-z0-9_-]{1,64})\/?$/
const HASHTAG_PATTERN = /#[\p{L}\p{N}_.]+/gu
// "Display Name (@handle) • Instagram: ..." or "Display Name on Instagram: ..."
const TITLE_HANDLE = /\(@([A-Za-z0-9._]+)\)/
const TITLE_NAME = /^(.*?)(?:\s+(?:on Instagram|\(@)|:|\s*•)/

function toInstagramUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

export function isInstagramUrl(value: string): boolean {
  const url = toInstagramUrl(value)
  if (!url) return false
  if (!INSTAGRAM_HOSTS.has(url.hostname)) return false
  return POST_PATH.test(url.pathname)
}

function mediaTypeFromPath(token: string): InstagramMediaType {
  if (token === "reel") return "reel"
  if (token === "tv") return "tv"
  return "post"
}

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function pickMetadataString(
  metadata: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = pickString(metadata[key])
    if (value) return value
  }
  return null
}

function extractPublishedAt(
  metadata: Record<string, unknown> | undefined,
): string | null {
  if (!metadata) return null
  const candidate = pickMetadataString(metadata, PUBLISHED_AT_METADATA_KEYS)
  if (!candidate) return null
  const parsed = new Date(candidate)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function extractThumbnail(
  metadata: Record<string, unknown> | undefined,
): string | null {
  if (!metadata) return null
  const candidate = pickMetadataString(metadata, THUMBNAIL_METADATA_KEYS)
  // A truncated URL is useless; drop over-long thumbnails rather than slicing.
  if (!candidate || candidate.length > MAX_URL_LENGTH) return null
  return candidate
}

function extractHashtags(text: string): string[] {
  const matches = text.match(HASHTAG_PATTERN) ?? []
  const seen = new Set<string>()
  const tags: string[] = []
  for (const raw of matches) {
    const tag = raw.toLowerCase().slice(0, MAX_HASHTAG_LENGTH)
    if (seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
    if (tags.length >= MAX_HASHTAGS) break
  }
  return tags
}

function capField(value: string | null, max: number): string | null {
  return value == null ? null : value.slice(0, max)
}

function deriveAuthor(
  handleFromPath: string | undefined,
  title: string | null,
): { authorHandle: string | null; authorName: string | null } {
  let authorHandle = handleFromPath ?? null
  let authorName: string | null = null

  if (title) {
    const handleMatch = title.match(TITLE_HANDLE)
    if (handleMatch) authorHandle = authorHandle ?? handleMatch[1]!
    const nameMatch = title.match(TITLE_NAME)
    if (nameMatch) authorName = pickString(nameMatch[1])
  }

  return { authorHandle, authorName }
}

/**
 * Normalize a Firecrawl hit into an InstagramPost. Returns null for hits that
 * are not Instagram post/reel/tv permalinks.
 */
export function parseInstagramPost(
  hit: InstagramDiscoverySearchHit,
): InstagramPost | null {
  const url = toInstagramUrl(hit.url)
  if (!url || !INSTAGRAM_HOSTS.has(url.hostname)) return null

  const match = url.pathname.match(POST_PATH)
  if (!match) return null

  const handleFromPath = match[1]
  const mediaType = mediaTypeFromPath(match[2]!)
  const shortcode = match[3]!

  const title = pickString(hit.title)
  const rawCaption =
    pickString(hit.description) ?? pickString(hit.markdown) ?? title ?? ""
  const caption = rawCaption.slice(0, MAX_CAPTION_LENGTH)

  const { authorHandle, authorName } = deriveAuthor(handleFromPath, title)
  const hashtags = extractHashtags(`${caption} ${title ?? ""}`)

  return {
    url: `https://www.instagram.com/${mediaType === "post" ? "p" : mediaType}/${shortcode}/`,
    shortcode,
    mediaType,
    authorHandle: capField(authorHandle, MAX_HANDLE_OR_NAME_LENGTH),
    authorName: capField(authorName, MAX_HANDLE_OR_NAME_LENGTH),
    caption,
    hashtags,
    publishedAt: extractPublishedAt(hit.metadata),
    thumbnailUrl: extractThumbnail(hit.metadata),
    matchedAi: [],
    matchedChristian: [],
  }
}

export const _internals = {
  extractHashtags,
  extractPublishedAt,
  deriveAuthor,
}
