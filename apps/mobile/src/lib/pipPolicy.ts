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
