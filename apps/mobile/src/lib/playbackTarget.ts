/**
 * KTD4: the one command/read surface for the chrome during a cast session.
 * Local mode is null — the controls keep the live expo-video player. Pure:
 * no react-native or SDK imports, so it tests without the RN runtime.
 */
import type { CastPhase } from "./cast/castSessionReducer"
import { extractMuxPlaybackId } from "./muxThumbnail"

export type PlaybackTarget = {
  isPlaying: boolean
  currentTime: number
  duration: number
  /** Session Finished state — the chrome shows Replay. */
  ended: boolean
  /** R16: true while connecting — transport commands are inert until the
   *  receiver confirms playback, and consumers skip optimistic updates. */
  held: boolean
  play: () => void
  pause: () => void
  seekTo: (positionSeconds: number) => void
}

export type CastTargetInput = {
  phase: CastPhase
  /** Receiver playhead in seconds, null until it reports. */
  position: number | null
  /** Remote stream duration in seconds, null until it reports. */
  duration: number | null
  /** Raw receiver player state ("playing" | "paused" | ...), null without
   *  remote media. */
  remotePlayerState: string | null
  play: () => void
  pause: () => void
  seekTo: (positionSeconds: number) => void
  /** Frozen local snapshot shown before the receiver reports. */
  fallbackPositionSeconds: number
  fallbackDurationSeconds: number
}

const noop = () => {}

/** The phases where the session owns the player area and the transport. */
export function isRemoteCastPhase(phase: CastPhase): boolean {
  return phase === "connecting" || phase === "active" || phase === "finished"
}

/** Buffering counts as playing: the receiver intends to play, so the chrome
 *  must keep offering Pause. */
export function isRemotePlayingState(playerState: string | null): boolean {
  return playerState === "playing" || playerState === "buffering"
}

export function selectPlaybackTarget(
  input: CastTargetInput,
): PlaybackTarget | null {
  if (!isRemoteCastPhase(input.phase)) return null
  const held = input.phase === "connecting"
  return {
    isPlaying: !held && isRemotePlayingState(input.remotePlayerState),
    currentTime: input.position ?? input.fallbackPositionSeconds,
    duration: input.duration ?? input.fallbackDurationSeconds,
    ended: input.phase === "finished",
    held,
    play: held ? noop : input.play,
    pause: held ? noop : input.pause,
    seekTo: held ? noop : input.seekTo,
  }
}

// R2: the SDK cannot distinguish "no devices" from a denied iOS local-network
// permission — both pin NO_DEVICES_AVAILABLE and Apple exposes no query API —
// so the button hides for both. A future native permission probe slots in here.
export function castDevicesAvailable(castState: string | null): boolean {
  return castState != null && castState !== "noDevicesAvailable"
}

/** State-aware Cast button accessibility label (R1/R2). */
export function castButtonLabel(
  phase: CastPhase,
  deviceName: string | null,
): string {
  if (!isRemoteCastPhase(phase)) return "Cast"
  return deviceName != null ? `Casting to ${deviceName}` : "Casting"
}

/** Player-area indicator label — distinct while connecting (R16), named
 *  while live (R7). Only meaningful in a remote phase. */
export function castIndicatorLabel(
  phase: CastPhase,
  deviceName: string | null,
): string {
  if (phase === "connecting") {
    return deviceName != null ? `Connecting to ${deviceName}…` : "Connecting…"
  }
  return deviceName != null ? `Casting to ${deviceName}` : "Casting"
}

/** The screen's instruction to the player after a terminal session state:
 *  seek to the TV's last position and keep the session's play/pause state. */
export type CastRecovery = {
  positionSeconds: number | null
  /** True when the receiver was playing — local playback resumes. */
  resume: boolean
  /** True when releasing the source pin reloads the player (dub switched
   *  mid-session) — the seek must wait for the new source to load. */
  sourceSwapped: boolean
}

// Mirrors useManagedVideoPlayer's swap predicate (Mux playback-id compare):
// equal ids mean the adapter will NOT reload when the pin releases.
export function releaseTriggersSwap(
  pinnedUrl: string | null,
  currentUrl: string | null,
): boolean {
  if (pinnedUrl == null || currentUrl == null || pinnedUrl === currentUrl) {
    return false
  }
  const pinnedId = extractMuxPlaybackId(pinnedUrl)
  const currentId = extractMuxPlaybackId(currentUrl)
  return !(pinnedId != null && currentId != null && pinnedId === currentId)
}
