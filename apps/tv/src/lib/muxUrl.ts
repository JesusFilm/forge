// Mux HLS URL helpers — playback id ↔ canonical HLS URL.
// SYNC: mirrors apps/mobile/src/lib/muxThumbnail.ts. Split here (TV thumbnail
// derivation lives in resolveImageUrl.ts) so a SearchResult.playbackId seed can
// start playback before the full video query resolves.

// Mux HLS URLs: https://stream.mux.com/{playbackId}.m3u8
const MUX_STREAM_HOST = "stream.mux.com"
// First path segment of a Mux HLS URL is the id (charset matches Mux's - and _).
const MUX_PATH_SEGMENT_RE = /^([a-zA-Z0-9_-]+)/
// Validate playback IDs before interpolating so a tainted seed can't inject a
// different host/path. Charset matches getMuxThumbnailUrl (Mux ids use - and _),
// so an id from a real Mux URL round-trips cleanly.
const MUX_PLAYBACK_ID_RE = /^[a-zA-Z0-9_-]+$/

/** Canonical Mux HLS URL from a playback ID, or null if missing/unsafe. */
export function muxHlsUrlFromPlaybackId(
  playbackId: string | null | undefined,
): string | null {
  if (!playbackId || !MUX_PLAYBACK_ID_RE.test(playbackId)) return null
  return `https://stream.mux.com/${playbackId}.m3u8`
}

/**
 * Mux playback ID from a stored HLS URL, or null if not a Mux stream URL. Lets
 * us compare sources by asset identity, not exact string (stored `hls` may
 * differ in shape from a rebuilt URL).
 */
export function extractMuxPlaybackId(
  streamingUrl: string | null | undefined,
): string | null {
  if (!streamingUrl) return null
  // Host-anchor: an unanchored substring match would let a non-Mux host embed
  // `stream.mux.com/<id>` in its path and falsely match. Require hostname to be
  // stream.mux.com, then read the id from the first path segment.
  let parsed: URL
  try {
    parsed = new URL(streamingUrl)
  } catch {
    return null
  }
  if (parsed.hostname !== MUX_STREAM_HOST) return null
  // pathname is like "/abc123.m3u8" — strip the leading slash, take the id token.
  const firstSegment = parsed.pathname.replace(/^\//, "")
  return MUX_PATH_SEGMENT_RE.exec(firstSegment)?.[1] ?? null
}
