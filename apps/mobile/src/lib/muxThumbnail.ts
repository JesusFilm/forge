// Mux HLS URLs: https://stream.mux.com/{playbackId}.m3u8
const MUX_STREAM_RE = /stream\.mux\.com\/([a-zA-Z0-9]+)/
// Playback IDs are opaque alphanumeric tokens — validate before interpolating
// into a URL so a tainted seed value can't inject a different host/path.
const MUX_PLAYBACK_ID_RE = /^[a-zA-Z0-9]+$/

export function deriveMuxThumbnailUrl(
  streamingUrl: string | null | undefined,
): string | null {
  if (!streamingUrl) return null
  const match = MUX_STREAM_RE.exec(streamingUrl)
  if (!match?.[1]) return null
  return `https://image.mux.com/${match[1]}/thumbnail.png?width=1280&fit_mode=smartcrop`
}

/** Canonical Mux HLS URL from a playback ID; null if missing or non-alphanumeric. */
export function muxHlsUrlFromPlaybackId(
  playbackId: string | null | undefined,
): string | null {
  if (!playbackId || !MUX_PLAYBACK_ID_RE.test(playbackId)) return null
  return `https://stream.mux.com/${playbackId}.m3u8`
}

/**
 * Extract the Mux playback ID from a stored HLS URL; null if not a Mux stream.
 * Lets callers compare sources by asset identity, since stored `hls` may differ
 * in shape from a rebuilt URL.
 */
export function extractMuxPlaybackId(
  streamingUrl: string | null | undefined,
): string | null {
  if (!streamingUrl) return null
  return MUX_STREAM_RE.exec(streamingUrl)?.[1] ?? null
}
