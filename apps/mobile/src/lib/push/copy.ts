/**
 * R21's one named copy constant. English only for now, and held here on its
 * own so the localization work can adopt it without touching the tap path.
 *
 * It is shown when a notification names a destination this build cannot read:
 * an unknown kind or a malformed payload. A destination that no longer exists
 * is NOT this message — that route shows its own not-found screen (R30).
 */
export const PUSH_UNRESOLVABLE_DESTINATION_MESSAGE =
  "We could not open that announcement. Here is the home screen."
