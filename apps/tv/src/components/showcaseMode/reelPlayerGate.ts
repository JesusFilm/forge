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
  /**
   * KTD-5: the swap INTO this token is a hop continuation (same footage, next dub), not
   * a content cut. True only for hop indices past the opener — the entry into the
   * centerpiece and the exit past it are ordinary poster-masked seams.
   */
  hopSwap: boolean
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
   * The poster MAY dissolve in over the outgoing frame (R11) — permission, not a
   * promise: ReelPlayer's covered branch instead defers the cover and snaps it under
   * the opaque overlay. False when unmounted (a fade would bleed bare background).
   */
  posterCrossfade: boolean
  /**
   * The reel WANTS this excerpt playing — shouldPlay minus videoReady. The watchdog
   * arms on this: a source that never starts never emits readyToPlay, so gating its
   * clock on videoReady would disarm it for the exact fault it exists to catch.
   */
  playIntended: boolean
  /** U7's `isSourceSwapping`: an excerpt/hop swap is not a rebuffer (KTD-9). */
  swapInFlight: boolean
  /**
   * KTD-5: a hop swap is masked by a brief dip over the LIVE video surface, never the
   * poster (same footage — a poster would read as a cut). True only while a hop swap is
   * in flight AND the video is mounted; a backgrounded hop falls back to the poster.
   */
  hopDipActive: boolean
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
  hopSwap,
}: ReelPlayerGateInputs): ReelPlayerGate {
  const shouldMountVideo =
    hasStream && videoReady && screenFocused && appForeground
  // Identity, not staleness: a late confirmation for an earlier excerpt leaves the
  // poster up, because the source on screen is not the one the reel is asking for.
  const swapInFlight = confirmedToken !== excerptToken
  // A hop swap over a live surface is masked by the dip, so the poster stands down for
  // it; a hop swap over an UNMOUNTED video has no frame to hold and falls to the poster.
  const maskWithPoster = swapInFlight && !hopSwap
  return {
    shouldPlay: shouldMountVideo && active,
    shouldMountVideo,
    // Deliberately NOT gated on videoReady — see the type's doc.
    playIntended: active && hasStream && screenFocused && appForeground,
    // An unmounted VideoView leaves bare screen background behind it, so the
    // poster covers the lifecycle gaps as well as the swaps.
    posterVisible: maskWithPoster || !shouldMountVideo,
    // An advance holds the outgoing stream mounted until its replacement resolves,
    // so its last frame is what the poster dissolves over. Android's previous-frame
    // flash lands on that same frame mid-dissolve, which is what we are showing.
    posterCrossfade: maskWithPoster && shouldMountVideo,
    swapInFlight,
    // Same-footage seam: hold the live frame and dip over it, never the poster.
    hopDipActive: hopSwap && swapInFlight && shouldMountVideo,
  }
}

/**
 * AVPlayer seeks land on keyframes, so a LANDED seek can settle a few seconds shy of
 * the requested start; only a gap past this is a dropped seek needing the heal.
 */
export const WINDOW_SEEK_TOLERANCE_SECONDS = 4

/**
 * tvOS can silently drop the `currentTime` write issued right after replaceAsync
 * (the item is not yet seekable), leaving a mid-video window playing from 0:00 —
 * latent in the shipped short-form-first fallback reel, where startSeconds is 0.
 * True = the confirmed clock sits meaningfully below the window: re-issue the seek.
 */
export function needsWindowStartSeek(args: {
  currentTime: number
  startSeconds: number
}): boolean {
  return (
    args.startSeconds > 0 &&
    args.currentTime + WINDOW_SEEK_TOLERANCE_SECONDS < args.startSeconds
  )
}
