import type { StudioPublicationFailure } from "@forge/studio-contracts/publication"

export class StudioCommandError extends Error {
  constructor(
    public readonly code:
      | "CONFLICT"
      | "IMMUTABLE"
      | "INVALID"
      | "PRODUCTION_DISABLED"
      | StudioPublicationFailure,
  ) {
    super(`Studio command rejected: ${code}`)
    this.name = "StudioCommandError"
  }
}

export class StudioProductionPreflightError extends Error {}

/** Thrown only after publication receipt lookup and before transaction commit. */
export class StudioPublicationRejected extends StudioCommandError {
  constructor(error: StudioCommandError) {
    super(error.code)
    this.name = "StudioPublicationRejected"
  }
}
