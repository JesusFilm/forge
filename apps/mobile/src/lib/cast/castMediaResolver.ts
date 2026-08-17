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
}

export const CAST_CONTENT_TYPE = "application/x-mpegURL"

export type CastMedia = {
  contentUrl: string
  contentType: typeof CAST_CONTENT_TYPE
  title: string | null
  posterUrl: string | null
  startPositionSeconds: number
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
  return {
    contentUrl,
    contentType: CAST_CONTENT_TYPE,
    title: input.title,
    posterUrl: input.posterUrl,
    startPositionSeconds:
      start != null && Number.isFinite(start) && start > 0 ? start : 0,
  }
}
