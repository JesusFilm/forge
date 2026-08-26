import type { VideoPlayerStatus } from "expo-video"

/**
 * The transport's view of the player, shared by the control it SHOWS
 * (`playerCenterControl`) and the action a press PERFORMS (`playPressAction`).
 *
 * The two used to branch separately in the same order, kept in step by a
 * comment in each file. When they disagree the transport lies: announcing
 * "Replay" while the press recovers, or offering a retry that cannot work.
 * Deriving both from here makes the order structural instead of a promise.
 */
export type PlaybackState = "playing" | "errored" | "ended" | "idle"

export type PlaybackStateInput = {
  playing: boolean
  /** Typed, not a bare string, so a misspelled status literal is a compile
   *  error — the whole recovery path turns on this one value. */
  status: VideoPlayerStatus | ""
  /** How a finished video is recognised differs per caller: the chrome holds a
   *  `playToEnd` flag, the press handler compares live position to duration. */
  ended: boolean
}

export function classifyPlaybackState(
  state: PlaybackStateInput,
): PlaybackState {
  if (state.playing) return "playing"
  // BEFORE the finished-video branch: an errored player can report a position
  // at or past its duration, and replaying it seeks a player that cannot play.
  if (state.status === "error") return "errored"
  if (state.ended) return "ended"
  return "idle"
}
