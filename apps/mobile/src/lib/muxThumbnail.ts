// Mux HLS URLs: https://stream.mux.com/{playbackId}.m3u8
const MUX_STREAM_RE = /stream\.mux\.com\/([a-zA-Z0-9]+)/

export function deriveMuxThumbnailUrl(
  streamingUrl: string | null | undefined,
): string | null {
  if (!streamingUrl) return null
  const match = MUX_STREAM_RE.exec(streamingUrl)
  if (!match?.[1]) return null
  return `https://image.mux.com/${match[1]}/thumbnail.png?width=1280&fit_mode=smartcrop`
}
