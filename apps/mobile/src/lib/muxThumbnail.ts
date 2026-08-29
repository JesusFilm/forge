// Mux HLS URLs: https://stream.mux.com/{playbackId}.m3u8
const MUX_STREAM_RE = /stream\.mux\.com\/([a-zA-Z0-9]+)/
// Playback IDs are opaque alphanumeric tokens — validate before interpolating
// into a URL so a tainted seed value can't inject a different host/path.
const MUX_PLAYBACK_ID_RE = /^[a-zA-Z0-9]+$/

// One-way door, and never device-derived: Mux caches per exact URL, so a change
// here cold-renders the whole catalogue and discards every warmed entry.
// Measured 2026-08-28: 640 = 33.9 KB, 800 = 41.4 KB, 1080 = 57.5 KB.
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

// Keyed straight off the playback ID an Experience item carries — the
// last-resort card poster. webp, not png: measured 2026-08-19 on a real asset,
// the png is 988,478 B against 59,262 B here for the same frame.
export function muxThumbnailFromPlaybackId(
  playbackId: string | null | undefined,
): string | null {
  return muxStillUrl(playbackId, 1280, 720)
}

/**
 * A still from one moment of the asset, for the Bible quote cards. Two decimal
 * places because a short runtime collapses the caller's window and whole-second
 * rounding would merge several cards onto one URL.
 */
export function muxThumbnailAtSecond(
  playbackId: string | null | undefined,
  second: number,
): string | null {
  if (!Number.isFinite(second) || second < 0) return null
  return muxStillUrl(playbackId, STILL_SIZE, STILL_SIZE, second)
}

// The one owner of the still URL shape, so the two public builders above cannot
// drift. `height` is not optional: with a bare `width`, smartcrop keeps the
// SOURCE height and returns a side-cropped frame rather than the ratio asked for.
function muxStillUrl(
  playbackId: string | null | undefined,
  width: number,
  height: number,
  second?: number,
): string | null {
  if (!playbackId || !MUX_PLAYBACK_ID_RE.test(playbackId)) return null
  const time = second == null ? "" : `&time=${second.toFixed(2)}`
  return `https://image.mux.com/${playbackId}/thumbnail.webp?width=${width}&height=${height}&fit_mode=smartcrop${time}`
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
