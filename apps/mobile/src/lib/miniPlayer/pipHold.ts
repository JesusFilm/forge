// R24's one rule, pure so it tests without React. While the OS
// picture-in-picture window is showing, every decision that would mount,
// unmount or hand over a video view reads its input through here.

/**
 * The value a held decision takes this render.
 *
 * `held` is what the same decision returned last render. Returning it, rather
 * than a snapshot taken when the latch armed, is what makes the release
 * automatic: the first render after the latch clears returns `next` again.
 */
export function pictureInPictureHold<T>(
  next: T,
  held: T,
  pipActive: boolean,
): T {
  return pipActive ? held : next
}
