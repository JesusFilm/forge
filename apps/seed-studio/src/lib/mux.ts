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
