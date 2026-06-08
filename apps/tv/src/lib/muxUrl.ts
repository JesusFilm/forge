// Mux HLS URL helpers — playback id ↔ canonical HLS URL.
//
// SYNC: mirrors apps/mobile/src/lib/muxThumbnail.ts (extractMuxPlaybackId /
// muxHlsUrlFromPlaybackId). Split out here as muxUrl.ts because the TV thumbnail
// derivation already lives in resolveImageUrl.ts (getMuxThumbnailUrl); this file
// is just the id↔URL round-trip so a SearchResult.playbackId seed can start
// playback before the full video query resolves.

// Mux HLS URLs: https://stream.mux.com/{playbackId}.m3u8
const MUX_STREAM_RE = /stream\.mux\.com\/([a-zA-Z0-9_-]+)/
// Playback IDs are opaque tokens — validate before interpolating into a URL so a
// tainted seed value can't inject a different host/path. The charset matches
// getMuxThumbnailUrl in resolveImageUrl.ts (Mux ids use - and _), so an id
// extracted from a real Mux URL round-trips cleanly.
const MUX_PLAYBACK_ID_RE = /^[a-zA-Z0-9_-]+$/

/**
 * Build the canonical Mux HLS URL from a playback ID, or null if the ID is
 * missing or contains an unsafe character.
 */
export function muxHlsUrlFromPlaybackId(
  playbackId: string | null | undefined,
): string | null {
  if (!playbackId || !MUX_PLAYBACK_ID_RE.test(playbackId)) return null
  return `https://stream.mux.com/${playbackId}.m3u8`
}

/**
 * Extract the Mux playback ID from a stored HLS URL, or null if it isn't a Mux
 * stream URL. Used to compare two sources by asset identity rather than exact
 * URL string (the stored `hls` may differ in shape from a rebuilt URL).
 */
export function extractMuxPlaybackId(
  streamingUrl: string | null | undefined,
): string | null {
  if (!streamingUrl) return null
  return MUX_STREAM_RE.exec(streamingUrl)?.[1] ?? null
}
