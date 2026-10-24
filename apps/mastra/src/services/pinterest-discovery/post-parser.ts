import { createHash } from "node:crypto"

import type { PinterestPin, PinterestRawItem } from "./types"

const MAX_CAPTION = 1024
const MAX_HASHTAGS = 30
const MAX_HASHTAG_LEN = 128

const HASHTAG_PATTERN = /#[\p{L}\p{N}_]+/gu

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
}

/** Decode the HTML entities Pinterest RSS uses in titles/descriptions. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+|#39);/g, (whole, name) =>
      name in NAMED_ENTITIES ? NAMED_ENTITIES[name]! : whole,
    )
}

function cap(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

function resolvePinId(link: string): string {
  const match = link.match(/\/pin\/([^/?#]+)/i)
  if (match) return match[1]!
  // Fallback: stable hash of the link, mirroring the prior bot.
  return createHash("sha1").update(link).digest("hex").slice(0, 16)
}

function extractThumbnail(descriptionHtml: string): string | null {
  const decoded = decodeEntities(descriptionHtml)
  const m = decoded.match(/<img[^>]+src="([^"]+)"/i)
  return m ? m[1]! : null
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

function toIso(pubDate: string | null | undefined): string | null {
  if (!pubDate) return null
  const ts = Date.parse(pubDate)
  return Number.isNaN(ts) ? null : new Date(ts).toISOString()
}

/**
 * Normalize a raw Pinterest RSS item into a `PinterestPin`. Returns null when no
 * pin link is present. `matchedAi`/`matchedChristian` are filled by the classifier.
 */
export function parsePinterestPin(item: PinterestRawItem): PinterestPin | null {
  const link = item.link?.trim()
  if (!link) return null

  const caption = cap(decodeEntities((item.title ?? "").trim()), MAX_CAPTION)

  return {
    pinId: resolvePinId(link),
    url: link,
    caption,
    thumbnailUrl: extractThumbnail(item.description ?? ""),
    publishedAt: toIso(item.pubDate),
    boardName: item.boardName ?? null,
    boardUrl: item.boardUrl ?? null,
    hashtags: extractHashtags(caption),
    matchedAi: [],
    matchedChristian: [],
  }
}

export const _internals = { resolvePinId, extractThumbnail, decodeEntities }
