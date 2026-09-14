import type { Prisma } from "@prisma/client"
import type { StudioPublish } from "@forge/studio-contracts/publication"

/** Calendar owns the implementation and its schema. This capability is injected
 * by trusted server code, never selected or supplied through a request body.
 *
 * The supplied now is an entry snapshot, not a clock after lock waits. Check
 * current server time against due/window after acquiring the slot lock.
 * Publication has already locked the project. Lock the schedule slot next;
 * validate and consume under that same transaction. Cancellation/reschedule
 * acquire the same locks in project-before-slot order. Check exact immutable
 * prior interactive authorization for schedule/version/due/window and
 * project/revision/approval/render/release, current non-revoked operator
 * membership, due time, cancellation, and consumption. Never create approval,
 * mutate the due instant, or lock an editable draft as a scheduling side effect.
 *
 * Throw new StudioCommandError(code), where code is a StudioPublicationFailure,
 * on rejection. The failure union is a code, not an exception. A late job may run only
 * within its previously authorized immutable window. Unready jobs stay hidden.
 * The common command resolves exact accepted receipts before this hook, so an
 * accepted retry does not consume twice or republish after later unpublication.
 * Prior human authorization pins project/revision/approval/render/release and
 * the schedule/version/due/window. readinessId is fresh server-resolved evidence
 * for that same release, not part of permanent human approval identity. Calendar
 * must never resolve or manufacture Mux evidence or substitute a release.
 * No network, rendering, provider or storage operation is allowed here.
 */
export type StudioSchedulePublicationHook = (
  tx: Prisma.TransactionClient,
  binding: StudioPublish & { schedule: NonNullable<StudioPublish["schedule"]> },
  now: Date,
) => Promise<void>

/** Supplied only by authenticated trusted server code; never parsed from HTTP. */
export type StudioScheduledPublication = {
  input: StudioPublish & { schedule: NonNullable<StudioPublish["schedule"]> }
  consume: StudioSchedulePublicationHook
}
