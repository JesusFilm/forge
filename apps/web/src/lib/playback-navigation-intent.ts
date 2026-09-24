/** Local player intent handoff. The recorder never infers a user action from a media event alone. */
export const PLAYBACK_NAVIGATION_INTENT_EVENT =
  "forge:playback-navigation-intent"

export type PlaybackNavigationIntent =
  | { mediaId: string; action: "manual_skip" }
  | {
      mediaId: string
      action: "pause_intent"
      cause: "user" | "scroll" | "system"
    }

export function dispatchPlaybackNavigationIntent(
  intent: PlaybackNavigationIntent,
): void {
  window.dispatchEvent(
    new CustomEvent<PlaybackNavigationIntent>(
      PLAYBACK_NAVIGATION_INTENT_EVENT,
      {
        detail: intent,
      },
    ),
  )
}
