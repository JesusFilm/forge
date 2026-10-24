import type { StudioPublish } from "@forge/studio-contracts/publication"
type Binding = Omit<StudioPublish, "readinessId" | "schedule">
class PublicationRecoveryError extends Error {}

/** An uncertain submission is immutable until its exact receipt is resolved.
 * Only a canonical rejection after receipt lookup may enable a fresh command. */
export class PublicationSubmission {
  private pending: StudioPublish | null = null
  private confirmedRejection = false
  private preparing = false
  private submitting = false
  get command() {
    return this.pending
  }
  get rejected() {
    return this.confirmedRejection
  }
  async prepare(
    binding: Binding,
    prepare: (
      binding: Binding,
    ) => Promise<{ releaseId: string; readinessId: string }>,
    isCurrent: (binding: Binding) => boolean,
  ) {
    if (this.pending || this.preparing)
      throw new PublicationRecoveryError(
        "Resolve the existing publication first",
      )
    this.preparing = true
    try {
      const captured = { ...binding }
      const result = await prepare(captured)
      if (result.releaseId !== captured.releaseId || !isCurrent(captured))
        throw new PublicationRecoveryError(
          "Project changed during preparation. Review the current render.",
        )
      this.pending = Object.freeze({
        ...captured,
        readinessId: result.readinessId,
      })
      this.confirmedRejection = false
    } finally {
      this.preparing = false
    }
  }
  async submit(
    call: (command: StudioPublish) => Promise<unknown>,
    confirmedNotCommitted: (error: unknown) => boolean,
  ) {
    if (!this.pending || this.submitting)
      throw new PublicationRecoveryError(
        "Prepare publication first or wait for its response",
      )
    this.submitting = true
    try {
      const result = await call(this.pending)
      this.pending = null
      this.confirmedRejection = false
      return result
    } catch (error) {
      this.confirmedRejection = confirmedNotCommitted(error)
      throw error
    } finally {
      this.submitting = false
    }
  }
  discardRejected() {
    if (this.submitting || !this.confirmedRejection)
      throw new PublicationRecoveryError(
        "An uncertain publication must retain its exact command",
      )
    this.pending = null
    this.confirmedRejection = false
  }
}
