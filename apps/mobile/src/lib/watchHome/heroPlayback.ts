// Whether Home's hero yields (U8, R9). Pure, because the composition is the
// rule: it lives inline in a JSX prop otherwise, where nothing can falsify it.

export type HeroPausedInput = {
  /** The viewer scrolled past the hero threshold. */
  scrolledAway: boolean
  /** Home is the focused screen. */
  focused: boolean
  /** A mini player session holds playback (R9/R10). */
  miniPlayerActive: boolean
}

/**
 * One predicate, not a suspend reason on the pager: that union holds a single
 * slot and its clear is unconditional, so a second writer silently drops the
 * first the next time the viewer scrolls back to the top.
 *
 * Resume is gated on window-absent AS WELL AS focus, because the pop that
 * creates the window fires Home's focus listener in the same commit.
 */
export function heroPausedFor({
  scrolledAway,
  focused,
  miniPlayerActive,
}: HeroPausedInput): boolean {
  return scrolledAway || !focused || miniPlayerActive
}
