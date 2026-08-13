// Shared vocabulary for the mini player, kept in its own leaf so the store and
// the surfaces can import it without importing each other.

import type { VideoQoeReason } from "../videoQoe"

/**
 * Why a mini player session ended — every NAMED cause, derived from the
 * telemetry vocabulary rather than restated beside it. "abandoned" is excluded
 * because it is the residual: it means nobody named a cause, so it can never
 * be something a caller deliberately passes.
 *
 * Deriving it this way is load-bearing. A reason added to one list and
 * forgotten in the other is exactly how a deliberate end starts reporting
 * itself as an abandonment.
 */
export type SessionEndReason = Exclude<VideoQoeReason, "abandoned">
