// Pure mount/play/poster gate for ReelPlayer (R10/R11/R18, KTD-2/KTD-3). React-free
// and colocated so the single-decoder contract is unit-testable — apps/tv has no
// render harness by convention (see videoBackdropGate.ts, the pattern this mirrors).

export type ReelPlayerGateInputs = {
  /** The showcase route is the foreground screen — false on nav-away/deep-link. */
  screenFocused: boolean
  /** App is not backgrounded. Derive via isAppStateForeground: "inactive" is a blip. */
  appForeground: boolean
  /** The reel wants this excerpt audible — false under chapter cards, interstitials, stills. */
  active: boolean
  /** A validated stream has been handed to the player. */
  hasStream: boolean
  /** Latched readyToPlay; resets only on a genuine error, never on a swap's idle blip. */
  videoReady: boolean
  /** The excerpt the reel wants playing now (reelState's source-swap guard token). */
  excerptToken: number
  /** The excerpt whose playback the player confirmed; null before the first frame. */
  confirmedToken: number | null
}

export type ReelPlayerGate = {
  /** Decode + play, audibly (R10). */
  shouldPlay: boolean
  /**
   * Mount the VideoView. Unmounting — never merely pausing — is what frees the
   * scarce tvOS decode slot on background and nav-away (R18).
   */
  shouldMountVideo: boolean
  /** Poster covers the VideoView. Must be true across every swap, seek, and unmount. */
  posterVisible: boolean
  /**
   * The poster may dissolve IN over the outgoing frame instead of snapping (R11).
   * Only when the VideoView is still mounted — otherwise there is nothing beneath
   * it and a fade would bleed the bare screen background through.
   */
  posterCrossfade: boolean
  /** U7's `isSourceSwapping`: a language-rotation swap is not a rebuffer (KTD-9). */
  swapInFlight: boolean
}

/**
 * Single source of truth for play/mount/poster, so a swap, the app lifecycle, and
 * the reel's phase can never race into a black frame or a second decoder. `active`
 * pauses but keeps the view mounted — the card is the next excerpt's buffer (R17).
 */
export function computeReelPlayerGate({
  screenFocused,
  appForeground,
  active,
  hasStream,
  videoReady,
  excerptToken,
  confirmedToken,
}: ReelPlayerGateInputs): ReelPlayerGate {
  const shouldMountVideo =
    hasStream && videoReady && screenFocused && appForeground
  // Identity, not staleness: a late confirmation for an earlier excerpt leaves the
  // poster up, because the source on screen is not the one the reel is asking for.
  const swapInFlight = confirmedToken !== excerptToken
  return {
    shouldPlay: shouldMountVideo && active,
    shouldMountVideo,
    // An unmounted VideoView leaves bare screen background behind it, so the
    // poster covers the lifecycle gaps as well as the swaps.
    posterVisible: swapInFlight || !shouldMountVideo,
    // An advance holds the outgoing stream mounted until its replacement resolves,
    // so its last frame is what the poster dissolves over. Android's previous-frame
    // flash lands on that same frame mid-dissolve, which is what we are showing.
    posterCrossfade: swapInFlight && shouldMountVideo,
    swapInFlight,
  }
}
