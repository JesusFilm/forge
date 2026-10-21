import { MUX_PLAYER_NAMES, type MuxPlayerName } from "./config"

/** The full-player surfaces. Explore joins later (U9). */
export type MuxViewSurface = "watch" | "experience"

/**
 * What the host knows about the video a view plays (KTD6). The host owns these
 * values and holds them per video; the hook only forwards them.
 */
export type MuxViewIdentity = {
  /** The Video `documentId`, or an Experience block's `videoId`. Null until known. */
  videoId: string | null
  /** The root player's slug. The Experience routes have none. */
  videoSlug: string | null
  /** A record title only, never a deep-link seed or a block title (R15). */
  title: string | null
}

export type MuxDownloadMarker = "downloaded" | "streamed"

/** Exactly the fields in the plan's data map (R14, R17, R19, R21, R22). */
export type MuxViewData = {
  player_name: MuxPlayerName
  viewer_user_id: string
  custom_1: MuxDownloadMarker
  video_id?: string
  video_title?: string
  custom_2?: string
  video_source_url?: string
}

export type MuxViewDataInput = {
  surface: MuxViewSurface
  identity: MuxViewIdentity
  streamUrl: string
  downloaded: boolean
  viewerId: string
  /** False when the backend cannot see seeks from the native controls (R13). */
  seesNativeControlSeeks: boolean
}

const REMOTE_URL = /^https?:\/\//i

function known(value: string | null): value is string {
  return value != null && value !== ""
}

export function buildMuxViewData(input: MuxViewDataInput): MuxViewData {
  const { surface, identity, streamUrl, downloaded } = input
  const data: MuxViewData = {
    player_name:
      surface === "experience" && !input.seesNativeControlSeeks
        ? MUX_PLAYER_NAMES.experience
        : MUX_PLAYER_NAMES.watch,
    viewer_user_id: input.viewerId,
    custom_1: downloaded ? "downloaded" : "streamed",
  }
  // A video change resets only video_*, so every root view sets custom_2 too
  // (KTD7). The routes never set it, or a root slug could carry over.
  if (surface === "watch" && known(identity.videoSlug))
    data.custom_2 = identity.videoSlug
  if (known(identity.videoId)) data.video_id = identity.videoId
  if (known(identity.title)) data.video_title = identity.title
  // R20: a local path names the iOS container, so only a remote URL is sent.
  if (!downloaded && REMOTE_URL.test(streamUrl))
    data.video_source_url = streamUrl
  return data
}
