import type { WatchVariant, WatchVideoRecord } from "../normalizeVideo"
import { cleanStreamUrl } from "../validateUrl"

// KTD5: the resolver's input is the watch screen's source chain MINUS the
// offlineSource prefix — there is no field a local file could arrive through.
export type CastMediaInput = {
  activeVariant: Pick<WatchVariant, "hls"> | null
  video: Pick<WatchVideoRecord, "streamingUrl"> | null
  seedStreamingUrl: string | null
  title: string | null
  posterUrl: string | null
  startPositionSeconds: number | null
  /** R15: the session speed a starting cast load inherits — a pure input the
   *  route reads at call time, never a subscription. */
  playbackRate: number | null
}

export const CAST_CONTENT_TYPE = "application/x-mpegURL"

/** The SDK's documented setPlaybackRate/MediaLoadRequest band. */
export const CAST_MIN_PLAYBACK_RATE = 0.5
export const CAST_MAX_PLAYBACK_RATE = 2

export type CastMedia = {
  contentUrl: string
  contentType: typeof CAST_CONTENT_TYPE
  title: string | null
  posterUrl: string | null
  startPositionSeconds: number
  playbackRate: number
}

// A cast receiver fetches the URL itself, so only https can work; this also
// makes a local file: path structurally impossible on top of the input shape.
function isRemoteHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:"
  } catch {
    return false
  }
}

export function resolveCastMedia(input: CastMediaInput): CastMedia | null {
  // Same ??-chain as the screen: an empty string wins the chain and then
  // fails validation, matching what the local player would receive.
  const candidate =
    input.activeVariant?.hls ??
    input.video?.streamingUrl ??
    input.seedStreamingUrl
  const contentUrl = cleanStreamUrl(candidate)
  if (contentUrl == null || !isRemoteHttpsUrl(contentUrl)) return null
  const start = input.startPositionSeconds
  const rate = input.playbackRate
  return {
    contentUrl,
    contentType: CAST_CONTENT_TYPE,
    title: input.title,
    posterUrl: input.posterUrl,
    startPositionSeconds:
      start != null && Number.isFinite(start) && start > 0 ? start : 0,
    // Default to normal speed, never clamp: an out-of-band rate here means a
    // caller bug, and 1 is the only always-safe receiver rate.
    playbackRate:
      rate != null &&
      Number.isFinite(rate) &&
      rate >= CAST_MIN_PLAYBACK_RATE &&
      rate <= CAST_MAX_PLAYBACK_RATE
        ? rate
        : 1,
  }
}
