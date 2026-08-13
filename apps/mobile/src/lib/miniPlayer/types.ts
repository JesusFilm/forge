// Shared vocabulary for the mini player, kept in its own leaf so the store and
// the surfaces can import it without importing each other.

/**
 * Why a mini player session ended. These map onto the widened VideoQoeReason
 * (U3): every one of them is a named cause, so a session that reports
 * "abandoned" means nobody named one.
 */
export type SessionEndReason =
  | "ended"
  | "replaced"
  | "dismissed"
  | "failed"
  | "signout"
