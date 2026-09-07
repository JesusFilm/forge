export class StudioCommandError extends Error {
  constructor(
    public readonly code:
      | "CONFLICT"
      | "IMMUTABLE"
      | "INVALID"
      | "APPROVAL_REQUIRED",
  ) {
    super(`Studio command rejected: ${code}`)
    this.name = "StudioCommandError"
  }
}
