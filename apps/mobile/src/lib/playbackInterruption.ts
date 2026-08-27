/**
 * Pause the app's one player for something presented OVER it, and resume only
 * if playback was running.
 *
 * The app owns a single player inside `PlaybackHost`, which is a sibling of the
 * navigation stack, so a component in the route tree cannot reach it. This is
 * the same module-scope channel `playbackRequest.ts` uses for the other
 * direction; the host registers a transport here and any surface may borrow it.
 *
 * MEASURED, 2026-08-27, Android 15 emulator, expo-video 57.0.3 +
 * expo-web-browser 57.0.2: launching a browser over a PLAYING video drops the
 * app into a picture-in-picture window (`mLastReportedPictureInPictureMode`
 * false → true) and playback keeps running there. expo-web-browser sets
 * FLAG_ACTIVITY_NEW_TASK / EXCLUDE_FROM_RECENTS / NO_HISTORY and NOT
 * FLAG_ACTIVITY_NO_USER_ACTION, so the launch is a user-leave, and expo-video
 * passes `setAutoEnterEnabled` straight through. So the pause below is
 * load-bearing on Android, not a mirror of the iOS one.
 *
 * Pausing BEFORE presenting is also what keeps ONE owner of the resume: the
 * app's AppState handler records `wasPlaying` on departure, reads false because
 * this already paused, and therefore declines to resume. This handle resumes.
 *
 * React-native-free so it stays unit-testable; the caller owns the lifecycle
 * signal that says the viewer is back.
 */

export type PlaybackTransport = {
  isPlaying: () => boolean
  pause: () => void
  play: () => void
}

export type PlaybackInterruption = {
  /** Whether playback was running when the interruption began. */
  readonly wasPlaying: boolean
  /** Idempotent. Resumes only when playback was running at the start. */
  resume: () => void
}

let transport: PlaybackTransport | null = null

/** The host registers on mount and clears on teardown. */
export function setPlaybackTransport(next: PlaybackTransport | null): void {
  transport = next
}

export function beginPlaybackInterruption(): PlaybackInterruption {
  let wasPlaying = false
  try {
    wasPlaying = transport?.isPlaying() ?? false
  } catch {
    wasPlaying = false // Native player already released.
  }

  if (wasPlaying) {
    try {
      transport?.pause()
    } catch {
      // Already released: nothing is playing, so nothing needs resuming.
      wasPlaying = false
    }
  }

  let settled = false
  return {
    wasPlaying,
    resume: () => {
      if (settled) return
      settled = true
      if (!wasPlaying) return
      try {
        transport?.play()
      } catch {
        // Released while away. The viewer still has the play control.
      }
    },
  }
}

export function resetPlaybackTransportForTests(): void {
  transport = null
}
