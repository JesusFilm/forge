/**
 * Derive a thumbnail URL from a Mux streaming URL.
 * stream.mux.com/{playbackId}.m3u8 → image.mux.com/{playbackId}/thumbnail.jpg
 */
export function getMuxThumbnail(
  streamingUrl: string | undefined | null,
): string | undefined {
  if (!streamingUrl) return undefined
  const match = streamingUrl.match(
    /stream\.mux\.com\/([A-Za-z0-9_-]+)(?:\.m3u8)?/,
  )
  if (!match) return undefined
  return `https://image.mux.com/${match[1]}/thumbnail.jpg?width=640`
}

/**
 * Cloudflare Image Delivery URLs require a variant suffix.
 * Append /public if no variant is present.
 */
export function fixImageUrl(
  url: string | undefined | null,
): string | undefined {
  if (!url) return undefined
  if (!url.includes("imagedelivery.net")) return url
  // Already has a variant (e.g. /public, /f=jpg,w=...)
  const parts = url.split("/")
  const last = parts[parts.length - 1]
  if (last.includes("=") || last === "public") return url
  return `${url}/public`
}
