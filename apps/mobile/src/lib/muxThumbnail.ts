// Mux HLS URLs: https://stream.mux.com/{playbackId}.m3u8
const MUX_STREAM_RE = /stream\.mux\.com\/([a-zA-Z0-9]+)/
// Playback IDs are opaque alphanumeric tokens — validate before interpolating
// into a URL so a tainted seed value can't inject a different host/path.
const MUX_PLAYBACK_ID_RE = /^[a-zA-Z0-9]+$/

// One-way door: Mux caches per exact URL, so changing this cold-renders the
// whole catalogue again and discards every warmed entry. See muxThumbnailAtSecond.
const STILL_SIZE = 800

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
//
// webp, not png: measured 2026-08-19 on a real asset, the png is 988,478 B and
// this url is 59,262 B for the same frame. `height` is not optional — with a
// bare `width`, smartcrop keeps the SOURCE height and returns a side-cropped
// 1280x1080, not 16:9.
export function muxThumbnailFromPlaybackId(
  playbackId: string | null | undefined,
): string | null {
  if (!playbackId || !MUX_PLAYBACK_ID_RE.test(playbackId)) return null
  return `https://image.mux.com/${playbackId}/thumbnail.webp?width=1280&height=720&fit_mode=smartcrop`
}

/**
 * A still from one moment of the asset, for the Bible quote cards.
 *
 * Fixed 800x800, never a size derived from the device: Mux caches per exact
 * URL, so a layout-derived width gives every screen geometry its own cold
 * render. Measured 2026-08-28 on one asset — 640 = 33.9 KB, 800 = 41.4 KB,
 * 1080 = 57.5 KB — and the still sits behind a heavy scrim as texture, so the
 * upscale on a 3x screen is not perceptible where 39% more bytes would be.
 *
 * The second is emitted to two decimal places because on a short runtime the
 * caller's window collapses and whole-second rounding would merge several
 * cards onto one URL. Caller owns the spacing and the clamp; this owns the URL.
 */
export function muxThumbnailAtSecond(
  playbackId: string | null | undefined,
  second: number,
): string | null {
  if (!playbackId || !MUX_PLAYBACK_ID_RE.test(playbackId)) return null
  if (!Number.isFinite(second) || second < 0) return null
  return `https://image.mux.com/${playbackId}/thumbnail.webp?width=${STILL_SIZE}&height=${STILL_SIZE}&fit_mode=smartcrop&time=${second.toFixed(2)}`
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
