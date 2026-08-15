// R24's one rule, pure so it tests without React. While the OS
// picture-in-picture window is showing, every decision that would mount,
// unmount or hand over a video view reads its input through here.

/**
 * The value a held decision takes this render.
 *
 * `held` is what the same decision returned last render. Returning it, rather
 * than a snapshot taken when the latch armed, is what makes the release
 * automatic: the first render after the latch clears returns `next` again.
 *
 * A NULLISH held value is never held. The rule protects a live surface from a
 * teardown or a handoff; it must not be able to freeze the ABSENCE of one. The
 * viewer can start the operating system's window from the FOREGROUND — the
 * SDUI routes render native controls — so the latch arms with no session and no
 * claim, and a hold that pinned that `null` stopped every later claim from ever
 * building a player.
 */
export function pictureInPictureHold<T>(
  next: T,
  held: T,
  pipActive: boolean,
): T {
  if (!pipActive || held == null) return next
  return held
}
