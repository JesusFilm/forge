import type { VideoPlayerStatus } from "expo-video"

import { classifyPlaybackState } from "./playbackState"

/** What a press of the play/pause control should do. */
export type PlayPressAction = "pause" | "replay" | "recover" | "play"

export type PlayPressState = {
  playing: boolean
  /** Typed, not a bare string, so a misspelled status literal is a compile
   *  error — the whole recovery path turns on this one value. */
  status: VideoPlayerStatus | ""
  duration: number
  currentTime: number
}

export function playPressAction(state: PlayPressState): PlayPressAction {
  const { duration, currentTime } = state
  // This caller has no end flag — it compares the live position to duration.
  const ended =
    Number.isFinite(duration) && duration > 0 && currentTime >= duration - 0.5

  switch (
    classifyPlaybackState({
      playing: state.playing,
      status: state.status,
      ended,
    })
  ) {
    case "playing":
      return "pause"
    case "errored":
      return "recover"
    case "ended":
      return "replay"
    default:
      return "play"
  }
}
