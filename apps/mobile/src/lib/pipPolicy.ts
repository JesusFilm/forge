// Pure AppState policy for the one player (R13, KTD12). Framework-free so it
// unit-tests without react-native; the adapter and the root host both read it.

/**
 * Should an AppState transition pause playback?
 *
 * Allow-list rather than "anything that is not active", which is what the
 * adapter did before the mini player. Two states have to be excluded and
 * neither is obvious:
 *
 * - `background` while picture-in-picture is active. Android reports
 *   picture-in-picture ENTRY as `background`, not `inactive`, so the old rule
 *   paused the video the system had just handed to the floating OS window.
 * - `inactive` at all. It is iOS's transient app-switcher / control-centre /
 *   incoming-call state, which the viewer swipes straight back out of.
 *
 * An unrecognised state never pauses: React Native has added states before,
 * and pausing is the destructive answer to "I do not know what this is".
 */
export function shouldPauseOnAppStateChange(
  nextState: string,
  pipActive: boolean,
): boolean {
  return nextState === "background" && !pipActive
}

/**
 * Should the picture-in-picture START put playback back?
 *
 * The two platforms report the pair in OPPOSITE orders, and only one of them
 * reaches the rule above in time.
 *
 * - iOS sends `inactive` → start → `background`. The latch is set before any
 *   pause decision, so nothing was ever paused and this answers no.
 * - Android sends `background` FIRST. React Native's `AppStateModule` emits it
 *   from `onHostPause`, and expo-video's own `PictureInPictureManager` records
 *   in source that it "receive[s] this event before any info on app entering
 *   PiP". The pause has already fired by the time the window opens, so without
 *   this the window shows a frozen frame with no audio for its whole life.
 *
 * The answer is exactly "undo the pause that the departure caused", never "play
 * whatever is loaded": a video the viewer had already paused must stay paused.
 */
export function shouldResumeOnPictureInPictureStart(
  pausedOnDeparture: boolean,
): boolean {
  return pausedOnDeparture
}
