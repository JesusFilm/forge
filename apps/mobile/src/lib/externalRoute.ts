/**
 * Pure "is playback on an external route" predicate for the watch player.
 * No react-native / expo imports, so it tests without the RN runtime.
 */

export type ExternalRouteState = {
  /** True while the player sends video to an AirPlay device (iOS only). */
  airPlayActive: boolean
  /** True while a cast session occupies the player area (connecting,
   *  active, or finished — the KTD4 remote phases). */
  castActive: boolean
}

/** The indicator and the subtitle-overlay gate read this, never a raw flag. */
export function isExternalRouteActive(state: ExternalRouteState): boolean {
  return state.airPlayActive || state.castActive
}
