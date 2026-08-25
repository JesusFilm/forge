import type { VideoPlayerStatus } from "expo-video"

import { classifyPlaybackState } from "./playbackState"

/**
 * Which affordance the transport's centre control shows.
 *
 * `offline` exists because a stopped video looked identical whatever stopped it
 * (todos/024). A play button over a failed stream both hides the reason and
 * offers a retry that cannot succeed while the device has no connection.
 */
export type CenterControl = "play" | "pause" | "replay" | "offline"

export type CenterControlState = {
  playing: boolean
  ended: boolean
  /** Typed, not a bare string, so a misspelled status literal is a compile
   *  error — the whole recovery path turns on this one value. */
  status: VideoPlayerStatus | ""
  online: boolean
}

export function playerCenterControl(state: CenterControlState): CenterControl {
  switch (classifyPlaybackState(state)) {
    case "playing":
      return "pause"
    // Only a FAILED source earns the indicator: a video still running from its
    // buffer is unaffected by the connection dropping.
    case "errored":
      return state.online ? "play" : "offline"
    case "ended":
      return "replay"
    default:
      return "play"
  }
}
