// Mux HLS URLs: https://stream.mux.com/{playbackId}.m3u8
const MUX_STREAM_RE = /stream\.mux\.com\/([a-zA-Z0-9]+)/
// Playback IDs are opaque alphanumeric tokens — validate before interpolating
// into a URL so a tainted seed value can't inject a different host/path.
const MUX_PLAYBACK_ID_RE = /^[a-zA-Z0-9]+$/

export function deriveMuxThumbnailUrl(
  streamingUrl: string | null | undefined,
): string | null {
  // Delegates so the smartcrop URL shape lives in exactly one place
  // (muxThumbnailFromPlaybackId) — hero and card-fallback posters can't drift.
  return muxThumbnailFromPlaybackId(extractMuxPlaybackId(streamingUrl))
}

/** Canonical Mux HLS URL from a playback ID; null if missing or non-alphanumeric. */
export function muxHlsUrlFromPlaybackId(
  playbackId: string | null | undefined,
): string | null {
  if (!playbackId || !MUX_PLAYBACK_ID_RE.test(playbackId)) return null
  return `https://stream.mux.com/${playbackId}.m3u8`
}

// Same smartcrop shape as deriveMuxThumbnailUrl, but keyed straight off the
// playback ID an Experience item already carries — the last-resort card poster
// when a MediaCollection item has no authored image and no hydrated video art.
export function muxThumbnailFromPlaybackId(
  playbackId: string | null | undefined,
): string | null {
  if (!playbackId || !MUX_PLAYBACK_ID_RE.test(playbackId)) return null
  return `https://image.mux.com/${playbackId}/thumbnail.png?width=1280&fit_mode=smartcrop`
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

/**
 * Two URL strings name one Mux asset (seed URL vs resolved variant) when
 * their playback IDs match. Non-Mux or null URLs never compare equal.
 */
export function isSameMuxAsset(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const aId = extractMuxPlaybackId(a)
  const bId = extractMuxPlaybackId(b)
  return aId != null && bId != null && aId === bId
}
