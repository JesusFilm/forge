/**
 * Pure "is playback on an external route" predicate for the watch player.
 * No react-native / expo imports, so it tests without the RN runtime.
 */

export type ExternalRouteState = {
  /** True while the player sends video to an AirPlay device (iOS only). */
  airPlayActive: boolean
  // U4 adds the cast-session flag here; extend this state, never fork it.
}

/** The indicator and the subtitle-overlay gate read this, never a raw flag. */
export function isExternalRouteActive(state: ExternalRouteState): boolean {
  return state.airPlayActive
}
